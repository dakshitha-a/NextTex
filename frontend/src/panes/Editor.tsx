import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
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
  spellCompartment,
  viewExtensions,
} from "./editor-setup";

import { outline as sectionsOf, sameOutline } from "../outline";
import {
  useEditorTheme,
  useEditorSyntax,
  useSpelling,
} from "../use-editor-theme";
import { get, markStale, set, useStore } from "../store";
import type { ProjectCollab } from "../collab";
import { locateWord } from "./locate-word";
import { noteTyping } from "../timing";

/** Fetched when a writer first selects something rather than before
 *  anything draws, the way every other surface behind a gesture in this app
 *  is: `bundle.initial_kb` counts only what a first visit has to
 *  download. */
const SelectionActions = lazy(() => import("./SelectionActions"));


/** How long the outline waits behind the keyboard.
 *
 *  There is no autosave delay any more.  A keystroke goes into the shared
 *  document, reaches the server on the same tick, and is written to disk
 *  from there; this is only about not re-parsing the section list on every
 *  character of a long chapter.
 */

const OUTLINE_DELAY = 250;

type Buffer = {
  state: EditorState;
  /** Let the shared document know this tab is done with the file. */
  release: () => void;
};

export type EditorHandle = {
  open(
    path: string,
    line?: number,
    word?: string,
    /** False when the agent is saying where it is about to write. */
    steal?: boolean,
  ): Promise<void>;
  /** Show an old version of a file, read-only. */
  view(path: string, sha: string): Promise<void>;
  /** Put the live buffer back, with its undo history and cursor. */
  backToNow(): void;
  /** Paint the lines that differ from what is on screen now. */
  showChanges(on: boolean): void;
  close(path: string): Promise<void>;
  /** Follow a file that has been renamed, keeping its buffer and history. */
  renamed(from: string, to: string): void;
  flash(line: number, endLine?: number): void;
  saveNow(): Promise<void>;
  textOf(path: string): string | null;
};

