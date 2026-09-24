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
import { findNode } from "../tree";
import {
  clearFlash,
  extensions,
  flashRange,
  freshState,
  keymapCompartment,
  swapCompartment,
  languageFor,
  marksFor,
  setDiff,
  setMarks,
  spellCompartment,
  viewExtensions,
} from "./editor-setup";
import { isCode, isMarkdown, isTeX } from "./file-kinds";
import { pasteExtension } from "./paste";
import { reconciled } from "./parked";

import { outline as sectionsOf, sameOutline } from "../outline";
import { sectionAtTop, trailTo } from "../section-at-top";
import {
  useEditorTheme,
  useEditorEmphasis,
  useEditorSyntax,
  useKeymap,
  useSpelling,
  useSpellingVariety,
} from "../use-editor-theme";
import { toShell, uiScale } from "../viewport";
import { Menu, MenuDivider, MenuItem } from "../ui/Menu";
import { get, markStale, set, useStore } from "../store";
import type { ProjectCollab } from "../collab";
import { locateWord, type WordHint } from "./locate-word";
import { noteTyping, onFrame } from "../timing";

/** Fetched when a writer first selects something rather than before
 *  anything draws, the way every other surface behind a gesture in this app
 *  is: `bundle.initial_kb` counts only what a first visit has to
 *  download. */
const SelectionActions = lazy(() => import("./SelectionActions"));
const EditorComments = lazy(() => import("./EditorComments"));
import { placeClear } from "./place-clear";
import type { CommentsApi } from "./EditorComments";



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
  /** The shared text this buffer is bound to, when it is bound to one.
   *  Read whenever the parked state goes back into the view and whenever
   *  a parked file's text is asked for: the state stops following the
   *  shared text the moment it is parked, and this is what it follows. */
  shared?: import("yjs").Text;
};

/** What a parked file says now: its shared text when it has one, since
 *  the parked state only knows what it said when it was parked. */
function parkedText(buffer: Buffer | undefined): string | null {
  if (!buffer) return null;
  return buffer.shared ? buffer.shared.toString() : buffer.state.doc.toString();
}

