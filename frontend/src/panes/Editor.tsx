import { useEffect, useRef } from "react";
import {
  EDITOR_SIZES,
  applyAppearance,
  step,
  storedAppearance,
} from "../appearance";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diffLines } from "diff";
import api, { type Symbols } from "../api";
import {
  clearFlash,
  extensions,
  flashRange,
  freshState,
  marksFor,
  setDiff,
  setMarks,
  viewExtensions,
} from "./editor-setup";
import { get, markStale, set, useStore } from "../store";


/** Autosave delay.  The server debounces the compile again on its side; this
 *  half is deliberately short so the total wait after the last keystroke is
 *  the compile itself and not much else. */
const SAVE_DELAY = 250;

type Buffer = {
  state: EditorState;
  saved: string;
  /** What the file looked like when this tab last agreed with the disk.
   *  Sent with every save so the server can refuse to let this buffer
   *  overwrite work done in another window. */
  tag: string;
};

export type EditorHandle = {
  open(path: string, line?: number): Promise<void>;
  /** Show an old version of a file, read-only. */
  view(path: string, sha: string): Promise<void>;
  /** Put the live buffer back, with its undo history and cursor. */
  backToNow(): void;
  /** Paint the lines that differ from what is on screen now. */
  showChanges(on: boolean): void;
  close(path: string): Promise<void>;
  reload(path: string): Promise<void>;
  /** Answer a refused save: keep this tab's text, or take what is on disk. */
  resolveConflict(path: string, keep: "mine" | "theirs"): Promise<void>;
  /** Follow a file that has been renamed, keeping its buffer and history. */
  renamed(from: string, to: string): void;
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
  // While this is set the view holds historical text.  The live
  // EditorState stays parked in `buffers`, so its undo history and cursor
  // survive by never being touched.
  const viewing = useRef<{ path: string; sha: string; scroll: number } | null>(null);
  const symbols = useRef<Symbols | null>(null);

  const pendingOpen = useStore((s) => s.pendingOpen);
  const diagnostics = useStore((s) => s.diagnostics);
  const lint = useStore((s) => s.lint);
  const settings = useStore((s) => s.settings);
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
        const answer = await api.writeFile(
          projectId, path, text, true, buffer.tag,
        );
        if (answer.conflict) {
          // Nothing was written and nothing is thrown away: the buffer
          // stays dirty and the writer picks which copy survives.
          set({
            conflict: { path, theirs: answer.text ?? "", tag: answer.tag ?? "" },
          });
          return;
        }
        buffer.saved = text;
        buffer.tag = answer.tag ?? "";
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
      // The preview is behind the moment a key is pressed.  Said here as
      // well as from the server's `compile_scheduled`, because the writer
      // sees their own keystroke a save and a round trip before the server
      // hears about it -- and with compile-as-you-type off the server is
      // never told at all.
      //
      // Not while an old version is on screen, though: loading one replaces
      // the document, which is a change to the buffer and not a change to
      // the file.  Nothing has been edited, so the preview still matches
      // the source -- and a stale dot raised there would stay up until the
      // next build, which with compiling off might be tomorrow.
      if (!viewing.current) markStale();
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

    const ext = extensions(onChange, onCursor, () => symbols.current);
    const readOnlyExt = viewExtensions(() => symbols.current);
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

    const backToNow = () => {
      const parked = viewing.current;
      if (!parked || !view.current) return;
      const buffer = buffers.current.get(parked.path);
      viewing.current = null;
      if (buffer) {
        view.current.setState(buffer.state);
        view.current.scrollDOM.scrollTop = parked.scroll;
      }
      current.current = parked.path;
      set({ viewing: null });
      view.current.focus();
    };

    const openBuffer = async (path: string, line?: number) => {
      const projectId = get().projectId;
      if (!projectId || !view.current) return;
      if (viewing.current) backToNow();
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
        buffer = {
          state: freshState(file.text, ext), saved: file.text, tag: file.tag,
        };
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
    const replaceText = (path: string, text: string, tag?: string) => {
      const buffer = buffers.current.get(path);
      if (!buffer) return;
      if (current.current === path && view.current && !viewing.current) {
        const editor = view.current;
        const scroll = editor.scrollDOM.scrollTop;
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
        });
        editor.scrollDOM.scrollTop = scroll;
        buffer.state = editor.state;
        // The dispatch above ran the shared update listener, which marked
        // the tab dirty and armed a save; the save then returns early
        // because nothing changed, leaving a dot that means nothing.
        cancelTimer();
        set({
          tabs: get().tabs.map((tab) =>
            tab.path === path ? { ...tab, dirty: false } : tab,
          ),
        });
      } else {
        buffer.state = buffer.state.update({
          changes: { from: 0, to: buffer.state.doc.length, insert: text },
        }).state;
      }
      buffer.saved = text;
      if (tag !== undefined) buffer.tag = tag;
    };

    const viewVersion = async (path: string, sha: string) => {
      const projectId = get().projectId;
      const editor = view.current;
      if (!projectId || !editor) return;
      // Write anything pending first: entering a read-only view must not
      // strand an edit, and the buffer has to be clean to come back to.
      await flush();
      cancelTimer();
      if (current.current && current.current !== path) await openBuffer(path);
      const buffer = buffers.current.get(path);
      if (!buffer) return;
      buffer.state = editor.state;

      const file = await api.historyVersion(projectId, path, sha);
      // Nothing below can arm a save: `current.current` is null, so every
      // early return in onChange, saveFile, flush and the beacon fires.
      // Where the reader is, as a line rather than a pixel: the old
      // version is a different length, so a scroll offset would land
      // somewhere else entirely.
      const anchorLine = editor.state.doc.lineAt(
        editor.state.selection.main.head,
      ).number;
      viewing.current = { path, sha, scroll: editor.scrollDOM.scrollTop };
      current.current = null;
      // Set here rather than by the caller after its own await: clicking a
      // tab in between called backToNow(), which cleared it, and the
      // caller then set it again -- leaving a banner saying "viewing an old
      // version" over a live, editable buffer whose Restore button would
      // have written the old text over it.
      const version = get().history.find((item) => item.sha === sha) ?? null;
      if (version) set({ viewing: { path, sha, version } });
      editor.setState(freshState(file.text, readOnlyExt));
      const target = Math.min(anchorLine, editor.state.doc.lines);
      editor.dispatch({
        effects: EditorView.scrollIntoView(editor.state.doc.line(target).from, {
          y: "center",
        }),
      });
    };

    publish.current({
      open: openBuffer,
      view: viewVersion,
      backToNow,
      showChanges: (on: boolean) => {
        const parked = viewing.current;
        const editor = view.current;
        if (!parked || !editor) return;
        if (!on) {
          editor.dispatch({ effects: setDiff.of([]) });
          return;
        }
        const live = buffers.current.get(parked.path)?.state.doc.toString() ?? "";
        editor.dispatch({
          effects: setDiff.of(goneLines(editor.state.doc.toString(), live)),
        });
      },
      close: async (path) => {
        if (viewing.current?.path === path) backToNow();
        if (current.current === path) await flush();
        else {
          const buffer = buffers.current.get(path);
          if (buffer && buffer.saved !== buffer.state.doc.toString()) {
            const projectId = get().projectId;
            if (projectId) {
              await api
                .writeFile(
                  projectId, path, buffer.state.doc.toString(), true, buffer.tag,
                )
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
        const showing = current.current === path && view.current && !viewing.current;
        const live = showing
          ? view.current!.state.doc.toString()
          : buffer.state.doc.toString();
        // Never overwrite unsaved work with what is on disk.  The tab stays
        // dirty and the user decides -- but they are told, or an edit
        // Claude just made would vanish under the next autosave with
        // nothing on screen having changed.
        if (live !== buffer.saved) {
          const file = await api.readFile(projectId, path);
          if (file.text !== live) {
            set({ conflict: { path, theirs: file.text, tag: file.tag } });
          }
          return;
        }
        const file = await api.readFile(projectId, path);
        // Anything typed during that fetch would be destroyed by the
        // replacement below, and the tab marked clean over the top of it.
        const stillLive = showing
          ? view.current!.state.doc.toString()
          : buffer.state.doc.toString();
        if (stillLive !== buffer.saved) return;
        if (file.text !== stillLive) replaceText(path, file.text, file.tag);
      },
      resolveConflict: async (path, keep) => {
        const projectId = get().projectId;
        const conflict = get().conflict;
        const buffer = buffers.current.get(path);
        set({ conflict: null });
        if (!projectId || !conflict || !buffer) return;
        if (keep === "theirs") {
          replaceText(path, conflict.theirs, conflict.tag);
          return;
        }
        // Keeping ours: save again against the version we were just shown,
        // so the write is deliberate rather than a race won by luck.
        buffer.tag = conflict.tag;
        const text =
          current.current === path && view.current
            ? view.current.state.doc.toString()
            : buffer.state.doc.toString();
        const answer = await api
          .writeFile(projectId, path, text, true, conflict.tag)
          .catch(() => null);
        if (answer?.conflict) {
          // It moved again while the writer was deciding.  Ask once more
          // rather than dropping the banner and saving nothing.
          set({
            conflict: { path, theirs: answer.text ?? "", tag: answer.tag ?? "" },
          });
          return;
        }
        if (answer?.ok) {
          buffer.saved = text;
          buffer.tag = answer.tag ?? "";
          set({
            tabs: get().tabs.map((tab) =>
              tab.path === path ? { ...tab, dirty: false } : tab,
            ),
          });
        }
      },
      renamed: (from, to) => {
        // Buffers are keyed by path.  Without this the open tab still
        // pointed at the old name, and the next autosave wrote there --
        // recreating the file that had just been renamed away, and leaving
        // the writer's ongoing edits in an orphan nothing includes.
        const buffer = buffers.current.get(from);
        if (!buffer) return;
        buffers.current.delete(from);
        buffers.current.set(to, buffer);
        if (current.current === from) current.current = to;
        if (viewing.current?.path === from) viewing.current.path = to;
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
        new Blob([JSON.stringify({ path, text, base: buffer.tag })], {
          type: "application/json",
        }),
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

  const compileResult = useStore((s) => s.compile);
  const projectId = useStore((s) => s.projectId);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .symbols(projectId)
      .then((found) => {
        if (!cancelled) symbols.current = found;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, compileResult]);

  useEffect(() => {
    if (!pendingOpen) return;
    openRef.current?.(pendingOpen.path, pendingOpen.line).catch((error) => {
      set({ error: `Could not open ${pendingOpen.path}: ${error.message}` });
    });
  }, [pendingOpen]);

  // Diagnostics repaint whenever a build or a lint pass lands.
  useEffect(() => {
    if (!view.current || !activePath || viewing.current) return;
    // The two switches govern what is drawn in the text and nothing else:
    // the drawer, the tab dot and the status strip keep every diagnostic.
    const show = { errors: settings.markErrors, warnings: settings.markWarnings };
    const marks = [
      ...marksFor(diagnostics, activePath, show),
      ...marksFor(lint, activePath, show),
    ];
    view.current.dispatch({ effects: setMarks.of(marks) as StateEffect<any> });
  }, [diagnostics, lint, activePath, settings.markErrors, settings.markWarnings]);

  // ---- sizing the text with the wheel ----------------------------------
  // The same gesture the preview already answers to, for the same reason: a
  // reader reaches for ctrl-wheel to make text bigger.  The listener must be
  // native -- React registers `wheel` passively, so `preventDefault` inside
  // `onWheel` is ignored and the browser zooms the whole page instead.
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const now = storedAppearance();
      const next = step(now.editor, EDITOR_SIZES, event.deltaY < 0 ? 1 : -1);
      if (next !== now.editor) applyAppearance({ ...now, editor: next });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

/** Lines of the old version that are gone from the file as it stands.
 *
 *  A real diff, not set membership: LaTeX is full of repeated lines --
 *  \centering, \end{figure}, a bare brace -- and asking "does this line
 *  appear anywhere in the new text" leaves a comb of shaded and unshaded
 *  rows through a block that was deleted whole. */
function goneLines(old: string, live: string): number[] {
  const gone: number[] = [];
  let line = 1;
  for (const part of diffLines(live, old)) {
    const count = part.count ?? part.value.split("\n").length - 1;
    if (part.added) {
      // Present in the old version, absent from the live one.
      for (let index = 0; index < count; index += 1) gone.push(line + index);
      line += count;
    } else if (!part.removed) {
      line += count;
    }
  }
  return gone;
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
