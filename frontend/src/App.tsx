import { useCallback, useEffect, useRef, useMemo, useState, lazy, Suspense } from "react";
import api, { captureToken, landingAfter, startDownload } from "./api";
import { forget, keep, recall, recallText } from "./remember";
import {
  ShareIcon,
  DownloadMenu,
  AppControls,
  Chevron,
  downloadPdf,
  FoldButton,
  Segmented,
  Handle,
} from "./chrome";
import { onFrame } from "./timing";
import {
  BREAKPOINTS,
  breakpoints,
  clampWidths,
  dragBounds,
  minPairFor,
  nextFolded,
  type Widths,
} from "./layout";
import Boundary from "./Boundary";
import {
  connect,
  disconnect,
  dismissNotice,
  get,
  handlers,
  reconcile,
  refreshContext,
  refreshGit,
  refreshHistory,
  replayTranscript,
  set,
  type Tab,
  useStore,
} from "./store";
import Editor, { type EditorHandle } from "./panes/Editor";
// Shown only for a file CodeMirror cannot hold, which most sessions
// never open, so it is fetched when one is.
const FileView = lazy(() => import("./panes/FileView"));
// Loaded when the editor opens, not when the app does.  PDF.js is a third
// of the bundle and the first screen is the project list, which has no
// preview on it at all.
const Pdf = lazy(() => import("./panes/Pdf"));
// Lazy for the same reason Pdf is: the tutorial carries a dozen screenshots
// and a thousand words, and none of it belongs in what a first visit has to
// download before the editor appears.
const Tutorial = lazy(() => import("./panes/tutorial/Tutorial"));
/** Lazily loaded, like the tutorial. Most sessions never open it, and the
 *  entry bundle is measured. */
const SharePanel = lazy(() => import("./panes/SharePanel"));
import { type PdfHandle } from "./panes/Pdf";
import Chat, { type ChatHandle } from "./panes/Chat";
import Tabs from "./panes/Tabs";
import PreviewTabs from "./panes/PreviewTabs";
import AgentButton from "./panes/AgentButton";
import Status from "./panes/Status";
import Diagnostics from "./panes/Diagnostics";
import FileTree from "./panes/FileTree";
import Projects from "./panes/Projects";
import SignIn from "./panes/SignIn";
import ContextPanel from "./panes/ContextPanel";
import Collapsed from "./panes/Collapsed";
import HistoryPanel, { ViewingBanner } from "./panes/History";
import TrashPanel from "./panes/TrashPanel";
import Logo from "./Logo";
import Settings from "./panes/Settings";
import InstanceBadge from "./panes/InstanceBadge";
import { toShell, uiScale, viewportWidth } from "./viewport";
import { APPEARANCE_CHANGED } from "./appearance";
import GitPanel from "./panes/GitPanel";
import PapersPanel from "./panes/PapersPanel";
import SectionsPanel, { includePath } from "./panes/SectionsPanel";

const DRAWER_CLOSED = 0;
const DRAWER_OPEN = 168;
// A build with an explanation puts a strip above the list, and 168px
// left less than one row's height under it -- the drawer opened onto
// its own summary with the errors it summarised out of sight.
const DRAWER_WITH_SUMMARY = 248;

const DEFAULTS: Widths = { rail: 240, editor: 0.5, chat: 380 };

/** The project the writer was in, so a reload comes back to the document. */
const LAST_PROJECT = "nexttex.lastProject";

/** How a file can be shown, from the tree the store already holds. */
function kindOf(tree: any, path: string): string | undefined {
  const find = (node: any): any =>
    node?.path === path
      ? node
      : (node?.children ?? []).reduce(
          (hit: any, child: any) => hit ?? find(child),
          null,
        );
  return find(tree)?.kind;
}

/** Every file path in a tree, flattened. */
function pathsIn(node: any): string[] {
  if (!node) return [];
  const here = node.type === "file" && node.path ? [node.path as string] : [];
  const below = (node.children ?? []).flatMap(pathsIn);
  return [...here, ...below];
}