export type EditorHandle = {
  open(
    path: string,
    line?: number,
    word?: string | WordHint,
    /** False when the agent is saying where it is about to write. */
    steal?: boolean,
  ): Promise<void>;
  /** Show an old version of a file, read-only. */
  view(path: string, sha: string): Promise<void>;
  /** Put the live buffer back, with its undo history and cursor. */
  backToNow(): void;
  /** Paint the lines that differ from what is on screen now. */
  showChanges(on: boolean): void;
  /** The two texts a viewed version is compared against: the version on
   *  screen and the live file behind it. Null when nothing is being
   *  viewed. */
  viewed(): { old: string; live: string } | null;
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
  onOpen,
}: {
  handleRef: (handle: EditorHandle) => void;
  /** Hand a question about the selection to the agent panel.  The panel
   *  seeds it into the composer rather than sending, for the reason the
   *  `Fix` button on a diagnostic gives: the writer always presses Enter on
   *  their own message. */
  onAskAbout?: (prompt: string) => void;
  /** Open another file, for a Ctrl-click on a `\ref` or an `\input`. */
  onOpen?: (path: string, line?: number) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  // How tall the editor's top panels are, when there are any: the section
  // bar sits over the scroller, and with find open it sat over the find
  // panel instead, covering its controls once the pane had scrolled past
  // a heading. Watched rather than assumed, since the panel is one row or
  // two and comes and goes.
  const [panelsHeight, setPanelsHeight] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let sized: ResizeObserver | null = null;
    const measure = () => {
      const panels = element.querySelector<HTMLElement>(".cm-panels-top");
      setPanelsHeight(panels?.offsetHeight ?? 0);
      sized?.disconnect();
      sized = null;
      if (panels && typeof ResizeObserver !== "undefined") {
        sized = new ResizeObserver(measure);
        sized.observe(panels);
      }
    };
    measure();
    const seen = new MutationObserver(measure);
    seen.observe(element, { childList: true, subtree: true });
    return () => {
      seen.disconnect();
      sized?.disconnect();
    };
  }, []);
  /** `jump`, for the section bar, which is rendered outside the effect
   *  that defines it. */
  const jumpRef = useRef<((line: number) => void) | null>(null);
  const opener = useRef(onOpen);
  opener.current = onOpen;
  const editorTheme = useEditorTheme();
  const syntax = useEditorSyntax();
  const emphasis = useEditorEmphasis();
  const spelling = useSpelling();
  const spellingVariety = useSpellingVariety();
  const keymapChoice = useKeymap();
  const keymapRef = useRef(keymapChoice);
  keymapRef.current = keymapChoice;
  /** Put Vim or Emacs into the view, or take it out, from the setting.
   *  The module is fetched the first time either is chosen; a fresh
   *  `EditorState` starts with the compartment empty, so this is asked
   *  again when a buffer is opened, as the spell checker is. */
  const applyKeymap = useCallback(async (now: EditorView) => {
    const wanted = keymapRef.current;
    if (wanted === "default") {
      const configured = keymapCompartment.get(now.state);
      if (Array.isArray(configured) && configured.length > 0) {
        now.dispatch({ effects: keymapCompartment.reconfigure([]) });
      }
      return;
    }
    const module = await import("./keymaps");
    // The setting may have moved while the chunk was on its way.
    if (keymapRef.current !== wanted || view.current !== now) return;
    now.dispatch({
      effects: keymapCompartment.reconfigure(
        wanted === "vim" ? module.vimExtension() : module.emacsExtension(),
      ),
    });
  }, []);
  useEffect(() => {
    const now = view.current;
    if (now) void applyKeymap(now);
  }, [keymapChoice, applyKeymap]);
  // The document in front decides which English a chapter is held to.
  const activePreview = useStore((s) => s.activePreview);
  // The writer's own words, and the offer to add one.  Held here rather
  // than in the store: nothing outside this pane has any use for either.
  const [accepted, setAccepted] = useState<string[]>([]);
  // Changed by the settings sheet as well as by this pane, and the two are
  // in different trees.
  const dictionaryStamp = useStore((s) => s.dictionaryStamp);
  // The checker arrives with its word list, on demand.  Nothing about it
  // is in the interface bundle until the setting is turned on, which is
  // most of the reason it can be turned on at all: it is a hundred
  // kilobytes and a pass over every visible line.
  const speller = useRef<typeof import("./spellcheck") | null>(null);
  // Read by the buffer swap below, which is a closure made once.
  /** The verb row's measured size, once it has been drawn, so the next
   *  placement can use it rather than a guess. */
  const actionsSize = useRef<{ width: number; height: number } | null>(null);
  const spellingRef = useRef(spelling);
  spellingRef.current = spelling;
  const varietyRef = useRef(spellingVariety);
  varietyRef.current = spellingVariety;
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  /** Put the checker into whatever state the view holds now.
   *
   *  Every fresh `EditorState` starts with `spellCompartment.of([])`, so a
   *  document that arrives after the checker was configured has no
   *  checker in it.  The effect below only runs when the setting or the
   *  word list changes, and after a reload both had settled before the
   *  file finished opening, so spell checking said it was on and marked
   *  nothing until it was switched off and on again.  Asked of the state,
   *  not of a ref: `speller.current` is one value for the whole module. */
  /** Which English this buffer is held to: the writer's choice, else what
   *  the document that owns the open file declares in its preamble, else
   *  both spellings.  The owner rather than the file, since a chapter has
   *  no preamble of its own. */
  const resolveVariety = useCallback((): "american" | "british" | "either" => {
    const chosen = varietyRef.current;
    if (chosen !== "follow") return chosen;
    const path = current.current ?? "";
    const state = get();
    const owner = state.owners[path]?.[0] ?? (state.previews.includes(path) ? path : state.activePreview);
    const declared = owner ? symbols.current?.english?.[owner] : undefined;
    return declared ?? "either";
  }, []);

  const applySpelling = useCallback((now: EditorView) => {
    const module = speller.current;
    if (!module || !spellingRef.current) return;
    // Code is not prose: every identifier in a script is a word the
    // dictionary has never heard of, and a page of red underlines under a
    // figure script says nothing about its spelling.
    if (isCode(current.current ?? "")) {
      const configured = spellCompartment.get(now.state);
      if (Array.isArray(configured) && configured.length > 0) {
        now.dispatch({ effects: spellCompartment.reconfigure([]) });
      }
      return;
    }
    const configured = spellCompartment.get(now.state);
    const alreadyOn = Array.isArray(configured) && configured.length > 0;
    if (!alreadyOn) {
      now.dispatch({ effects: spellCompartment.reconfigure(module.spellchecking()) });
    }
    now.dispatch({
      effects: module.setSpelling.of({
        on: true, custom: acceptedRef.current, variety: resolveVariety(),
      }),
    });
  }, []);
  const [offer, setOffer] = useState<{
    word: string;
    /** Where the menu wants to be, in the shell's own pixels on the screen:
     *  under the word, or at the pointer, with the word's top as the edge
     *  it flips above when there is no room below. */
    x: number;
    y: number;
    flip: number;
    /** Where the word is in the document, so a suggestion can replace it.
     *  The decoration knows the text; only the position can put something
     *  else in its place. */
    from: number;
    to: number;
    /** What the writer probably meant, worked out when the menu opens.
     *  Empty for a word that is nothing like anything in the list, which
     *  is the case where adding it to the dictionary is the right answer
     *  and a column of wrong guesses above that item is in the way. */
    guesses: string[];
  } | null>(null);
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
  /** The first line on screen, for the bar that says which section the
   *  top of the pane is in.  Written on scroll, once a frame. */
  const [topLine, setTopLine] = useState(1);
  const outlineNow = useStore((s) => s.outline);
  const viewingNow = useStore((s) => s.viewing);
  const shownNow = useStore((s) => s.shownPath);
  const [actions, setActions] = useState<
    { left: number; top: number; from: number; to: number; verbs: boolean } | null
  >(null);
  /** Comments' marks and cards, a lazy chunk; see EditorComments. */
  const comments = useRef<CommentsApi | null>(null);
  /** When the pointer last pressed twice, which is how a word is picked
   *  up while reading. */
  const lastDouble = useRef(0);

  /** Where the verb row goes for the selection the editor has now, in
   *  pane pixels, or null when there is no editor to ask.
   *
   *  Anchored on line blocks rather than on the first selected character.
   *  A block is the whole logical line, every visual row of a wrapped
   *  paragraph and its leading, so "above the first selected line" means
   *  above the paragraph: the row was anchored on the glyph once, and on a
   *  paragraph wrapped over four rows a selection on the third put it
   *  squarely over the second, which is the text it is about.  The
   *  character still supplies the left edge, when it is in the rendered
   *  viewport; the block always exists, so a selection whose end is off
   *  the screen gets a row too, at the edge of the pane nearest the
   *  selection's head.  Reads only refs, so the cursor listener, the
   *  measure callback and the scroll listener share one copy of the
   *  arithmetic.
   *
   *  In shell pixels throughout.  The frame, `documentTop`, the line
   *  blocks and `coordsAtPos` are all viewport measurements, which the
   *  interface size setting scales with `zoom`; the row's own size is
   *  measured in shell pixels and the answer is written as CSS pixels
   *  inside the scaled shell.  Mixing the two drew the row that much
   *  further down and right at any size but 100 %: over the selection at
   *  110 %, off the pane at 125 %, which the writer met as a menu with
   *  "no order to where it appears". */
  const placeRow = useCallback(() => {
    const editor = view.current;
    const pane = host.current;
    const frame = pane?.getBoundingClientRect();
    if (!editor || !pane || !frame) return null;
    const scale = uiScale();
    const range = editor.state.selection.main;
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    const firstBlock = editor.lineBlockAt(from);
    const lastBlock = editor.lineBlockAt(to);
    const origin = (editor.documentTop - frame.top) / scale;
    const left = ((editor.coordsAtPos(from)?.left ?? frame.left) - frame.left) / scale;
    const head = editor.coordsAtPos(range.head);
    const pointerY = head ? (head.top - frame.top) / scale : undefined;
    return placeClear(
      { top: firstBlock.top / scale + origin, bottom: firstBlock.bottom / scale + origin, left },
      { top: lastBlock.top / scale + origin, bottom: lastBlock.bottom / scale + origin, left },
      { width: pane.offsetWidth, height: pane.offsetHeight },
      actionsSize.current ?? { width: 300, height: 32 },
      pointerY,
    );
  }, []);
  /** Move an open row to where the selection is now, and nothing when it
   *  is closed or has not moved: this runs on every scroll tick. */
  const followRow = useCallback(() => {
    const at = placeRow();
    if (!at) return;
    setActions((open) =>
      open && (open.left !== at.left || open.top !== at.top)
        ? { ...open, left: at.left, top: at.top }
        : open,
    );
  }, [placeRow]);

  /** The row's real size once it is drawn.  The first placement guessed
   *  it; with the real one, the row moves if the guess would have put it
   *  over the text.  A stable callback, because the row's layout effect
   *  depends on it and an inline one re-ran the measurement on every
   *  render of this pane. */
  const measureRow = useCallback((size: { width: number; height: number }) => {
    const before = actionsSize.current;
    actionsSize.current = size;
    if (!before || before.height !== size.height || before.width !== size.width) {
      followRow();
    }
  }, [followRow]);
  const openRef = useRef<
    | ((
        path: string,
        line?: number,
        word?: string | WordHint,
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
        // The whole answer, not only `me`. The array of members and
        // whether each one's link is up was fetched here and thrown away,
        // and one sheet polled the same route for it, so nothing in the
        // tab strip could tell "nobody is here" from "somebody is here and
        // is not being drawn" from "they have gone for good".
        api.collab(projectId)
          .then((collabState) => set({
            peerId: collabState.me,
            share: {
              shared: collabState.shared,
              me: collabState.me,
              members: collabState.members,
              removed: collabState.removed,
            },
          }))
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
      const text = editor && path ? editor.state.doc.toString() : "";
      const next = text ? sectionsOf(text) : [];
      const now = get().outline;
      // Typing prose changes the text on every keystroke and the section
      // list almost never; keeping the old array keeps the panel still.
      if (!sameOutline(now, next)) set({ outline: next });
      // A Markdown file's text goes to the preview pane on the same
      // cadence, and from the same place, because the two are the same
      // question: what does the buffer say now.  An old version being
      // viewed is what the buffer holds, so the pane renders that
      // version, which is the point of viewing it.
      const held = get().markdownSource;
      if (editor && path && isMarkdown(path)) {
        if (!held || held.path !== path || held.text !== text) {
          set({ markdownSource: { path, text } });
        }
      } else if (held) {
        set({ markdownSource: null });
      }
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
      // A .bib file's rows follow the typing: the check is cheap and reads
      // the live text, so it is asked again once the keystrokes settle.
      if (path.endsWith(".bib")) {
        const projectId = get().projectId;
        if (projectId) lintFile(projectId, path, 800);
      }
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
      // Beside the cursor, because they change together and the word
      // count needs both: the outline says where every section starts and
      // only this says where the last one stops.
      const lines = view.current?.state.doc.lines ?? 1;
      if (get().lineCount !== lines) set({ lineCount: lines });
      // Where this browser is, for the collaborator strip and the People
      // drawer. Cheap, and not debounced: awareness is designed to be
      // written on every move, and holding it back is what makes a remote
      // caret look laggy. Here, before the selection's early return: it
      // used to sit after it, so a collaborator who only read or moved
      // their caret was "not in a file" to everyone until they typed or
      // selected a dozen characters.
      if (current.current && collab.current) collab.current.here(current.current, line, false);
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
      // one too, and clear of every line the selection touches: above the
      // first of them by preference, below the last when there is no room
      // above.  See `placeRow` for why the anchor is the line block and
      // `placeClear` for the ladder.
      //
      // A few characters is not a selection worth acting on: a
      // double-click on one word happens constantly while reading, and a
      // row of verbs appearing over it every time would be the diagnostics
      // drawer's mistake in a third place.
      if (!view.current || !span || !selection.trim() || viewing.current) {
        setActions((open) => (open === null ? open : null));
        return;
      }
      // Commenting on one word is ordinary, so a selection the writer made
      // gets Comment; the agent's verbs wait for twelve characters. A word
      // double-clicked while reading gets nothing, for the reason above.
      const verbs = selection.trim().length >= 12;
      if (!verbs && Date.now() - lastDouble.current < 600) {
        setActions((open) => (open === null ? open : null));
        return;
      }
      const at = placeRow();
      if (!at) {
        setActions(null);
        return;
      }
      // The row is measured once it exists and re-placed with its real
      // size; until then the guess is the size it has always had.
      setActions((open) =>
        open &&
        open.left === at.left &&
        open.top === at.top &&
        open.from === span.fromLine &&
        open.to === span.toLine &&
        open.verbs === verbs
          ? open
          : { left: at.left, top: at.top, from: span.fromLine, to: span.toLine, verbs },
      );
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

    const ext = [
      ...extensions(onChange, onCursor, remoteMarker),
      // A pasted table or image, caught before CodeMirror's own paste; the
      // upload goes through the same route as the tree's paste, under
      // `figures/`, keeping both when the dated name is already taken.
      pasteExtension({
        isTex: () => isTeX(current.current ?? ""),
        upload: async (image) => {
          const projectId = get().projectId;
          if (!projectId) throw new Error("no project is open");
          const extension = image.type.split("/")[1]?.split("+")[0] ?? "png";
          const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
          const name = `pasted-${stamp}.${extension}`;
          const file = new File([image], name, { type: image.type });
          const answer = await api.uploadFiles(projectId, "figures", [file], { [name]: "keep-both" });
          const written = answer.written[0];
          if (!written) throw new Error("nothing was written");
          return written;
        },
        complain: (message) => set({ error: message }),
      }),
    ];
    const readOnlyExt = viewExtensions();
    /** The language for a live buffer of `path`: LaTeX with its
     *  completions and links, or Python for a script.  The link opener
     *  goes through the ref, because this effect runs once and the
     *  extension it builds lives as long as the pane: the prop is a
     *  callback that is rebuilt whenever the project changes, and a
     *  captured one would go on opening files in the project before this
     *  one. */
    const languageOf = (path: string) => languageFor(path, () => symbols.current, {
      follow: (target, line) => opener.current?.(target, line),
      complete: true,
      // The tree's entry for the figure: its modification time is the
      // stamp the thumbnail is cached under, so a regenerated plot is
      // redrawn and one that is not is drawn once.
      figure: (target) => {
        const id = get().projectId;
        const node = findNode(get().tree, target);
        if (!id || !node) return null;
        return { projectId: id, stamp: node.mtime ?? node.size ?? 0, size: node.size };
      },
      // The search panel answers: it lists the references and holds the
      // rename box, since it already has the file-by-file list and the
      // confirmation a project-wide edit needs.
      onSymbol: (kind, name, rename) =>
        set({ symbolRequest: { kind, name, rename, nonce: Date.now() } }),
      onEquation: (body, format) => {
        const id = get().projectId;
        if (!id) return Promise.reject(new Error("No project is open."));
        return import("./equation-verbs").then(({ equationImage }) => equationImage(id, body, format));
      },
    });
    /** The same, for a pane that cannot be edited: no completions, and
     *  no following a reference out of a version being read. */
    const readOnlyLanguageOf = (path: string) =>
      languageFor(path, () => symbols.current);
    view.current = new EditorView({ parent: host.current, state: freshState("", ext) });
    // The verb row is furniture over the page, not part of it, so when the
    // page moves it has to be moved too: it used to stay where it was
    // placed while the text scrolled underneath, which put it over the
    // selection it had been placed to avoid.  A scroll event rather than
    // the view's update listener, because a scroll inside the rendered
    // viewport changes neither the viewport nor the geometry flags, and
    // the block heights and `documentTop` the placement reads are right
    // the moment the event fires.  The observer covers the pane changing
    // width, which moves the row's horizontal clamp.
    const scroller = view.current.scrollDOM;
    scroller.addEventListener("scroll", followRow, { passive: true });
    const resized = new ResizeObserver(followRow);
    resized.observe(host.current);
    // The section bar reads the line at the top of the viewport.  Once a
    // frame, and only written when it changes: a scroll fires many times
    // per frame and the bar redraws for none of them otherwise.
    const noteTop = onFrame(() => {
      const editor = view.current;
      if (!editor) return;
      const block = editor.lineBlockAtHeight(editor.scrollDOM.scrollTop);
      const line = editor.state.doc.lineAt(block.from).number;
      setTopLine((was) => (was === line ? was : line));
    });
    scroller.addEventListener("scroll", noteTop, { passive: true });

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
      word?: string | WordHint,
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

    /** The floating things that belonged to the state being replaced.
     *
     *  `setState` does not fire the update listener, so neither of these
     *  was told about a swap to another file: a verb row offering to
     *  rewrite a paragraph in the file you just left hung over the one you
     *  opened, and pressing it sent the agent at a selection that is not
     *  there any more. The spelling menu is the same shape.
     *
     *  The caret readout is the third. It is read from the state now on
     *  screen, after `setState`, and written straight to the store rather
     *  than through `onCursor`: that path also places the verb row, tells
     *  the collaborators where this browser is and arms the focus timer,
     *  none of which a swap should do. The fix run's attempt at this left
     *  the readout stuck after the swap, and the test that covers it types
     *  after opening the file for exactly that reason.
     */
    /** Hold the editor shut for the length of a swap. */
    const closeForSwap = () => {
      if (!view.current) return;
      view.current.dispatch({
        effects: swapCompartment.reconfigure(EditorState.readOnly.of(true)),
      });
    };

    /** Let the writer type again, after a swap that finished or one that
     *  could not. */
    const openAgain = () => {
      if (!view.current) return;
      if (swapCompartment.get(view.current.state) === undefined) return;
      view.current.dispatch({ effects: swapCompartment.reconfigure([]) });
    };

    const afterSwap = () => {
      openAgain();
      // The comment extension into the new file's state, its marks, and
      // a thread the drawer asked for once its file is the one shown.
      comments.current?.apply();
      setActions((open) => (open === null ? open : null));
      setOffer((open) => (open === null ? open : null));
      if (view.current) {
        applySpelling(view.current);
        void applyKeymap(view.current);
      }
      // Which document the view actually holds, said out loud. A tab
      // appears the moment it is opened and the view keeps the file it
      // had until `openBuffer` has waited for the shared document, so
      // "the tab is there" and "keystrokes reach that file" are different
      // moments and nothing outside could tell them apart.
      const shown = current.current ?? viewing.current?.path ?? null;
      if (get().shownPath !== shown) set({ shownPath: shown });
      const state = view.current?.state;
      if (!state) return;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const cursor = { line: line.number, column: head - line.from + 1 };
      const held = get().cursor;
      if (held.line !== cursor.line || held.column !== cursor.column) {
        set({ cursor });
      }
      if (get().lineCount !== state.doc.lines) set({ lineCount: state.doc.lines });
    };

    const backToNow = () => {
      const parked = viewing.current;
      if (!parked || !view.current) return;
      const buffer = buffers.current.get(parked.path);
      viewing.current = null;
      if (buffer) {
        if (buffer.shared) buffer.state = reconciled(buffer.state, buffer.shared.toString());
        view.current.setState(buffer.state);
        view.current.scrollDOM.scrollTop = parked.scroll;
      }
      current.current = parked.path;
      set({ viewing: null });
      afterSwap();
      refreshOutline();
      view.current.focus();
    };

    const openBuffer = async (
      path: string,
      line?: number,
      word?: string | WordHint,
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
      if (current.current !== path) {
        // Shut from the moment a swap is asked for, not from the first
        // await inside it: the caller that makes a new file has already
        // drawn its tab, and a writer who starts typing at the sight of
        // the tab is typing into the file they just left. `afterSwap`
        // opens it again, and so does every road out of here that does
        // not reach `afterSwap`.
        closeForSwap();
      }
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
        // Shut for the length of the swap. Everything below this point is
        // awaited, and until `setState` runs the view still holds the file
        // the writer was in: a keystroke here went into the previous
        // document and was written to the previous file. `afterSwap`
        // opens it again, and every road out of `openBuffer` goes through
        // `afterSwap`.
        // The document, not the file. Its text is whatever the server and
        // every other browser have agreed it is, which for a file nobody
        // else has open is exactly what is on disk.
        let shared: Awaited<ReturnType<typeof connect>>;
        let opened: Awaited<ReturnType<NonNullable<typeof shared>["open"]>> | null;
        try {
          shared = await connect(projectId);
          opened = shared ? await shared.open(path) : null;
        } catch (error) {
          // A swap that cannot finish must still give the editor back, or
          // the pane the writer is looking at stays uneditable for the
          // rest of the session with nothing on screen to say why.
          openAgain();
          throw error;
        }
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
          let file: Awaited<ReturnType<typeof api.readFile>>;
          try {
            file = await api.readFile(projectId, path);
          } catch (error) {
            openAgain();
            throw error;
          }
          buffer = {
            state: freshState(file.text, readOnlyExt, readOnlyLanguageOf(path)),
            release: () => {},
          };
          set({
            error:
              `${path} is not connected to this project's shared documents, ` +
              "so it is open for reading only. Reloading usually fixes it.",
          });
        } else {
          // The document is handed back before the server's first answer
          // has filled it.  Waiting here is what lets the jump below land
          // on a line that exists: without it a double-click on the page
          // opened the right chapter with the caret at the top, because
          // the line it asked for was clamped against an empty document.
          // The state is built after the wait so the pane never shows the
          // empty document either.
          await opened.synced;
          buffer = {
            state: freshState(
              opened.text.toString(), [...ext, opened.extension], languageOf(path),
            ),
            release: () => shared!.release(path),
            shared: opened.text,
          };
        }
        buffers.current.set(path, buffer);
      } else if (buffer.shared) {
        // Parked, and the shared text may have moved on without it: an
        // outside rewrite, the agent, a collaborator.  See `parked.ts`.
        buffer.state = reconciled(buffer.state, buffer.shared.toString());
      }
      if (current.current && view.current) {
        const outgoing = buffers.current.get(current.current);
        if (outgoing) outgoing.state = view.current.state;
      }
      current.current = path;
      if (get().selected?.path !== path) set({ selected: null });
      view.current.setState(buffer.state);
      afterSwap();
      refreshOutline();
      if (line !== undefined) jump(line, undefined, word);
      api.setFocus(projectId, path).catch(() => undefined);
      lintFile(projectId, path);
    };
    openRef.current = openBuffer;
    jumpRef.current = (line) => jump(line);

    const viewVersion = async (path: string, sha: string) => {
      const projectId = get().projectId;
      const editor = view.current;
      if (!projectId || !editor) return;
      cancelTimer();
      // Back to the live buffer first, if a version is already on screen.
      // `buffer.state = editor.state` below parks whatever the editor is
      // showing, and clicking a second version parked the *read-only*
      // state of the first one. "Back to now" then restored that, so the
      // writer was returned to a pane that looked live, was not editable,
      // and swallowed everything they typed into it.
      if (viewing.current) backToNow();
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
      editor.setState(freshState(file.text, readOnlyExt, readOnlyLanguageOf(path)));
      afterSwap();
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
      viewed: () => {
        const parked = viewing.current;
        const editor = view.current;
        if (!parked || !editor) return null;
        return {
          old: editor.state.doc.toString(),
          live: parkedText(buffers.current.get(parked.path)) ?? "",
        };
      },
      showChanges: (on: boolean) => {
        const parked = viewing.current;
        const editor = view.current;
        if (!parked || !editor) return;
        if (!on) {
          editor.dispatch({ effects: setDiff.of([]) });
          return;
        }
        const live = parkedText(buffers.current.get(parked.path)) ?? "";
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
        return parkedText(buffers.current.get(path));
      },
    });

    return () => {
      cancelTimer();
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
      scroller.removeEventListener("scroll", followRow);
      scroller.removeEventListener("scroll", noteTop);
      noteTop.cancel();
      resized.disconnect();
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
  }, [spelling, activePath, dictionaryStamp]);

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
      speller.current = module;
      applySpelling(now);
    };
    if (speller.current) tell(speller.current);
    else import("./spellcheck").then(tell).catch(() => undefined);
    return () => { live = false; };
    // `spellingVariety` and `builtAt` are read through refs inside
    // `applySpelling`; they are here so a changed setting, or a symbol
    // table refreshed by a build, re-applies the checker.
  }, [spelling, accepted, applySpelling, spellingVariety, builtAt, activePreview]);

  /** Open the menu on the misspelled word the caret is in.
   *
   *  The keyboard route, which did not exist. The menu claimed
   *  `role="menu"` and a keyboard user met nothing at all: Shift-F10 fires
   *  `contextmenu` on the content element rather than on the word, so the
   *  handler's test for a `.nx-misspelled` ancestor failed and nothing
   *  opened. A screen reader was being told "menu, one item" about
   *  something only a mouse could reach.
   *
   *  Asked of the DOM rather than of the decoration set, because the mark
   *  carries the word in an attribute precisely so that whatever opens the
   *  menu does not have to work out what was pointed at. */
  const offerAtCaret = useCallback(() => {
    const now = view.current;
    const root = host.current;
    if (!now || !root) return false;
    // Both sides of the caret, because a caret at the first character of a
    // word is a position the browser can resolve into either the mark or
    // the text before it, and the writer means the word they are in.
    const at = now.state.selection.main.head;
    const marked = (position: number): HTMLElement | null => {
      if (position < 0 || position > now.state.doc.length) return null;
      const spot = now.domAtPos(position);
      const node = spot.node.nodeType === 1
        ? (spot.node as HTMLElement)
        : spot.node.parentElement;
      return (node?.closest?.(".nx-misspelled") as HTMLElement | null) ?? null;
    };
    const word = marked(at) ?? marked(at + 1) ?? marked(at - 1);
    if (!word?.dataset.word) return false;
    const where = word.getBoundingClientRect();
    // Read in viewport pixels, written as a style inside the zoomed shell:
    // see viewport.ts for why the two are not the same number.
    setOffer(
      offerFor(now, word, toShell(where.left), toShell(where.bottom) + 2, toShell(where.top) - 2),
    );
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offerFor is
    // declared just below and is stable for the same accepted list.
  }, [accepted]);

  /** One offer, however the menu was asked for.
   *
   *  The suggestions are worked out here rather than while drawing,
   *  because the search is a few hundred set lookups and the menu is
   *  re-rendered on every arrow key once it is open. */
  const offerFor = useCallback(
    (now: EditorView, node: HTMLElement, x: number, y: number, flip: number) => {
      const word = node.dataset.word ?? "";
      const from = now.posAtDOM(node);
      const list = speller.current?.shipped() ?? null;
      const mine = new Set(accepted.map((w) => w.toLowerCase()));
      const guesses = list
        ? speller.current!.suggestions(word, (candidate) =>
            list.has(candidate) || mine.has(candidate),
          )
        : [];
      return { word, x, y, flip, from, to: from + word.length, guesses };
    },
    [accepted],
  );

  // A right-click, not a left one: the left button places the caret, and
  // taking that away from a word because it happens to be underlined would
  // make the document harder to edit in exactly the places it needs editing.
  useEffect(() => {
    const root = host.current;
    if (!root || !spelling) return;
    const onMenu = (event: MouseEvent) => {
      // Shift-F10 and the Menu key arrive as a `contextmenu` event with no
      // pointer behind it, and Chromium reports 0, 0 for its coordinates.
      // Read literally that is the top left corner of the window, so the
      // menu opened at a negative offset inside the pane and was drawn
      // off screen: from the writer's side, the key did nothing. The word
      // the caret is in is what a keyboard press means, and its own
      // rectangle is where the menu belongs.
      if (event.clientX === 0 && event.clientY === 0) {
        if (offerAtCaret()) event.preventDefault();
        return;
      }
      const target = (event.target as HTMLElement | null)?.closest?.(
        ".nx-misspelled",
      ) as HTMLElement | null;
      if (!target) {
        // Shift-F10, and the keyboard's Menu key, arrive here as a
        // `contextmenu` event fired on the content element rather than on
        // the word: there is no pointer, so there is nothing under it.
        // The caret is what the writer means, and this is the only route
        // the menu ever had from a keyboard.
        if (offerAtCaret()) event.preventDefault();
        return;
      }
      const word = target.dataset.word;
      if (!word || !view.current) return;
      event.preventDefault();
      const where = target.getBoundingClientRect();
      setOffer(
        offerFor(
          view.current,
          target,
          toShell(event.clientX),
          toShell(event.clientY),
          toShell(where.top) - 2,
        ),
      );
    };
    const onKey = (event: KeyboardEvent) => {
      // Mod-. as well, because Shift-F10 is not a key every keyboard has
      // and the Menu key is missing from most laptops.
      const wanted = (event.ctrlKey || event.metaKey) && event.key === ".";
      if (!wanted) return;
      if (offerAtCaret()) event.preventDefault();
    };
    root.addEventListener("contextmenu", onMenu);
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("contextmenu", onMenu);
      root.removeEventListener("keydown", onKey);
    };
  }, [spelling, offerAtCaret, offerFor]);

  /** Where the menu goes, and where focus goes, the moment it mounts.
   *
   *  Focus goes into the menu when it opens. Without this the arrow keys
   *  moved the caret in the document behind the backdrop, so the page
   *  scrolled underneath a menu that stayed put, and nothing about the
   *  menu could be reached or dismissed without a mouse.
   *
   *  Opened near the foot of the pane it went below it, and the host
   *  clips, so the item that matters was the one nobody could see. It
   *  opens upwards instead when there is no room below; measured rather
   *  than guessed, because the number of guesses is the number of rows.
   *
   *  A stable callback, keyed on the offer. An inline ref is a new
   *  function on every render, and React calls a new ref with the node
   *  again, so every re-render of this pane while the menu was open (the
   *  word list arriving, a cursor readout) put focus back on the first
   *  row a beat after an arrow key had moved it. */
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
  // The white page is the light palette with its four surfaces moved up,
  // so it is applied on top of it rather than instead of it: one class
  // carries the inks, the accents and the syntax hues, the other carries
  // the page.  See the note beside it in styles.css.
  const skin = editorTheme === "white" ? " nx-theme-light nx-theme-white" : "";
  // Nothing is styled when this is absent: the subtle look is the absence
  // of a rule rather than a reproduction of one.
  const colour = syntax === "colour" ? " nx-syntax-colour" : "";
  // Likewise: the class takes the lift off one variable, and every command
  // weight in the pane resolves through that variable.
  const plain = emphasis === "plain" ? " nx-syntax-plain" : "";
  // Which section the top of the pane is in, for a bar over the source.
  // Hidden before the first heading, on a heading's own line, and while
  // an old version is on screen, whose lines are not the outline's.
  const atTop = viewingNow ? null : sectionAtTop(outlineNow, topLine);
  return (
    <div
      ref={host}
      data-testid="editor-host"
      data-shown={shownNow ?? ""}
      className={`relative h-full min-h-0 overflow-hidden${skin}${colour}${plain}`}
      onMouseDownCapture={(event) => {
        if (event.detail >= 2) lastDouble.current = Date.now();
      }}
    >
      {atTop ? (
        <button
          type="button"
          data-testid="section-bar"
          data-line={atTop.line}
          title={`Go to line ${atTop.line}`}
          className="nx-section-bar absolute left-0 right-0 z-10 flex h-[22px] items-center gap-[6px] overflow-hidden whitespace-nowrap border-b border-line bg-surface px-[10px] text-left"
          style={{ top: panelsHeight }}
          onClick={() => jumpRef.current?.(atTop.line)}
        >
          {trailTo(outlineNow, atTop).map((heading, index, trail) => (
            <span key={`${heading.line}:${heading.title}`} className="flex min-w-0 items-center gap-[6px]">
              {index ? <span className="t-micro text-ink-3">›</span> : null}
              <span
                className={`t-micro truncate ${index === trail.length - 1 ? "text-ink-2" : "text-ink-3"}`}
              >
                {heading.title}
              </span>
            </span>
          ))}
        </button>
      ) : null}
      {actions ? (
        <Suspense fallback={null}>
          <SelectionActions
            lines={{ from: actions.from, to: actions.to }}
            at={{ left: actions.left, top: actions.top }}
            onMeasure={measureRow}
            onDismiss={() => setActions(null)}
            verbs={actions.verbs}
            onComment={() => {
              if (comments.current?.start()) setActions(null);
            }}
            onPick={(prompt) => {
              setActions(null);
              onAskAbout?.(prompt);
            }}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <EditorComments
          view={view}
          host={host}
          current={current}
          viewing={viewing}
          sharedOf={(path) => buffers.current.get(path)?.shared}
          collab={collab}
          handle={comments}
        />
      </Suspense>
      {/* The kit's menu: placed on the screen from its measured size, put
          away by a press anywhere else, and closed by Escape with focus
          going back to the editor. */}
      <Menu
        open={offer !== null}
        onClose={() => {
          setOffer(null);
          view.current?.focus();
        }}
        wanted={offer ? { left: offer.x, top: offer.y, flip: offer.flip } : null}
        testid="spelling-menu"
        width={232}
        // A digit picks the guess with that number, which the hint beside
        // each guess promises.
        onKey={(event) => {
          const digit = Number(event.key);
          if (!offer || !Number.isInteger(digit) || digit < 1 || digit > offer.guesses.length) return false;
          event.preventDefault();
          const guess = offer.guesses[digit - 1];
          const now = view.current;
          setOffer(null);
          now?.dispatch({
            changes: { from: offer.from, to: offer.to, insert: guess },
            selection: { anchor: offer.from + guess.length },
          });
          now?.focus();
          return true;
        }}
      >
        {/* The guesses first, because a typo is the common case and adding
            a typo to the dictionary is the one outcome nobody wants; each
            with its number, so the first is a keystroke away.  A word that
            is nothing like anything in the list gets no guesses at all,
            and then the item below is the whole menu. */}
        {offer?.guesses.map((guess, index) => (
          <MenuItem
            key={guess}
            hint={index < 9 ? String(index + 1) : undefined}
            onClick={() => {
              const now = view.current;
              setOffer(null);
              now?.dispatch({
                changes: { from: offer.from, to: offer.to, insert: guess },
                selection: { anchor: offer.from + guess.length },
              });
              now?.focus();
            }}
          >
            {guess}
          </MenuItem>
        ))}
        {offer?.guesses.length ? <MenuDivider /> : null}
        <MenuItem
          onClick={() => {
            if (offer) accept(offer.word);
            view.current?.focus();
          }}
        >
          Add “{offer?.word}” to the dictionary
        </MenuItem>
      </Menu>
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
/** chktex for a .tex, the bibliography check for a .bib, nothing for the
 *  rest.  A .tex is asked once, on open; a .bib is asked again after the
 *  last keystroke settles (see `onChange`), because its check is pure
 *  Python over the live text and a row that says a field is missing
 *  should leave when the field is typed. */
function lintFile(projectId: string, path: string, delay = 600) {
  if (!path.endsWith(".tex") && !path.endsWith(".bib")) {
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
  }, delay);
}
