import { useEffect, useRef } from "react";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import api from "../api";
import { get, set, useStore } from "../store";
import {
  clearFlash,
  extensions,
  flashRange,
  freshState,
  marksFor,
  setMarks,
} from "./editor-setup";

/** Autosave delay.  The server debounces the compile again on its side; this
 *  half is deliberately short so the total wait after the last keystroke is
 *  the compile itself and not much else. */
const SAVE_DELAY = 250;

type Buffer = { state: EditorState; saved: string };

export type EditorHandle = {
  open(path: string, line?: number): Promise<void>;
  close(path: string): Promise<void>;
  reload(path: string): Promise<void>;
  flash(line: number, endLine?: number): void;
  saveNow(): Promise<void>;
  textOf(path: string): string | null;
};

export default function Editor({
  handleRef,
}: {
  handleRef: (handle: EditorHandle) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const buffers = useRef(new Map<string, Buffer>());
  const current = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  const openRef = useRef<((path: string, line?: number) => Promise<void>) | null>(null);
  // The parent hands us a new callback on every render.  Holding it in a ref
  // keeps the setup effect at zero dependencies, which matters more than it
  // sounds: an effect that re-runs destroys the view mid-edit and the
  // pending autosave then writes what the empty replacement contains.
  const publish = useRef(handleRef);
  publish.current = handleRef;

  const pendingOpen = useStore((s) => s.pendingOpen);
  const diagnostics = useStore((s) => s.diagnostics);
  const lint = useStore((s) => s.lint);
  const activePath = useStore((s) => s.activePath);

  useEffect(() => {
    if (!host.current || view.current) return;

    /** Write one file, and only if the view still holds it. */
    const saveFile = async (path: string) => {
      const editor = view.current;
      if (!editor || current.current !== path) return;
      const buffer = buffers.current.get(path);
      const text = editor.state.doc.toString();
      if (!buffer || buffer.saved === text) return;
      const projectId = get().projectId;
      if (!projectId) return;
      try {
        await api.writeFile(projectId, path, text);
        buffer.saved = text;
        set({
          tabs: get().tabs.map((tab) =>
            tab.path === path ? { ...tab, dirty: false } : tab,
          ),
        });
        lintFile(projectId, path);
      } catch (error: any) {
        set({ error: `Could not save ${path}: ${error.message}` });
      }
    };

    const cancelTimer = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    /** Write whatever is in the view now, before anything replaces it. */
    const flush = async () => {
      cancelTimer();
      const path = current.current;
      if (path) await saveFile(path);
    };

    const onChange = () => {
      const path = current.current;
      if (!path) return;
      const tabs = get().tabs;
      if (!tabs.find((tab) => tab.path === path)?.dirty) {
        set({
          tabs: tabs.map((tab) =>
            tab.path === path ? { ...tab, dirty: true } : tab,
          ),
        });
      }
      cancelTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        saveFile(path);
      }, SAVE_DELAY);
    };

    const onCursor = (line: number, column: number, selection: string) => {
      const cursor = get().cursor;
      if (cursor.line !== line || cursor.column !== column) {
        set({ cursor: { line, column } });
      }
      // Where the user is looking, told to the server on a delay: it is
      // what the agent's "here" and "this" resolve to, and it changes on
      // every keystroke.
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(() => {
        focusTimer.current = null;
        const projectId = get().projectId;
        const path = current.current;
        if (!projectId || !path) return;
        api
          .setFocus(projectId, path, line, column, selection)
          .catch(() => undefined);
      }, 400);
    };

    const ext = extensions(onChange, onCursor);
    view.current = new EditorView({ parent: host.current, state: freshState("", ext) });

    const jump = (line: number, endLine?: number) => {
      const editor = view.current;
      if (!editor) return;
      const total = editor.state.doc.lines;
      const target = editor.state.doc.line(Math.min(Math.max(line, 1), total));
      const end = endLine
        ? editor.state.doc.line(Math.min(Math.max(endLine, 1), total))
        : target;
      editor.dispatch({
        selection: { anchor: target.from },
        effects: [
          EditorView.scrollIntoView(target.from, { y: "center" }),
          flashRange.of({ from: target.from, to: end.to }),
        ],
      });
      editor.focus();
      // 700ms, matching the SyncTeX highlight in the spec: long enough to
      // find with the eye after a jump, short enough not to linger.
      window.setTimeout(() => {
        view.current?.dispatch({ effects: flashRange.of(null) });
      }, 700);
      window.setTimeout(() => {
        view.current?.dispatch({ effects: clearFlash.of(null) });
      }, 1200);
    };

    const openBuffer = async (path: string, line?: number) => {
      const projectId = get().projectId;
      if (!projectId || !view.current) return;
      if (current.current === path) {
        if (line !== undefined) jump(line);
        return;
      }
      // The outgoing file is written before its state leaves the view, or an
      // edit made in the last quarter second is lost to a tab click.
      await flush();
      let buffer = buffers.current.get(path);
      if (!buffer) {
        const file = await api.readFile(projectId, path);
        buffer = { state: freshState(file.text, ext), saved: file.text };
        buffers.current.set(path, buffer);
      }
      if (current.current && view.current) {
        const outgoing = buffers.current.get(current.current);
        if (outgoing) outgoing.state = view.current.state;
      }
      current.current = path;
      view.current.setState(buffer.state);
      if (line !== undefined) jump(line);
      api.setFocus(projectId, path).catch(() => undefined);
      lintFile(projectId, path);
    };
    openRef.current = openBuffer;

    /** Replace a buffer's text with what is on disk, keeping the history. */
    const replaceText = (path: string, text: string) => {
      const buffer = buffers.current.get(path);
      if (!buffer) return;
      if (current.current === path && view.current) {
        const editor = view.current;
        const scroll = editor.scrollDOM.scrollTop;
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
        });
        editor.scrollDOM.scrollTop = scroll;
        buffer.state = editor.state;
      } else {
        buffer.state = buffer.state.update({
          changes: { from: 0, to: buffer.state.doc.length, insert: text },
        }).state;
      }
      buffer.saved = text;
    };

    publish.current({
      open: openBuffer,
      close: async (path) => {
        if (current.current === path) await flush();
        else {
          const buffer = buffers.current.get(path);
          if (buffer && buffer.saved !== buffer.state.doc.toString()) {
            const projectId = get().projectId;
            if (projectId) {
              await api
                .writeFile(projectId, path, buffer.state.doc.toString())
                .catch(() => undefined);
            }
          }
        }
        buffers.current.delete(path);
        if (current.current === path) current.current = null;
      },
      reload: async (path) => {
        const projectId = get().projectId;
        if (!projectId) return;
        const buffer = buffers.current.get(path);
        if (!buffer) return;
        const live =
          current.current === path && view.current
            ? view.current.state.doc.toString()
            : buffer.state.doc.toString();
        // Never overwrite unsaved work with what is on disk.  The tab stays
        // dirty and the user decides.
        if (live !== buffer.saved) return;
        const file = await api.readFile(projectId, path);
        if (file.text !== live) replaceText(path, file.text);
      },
      flash: jump,
      saveNow: flush,
      textOf: (path) => {
        if (current.current === path && view.current) {
          return view.current.state.doc.toString();
        }
        return buffers.current.get(path)?.state.doc.toString() ?? null;
      },
    });

    // Closing the tab mid-edit should not lose the last quarter second.
    const onLeave = () => {
      const path = current.current;
      const editor = view.current;
      const projectId = get().projectId;
      if (!path || !editor || !projectId) return;
      const buffer = buffers.current.get(path);
      const text = editor.state.doc.toString();
      if (!buffer || buffer.saved === text) return;
      navigator.sendBeacon?.(
        `/api/projects/${projectId}/file/beacon`,
        new Blob([JSON.stringify({ path, text })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onLeave);

    return () => {
      window.removeEventListener("pagehide", onLeave);
      cancelTimer();
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pendingOpen) return;
    openRef.current?.(pendingOpen.path, pendingOpen.line).catch((error) => {
      set({ error: `Could not open ${pendingOpen.path}: ${error.message}` });
    });
  }, [pendingOpen]);

  // Diagnostics repaint whenever a build or a lint pass lands.
  useEffect(() => {
    if (!view.current || !activePath) return;
    const marks = [
      ...marksFor(diagnostics, activePath),
      ...marksFor(lint, activePath),
    ];
    view.current.dispatch({ effects: setMarks.of(marks) as StateEffect<any> });
  }, [diagnostics, lint, activePath]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

let lintTimer: number | null = null;
function lintFile(projectId: string, path: string) {
  if (!path.endsWith(".tex")) {
    set({ lint: [] });
    return;
  }
  if (lintTimer !== null) window.clearTimeout(lintTimer);
  lintTimer = window.setTimeout(async () => {
    try {
      const result = await api.lint(projectId, path);
      set({ lint: result.diagnostics });
    } catch {
      set({ lint: [] });
    }
  }, 600);
}