export default function App() {
  const [view, setView] = useState<
    "loading" | "offline" | "signin" | "projects" | "editor"
  >(
    "loading",
  );
  // What the server said when it refused to start us, if it said anything.
  // A server that is not listening says nothing; a server that is broken
  // answers, and what it answers is the only thing the writer can act on.
  const [waitingBecause, setWaitingBecause] = useState("");
  // Configured with no writing agent at all.  Read here with every other
  // hook, above the early returns: a `useStore` further down runs only on
  // the renders that get that far, which is React error #310 and took the
  // whole editor with it.
  const agentProvider = useStore((s) => s.agent)?.provider;
  const noAgent = agentProvider === "none";
  // Read here too, and for the same reason: the drawer opens taller
  // when the build left an explanation to sit above the list.
  const hasSummary = !!useStore((s) => s.compile?.summary);
  const [widths, setWidths] = useState<Widths>(DEFAULTS);
  const [drawer, setDrawer] = useState(DRAWER_CLOSED);
  const [railHidden, setRailHidden] = useState(false);
  // Three widths matter: below 1400 the chat stops being a docked column,
  // below 1100 the rail folds away, and below 900 the editor and the PDF
  // take turns rather than splitting a space too small for either.
  // In the space the layout is laid out in, not the viewport: at a 150%
  // interface size a 1680px display has 1120px to arrange, and the
  // narrow-layout breakpoints are written in those units.
  const [width, setWidth] = useState(viewportWidth);
  const { narrow, tight } = breakpoints(width);
  // Open unless the window is too narrow to dock it, so a narrow window
  // does not paint an overlay on the first frame and close it on the
  // second.
  const [chatOpen, setChatOpen] = useState(!narrow);
  const [showing, setShowing] = useState<"source" | "preview">("source");
  const [contextRequest, setContextRequest] =
    useState<"style" | "voice" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Docked when the editor can spare the width; over it when it cannot.
  // The panel exists to be read *beside* the file, and an overlay that
  // covers the right third of a wrapped LaTeX line defeats it.
  const [editorWide, setEditorWide] = useState(true);
  const [showingChanges, setShowingChanges] = useState(false);
  const [mainFile, setMainFile] = useState("main.tex");
  /** Which of the rail's two navigation panels are open.  Kept apart from
   *  `folded`, which is the pane layout the focus modes save and restore:
   *  these are sections inside one pane and have nothing to do with it. */
  const [railOpen, setRailOpen] = useState({ files: true, sections: true });
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Every pane folds away, and says where it went.  Editor and preview are
  // mutually exclusive: folding one gives the other the whole space, and
  // folding both would leave nothing to work in.
  const [folded, setFolded] = useState({
    rail: false,
    editor: false,
    pdf: false,
    chat: false,
  });
  // Reading mode and writing mode: one pane with the window to itself.
  const [focus, setFocus] = useState<"editor" | "pdf" | null>(null);
  const beforeFocus = useRef<{
    folded: { rail: boolean; editor: boolean; pdf: boolean; chat: boolean };
    railHidden: boolean;
    railByHand: boolean;
    chatOpen: boolean;
    showing: "source" | "preview";
  } | null>(null);
  // Derived, not mirrored. This was `useState(false)` kept in step with
  // `narrow` from an effect, which meant it was a render behind the width
  // it describes -- so for one commit the panel's class came from the old
  // value while `widths` and `folded` came from the new one, and the layout
  // was painted from two different ideas of how wide the window was. A
  // frame of that is a flicker; a frame that survives a slow re-render is a
  // panel sitting somewhere it should not be, which is not reproducible on
  // purpose and so could not be chased. There is nothing to keep in step:
  // it was only ever set to `narrow`.
  const chatOver = narrow;
  const [wordScope, setWordScope] = useState<"file" | "document">("document");
  const [words, setWords] = useState<number | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const pdf = useRef<PdfHandle | null>(null);
  const chat = useRef<ChatHandle | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const editorPane = useRef<HTMLDivElement | null>(null);
  const pdfPane = useRef<HTMLDivElement | null>(null);

  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const notices = useStore((s) => s.notices);
  const viewing = useStore((s) => s.viewing);

  /** Go back to what was being written, or to the list if there is nothing.
   *
   *  A reload, or a browser restoring its tabs the next morning, used to
   *  land on the list of projects with no sign of which one had been open.
   */
  const resumeOrList = useCallback(async () => {
    let last = "";
    try {
      last = recallText(LAST_PROJECT);
    } catch {
      /* nothing was remembered */
    }
    if (last) {
      const known = await api.projects().catch(() => null);
      const match = known?.projects.find(
        (project) => project.id === last && !project.missing,
      );
      if (match?.id) {
        try {
          await openProjectRef.current?.(match.id);
          return;
        } catch {
          /* it has gone or will not open: the list is the safe answer */
        }
      }
    }
    setView("projects");
  }, []);

  // ---- first load -------------------------------------------------------
  useEffect(() => {
    captureToken();
    let stopped = false;
    (async () => {
      // "Could not reach the server" and "no agent is configured" used to
      // be the same branch, so a server that was down put the writer on the
      // sign-in screen -- a question they cannot answer about a machine
      // that is not listening.  An `ApiError` carries a status; a fetch
      // that never got an answer throws a bare TypeError instead.
      for (let attempt = 0; !stopped; attempt += 1) {
        try {
          // One round trip for both: who the agent is, and which install
          // this is.  The second only matters when a machine carries two.
          const [status, self] = await Promise.all([
            api.agentStatus(),
            api.instance().catch(() => null),
          ]);
          set({ agent: status, instance: self?.instance ?? "" });
          if (self?.instance) document.title = `NextTex · ${self.instance}`;
          if (!status?.ready) setView("signin");
          else await resumeOrList();
          return;
        } catch (problem: any) {
          if (landingAfter(problem) === "signin") {
            set({ agent: null });
            setView("signin");
            return;
          }
          // A server that answered said something; a server that is not
          // listening said nothing, and the screen supplies its own words.
          setWaitingBecause(problem?.status !== undefined ? problem?.message ?? "" : "");
          setView("offline");
          await new Promise((wake) => window.setTimeout(wake, Math.min(500 * 2 ** attempt, 4000)));
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [resumeOrList]);

  useEffect(() => {
    // A browser fires `resize` far faster than it paints, and this reads
    // computed style and then re-renders the root, so once per frame is
    // both as often as it can be seen and as often as it is worth doing.
    const onResize = onFrame(() => setWidth(viewportWidth()));
    window.addEventListener("resize", onResize);
    // The interface size changes the space the layout has without the
    // window changing size at all: it is a `zoom` on the root, and
    // `viewportWidth` is the window divided by it.  No `resize` follows, so
    // until this was listened for, everything measured stayed at the old
    // number until the window itself was dragged -- `narrow`, `tight`,
    // `chatOver` and `railHidden`, and the effect that keeps the pane
    // widths inside the window.  Stepping the size up therefore left the
    // agent panel docked in a row too narrow to hold it.
    window.addEventListener(APPEARANCE_CHANGED, onResize);
    return () => {
      onResize.cancel();
      window.removeEventListener("resize", onResize);
      window.removeEventListener(APPEARANCE_CHANGED, onResize);
    };
  }, []);

  const openProjectRef = useRef<((id: string) => Promise<void>) | null>(null);

  /** Go back to the list, and stop reopening this project on a reload. */
  const leaveProject = useCallback(() => {
    try {
      forget(LAST_PROJECT);
    } catch {
      /* nothing was remembered anyway */
    }
    setView("projects");
  }, []);

  // ---- opening a project ------------------------------------------------
  const openProject = useCallback(async (id: string) => {
    const project = await api.open(id);
    setMainFile(project.main ?? "main.tex");
    set({
      projectId: id,
      projectName: project.name ?? "",
      tree: project.tree,
      tabs: [],
      activePath: null,
      outline: [],
      diagnostics: [],
      lint: [],
      compile: null,
      stale: false,
      // The three switches live in the project's own nexttex.toml and
      // arrive with it, so the settings card is right on the first frame
      // rather than showing defaults until something changes.
      settings: {
        autocompile: project.autocompile !== false,
        markErrors: project.markErrors !== false,
        markWarnings: project.markWarnings === true,
      },
    });
    replayTranscript(project.transcript ?? []);
    // A card the server is still waiting on outlives the page that showed
    // it, and the replay above marks it denied.  Ask what is really open.
    void reconcile();
    connect(id);
    refreshContext(id);
    setView("editor");
    // So a reload, or a browser restoring its tabs tomorrow morning, comes
    // back to the document rather than to the list of projects.
    try {
      keep(LAST_PROJECT, id);
    } catch {
      /* private browsing: the app works, it just forgets */
    }
    // Reset first: a project with nothing stored gets the default, not
    // whatever the project before it was left in.
    setRailOpen(recall(`nexttex.rail.${id}`, { files: true, sections: true }));
    setFolded((current) => recall(`nexttex.folded.${id}`, current));
    setWidths(recall(`nexttex.widths.${id}`, DEFAULTS));
    // The files that were open last time, and the one that was in front.
    // Opening the main file instead would be right once and wrong every
    // time after that.
    // Still checked field by field after `recall` has handed back an
    // object: `recall` guarantees the shape of the entry and not the shape
    // of what is inside it, and these two go on to open files.
    const open = recall(`nexttex.open.${id}`, { tabs: [], active: "" } as {
      tabs: unknown; active: unknown;
    });
    const reopened: string[] = Array.isArray(open.tabs)
      ? (open.tabs as string[]).filter((t) => typeof t === "string").slice(0, 12)
      : [];
    const front = typeof open.active === "string" ? open.active : "";
    const main = project.main ?? "main.tex";
    const inTree = new Set(pathsIn(project.tree));
    const active = inTree.has(front) ? front : main;
    // The strip comes back whole and in the order it was left in -- adding
    // the tabs one at a time and the active one last reordered the strip
    // under the writer on every reload, moving whatever they were working
    // on to the far right.
    //
    // Only the file in front is read.  A tab is a name until it is clicked;
    // its buffer is fetched then.  This used to loop over `openFile`, which
    // reads as though it loaded each one -- it does not, and could not:
    // `pendingOpen` holds a single file and the editor consumes it once per
    // render, so all but the last were overwritten before anything saw
    // them.  Six remembered tabs must not cost six reads before the window
    // can be used, so say what happens.
    const strip = reopened.filter((path) => inTree.has(path));
    if (!strip.includes(active)) strip.push(active);
    // The previewed documents arrive with the project rather than in a
    // second round trip, because the strip is drawn on the first frame.
    const previewed: string[] = (project as any).previews ?? [main];
    set({
      tabs: strip.map((path): Tab => ({ path })),
      previews: previewed,
      activePreview: previewed.includes(active) ? active : previewed[0] ?? main,
      candidates: (project as any).candidates ?? [],
      owners: (project as any).owners ?? {},
    });
    openFile(active).catch(() => undefined);
    // Every previewed document, not just the main one: a second preview
    // opening on a stale page from the last session is the thing the tab
    // strip most obviously must not do.
    for (const name of previewed) {
      api.compile(id, false, name).catch(() => undefined);
    }
  }, []);
  openProjectRef.current = openProject;

  /** Build now, on purpose.  Saves first: autosave runs 250ms behind the
   *  keyboard, so a click inside that window would typeset the previous
   *  text and look like the button had not worked. */
  const buildNow = useCallback(
    async (full: boolean) => {
      const id = get().projectId;
      if (!id) return;
      await editor.current?.saveNow();
      // The document in front.  A manual build is about the page being
      // looked at, and building the main one from a tab showing another
      // would leave the button apparently doing nothing.
      await api.compile(id, full, get().activePreview).catch(() => undefined);
    },
    [],
  );

  const openFile = useCallback(async (
    path: string,
    line?: number,
    /** The word a double-click on the page landed on, when that is where
     *  this came from. The editor puts the cursor on it rather than at the
     *  start of the line. */
    word?: string,
  ) => {
    const state = get();
    if (!state.tabs.some((tab) => tab.path === path)) {
      set({ tabs: [...state.tabs, { path }] });
    }
    // A figure gets a tab and becomes the active document like anything
    // else -- that is how its history is reached -- but it is never handed
    // to the editor, which would read its bytes as UTF-8 and report a
    // failure for a file that is perfectly fine.
    set({
      activePath: path,
      ...(kindOf(get().tree, path) === "text" || !kindOf(get().tree, path)
        ? { pendingOpen: { path, line, word, nonce: Date.now() } }
        : {}),
    });
  }, []);

  /** Open or fold one of the rail's navigation panels, and remember which.
   *  Kept out of `folded`, which the focus modes save and restore: these
   *  are sections inside one pane rather than panes. */
  const toggleRail = useCallback((which: "files" | "sections") => {
    setRailOpen((current) => {
      const next = { ...current, [which]: !current[which] };
      const id = get().projectId;
      try {
        if (id) {
          keep(`nexttex.rail.${id}`, next);
        }
      } catch {
        /* private browsing: the app works, it just forgets */
      }
      return next;
    });
  }, []);

  /** Go to a heading in the Sections list.  A row standing for an
   *  `\include` opens the file it names; every other row moves the caret
   *  inside the document already in front. */
  const resolveInclude = useCallback(
    (path: string) => includePath(get().tree, mainFile, path),
    [mainFile],
  );

  const jumpToHeading = useCallback(
    (heading: { line: number; path?: string }) => {
      if (heading.path) {
        // A row whose file is not in the project is drawn as unavailable
        // and cannot be clicked, so this only ever has somewhere to go.
        const target = includePath(get().tree, mainFile, heading.path);
        if (target) openFile(target);
        return;
      }
      const path = get().activePath;
      if (path) openFile(path, heading.line);
    },
    [mainFile, openFile],
  );

  const closeFile = useCallback(async (path: string) => {
    const state = get();
    const remaining = state.tabs.filter((tab) => tab.path !== path);
    await editor.current?.close(path);
    set({
      tabs: remaining,
      activePath:
        state.activePath === path
          ? (remaining[remaining.length - 1]?.path ?? null)
          : state.activePath,
    });
    const next = get().activePath;
    if (next) set({ pendingOpen: { path: next, nonce: Date.now() } });
  }, []);

  const viewVersion = useCallback(async (sha: string | null) => {
    const path = get().activePath;
    if (!path) return;
    setShowingChanges(false);
    if (!sha) {
      editor.current?.backToNow();
      return;
    }
    try {
      // The editor sets `viewing` itself, at the moment it actually parks
      // the live buffer.  Setting it here, after the await, could land
      // after a tab click had already left the view.
      await editor.current?.view(path, sha);
    } catch (error: any) {
      set({ error: `Could not open that version: ${error.message}` });
    }
  }, []);

  const restoreVersion = useCallback(async () => {
    const state = get();
    const viewingNow = state.viewing;
    if (!state.projectId || !viewingNow) return;
    try {
      await api.restoreVersion(state.projectId, viewingNow.path, viewingNow.sha);
      editor.current?.backToNow();
      set({ viewing: null });
      await refreshHistory(state.projectId, viewingNow.path);
    } catch (error: any) {
      set({ error: `Could not restore that version: ${error.message}` });
    }
  }, []);

  const closeHistory = useCallback(() => {
    // Every way out of the panel is also a way out of viewing a version.
    editor.current?.backToNow();
    setShowingChanges(false);
    setHistoryOpen(false);
  }, []);

  /** Carry an open file across a rename.
   *
   *  Tabs, the active path and the editor's buffers are all keyed by path.
   *  Renaming one that was open left every one of them pointing at a name
   *  that no longer exists, and the next autosave then wrote there --
   *  bringing the old file back and stranding the writer's edits in it.
   */
  // A folder that moves takes every file under it, so this follows a path
  // prefix rather than an exact match.  Matching only the moved path itself
  // left every tab inside a moved folder pointing at a file that was no
  // longer there, and the next save wrote it back to the old place.
  const renameOpenFile = useCallback((from: string, to: string) => {
    const moved = (path: string): string | null => {
      if (path === from) return to;
      if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
      return null;
    };
    const state = get();
    // The editor follows the same prefix rule over its own buffers, so one
    // call moves every open file under a renamed folder.
    editor.current?.renamed(from, to);
    const touched =
      state.tabs.some((tab) => moved(tab.path) !== null) ||
      (state.activePath !== null && moved(state.activePath) !== null) ||
      (state.viewing != null && moved(state.viewing.path) !== null);
    if (!touched) return;
    set({
      tabs: state.tabs.map((tab) => {
        const next = moved(tab.path);
        return next ? { ...tab, path: next } : tab;
      }),
      activePath: state.activePath
        ? (moved(state.activePath) ?? state.activePath)
        : state.activePath,
      viewing: state.viewing
        ? { ...state.viewing, path: moved(state.viewing.path) ?? state.viewing.path }
        : state.viewing,
    });
  }, []);

  // Which files are open, kept up to date rather than written on exit: a
  // browser tab that is closed, crashes or is restored tomorrow never gets
  // to run an exit handler.
  useEffect(() => {
    const id = get().projectId;
    if (!id || view !== "editor") return;
    keep(`nexttex.open.${id}`, {
      tabs: tabs.map((tab) => tab.path),
      active: activePath,
    });
  }, [tabs, activePath, view]);

  const refreshTree = useCallback(async () => {
    const id = get().projectId;
    if (!id) return;
    set({ tree: await api.tree(id) });
  }, []);

  // ---- events from the server ------------------------------------------
  useEffect(() => {
    handlers.onFilesChanged = (_paths, structural = true) => {
      // A plain save in another tab changes a file, not the shape of the
      // project, and walking the tree for one of those on every keystroke
      // burst in the other window is work for nothing.
      if (structural) refreshTree();
      // No reloading. An open file is a shared document, so a change made
      // anywhere is already in the buffer by the time this event lands.
    };
    handlers.onRenamed = (from, to) => {
      renameOpenFile(from, to);
    };
    handlers.onReveal = (path, line) => {
      openFile(path, line);
    };
    handlers.onAgentEdit = async (path, line) => {
      // Nothing to reload: the agent's edit went into the shared document,
      // so it is already on screen. What is left is going to look at it.
      refreshTree();
      // Go to what Claude changed.  The caret follows unless the writer is
      // mid-sentence in the composer, in which case moving focus would
      // interrupt a question they are still asking.
      const composerHasFocus = document.activeElement?.tagName === "TEXTAREA";
      await openFile(path, line);
      if (composerHasFocus) {
        // `preventScroll` for the same reason every focus in the panel
        // carries it: the composer can be outside the shell, and a focus
        // that scrolls it into view drags the whole layout with it.
        (document.querySelector("textarea") as HTMLTextAreaElement | null)
          ?.focus({ preventScroll: true });
      }
    };
    handlers.onProjectChanged = (main) => {
      // The event carries what changed, so this no longer re-reads the
      // whole project -- tree, transcript and all -- to learn one filename.
      // The store has already taken the three switches out of the same
      // payload.
      if (main) setMainFile(main);
    };
    // The drawer is never opened for you.  A build fires while you are
    // still typing an equation, and having the error list jump up over the
    // document at that moment is the most irritating thing this app can do.
    // The status strip colours its dot; opening the list stays your choice.
    return () => {
      handlers.onFilesChanged = undefined;
      handlers.onRenamed = undefined;
      handlers.onReveal = undefined;
      handlers.onAgentEdit = undefined;
      handlers.onProjectChanged = undefined;
      handlers.onCompileDone = undefined;
    };
  }, [refreshTree, openFile, renameOpenFile]);

  useEffect(() => () => disconnect(), []);

  // Word counts are cheap but not free, so they follow the build rather
  // than every keystroke.
  // The build's *identity* used to be the dependency here, and a build
  // replaces that object, so one finished build fanned out into a git
  // status, a word count and a whole symbol table, three round trips for
  // a thing that happens 1.6 seconds after every pause in typing. The
  // stamp is a number written once when a build lands, which is exactly
  // the event these three actually want.
  const builtAt = useStore((s) => s.pdfStamp);
  const git = useStore((s) => s.git);

  // Roughly as often as the files on disk change, and it costs one
  // `git status`.
  useEffect(() => {
    if (projectId) refreshGit(projectId);
  }, [projectId, builtAt]);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .words(projectId, activePath ?? "", wordScope)
      .then((result) => !cancelled && setWords(result.words))
      .catch(() => !cancelled && setWords(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, activePath, wordScope, builtAt]);

  // ---- pane dragging ----------------------------------------------------
  // The arithmetic itself is in `layout.ts`, where it can be tested: it is
  // what decides whether this row fits the window, and the shell clips
  // rather than scrolls, so getting it wrong makes part of the interface
  // unreachable rather than merely awkward.
  useEffect(() => {
    setWidths((current) =>
      clampWidths(current, {
        width,
        tight,
        railShown: !(railHidden || folded.rail),
        chatShown: !noAgent && !chatOver && !folded.chat,
        minPair: minPairFor(folded),
      }),
    );
  }, [width, tight, railHidden, folded, chatOver, noAgent]);

  const startDrag =
    (which: "rail" | "split" | "chat") => (event: React.PointerEvent) => {
      event.preventDefault();
      // Measure what the panes actually are, then move them by how far the
      // pointer has travelled since the last frame -- re-anchoring whenever
      // a minimum width stops the movement.
      //
      // Without the re-anchoring, dragging past a stop lets the cursor run
      // away from the pane: a pointer 400 px beyond the limit has to travel
      // all 400 px back before anything moves, which reads as the handle
      // being stuck in the direction you now want to go.  Re-anchoring
      // means the pane starts moving the instant you reverse.
      // `getBoundingClientRect` reports viewport pixels even inside the
      // zoomed shell, so bring it back into the space the bounds are written
      // in.
      const editorWidth = toShell(editorPane.current?.getBoundingClientRect().width ?? 0);
      const pdfWidth = toShell(pdfPane.current?.getBoundingClientRect().width ?? 0);
      const pair = editorWidth + pdfWidth;
      setEditorWide(editorWidth > 700);

      // The browser reads a divider drag as a text selection too, and left
      // the status strip and the gutter highlighted afterwards.
      document.body.classList.add("nx-dragging");

      let anchorX = event.clientX;
      let anchorWidth =
        which === "rail"
          ? widthsRef.current.rail
          : which === "chat"
            ? widthsRef.current.chat
            : editorWidth;

      const bounds = dragBounds(which, {
        pair,
        anchorWidth,
        minPair: tight ? 0 : minPairFor(folded),
      });

      // The same reason, on the other end of a drag: pointer moves arrive
      // faster than frames, and every one of these set state on the root.
      const move = onFrame((moveEvent: PointerEvent) => {
        const direction = which === "chat" ? -1 : 1;
        const wanted =
          anchorWidth + (direction * (moveEvent.clientX - anchorX)) / uiScale();
        const settled = Math.min(Math.max(wanted, bounds.min), bounds.max);
        if (settled !== wanted) {
          anchorX = moveEvent.clientX;
          anchorWidth = settled;
        }
        setWidths((current) => {
          if (which === "rail") return { ...current, rail: settled };
          if (which === "chat") return { ...current, chat: settled };
          if (pair <= 0) return current;
          return { ...current, editor: settled / pair };
        });
      });

      const up = () => {
        move.cancel();
        document.body.classList.remove("nx-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // A drag can also end without a pointerup -- a browser dialog, a
        // tab switch, an interrupted touch -- and the move listener then
        // stayed attached, resizing panes on every mouse movement after.
        window.removeEventListener("pointercancel", up);
        const id = get().projectId;
        if (id) {
          keep(`nexttex.widths.${id}`, widthsRef.current);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const chatOverRef = useRef(chatOver);
  chatOverRef.current = chatOver;
  const foldedRef = useRef(folded);
  foldedRef.current = folded;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const railHiddenRef = useRef(railHidden);
  railHiddenRef.current = railHidden;
  const showingRef = useRef(showing);
  showingRef.current = showing;

  // What the chat panel was doing before the window got narrow, so that
  // widening it again gives back the layout the writer chose rather than
  // reopening a panel they deliberately folded away.
  const foldedBeforeNarrow = useRef<boolean | null>(null);
  useEffect(() => {
    if (narrow) {
      if (foldedBeforeNarrow.current === null) {
        foldedBeforeNarrow.current = get().projectId ? chatOpenRef.current : true;
      }
      setChatOpen(false);
      return;
    }
    setChatOpen(foldedBeforeNarrow.current ?? true);
    foldedBeforeNarrow.current = null;
  }, [narrow]);

  // The editor's width decides whether history docks or overlays.
  useEffect(() => {
    const pane = editorPane.current;
    if (!pane) return;
    const observer = new ResizeObserver((entries) => {
      setEditorWide((entries[0]?.contentRect.width ?? 0) > 700);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [view]);

  // The rail folds away when there is no room and comes back when there is,
  // unless the user hid it themselves.
  const railByHand = useRef(false);

  const fold = useCallback((pane: "rail" | "editor" | "pdf" | "chat") => {
    // Folding anything by hand is the writer arranging the panes
    // themselves, which is the end of whatever mode they were in: the
    // layout it would restore is no longer the one they left.
    setFocus(null);
    beforeFocus.current = null;
    setFolded((current) => {
      const next = nextFolded(current, pane);
      const id = get().projectId;
      if (id) {
        keep(`nexttex.folded.${id}`, next);
      }
      return next;
    });
  }, []);

  /** Where the tutorial sheet's right edge sits.
   *
   *  Immediately left of the agent when it has a column of its own, and at
   *  the window edge when it does not.  Either way the sheet lands on the
   *  preview, which is the one pane no part of the tutorial asks you to
   *  touch -- the rail, the tab strip, the gutter, the status strip and the
   *  composer all stay visible behind it. */
  const chatDocked = !noAgent && !chatOver && !folded.chat;
  const tutorialRight = chatDocked ? widths.chat : 0;

  /** Back to the screen that chose the agent.
   *
   *  Changing it closes every open session server-side, because each one
   *  holds an agent built for the old provider -- so the editor is left
   *  behind deliberately rather than kept in a state whose agent no longer
   *  exists.  `onDone` puts the writer back where they were. */
  const changeAgent = useCallback(() => {
    setTutorialOpen(false);
    setView("signin");
  }, []);

  /** Open the tutorial, putting the agent overlay away first.
   *
   *  Below 1400px the agent is itself an overlay over the preview, and two
   *  overlapping sheets is a mess.  This is the same handoff the preview
   *  pane already performs on a pointer press, for the same reason -- and
   *  the tutorial's own shortcut table names the key that brings the agent
   *  back two sections later. */
  const openTutorial = useCallback(() => {
    if (chatOverRef.current && chatOpenRef.current) setChatOpen(false);
    setTutorialOpen(true);
  }, []);

  /** Show or hide the agent panel.
   *
   *  It is two different things depending on the width: below 1400px the
   *  panel is an overlay that slides over the page, above it a column that
   *  folds.  One shortcut has to do whichever is on screen, and either way
   *  opening it leaves the caret in the box -- a shortcut that opens a
   *  panel you then have to click into has saved nobody anything. */
  const toggleChat = useCallback(() => {
    if (get().agent?.provider === "none") return;
    if (chatOverRef.current) {
      const opening = !chatOpenRef.current;
      setChatOpen(opening);
      if (opening) window.setTimeout(() => chat.current?.focusComposer(), 60);
      return;
    }
    const opening = foldedRef.current.chat;
    fold("chat");
    if (opening) window.setTimeout(() => chat.current?.focusComposer(), 60);
  }, [fold]);

  /** Close the agent panel, whichever form it is in, and leave everything
   *  else alone.  Escape only ever closes: a key that opened a panel from
   *  nowhere would be a surprise, and there is a shortcut for opening. */
  const closeChat = useCallback(() => {
    if (chatOverRef.current) {
      if (chatOpenRef.current) setChatOpen(false);
      return;
    }
    if (!foldedRef.current.chat) fold("chat");
  }, [fold]);

  // ---- previewed documents ----------------------------------------------
  const previews = useStore((s) => s.previews);
  const activePreview = useStore((s) => s.activePreview);

  /** Bring a document's preview forward, and its source with it.
   *
   *  Both directions are automatic and neither moves the keyboard: a tab
   *  click that stole focus from the composer or the editor would make the
   *  strip unusable while typing. */
  const showPreview = useCallback((path: string) => {
    if (!path || path === get().activePreview) return;
    set({ activePreview: path });
    const id = get().projectId;
    if (id) {
      api
        .setFocus(id, get().activePath ?? "", undefined, undefined, undefined, path)
        .catch(() => undefined);
    }
    if (get().activePath !== path) openFile(path);
  }, [openFile]);

  const startPreviewing = useCallback(async (path: string) => {
    const id = get().projectId;
    if (!id) return;
    try {
      const body = await api.addPreview(id, path);
      set({ previews: body.previews, candidates: body.candidates, owners: body.owners });
      showPreview(path);
    } catch (problem: any) {
      set({ error: problem.message });
    }
  }, [showPreview]);

  const stopPreviewing = useCallback(async (path: string) => {
    const id = get().projectId;
    if (!id) return;
    try {
      const body = await api.removePreview(id, path);
      const next = get().activePreview === path ? body.main : get().activePreview;
      set({
        previews: body.previews, candidates: body.candidates,
        owners: body.owners, activePreview: next,
      });
    } catch (problem: any) {
      set({ error: problem.message });
    }
  }, []);

  /** The preview follows the file you open, when that file is a document
   *  in its own right.  A chapter is not: its preview is the document that
   *  includes it, which is already showing. */
  useEffect(() => {
    if (!activePath) return;
    if (previews.includes(activePath) && activePath !== activePreview) {
      set({ activePreview: activePath });
    }
  }, [activePath, previews, activePreview]);

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key === "b") {
        event.preventDefault();
        railByHand.current = true;
        setRailHidden((value) => !value);
      }
      if (meta && event.key === "s") {
        event.preventDefault();
        // With compile-as-you-type off, save is also the build: it is the
        // Overleaf convention, it is what the hands already do, and it
        // saves inventing a second binding for a thing the writer now has
        // to ask for explicitly.
        if (get().settings.autocompile) editor.current?.saveNow();
        else void buildNow(false);
      }
      if (meta && event.key === "Enter" && activePath) {
        event.preventDefault();
        pdf.current?.reveal(activePath, get().cursor.line);
      }
      // The agent panel.  `code` rather than `key`: with Alt held, macOS
      // reports the character the combination would type, so `key` here is
      // "å" rather than "a".
      //
      // Not Super-A as first suggested: on Linux the window manager takes
      // Super before the browser sees it, and Cmd/Ctrl-A alone is Select
      // All, which an editor cannot give up.  Cmd/Ctrl-Shift-A is Chrome's
      // own tab search.  Alt keeps the A, which is the part worth keeping.
      if (meta && event.altKey && event.code === "KeyA") {
        event.preventDefault();
        toggleChat();
      }

      // Cycle the previewed documents.  KeyP for preview, and free in both
      // CodeMirror's keymap and the browser's -- see docs/design.md.
      if (meta && event.altKey && event.code === "KeyP") {
        event.preventDefault();
        const open = get().previews;
        if (open.length > 1) {
          const at = open.indexOf(get().activePreview);
          showPreview(open[(at + 1 + open.length) % open.length]);
        }
      }

      // Escape closes the agent panel, from inside the agent panel.
      //
      // Not from anywhere on screen.  Escape already means something in the
      // editor -- it is how a keyboard gets out of CodeMirror, where Tab
      // indents rather than moving on -- and a global binding stole that,
      // shutting the panel every time somebody pressed it to tab away.  So
      // this is scoped the way every other Escape in the app is: it
      // dismisses the thing you are in.  The shortcut that opens the panel
      // leaves the caret in its composer, which is what makes the two a
      // pair; anywhere else the key belongs to whatever is nearer.
      if (event.key === "Escape") {
        // These cover the screen while they are open, and close themselves.
        if (tutorialOpen || historyOpen || showingChanges || contextRequest) return;
        const active = document.activeElement as HTMLElement | null;
        if (!active?.closest?.("[data-nx-chat]")) return;
        // A popover inside the panel claims Escape by preventing the
        // default, and window listeners run in the order they were added --
        // those components mount long after this one, so the claim is only
        // visible once the dispatch is over.  Hence the wait.
        window.setTimeout(() => {
          if (event.defaultPrevented) return;
          closeChat();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activePath, toggleChat, closeChat, showPreview,
    tutorialOpen, historyOpen, showingChanges, contextRequest,
  ]);


  /** Give one pane the whole window, and give it back.
   *
   *  Reading mode and writing mode are the same mechanism pointed at
   *  different panes: everything else folds away, and a second double
   *  click restores the layout exactly as it was rather than unfolding
   *  everything -- a writer who had the agent hidden before does not want
   *  it back for having read a page.
   *
   *  Deliberately not persisted. The folded state that reaches
   *  localStorage is the arrangement the writer chose, so a reload in the
   *  middle of a mode comes back to their real layout rather than to a
   *  collapsed window with no memory of what preceded it. */
  const toggleFocus = useCallback((pane: "editor" | "pdf") => {
    if (focusRef.current === pane) {
      const saved = beforeFocus.current;
      if (saved) {
        setFolded(saved.folded);
        setRailHidden(saved.railHidden);
        railByHand.current = saved.railByHand;
        setChatOpen(saved.chatOpen);
        setShowing(saved.showing);
      }
      beforeFocus.current = null;
      setFocus(null);
      return;
    }
    if (!beforeFocus.current) {
      beforeFocus.current = {
        folded: foldedRef.current,
        railHidden: railHiddenRef.current,
        railByHand: railByHand.current,
        chatOpen: chatOpenRef.current,
        showing: showingRef.current,
      };
    }
    // Writing keeps the file list; reading does not. Somebody writing is
    // still moving between chapters, and a mode that hides the way to the
    // next one is a mode they leave immediately. Somebody reading the
    // typeset page has nothing to navigate to.
    const keepRail = pane === "editor";
    // Set by hand either way, so the width-watching effect does not undo
    // it the moment the window is touched.
    railByHand.current = true;
    setRailHidden(!keepRail);
    setChatOpen(false);
    setFolded({
      rail: !keepRail,
      editor: pane !== "editor",
      pdf: pane !== "pdf",
      chat: true,
    });
    // Below 900px the two middle panes share one view rather than folding,
    // so the mode picks which of them is showing.
    setShowing(pane === "editor" ? "source" : "preview");
    setFocus(pane);
  }, []);

  /** One header, two gestures.
   *
   *  A double click arrives as two clicks, so the fold has to wait long
   *  enough to find out which one this is. 250 ms is the shortest wait
   *  that does not turn a deliberate double click into a fold followed by
   *  a mode, and it is short enough that a single click still feels like
   *  a button rather than a request. */
  // The pending click carries which header it was on: a click on the
  // preview followed quickly by one on the source is two single clicks,
  // not a double click on whichever came second.
  const headerTimer = useRef<{ pane: "editor" | "pdf"; id: number } | null>(null);
  const headerClick = useCallback(
    (pane: "editor" | "pdf") => {
      const pending = headerTimer.current;
      if (pending) {
        window.clearTimeout(pending.id);
        headerTimer.current = null;
        if (pending.pane === pane) {
          toggleFocus(pane);
          return;
        }
        // A different header: the first click was meant on its own.
        fold(pending.pane);
      }
      const id = window.setTimeout(() => {
        headerTimer.current = null;
        fold(pane);
      }, 250);
      headerTimer.current = { pane, id };
    },
    [fold, toggleFocus],
  );
  useEffect(
    () => () => {
      if (headerTimer.current) window.clearTimeout(headerTimer.current.id);
    },
    [],
  );

  // The rail comes back when there is room again, unless it was hidden by
  // hand -- which a focus mode counts as.
  useEffect(() => {
    if (railByHand.current) return;
    setRailHidden(width < BREAKPOINTS.rail);
  }, [width]);

  /** The active file, when it is one the editor cannot open.
   *
   * Above the early returns with every other hook, for the reason the
   * comment at the top of this component gives: a hook that only runs on
   * the renders which get that far is React error #310, and it took the
   * whole editor with it once already. It used to be an IIFE further down
   * that walked the entire tree on every render and read it through `get()`,
   * so it was both repeated work and a value React had no idea it depended
   * on.
   */
  const tree = useStore((s) => s.tree);
  const activeBinary = useMemo(() => {
    if (!activePath) return null;
    const find = (node: any): any =>
      node?.path === activePath
        ? node
        : (node?.children ?? []).reduce(
            (hit: any, child: any) => hit ?? find(child),
            null,
          );
    const node = find(tree);
    return node && node.type === "file" && node.kind && node.kind !== "text"
      ? node
      : null;
  }, [activePath, tree]);

  if (view === "loading") {
    // Words rather than a spinner, because §6 of the specification does not
    // have spinners and because a coloured rectangle is not a loading state,
    // it is an absence. This is the first thing anybody sees, and on a slow
    // first connection it was the only thing, for as long as it took.
    return (
      <div className="flex h-full items-center justify-center bg-surround">
        <p className="t-ui text-ink-3" role="status">
          Opening NextTex
        </p>
      </div>
    );
  }
  if (view === "offline") {
    // Said plainly and without a button: there is nothing the reader can
    // press that would help, and the app reconnects on its own.  When the
    // server did answer, what it said goes here rather than being replaced
    // by "not answering", which would be a false statement about a machine
    // that is listening.
    return (
      <div className="flex h-full items-center justify-center bg-surround">
        <div className="text-center">
          <p className="t-ui text-ink">Waiting for NextTex</p>
          <p className="t-meta mt-1 text-ink-2">
            {waitingBecause || "The server is not answering."} This page
            reconnects on its own.
          </p>
        </div>
      </div>
    );
  }
  if (view === "signin") {
    return (
      <SignIn
        // Only when there is something to go back to.  At boot there is
        // not: no agent has been chosen and no project is open.
        onCancel={
          get().projectId || get().projects.length
            ? () => void resumeOrList()
            : undefined
        }
        onDone={async () => {
          set({ agent: await api.agentStatus().catch(() => null) });
          // Back to whatever was being written, the same way a reload
          // gets there.  Signing in again after a session expires should
          // not cost the writer their place.
          void resumeOrList();
        }}
      />
    );
  }
  if (view === "projects") {
    return (
      <Projects
        onOpen={openProject}
        canClose={Boolean(projectId)}
        onClose={() => setView("editor")}
        onChangeAgent={changeAgent}
      />
    );
  }

  const editorFraction = widths.editor;
  // Whether the rail went by hand or by window width, everything it holds
  // has to be reachable from somewhere else.
  const railFolded = railHidden || folded.rail;

  return (
    // Two elements rather than one, and which is which matters.  `nx-frame`
    // is the scroll port, so a window narrower than the layout's stated
    // minimum can be scrolled across instead of having its right hand edge
    // quietly cut off.  `nx-shell` inside it clips with `overflow: clip` and
    // is therefore not a scroll container at all, which is what stops a
    // browser scrolling a focused element into view and taking the whole
    // layout with it.  See the rules in styles.css for both.
    <div className="nx-frame bg-surround">
    <div ref={shell} className="nx-shell relative flex h-full w-full bg-surround">
      {railHidden || folded.rail ? (
        <Collapsed
          label="Files"
          side="left"
          furniture
          onExpand={() => {
            railByHand.current = true;
            setRailHidden(false);
            setFolded((current) => ({ ...current, rail: false }));
          }}
        />
      ) : (
        <>
          <div
            className="nx-furniture nx-pane flex min-h-0 shrink-0 flex-col bg-surface"
            style={{ width: widths.rail }}
          >
            {/* No rule under this: the Files header below carries it, so
                the project name and the panel stack are divided once. */}
            <div className="flex h-[32px] shrink-0 items-center justify-between px-[10px]">
              <button
                className="flex min-w-0 items-center gap-2 transition-colors duration-[90ms] hover:text-hint"
                data-testid="switch-project"
                onClick={leaveProject}
                title="Switch project"
              >
                <Logo size={18} />
                <span className="t-ui-lg truncate font-serif">{projectName}</span>
                <InstanceBadge />
              </button>
              <div className="flex items-center">
                {/* Beside the project's own name, because sharing is a fact
                    about this project rather than about the install. */}
                <button
                  className="quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
                  title="Share this project with other people running NextTex"
                  aria-label="Share this project"
                  data-testid="open-share"
                  onClick={() => setSharing(true)}
                >
                  <ShareIcon />
                </button>
                <Settings
                  align="left"
                  inProject
                  onTutorial={openTutorial}
                  onChangeAgent={changeAgent}
                />
                {/* Two buttons that both mean "give me a copy" were two
                    words competing with the project's name for a 32px bar.
                    One icon, and the choice inside it. */}
                <DownloadMenu
                  onZip={() =>
                    projectId &&
                    startDownload(api.downloadUrl(projectId, { format: "zip" }))
                  }
                  onPdf={() => projectId && downloadPdf(projectId, projectName)}
                />
                <FoldButton
                  direction="left"
                  label="Fold the file list away"
                  onClick={() => fold("rail")}
                />
              </div>
            </div>
            {/* The panels scroll as a stack when they do not all fit.
                Every expanded panel below Files is `shrink-0` -- correct,
                because a list squeezed to two rows is worse than one you
                scroll to -- but the column had no answer for the case where
                their natural heights add up to more than the rail is tall,
                and they simply drew over each other.  Opening Files,
                Sections and the context panel together was enough to do it.

                min-h-0 as well as overflow: a flex child will not scroll
                until it is allowed to be shorter than its content, and
                without it this scrolls the window instead. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {/* Files and Sections are both navigation, and both fold, so
                  the rail reads as one stack of panels rather than a tree
                  with some panels bolted underneath it. */}
              <button
                className="flex h-[26px] shrink-0 items-center justify-between border-t border-line px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
                aria-expanded={railOpen.files}
                data-testid="files-toggle"
                onClick={() => toggleRail("files")}
              >
                <span className="t-micro text-ink-2">Files</span>
                <span className={`text-ink-3 ${railOpen.files ? "rotate-180" : ""}`}>
                  <Chevron direction="down" />
                </span>
              </button>
              {/* Unmounted rather than hidden when folded: the tree owns a
                  type-ahead and a roving tab stop, and both would still be
                  reachable from the keyboard behind a closed panel. */}
              {railOpen.files ? (
                <FileTree
                onPreview={startPreviewing}
                onUnpreview={stopPreviewing}
                  onOpen={openFile}
                  onRefresh={refreshTree}
                  onRename={renameOpenFile}
                  onHistory={() => setHistoryOpen(true)}
                  mainFile={mainFile}
                />
              ) : null}
              <SectionsPanel
                open={railOpen.sections}
                onToggle={() => toggleRail("sections")}
                onJump={jumpToHeading}
                grow={!railOpen.files}
                resolve={resolveInclude}
              />
              <TrashPanel onRefresh={refreshTree} />
              <PapersPanel onRefresh={refreshTree} />
              {/* What the agent reads is nothing to offer when there is no
                  agent.  The trash, the papers and the git panel all stay:
                  none of them is about a model. */}
              {noAgent ? null : (
                <ContextPanel
                  openFor={contextRequest}
                  onHandled={() => setContextRequest(null)}
                />
              )}
              <GitPanel onOpen={openFile} />
            </div>
          </div>
          <Handle
            onPointerDown={startDrag("rail")}
            onReset={() => setWidths((current) => ({ ...current, rail: DEFAULTS.rail }))}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1">
        {folded.editor && !tight ? (
          <Collapsed label="Source" side="left" onExpand={() => fold("editor")} />
        ) : null}
        <div
          ref={editorPane}
          className={`nx-pane flex min-h-0 flex-col bg-surface ${
            tight
              ? showing === "source"
                ? "flex-1"
                : "hidden"
              : folded.editor
                ? "hidden"
                : "min-w-[420px]"
          }`}
          style={
            tight || folded.editor
              ? undefined
              : { flex: `${folded.pdf ? 1 : editorFraction} 1 0` }
          }
        >
          <div className="flex items-center bg-surface-2">
            {railFolded ? (
              // Nothing is lost when the rail folds away: the project name,
              // its switcher, the theme and the downloads move here.
              <div className="flex h-[32px] shrink-0 items-center border-r border-line pl-1">
                <AppControls
                  projectId={projectId}
                  projectName={projectName}
                  onSwitch={leaveProject}
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <Tabs
                onSelect={(path) => openFile(path)}
                onClose={closeFile}
                // Only the empty run of the strip, never a tab: this is the
                // one header whose whole width is already a control.
                onBlank={!tight ? () => headerClick("editor") : undefined}
              />
            </div>
            {tight ? (
              <Segmented value={showing} onChange={setShowing} />
            ) : null}
            {!tight ? (
              <FoldButton
                direction="left"
                label="Fold the source away"
                onClick={() => fold("editor")}
              />
            ) : null}
          </div>
          {viewing ? (
            <ViewingBanner
              version={viewing.version}
              showingChanges={showingChanges}
              onRestore={restoreVersion}
              onBack={() => {
                editor.current?.backToNow();
                setShowingChanges(false);
              }}
              onToggleChanges={() => {
                const next = !showingChanges;
                setShowingChanges(next);
                editor.current?.showChanges(next);
              }}
            />
          ) : null}
          <div className="relative flex min-h-0 flex-1">
            <div className="relative min-h-0 flex-1">
              <Editor handleRef={(handle) => (editor.current = handle)} />

              {/* A figure is a file in this project like any other: it has
                  a tab, a place in the tree, and -- since it can now be
                  replaced without losing what it replaced -- a history.
                  All three of those go through "the active document", so
                  one that CodeMirror cannot hold has to be shown here. */}
              {activeBinary ? (
                <div className="absolute inset-0">
                  <Suspense fallback={null}>
                    <FileView path={activeBinary.path} size={activeBinary.size} />
                  </Suspense>
                </div>
              ) : null}

              {tabs.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center bg-surface">
                  <p className="t-display text-ink-3">Open a file from the list.</p>
                </div>
              ) : null}
            </div>
            {historyOpen ? (
              <HistoryPanel
                docked={!tight && editorWide}
                onView={viewVersion}
                onClose={closeHistory}
              />
            ) : null}
          </div>
          <Status
            onHistory={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
            historyOpen={historyOpen}
            // §4: nothing is lost when the rail folds -- the dirty count
            // comes here instead of disappearing with the git panel.
            git={railFolded && git?.repository ? git : null}
            words={words}
            wordScope={wordScope}
            onToggleWordScope={() =>
              setWordScope((value) => (value === "file" ? "document" : "file"))
            }
            onToggleDrawer={() =>
              setDrawer((value) =>
                value ? DRAWER_CLOSED : hasSummary ? DRAWER_WITH_SUMMARY : DRAWER_OPEN,
              )
            }
            onRebuild={(full) => void buildNow(full)}
          />
          <Diagnostics
            height={drawer}
            onJump={(file, line) => openFile(file, line)}
            onFix={(text) => chat.current?.seed(text)}
            onResize={setDrawer}
            onClose={() => setDrawer(DRAWER_CLOSED)}
          />
        </div>

        {tight || folded.editor || folded.pdf ? null : (
          <Handle
            onPointerDown={startDrag("split")}
            onReset={() =>
              setWidths((current) => ({ ...current, editor: DEFAULTS.editor }))
            }
          />
        )}

        <div
          ref={pdfPane}
          data-testid="preview-pane"
          // Reaching for the page puts the page away.  Below 1400px the
          // agent panel is an overlay lying over the preview, and the
          // click that means "let me read this" is the same click that
          // should give the width back.  On pointerdown rather than click,
          // so it lands before the header's own single/double-click timer
          // and never turns a fold into a mode change; nothing is
          // prevented, so the click still reaches the page underneath.
          onPointerDown={(event) => {
            if (!chatOver || !chatOpen) return;
            // Not from the header.  It is a control with its own single and
            // double click handling, and closing the overlay from it would
            // be recorded as the layout that reading mode came *from* --
            // so leaving reading mode would give back a window with the
            // agent panel missing, which is not what was there before.
            if ((event.target as HTMLElement).closest('[data-testid="preview-header"]')) {
              return;
            }
            setChatOpen(false);
          }}
          className={`nx-pane flex min-h-0 flex-col ${
            tight
              ? showing === "preview"
                ? "flex-1"
                : "hidden"
              : folded.pdf
                ? "hidden"
                : "min-w-[320px]"
          }`}
          // Grow factors are two halves of one whole.  Against Tailwind's
          // flex-1 (grow: 1) an editor at 0.5 takes a third, not a half,
          // which is how the PDF ended up filling its pane edge to edge.
          style={
            tight || folded.pdf
              ? undefined
              : { flex: `${folded.editor ? 1 : 1 - editorFraction} 1 0` }
          }
        >
          {!tight ? (
            <div
              // `select-none`: this header answers a double click by
              // entering reading mode, and a double click on text also
              // selects the word under it -- so the label was left
              // highlighted in a lavender that reads like --pen, the one
              // colour reserved for "the agent touched this".
              className="flex h-[32px] shrink-0 cursor-pointer select-none items-center gap-2 border-b border-line bg-surface-2 pl-2 pr-1 transition-colors duration-[90ms] hover:bg-surface-3"
              title="Click to fold the preview away, double-click to read"
              data-testid="preview-header"
              onClick={(event) => {
                // The header is the control; the chip inside it is not.
                if ((event.target as HTMLElement).closest("button")) return;
                headerClick("pdf");
              }}
            >
              {/* The label stays on the left in every state.  When the
                  rail is folded away this header also carries the project
                  controls, and those used to take the label's place -- so
                  the second half of the double click that leaves reading
                  mode landed on "switch project" and left the document
                  entirely.  They go beside the other control instead, and
                  the left of the bar stays the thing you click. */}
              <PreviewTabs
                onSelect={showPreview}
                onClose={stopPreviewing}
                onAdd={startPreviewing}
              />
              <span className="flex-1" />
              {railFolded && folded.editor ? (
                <AppControls
                  projectId={projectId}
                  projectName={projectName}
                  onSwitch={leaveProject}
                />
              ) : null}
              <FoldButton
                direction="right"
                label="Fold the preview away"
                onClick={() => fold("pdf")}
              />
            </div>
          ) : null}
          {tight && showing === "preview" ? (
            // The preview has no header at this width, so the tabs share
            // the row that carries the source/preview toggle.  Without
            // this there was no way to change document with a mouse below
            // 900px -- the same hole the agent button had, in the same
            // place, for the same reason.
            <div className="flex items-center gap-2 bg-surface-2 py-1 pl-1 pr-2">
              <PreviewTabs
                onSelect={showPreview}
                onClose={stopPreviewing}
                onAdd={startPreviewing}
              />
              <Segmented value={showing} onChange={setShowing} />
            </div>
          ) : null}
          {/* Its own boundary as well as the root's: the preview is the
              largest chunk and the one most likely to be missing after an
              update, and losing the pane is a great deal better than
              losing the window. */}
          <Boundary>
          <Suspense fallback={<div className="h-full bg-surface-2" />}>
          <Pdf
            document={activePreview}
            handleRef={(handle) => (pdf.current = handle)}
            onNavigate={(file, line, word) => openFile(file, line, word)}
            onLoadTemplate={async () => {
              const id = get().projectId;
              if (!id) return;
              try {
                await api.loadTemplate(id);
                refreshTree();
              } catch (error: any) {
                set({ error: error.message });
              }
            }}
          />
          </Suspense>
          </Boundary>
        </div>
        {folded.pdf && !tight ? (
          <Collapsed label="Preview" side="right" onExpand={() => fold("pdf")} />
        ) : null}
      </div>

      {/* No agent means no column, not an empty one.  Somebody who chose to
          write without a model gets the whole width for the document and
          the page, which is the point of offering the choice at all. */}
      {noAgent ? null : !chatOver && !folded.chat ? (
        <Handle
          onPointerDown={startDrag("chat")}
          onReset={() => setWidths((current) => ({ ...current, chat: DEFAULTS.chat }))}
        />
      ) : null}
      {/* One way to the agent, in the same corner at every width.  It
          travels left when the panel is docked so the panel never covers
          the thing that closes it. */}
      {noAgent ? null : (
        <AgentButton
          open={chatOver ? chatOpen : !folded.chat}
          onToggle={toggleChat}
          // Left of the panel whenever the panel is showing -- docked or
          // overlaid.  Only the docked case was handled, so on a narrow
          // window the pill landed inside the overlay: over the model
          // popover, two pixels above Send, and across the corner of the
          // box you type into.  The control that closes a panel must not
          // be covered by it, and must not cover it either.
          right={
            (chatOver ? chatOpen : !folded.chat) ? widths.chat + 14 : 14
          }
        />
      )}
      {tutorialOpen ? (
        <Suspense
          fallback={
            <div
              className="absolute inset-y-0 z-40 w-[380px] max-w-full border-l border-line bg-surface-2"
              style={{ right: tutorialRight }}
            />
          }
        >
          <Tutorial right={tutorialRight} onClose={() => setTutorialOpen(false)} />
        </Suspense>
      ) : null}

      {noAgent ? null : (
      <div
        className={
          "nx-furniture " +
          (chatOver
            ? "absolute right-0 top-0 z-30 h-full border-l border-line shadow-[0_0_8px_rgba(0,0,0,0.25)]"
            : folded.chat
              ? "hidden"
              : "nx-pane min-h-0 shrink-0")
        }
        style={{
          width: widths.chat,
          transform: chatOver && !chatOpen ? "translateX(100%)" : undefined,
          // Hidden once it has finished sliding out.  A transform leaves it
          // laid out and hit-testable, so a click could land in a panel
          // nobody can see -- and the browser would scroll it into view,
          // taking the rail off the screen with it.  The delay is what
          // keeps the slide visible: on the way out visibility waits for
          // the transform, on the way in it applies at once.
          visibility: chatOver && !chatOpen ? "hidden" : undefined,
          transition: chatOver
            ? `transform 180ms var(--ease), visibility 0s linear ${
                chatOpen ? "0s" : "180ms"
              }`
            : undefined,
        }}
        aria-hidden={chatOver && !chatOpen}
        // `inert` as well as `aria-hidden`, and this is not belt and
        // braces.  The parked overlay is slid off the edge with a
        // transform, so it is still laid out: it adds its own width to the
        // shell's scrollWidth, and everything inside it is still focusable.
        // Clicking or tabbing to anything in there made the browser scroll
        // it into view, which dragged the whole layout left by the panel's
        // width -- the rail off the screen and the editor's text clipped at
        // x=0.  `aria-hidden` says "do not announce this"; only `inert`
        // says "this cannot be reached".
        inert={chatOver && !chatOpen}
        // Read by the Escape handler, which has to tell the panel's own
        // composer from every other box on screen.
        data-nx-chat=""
        data-testid="chat-panel"
      >
        <Chat
          onAddContext={async (kind) => {
            if (kind === "template") {
              const id = get().projectId;
              if (!id) return;
              try {
                await api.loadTemplate(id);
                refreshTree();
              } catch (error: any) {
                set({ error: error.message });
              }
              return;
            }
            // The panel lives in the rail, so it has to be open to be used.
            railByHand.current = true;
            setRailHidden(false);
            setFolded((current) => ({ ...current, rail: false }));
            setContextRequest(kind);
          }}
          onFold={() => (chatOver ? setChatOpen(false) : fold("chat"))}
          handleRef={(handle) => (chat.current = handle)}
          onShowEdit={(path, line) => openFile(path, line)}
          onHoverEdit={(path, range) => {
            if (range && get().activePath === path) {
              editor.current?.flash(range[0], range[1]);
            }
          }}
        />
      </div>
      )}

      {sharing && projectId ? (
        <Suspense fallback={null}>
          <SharePanel projectId={projectId} onClose={() => setSharing(false)} />
        </Suspense>
      ) : null}

      {/* A live region, always present rather than mounted with the first
          failure: a region that appears at the same moment as its content
          is not announced by every screen reader, and the whole purpose of
          this is to say something to somebody who cannot see it. `polite`
          rather than `assertive` because none of these interrupts what the
          writer is doing; it reports what the app just failed to do. */}
      <div
        className="pointer-events-none absolute bottom-3 left-1/2 z-50 flex
                   -translate-x-1/2 flex-col items-center gap-2"
        role="status"
        aria-live="polite"
        data-testid="notices"
      >
        {notices.map((notice) => (
          <div
            key={notice.id}
            className="nx-arrive pointer-events-auto flex max-w-[52ch] items-start
                       gap-3 rounded-[3px] border border-error bg-surface px-3 py-2
                       shadow-float"
          >
            <span className="t-meta text-error">{notice.text}</span>
            <button
              className="t-micro shrink-0 text-ink-3 hover:text-ink"
              onClick={() => dismissNotice(notice.id)}
              aria-label={`Dismiss: ${notice.text}`}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

