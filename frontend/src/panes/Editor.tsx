import { useEffect, useRef } from "react";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import api from "../api";
import { get, set, useStore } from "../store";
import { extensions, flashRange, freshState, marksFor, setMarks } from "./editor-setup";

/** Autosave delay.  The server debounces the compile again on its side; this
 *  half is deliberately short so the total wait after the last keystroke is
 *  the compile itself and not much else. */
const SAVE_DELAY = 250;

type Buffer = { state: EditorState; saved: string };

export type EditorHandle = {
  open(path: string, line?: number): Promise<void>;
  close(path: string): void;
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
  const openRef = useRef<((path: string, line?: number) => Promise<void>) | null>(null);
  const pendingOpen = useStore((s) => s.pendingOpen);
  const diagnostics = useStore((s) => s.diagnostics);
  const lint = useStore((s) => s.lint);
  const activePath = useStore((s) => s.activePath);

  useEffect(() => {
    if (!host.current || view.current) return;

    const save = async () => {
      const path = current.current;
      const editor = view.current;
      if (!path || !editor) return;
      const text = editor.state.doc.toString();
      const buffer = buffers.current.get(path);
      if (buffer && buffer.saved === text) return;
      const projectId = get().projectId;
      if (!projectId) return;
      try {
        await api.writeFile(projectId, path, text);
        const entry = buffers.current.get(path);
        if (entry) entry.saved = text;
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
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(save, SAVE_DELAY);
    };

    const onCursor = (line: number, column: number) => {
      const cursor = get().cursor;
      if (cursor.line !== line || cursor.column !== column) {
        set({ cursor: { line, column } });
      }
    };

    const ext = extensions(onChange, onCursor);
    view.current = new EditorView({ parent: host.current, state: freshState("", ext) });

    const openBuffer = async (path: string, line?: number) => {
      const projectId = get().projectId;
      if (!projectId || !view.current) return;
      let buffer = buffers.current.get(path);
      if (!buffer) {
        const file = await api.readFile(projectId, path);
        buffer = { state: freshState(file.text, ext), saved: file.text };
        buffers.current.set(path, buffer);
      } else if (current.current === path && line === undefined) {
        return;
      }
      if (current.current && current.current !== path && view.current) {
        const existing = buffers.current.get(current.current);
        if (existing) existing.state = view.current.state;
      }
      current.current = path;
      view.current.setState(buffer.state);
      if (line !== undefined) jump(line);
      api.setFocus(projectId, path).catch(() => undefined);
      lintFile(projectId, path);
    };

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
    };

    openRef.current = openBuffer;
    handleRef({
      open: openBuffer,
      close: (path) => {
        buffers.current.delete(path);
        if (current.current === path) current.current = null;
      },
      reload: async (path) => {
        const projectId = get().projectId;
        if (!projectId) return;
        const buffer = buffers.current.get(path);
        // Never overwrite unsaved work with what is on disk.  The tab stays
        // dirty and the user decides.
        if (buffer && view.current && current.current === path) {
          if (buffer.saved !== view.current.state.doc.toString()) return;
        } else if (buffer && buffer.saved !== buffer.state.doc.toString()) {
          return;
        }
        const file = await api.readFile(projectId, path);
        const replaced = { state: freshState(file.text, ext), saved: file.text };
        buffers.current.set(path, replaced);
        if (current.current === path && view.current) {
          const scroll = view.current.scrollDOM.scrollTop;
          view.current.setState(replaced.state);
          view.current.scrollDOM.scrollTop = scroll;
        }
      },
      flash: jump,
      saveNow: save,
      textOf: (path) => {
        if (current.current === path && view.current) {
          return view.current.state.doc.toString();
        }
        return buffers.current.get(path)?.state.doc.toString() ?? null;
      },
    });

    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [handleRef]);

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