export default function Editor({
  handleRef,
  onAskAbout,
}: {
  handleRef: (handle: EditorHandle) => void;
  /** Hand a question about the selection to the agent panel.  The panel
   *  seeds it into the composer rather than sending, for the reason the
   *  `Fix` button on a diagnostic gives: the writer always presses Enter on
   *  their own message. */
  onAskAbout?: (prompt: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const editorTheme = useEditorTheme();
  const syntax = useEditorSyntax();
  const spelling = useSpelling();
  // The writer's own words, and the offer to add one.  Held here rather
  // than in the store: nothing outside this pane has any use for either.
  const [accepted, setAccepted] = useState<string[]>([]);
  const [offer, setOffer] = useState<{ word: string; x: number; y: number } | null>(
    null,
  );
  const view = useRef<EditorView | null>(null);
  const buffers = useRef(new Map<string, Buffer>());
  const current = useRef<string | null>(null);
  const collab = useRef<ProjectCollab | null>(null);
  // How a change made by the shared document is told apart from a keystroke.
  // Filled in when the collaboration module arrives, which is after these
  // extensions have been built.
  const remoteMarker = useRef<unknown>(null);
  const timer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  /** Where to draw the verb row over a selection, and which lines it is
   *  about.  Null whenever there is nothing selected, which is most of the
   *  time. */
  const [actions, setActions] = useState<
    { left: number; top: number; from: number; to: number } | null
  >(null);
  const openRef = useRef<
    | ((
        path: string,
        line?: number,
        word?: string,
        steal?: boolean,
      ) => Promise<void>)
    | null
  >(null);
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

  // Everything bound to the project that was open before this one has to
  // go when it does. Buffers are keyed by path, and `main.tex` is `main.tex`
  // in every project: without this, opening a second project either showed
  // the first one's document under the second one's name, or bound the
  // editor to a `Y.Text` whose socket had already been closed -- typing into
  // a detached document that reached nothing.
  const projectForBuffers = useRef<string | null>(null);
  const pendingOpen = useStore((s) => s.pendingOpen);
  const diagnostics = useStore((s) => s.diagnostics);
  const lint = useStore((s) => s.lint);
  const settings = useStore((s) => s.settings);
  const activePath = useStore((s) => s.activePath);

  useEffect(() => {
    if (!host.current || view.current) return;

    /** Yjs and its CodeMirror binding, on their way.
     *
     *  Imported rather than pulled into the entry bundle: they are about a
     *  hundred kilobytes, and `bundle.initial_kb` counts only the entry
     *  script.  Started *here*, as the editor mounts, rather than inside
     *  `connect` where it is first needed -- the editor mounts while the
     *  file tree is still arriving, so the download happens alongside work
     *  that was going to happen anyway instead of standing between a click
     *  on a file and its text appearing.
     */
    const shared = import("../collab");

    /** The shared documents for the project on screen, connected on demand. */
    const connect = async (projectId: string): Promise<ProjectCollab | null> => {
      if (collab.current?.projectId === projectId) return collab.current;
      try {
        // Together, because they do not need each other.  Asking for the
        // name after the module had landed put a whole HTTP round trip
        // between opening a file and opening its socket, on every project.
        const [module, who] = await Promise.all([
          shared,
          api.auth().catch(() => null),
        ]);
        remoteMarker.current = module.remoteMarker;
        const name = who?.displayName?.trim() || "Someone";
        // Which install this is, so the history panel can say "you" about a
        // version rather than printing your own name back at you.
        api.collab(projectId)
          .then((collabState) => set({ peerId: collabState.me }))
          .catch(() => undefined);
        collab.current = module.collabFor(projectId, {
          name,
          colour: module.colourFor(name),
        });
        collab.current.subscribe(() => {
          set({
            collaborators: collab.current?.collaborators() ?? [],
            connection: collab.current?.connection ?? "offline",
          });
        });
        return collab.current;
      } catch {
        // No shared documents means no editing, so this is worth saying
        // rather than failing quietly into a read-only-looking pane.
        set({ error: "Could not reach the shared documents for this project." });
        return null;
      }
    };

    const cancelTimer = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    /** Ask the server to write the shared documents out now.
     *
     *  It does so on its own a moment after every change, so this is only
     *  for the cases where "now" matters: a manual build clicked inside that
     *  window would otherwise typeset the previous text and look like the
     *  button had not worked.
     */
    const flush = async () => {
      cancelTimer();
      const projectId = get().projectId;
      if (projectId) await api.flushDocuments(projectId).catch(() => undefined);
    };

    /** The section list for whatever is on screen.  Read from the buffer
     *  rather than from a compiled .toc: a .toc only exists after a build
     *  and lags the text by a whole compile, and the outline is wanted
     *  while the section is still being typed. */
    const refreshOutline = () => {
      const editor = view.current;
      const path = viewing.current?.path ?? current.current;
      const next = editor && path ? sectionsOf(editor.state.doc.toString()) : [];
      const now = get().outline;
      // Typing prose changes the text on every keystroke and the section
      // list almost never; keeping the old array keeps the panel still.
      if (!sameOutline(now, next)) set({ outline: next });
    };

    const onChange = (local: boolean) => {
      const path = current.current;
      if (!path) return;

      // The outline follows the document whoever changed it -- a
      // collaborator adding a section is a section, and a file whose text
      // arrives over the socket a moment after it was opened has to get one
      // at all. Only the two things below are about *this* keyboard.
      cancelTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        refreshOutline();
      }, OUTLINE_DELAY);

      // Recorded for whoever is about to move the view: the agent now
      // says where it is about to write and the editor goes to look, which
      // is welcome when the writer is reading and not when they are
      // mid-sentence.  Only a local change counts, so a collaborator
      // typing does not pin this person's view in place.
      if (local) noteTyping();

      // A change that came from the shared document is not this person's
      // keystroke. Two of them arrive routinely and neither should mark the
      // page behind: the first sync when a file opens, which changes
      // nothing, and a collaborator's edit, which the server is already
      // telling this browser about through `compile_scheduled`. Marking
      // those here left the preview permanently stale on a file that had
      // simply been opened.
      if (!local) return;
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
      // By path: editing the supplementary information must not mark the
      // main document stale, because no build of main would follow to
      // clear it and the preview would sit behind for the session.
      if (!viewing.current) markStale(path);
      // A tab is never "unsaved" any more. The keystroke is already in the
      // shared document, and the server writes it out a moment later, so a
      // dot meaning "not written yet" would be a dot that is never true.
      const editor = view.current;
      if (editor && collab.current) {
        const line = editor.state.doc.lineAt(editor.state.selection.main.head).number;
        collab.current.here(path, line, true);
      }
    };

    const onCursor = (
      line: number,
      column: number,
      selection: string,
      span: { fromLine: number; toLine: number } | null,
    ) => {
      const cursor = get().cursor;
      if (cursor.line !== line || cursor.column !== column) {
        set({ cursor: { line, column } });
      }
      // Straight into the store, undebounced, because the composer reads it
      // the instant Send is pressed. The 400 ms below is right for telling
      // the server where the cursor is and wrong for this: select a
      // paragraph, click Send, and the question would beat the selection.
      const path = current.current;
      const held = get().selected;
      const next =
        span && path ? { path, text: selection, ...span } : null;
      if (
        (next === null) !== (held === null) ||
        (next && held && (next.text !== held.text || next.path !== held.path))
      ) {
        set({ selected: next });
      }
      // The verb row over a selection.  Placed from the document rather
      // than from the pointer, so a selection made with the keyboard gets
      // one too, and above the selection rather than below it, because
      // below is where the rest of the paragraph is.
      //
      // A few characters is not a selection worth acting on: a
      // double-click on one word happens constantly while reading, and a
      // row of verbs appearing over it every time would be the diagnostics
      // drawer's mistake in a third place.
      const editor = view.current;
      if (!editor || !span || selection.trim().length < 12 || viewing.current) {
        setActions((open) => (open === null ? open : null));
        return;
      }
      const range = editor.state.selection.main;
      const box = editor.coordsAtPos(Math.min(range.from, range.to));
      const frame = host.current?.getBoundingClientRect();
      if (!box || !frame) {
        setActions(null);
        return;
      }
      const width = 300;
      setActions({
        left: Math.max(
          8,
          Math.min(box.left - frame.left, frame.width - width - 8),
        ),
        // 30px is the row's height plus its gap: above the first selected
        // line, and pushed below it when the selection starts at the very
        // top of the pane and there is nowhere above to go.
        top: Math.max(4, box.top - frame.top - 30),
        from: span.fromLine,
        to: span.toLine,
      });
      // Where this browser is, for the collaborator strip. Cheap, and not
      // debounced: awareness is designed to be written on every move, and
      // holding it back is what makes a remote caret look laggy.
      const here = current.current;
      if (here && collab.current) collab.current.here(here, line, false);
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

    const ext = extensions(onChange, onCursor, () => symbols.current, remoteMarker);
    const readOnlyExt = viewExtensions(() => symbols.current);
    view.current = new EditorView({ parent: host.current, state: freshState("", ext) });

    /** Go and look at a line.
     *
     *  `steal` is what separates the two callers, and it is the whole of
     *  the difference between them. A double-click on the typeset page or a
     *  `Show` on an edit chip is the writer asking to be taken somewhere,
     *  so the caret goes with them. The agent announcing where it is about
     *  to write is not: the pane scrolls, the range flashes, and the
     *  selection is left exactly where the writer put it. Everything else
     *  here, the clamping, the word lookup, the scroll and the two teardown
     *  timers, is the same either way and is deliberately not duplicated.
     */
    const jump = (
      line: number,
      endLine?: number,
      word?: string,
      steal = true,
      hold = 700,
    ) => {
      const editor = view.current;
      if (!editor) return;
      const total = editor.state.doc.lines;
      let target = editor.state.doc.line(Math.min(Math.max(line, 1), total));
      // A double-click on the page knows which word it landed on, and
      // synctex does not: it answers every query with `Column:-1`, so
      // without this the cursor can only arrive at the start of the line.
      // Near, and not on the words you were looking at.
      let at = target.from;
      if (word) {
        const found = locateWord(
          (number) => editor.state.doc.line(number).text,
          total,
          target.number,
          word,
        );
        if (found) {
          target = editor.state.doc.line(found.line);
          at = target.from + found.column - 1;
        }
      }
      const end = endLine
        ? editor.state.doc.line(Math.min(Math.max(endLine, 1), total))
        : target;
      editor.dispatch({
        ...(steal ? { selection: { anchor: at } } : {}),
        effects: [
          EditorView.scrollIntoView(at, { y: "center" }),
          flashRange.of({ from: target.from, to: end.to }),
        ],
      });
      if (steal) editor.focus();
      // 700ms, matching the SyncTeX highlight in the spec: long enough to
      // find with the eye after a jump, short enough not to linger.  The
      // agent's own announcement holds longer, because the write it points
      // at has not happened yet and a highlight that has faded before the
      // text changes has pointed at nothing.
      window.setTimeout(() => {
        view.current?.dispatch({ effects: flashRange.of(null) });
      }, hold);
      window.setTimeout(() => {
        view.current?.dispatch({ effects: clearFlash.of(null) });
      }, hold + 500);
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
      refreshOutline();
      view.current.focus();
    };

    const openBuffer = async (
      path: string,
      line?: number,
      word?: string,
      /** False when the agent is saying where it is about to write. The
       *  pane scrolls and the range flashes; the caret is left alone. */
      steal = true,
    ) => {
      const projectId = get().projectId;
      if (!projectId || !view.current) return;
      if (projectForBuffers.current !== projectId) {
        for (const [, held] of buffers.current) held.release();
        buffers.current.clear();
        current.current = null;
        viewing.current = null;
        collab.current = null;
        projectForBuffers.current = projectId;
      }
      if (viewing.current) backToNow();
      if (current.current === path) {
        // The agent's announcement holds its highlight longer than a jump
      // does, because the write it points at has not happened yet and a
      // flash that has faded before the text changes pointed at nothing.
      if (line !== undefined) {
        jump(line, undefined, word, steal, steal ? 700 : 3000);
      }
        refreshOutline();
        return;
      }
      let buffer = buffers.current.get(path);
      if (!buffer) {
        // The document, not the file. Its text is whatever the server and
        // every other browser have agreed it is, which for a file nobody
        // else has open is exactly what is on disk.
        const shared = await connect(projectId);
        const opened = shared ? await shared.open(path) : null;
        if (!opened) {
          // No document, so there is no way to disk: a keystroke here would
          // reach nothing, and with the old whole-file save and the closing
          // beacon both gone, nothing would catch it either. The first
          // version handed back an ordinary editable pane, which looked
          // exactly like a working one and silently discarded everything
          // typed into it.
          //
          // So the file is shown, read-only, and the reason is said out
          // loud rather than left for the writer to discover.
          const file = await api.readFile(projectId, path);
          buffer = { state: freshState(file.text, readOnlyExt), release: () => {} };
          set({
            error:
              `${path} is not connected to this project's shared documents, ` +
              "so it is open for reading only. Reloading usually fixes it.",
          });
        } else {
          buffer = {
            state: freshState(opened.text.toString(), [...ext, opened.extension]),
            release: () => shared!.release(path),
          };
        }
        buffers.current.set(path, buffer);
      }
      if (current.current && view.current) {
        const outgoing = buffers.current.get(current.current);
        if (outgoing) outgoing.state = view.current.state;
      }
      current.current = path;
      if (get().selected?.path !== path) set({ selected: null });
      view.current.setState(buffer.state);
      refreshOutline();
      if (line !== undefined) jump(line, undefined, word);
      api.setFocus(projectId, path).catch(() => undefined);
      lintFile(projectId, path);
    };
    openRef.current = openBuffer;

    const viewVersion = async (path: string, sha: string) => {
      const projectId = get().projectId;
      const editor = view.current;
      if (!projectId || !editor) return;
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
      refreshOutline();
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
        // Nothing to write out. Whatever was typed is in the shared
        // document already, which is what made the closing-tab beacon --
        // and the whole class of bug it existed for -- unnecessary.
        buffers.current.get(path)?.release();
        buffers.current.delete(path);
        if (current.current === path) {
          current.current = null;
          refreshOutline();
        }
      },
      renamed: (from, to) => {
        // Buffers are keyed by path.  Without this the open tab still
        // pointed at the old name, and the next autosave wrote there --
        // recreating the file that had just been renamed away, and leaving
        // the writer's ongoing edits in an orphan nothing includes.
        //
        // A folder move renames every buffer beneath it at once, so this
        // follows a path prefix: matching only the moved path itself left
        // every open file inside a moved folder writing to the old place,
        // which is the same bug once removed.
        const moved = (path: string): string | null => {
          if (path === from) return to;
          if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
          return null;
        };
        for (const path of [...buffers.current.keys()]) {
          const next = moved(path);
          if (!next) continue;
          const buffer = buffers.current.get(path)!;
          buffers.current.delete(path);
          buffers.current.set(next, buffer);
        }
        const active = current.current ? moved(current.current) : null;
        if (active) current.current = active;
        const shown = viewing.current ? moved(viewing.current.path) : null;
        if (shown && viewing.current) viewing.current.path = shown;
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

    return () => {
      cancelTimer();
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // A number written once when a build lands, rather than the build result
  // itself, whose identity changes for reasons the symbol table does not
  // care about. See the same change in App.tsx.
  const builtAt = useStore((s) => s.pdfStamp);
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
  }, [projectId, builtAt]);

  useEffect(() => {
    if (!pendingOpen) return;
    openRef.current?.(
      pendingOpen.path,
      pendingOpen.line,
      pendingOpen.word,
      pendingOpen.steal !== false,
    ).catch((error) => {
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

  // ---- spell checking ---------------------------------------------------
  // The checker is told three things: whether it is on, and which words
  // this project has accepted.  Both arrive as one effect so it can never
  // be running with one of them stale.
  useEffect(() => {
    const projectId = get().projectId;
    if (!projectId || !spelling) {
      setAccepted([]);
      return;
    }
    let live = true;
    api
      .dictionary(projectId)
      .then((result) => { if (live) setAccepted(result.words); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [spelling, activePath]);

  // The checker arrives with its word list, on demand.  Nothing about it
  // is in the interface bundle until the setting is turned on, which is
  // most of the reason it can be turned on at all: it is a hundred
  // kilobytes and a pass over every visible line.
  const speller = useRef<typeof import("./spellcheck") | null>(null);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (!spelling) {
      editor.dispatch({ effects: spellCompartment.reconfigure([]) });
      return;
    }
    let live = true;
    const tell = (module: typeof import("./spellcheck")) => {
      const now = view.current;
      if (!live || !now) return;
      if (speller.current !== module) {
        now.dispatch({ effects: spellCompartment.reconfigure(module.spellchecking()) });
        speller.current = module;
      }
      now.dispatch({
        effects: module.setSpelling.of({ on: true, custom: accepted }),
      });
    };
    if (speller.current) tell(speller.current);
    else import("./spellcheck").then(tell).catch(() => undefined);
    return () => { live = false; };
  }, [spelling, accepted]);

  // A right-click, not a left one: the left button places the caret, and
  // taking that away from a word because it happens to be underlined would
  // make the document harder to edit in exactly the places it needs editing.
  useEffect(() => {
    const root = host.current;
    if (!root || !spelling) return;
    const onMenu = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.(
        ".nx-misspelled",
      ) as HTMLElement | null;
      if (!target) return;
      const word = target.dataset.word;
      if (!word) return;
      event.preventDefault();
      const box = root.getBoundingClientRect();
      setOffer({ word, x: event.clientX - box.left, y: event.clientY - box.top });
    };
    root.addEventListener("contextmenu", onMenu);
    return () => root.removeEventListener("contextmenu", onMenu);
  }, [spelling]);

  const accept = useCallback(async (word: string) => {
    setOffer(null);
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      const result = await api.addWord(projectId, word);
      setAccepted(result.words);
    } catch {
      /* the underline stays, which is the honest outcome */
    }
  }, []);

  // The editor's own light or dark, when it has been set apart from the
  // interface's.  A class on this element rather than a rule at the root,
  // because what changes is the palette handed to this subtree: everything
  // inside resolves its colours through the same tokens, so the syntax
  // highlighting and the gutter markers follow without knowing about it.
  // The three paper grounds are the light palette with its four surfaces
  // moved up, so they are applied on top of it rather than instead of it:
  // one class carries the inks, the accents and the syntax hues, the other
  // carries the page.  See the note beside them in styles.css.
  const skin =
    editorTheme === "match"
      ? ""
      : editorTheme === "light" || editorTheme === "dark"
        ? ` nx-theme-${editorTheme}`
        : ` nx-theme-light nx-theme-${editorTheme}`;
  // Nothing is styled when this is absent: the subtle look is the absence
  // of a rule rather than a reproduction of one.
  const colour = syntax === "colour" ? " nx-syntax-colour" : "";
  return (
    <div
      ref={host}
      className={`relative h-full min-h-0 overflow-hidden${skin}${colour}`}
    >
      {actions ? (
        <Suspense fallback={null}>
          <SelectionActions
            lines={{ from: actions.from, to: actions.to }}
            at={{ left: actions.left, top: actions.top }}
            onDismiss={() => setActions(null)}
            onPick={(prompt) => {
              setActions(null);
              onAskAbout?.(prompt);
            }}
          />
        </Suspense>
      ) : null}
      {offer ? (
        <>
          {/* A click anywhere else puts it away, including a click that is
              doing something else -- which is the behaviour of every other
              menu in the app. */}
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setOffer(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setOffer(null);
            }}
          />
          <div
            className="absolute z-50 rounded-[3px] border border-line bg-surface-2 py-1 shadow-[var(--float)]"
            style={{
              left: Math.min(offer.x, (host.current?.clientWidth ?? 0) - 210),
              top: offer.y,
            }}
            role="menu"
            data-testid="spelling-menu"
          >
            <button
              role="menuitem"
              className="t-micro block w-full px-3 py-[3px] text-left text-ink-2 hover:bg-surface-3 hover:text-ink"
              onClick={() => accept(offer.word)}
            >
              Add “{offer.word}” to the dictionary
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
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
