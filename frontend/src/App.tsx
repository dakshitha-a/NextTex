import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import api, { captureToken, saveBlob, startDownload } from "./api";
import {
  connect,
  disconnect,
  get,
  handlers,
  refreshContext,
  refreshGit,
  refreshHistory,
  refreshTrash,
  replayTranscript,
  set,
  useStore,
} from "./store";
import Editor, { type EditorHandle } from "./panes/Editor";
import FileView from "./panes/FileView";
// Loaded when the editor opens, not when the app does.  PDF.js is a third
// of the bundle and the first screen is the project list, which has no
// preview on it at all.
const Pdf = lazy(() => import("./panes/Pdf"));
import { type PdfHandle } from "./panes/Pdf";
import Chat, { type ChatHandle } from "./panes/Chat";
import Tabs from "./panes/Tabs";
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
import { applyTheme, storedTheme, type Theme } from "./theme";
import GitPanel from "./panes/GitPanel";

const DRAWER_CLOSED = 0;
const DRAWER_OPEN = 168;

type Widths = { rail: number; editor: number; chat: number };
const DEFAULTS: Widths = { rail: 240, editor: 0.5, chat: 380 };

/** The project the writer was in, so a reload comes back to the document. */
const LAST_PROJECT = "nexttex.lastProject";

/** Every file path in a tree, flattened. */
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

function pathsIn(node: any): string[] {
  if (!node) return [];
  const here = node.type === "file" && node.path ? [node.path as string] : [];
  const below = (node.children ?? []).flatMap(pathsIn);
  return [...here, ...below];
}

export default function App() {
  const [view, setView] = useState<"loading" | "signin" | "projects" | "editor">(
    "loading",
  );
  // Configured with no writing agent at all.  Read here with every other
  // hook, above the early returns: a `useStore` further down runs only on
  // the renders that get that far, which is React error #310 and took the
  // whole editor with it.
  const noAgent = useStore((s) => s.agent)?.provider === "none";
  const [widths, setWidths] = useState<Widths>(DEFAULTS);
  const [drawer, setDrawer] = useState(DRAWER_CLOSED);
  const [railHidden, setRailHidden] = useState(false);
  // Three widths matter: below 1400 the chat stops being a docked column,
  // below 1100 the rail folds away, and below 900 the editor and the PDF
  // take turns rather than splitting a space too small for either.
  const [width, setWidth] = useState(window.innerWidth);
  const narrow = width < 1400;
  const tight = width < 900;
  const [chatOpen, setChatOpen] = useState(true);
  const [showing, setShowing] = useState<"source" | "preview">("source");
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const [contextRequest, setContextRequest] =
    useState<"style" | "voice" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Docked when the editor can spare the width; over it when it cannot.
  // The panel exists to be read *beside* the file, and an overlay that
  // covers the right third of a wrapped LaTeX line defeats it.
  const [editorWide, setEditorWide] = useState(true);
  const [showingChanges, setShowingChanges] = useState(false);
  const [mainFile, setMainFile] = useState("main.tex");
  // Every pane folds away, and says where it went.  Editor and preview are
  // mutually exclusive: folding one gives the other the whole space, and
  // folding both would leave nothing to work in.
  const [folded, setFolded] = useState({
    rail: false,
    editor: false,
    pdf: false,
    chat: false,
  });
  const [chatOver, setChatOver] = useState(false);
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
  const error = useStore((s) => s.error);
  const conflict = useStore((s) => s.conflict);
  const viewing = useStore((s) => s.viewing);

  /** Go back to what was being written, or to the list if there is nothing.
   *
   *  A reload, or a browser restoring its tabs the next morning, used to
   *  land on the list of projects with no sign of which one had been open.
   */
  const resumeOrList = useCallback(async () => {
    let last = "";
    try {
      last = window.localStorage.getItem(LAST_PROJECT) ?? "";
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
    (async () => {
      const status = await api.agentStatus().catch(() => null);
      set({ agent: status });
      if (!status?.ready) {
        setView("signin");
        return;
      }
      await resumeOrList();
    })();
  }, [resumeOrList]);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const openProjectRef = useRef<((id: string) => Promise<void>) | null>(null);

  /** Go back to the list, and stop reopening this project on a reload. */
  const leaveProject = useCallback(() => {
    try {
      window.localStorage.removeItem(LAST_PROJECT);
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
      diagnostics: [],
      lint: [],
      compile: null,
    });
    replayTranscript(project.transcript ?? []);
    connect(id);
    refreshContext(id);
    setView("editor");
    // So a reload, or a browser restoring its tabs tomorrow morning, comes
    // back to the document rather than to the list of projects.
    try {
      window.localStorage.setItem(LAST_PROJECT, id);
    } catch {
      /* private browsing: the app works, it just forgets */
    }
    const storedFolds = window.localStorage.getItem(`nexttex.folded.${id}`);
    if (storedFolds) {
      try {
        setFolded((current) => ({ ...current, ...JSON.parse(storedFolds) }));
      } catch {
        /* a corrupt entry is not worth reporting */
      }
    }
    const stored = window.localStorage.getItem(`nexttex.widths.${id}`);
    if (stored) {
      try {
        setWidths({ ...DEFAULTS, ...JSON.parse(stored) });
      } catch {
        /* a corrupt entry is not worth reporting */
      }
    }
    // The files that were open last time, and the one that was in front.
    // Opening the main file instead would be right once and wrong every
    // time after that.
    let reopened: string[] = [];
    let front = "";
    try {
      const remembered = window.localStorage.getItem(`nexttex.open.${id}`);
      if (remembered) {
        const parsed = JSON.parse(remembered);
        reopened = Array.isArray(parsed.tabs) ? parsed.tabs.slice(0, 12) : [];
        front = typeof parsed.active === "string" ? parsed.active : "";
      }
    } catch {
      /* a corrupt entry is not worth reporting */
    }
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
    set({ tabs: strip.map((path) => ({ path, dirty: false })) });
    openFile(active).catch(() => undefined);
    api.compile(id).catch(() => undefined);
  }, []);
  openProjectRef.current = openProject;

  const openFile = useCallback(async (path: string, line?: number) => {
    const state = get();
    if (!state.tabs.some((tab) => tab.path === path)) {
      set({ tabs: [...state.tabs, { path, dirty: false }] });
    }
    // A figure gets a tab and becomes the active document like anything
    // else -- that is how its history is reached -- but it is never handed
    // to the editor, which would read its bytes as UTF-8 and report a
    // failure for a file that is perfectly fine.
    set({
      activePath: path,
      ...(kindOf(get().tree, path) === "text" || !kindOf(get().tree, path)
        ? { pendingOpen: { path, line, nonce: Date.now() } }
        : {}),
    });
  }, []);

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
  const renameOpenFile = useCallback((from: string, to: string) => {
    editor.current?.renamed(from, to);
    const state = get();
    if (!state.tabs.some((tab) => tab.path === from)) return;
    set({
      tabs: state.tabs.map((tab) =>
        tab.path === from ? { ...tab, path: to } : tab,
      ),
      activePath: state.activePath === from ? to : state.activePath,
      viewing:
        state.viewing?.path === from
          ? { ...state.viewing, path: to }
          : state.viewing,
    });
  }, []);

  // Which files are open, kept up to date rather than written on exit: a
  // browser tab that is closed, crashes or is restored tomorrow never gets
  // to run an exit handler.
  useEffect(() => {
    const id = get().projectId;
    if (!id || view !== "editor") return;
    try {
      window.localStorage.setItem(
        `nexttex.open.${id}`,
        JSON.stringify({ tabs: tabs.map((tab) => tab.path), active: activePath }),
      );
    } catch {
      /* private browsing: the app works, it just forgets */
    }
  }, [tabs, activePath, view]);

  const refreshTree = useCallback(async () => {
    const id = get().projectId;
    if (!id) return;
    set({ tree: await api.tree(id) });
  }, []);

  // ---- events from the server ------------------------------------------
  useEffect(() => {
    handlers.onFilesChanged = (paths, structural = true) => {
      // A plain save in another tab changes a file, not the shape of the
      // project, and walking the tree for one of those on every keystroke
      // burst in the other window is work for nothing.
      if (structural) refreshTree();
      for (const path of paths) editor.current?.reload(path);
    };
    handlers.onReveal = (path, line) => {
      openFile(path, line);
    };
    handlers.onAgentEdit = async (path, line) => {
      // Reload first, *then* jump.  A reload replaces the whole document,
      // which throws away any selection set before it -- the caret landed
      // on the change and was immediately dragged back to line one.
      await editor.current?.reload(path);
      refreshTree();
      // Go to what Claude changed.  The caret follows unless the writer is
      // mid-sentence in the composer, in which case moving focus would
      // interrupt a question they are still asking.
      const composerHasFocus = document.activeElement?.tagName === "TEXTAREA";
      await openFile(path, line);
      if (composerHasFocus) {
        (document.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
      }
    };
    handlers.onProjectChanged = () => {
      const id = get().projectId;
      if (id) api.open(id).then((project) => setMainFile(project.main ?? "main.tex"));
    };
    // The drawer is never opened for you.  A build fires while you are
    // still typing an equation, and having the error list jump up over the
    // document at that moment is the most irritating thing this app can do.
    // The status strip colours its dot; opening the list stays your choice.
    return () => {
      handlers.onFilesChanged = undefined;
      handlers.onReveal = undefined;
      handlers.onAgentEdit = undefined;
      handlers.onProjectChanged = undefined;
      handlers.onCompileDone = undefined;
    };
  }, [refreshTree, openFile]);

  useEffect(() => () => disconnect(), []);

  // Word counts are cheap but not free, so they follow the build rather
  // than every keystroke.
  const compileResult = useStore((s) => s.compile);
  const git = useStore((s) => s.git);

  // Roughly as often as the files on disk change, and it costs one
  // `git status`.
  useEffect(() => {
    if (projectId) refreshGit(projectId);
  }, [projectId, compileResult]);
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
  }, [projectId, activePath, wordScope, compileResult]);

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
        editor.current?.saveNow();
      }
      if (meta && event.key === "Enter" && activePath) {
        event.preventDefault();
        pdf.current?.reveal(activePath, get().cursor.line);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath]);

  // ---- pane dragging ----------------------------------------------------
  // Minimum widths, in pixels.  The panes carry these as CSS too; the drag
  // has to know them or it computes ratios the layout cannot honour.
  const MIN_EDITOR = 420;
  const MIN_PDF = 320;

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
      const bounds =
        which === "rail"
          ? { min: 180, max: 400 }
          : which === "chat"
            ? { min: 320, max: 560 }
            : { min: MIN_EDITOR, max: 0 };

      const editorWidth = editorPane.current?.getBoundingClientRect().width ?? 0;
      const pdfWidth = pdfPane.current?.getBoundingClientRect().width ?? 0;
      const pair = editorWidth + pdfWidth;
      if (which === "split") bounds.max = Math.max(pair - MIN_PDF, MIN_EDITOR);
      setEditorWide(editorWidth > 700);

      let anchorX = event.clientX;
      let anchorWidth =
        which === "rail"
          ? widthsRef.current.rail
          : which === "chat"
            ? widthsRef.current.chat
            : editorWidth;

      const move = (moveEvent: PointerEvent) => {
        const direction = which === "chat" ? -1 : 1;
        const wanted = anchorWidth + direction * (moveEvent.clientX - anchorX);
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
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // A drag can also end without a pointerup -- a browser dialog, a
        // tab switch, an interrupted touch -- and the move listener then
        // stayed attached, resizing panes on every mouse movement after.
        window.removeEventListener("pointercancel", up);
        const id = get().projectId;
        if (id) {
          window.localStorage.setItem(
            `nexttex.widths.${id}`,
            JSON.stringify(widthsRef.current),
          );
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

  // What the chat panel was doing before the window got narrow, so that
  // widening it again gives back the layout the writer chose rather than
  // reopening a panel they deliberately folded away.
  const foldedBeforeNarrow = useRef<boolean | null>(null);
  useEffect(() => {
    setChatOver(narrow);
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

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  const fold = useCallback((pane: "rail" | "editor" | "pdf" | "chat") => {
    setFolded((current) => {
      const next = { ...current, [pane]: !current[pane] };
      // One of the two middle panes always stays open.
      if (pane === "editor" && next.editor) next.pdf = false;
      if (pane === "pdf" && next.pdf) next.editor = false;
      const id = get().projectId;
      if (id) {
        window.localStorage.setItem(`nexttex.folded.${id}`, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  // The rail folds away when there is no room and comes back when there is,
  // unless the user hid it themselves.
  const railByHand = useRef(false);
  useEffect(() => {
    if (railByHand.current) return;
    setRailHidden(width < 1100);
  }, [width]);

  if (view === "loading") {
    return <div className="h-full bg-surround" />;
  }
  if (view === "signin") {
    return (
      <SignIn
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
      />
    );
  }

  const editorFraction = widths.editor;
  // Whether the rail went by hand or by window width, everything it holds
  // has to be reachable from somewhere else.
  const railFolded = railHidden || folded.rail;

  /** The active file, when it is one the editor cannot open. */
  const activeBinary = (() => {
    if (!activePath) return null;
    const find = (node: any): any =>
      node?.path === activePath
        ? node
        : (node?.children ?? []).reduce(
            (hit: any, child: any) => hit ?? find(child),
            null,
          );
    const node = find(get().tree);
    return node && node.type === "file" && node.kind && node.kind !== "text"
      ? node
      : null;
  })();

  return (
    <div ref={shell} className="relative flex h-full w-full overflow-hidden bg-surround">
      {railHidden || folded.rail ? (
        <Collapsed
          label="Files"
          side="left"
          onExpand={() => {
            railByHand.current = true;
            setRailHidden(false);
            setFolded((current) => ({ ...current, rail: false }));
          }}
        />
      ) : (
        <>
          <div
            className="nx-pane flex min-h-0 flex-col bg-surface"
            style={{ width: widths.rail }}
          >
            {/* No rule under this: the Files bar below carries it, so the
                project name and the file actions read as one masthead. */}
            <div className="flex h-[32px] shrink-0 items-center justify-between px-[10px]">
              <button
                className="flex min-w-0 items-center gap-2 transition-colors duration-[90ms] hover:text-hint"
                data-testid="switch-project"
                onClick={leaveProject}
                title="Switch project"
              >
                <Logo size={18} />
                <span className="t-ui-lg truncate font-serif">{projectName}</span>
              </button>
              <div className="flex items-center">
                <ThemeToggle theme={theme} onChange={setTheme} />
                <button
                  className="quiet t-micro h-[26px] rounded-[3px] px-2 hover:bg-surface-3"
                  title="Download the whole project as a zip"
                  onClick={() =>
                    projectId &&
                    startDownload(api.downloadUrl(projectId, { format: "zip" }))
                  }
                >
                  Zip
                </button>
                <button
                  className="quiet t-micro h-[26px] rounded-[3px] px-2 hover:bg-surface-3"
                  title="Download the typeset PDF"
                  onClick={() => projectId && downloadPdf(projectId, projectName)}
                >
                  PDF
                </button>
                <FoldButton
                  direction="left"
                  label="Fold the file list away"
                  onClick={() => fold("rail")}
                />
              </div>
            </div>
            <FileTree
              onOpen={openFile}
              onRefresh={refreshTree}
              onRename={renameOpenFile}
              onHistory={() => setHistoryOpen(true)}
              mainFile={mainFile}
            />
            <TrashPanel onRefresh={refreshTree} />
            <ContextPanel
              openFor={contextRequest}
              onHandled={() => setContextRequest(null)}
            />
            <GitPanel onOpen={openFile} />
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
                  theme={theme}
                  onTheme={setTheme}
                  projectId={projectId}
                  projectName={projectName}
                  onSwitch={leaveProject}
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <Tabs onSelect={(path) => openFile(path)} onClose={closeFile} />
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
            {chatOver && !chatOpen ? (
              <button
                className="t-micro mr-2 shrink-0 rounded-[3px] border border-line px-2 py-[3px] text-ink-2 hover:text-ink"
                onClick={() => setChatOpen(true)}
              >
                Claude
              </button>
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
                  <FileView path={activeBinary.path} size={activeBinary.size} />
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
              setDrawer((value) => (value ? DRAWER_CLOSED : DRAWER_OPEN))
            }
            onRebuild={() => projectId && api.compile(projectId, true)}
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
              className="flex h-[32px] shrink-0 cursor-pointer items-center gap-2 border-b border-line bg-surface-2 pl-2 pr-1 transition-colors duration-[90ms] hover:bg-surface-3"
              title="Fold the preview away"
              onClick={(event) => {
                // The header is the control; the chip inside it is not.
                if ((event.target as HTMLElement).closest("button")) return;
                fold("pdf");
              }}
            >
              {railFolded && folded.editor ? (
                <AppControls
                  theme={theme}
                  onTheme={setTheme}
                  projectId={projectId}
                  projectName={projectName}
                  onSwitch={leaveProject}
                />
              ) : (
                <span className="t-ui-lg font-serif text-ink">Preview</span>
              )}
              <span className="flex-1" />
              <FoldButton
                direction="right"
                label="Fold the preview away"
                onClick={() => fold("pdf")}
              />
            </div>
          ) : null}
          {tight && showing === "preview" ? (
            <div className="flex items-center justify-end bg-surface-2 py-1 pr-2">
              <Segmented value={showing} onChange={setShowing} />
            </div>
          ) : null}
          <Suspense fallback={<div className="h-full bg-surface-2" />}>
          <Pdf
            handleRef={(handle) => (pdf.current = handle)}
            onNavigate={(file, line) => openFile(file, line)}
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
      {!noAgent && folded.chat && !chatOver ? (
        <Collapsed label="Claude" side="right" onExpand={() => fold("chat")} />
      ) : null}
      <div
        hidden={noAgent}
        className={
          chatOver
            ? "absolute right-0 top-0 z-30 h-full border-l border-line shadow-[0_0_8px_rgba(0,0,0,0.25)]"
            : folded.chat
              ? "hidden"
              : "nx-pane min-h-0"
        }
        style={{
          width: widths.chat,
          transform: chatOver && !chatOpen ? "translateX(100%)" : undefined,
          transition: chatOver
            ? "transform 180ms var(--ease)"
            : undefined,
        }}
        aria-hidden={chatOver && !chatOpen}
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

      {conflict ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-lg rounded-[3px] border border-warn bg-surface px-3 py-2">
          <div className="t-meta text-ink">
            <span className="text-warn">{conflict.path}</span> changed somewhere
            else while you were editing it. Nothing has been overwritten.
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="pen-button t-micro"
              onClick={() =>
                editor.current?.resolveConflict(conflict.path, "mine")
              }
            >
              Keep what I typed
            </button>
            <button
              className="ghost-button t-micro"
              onClick={() =>
                editor.current?.resolveConflict(conflict.path, "theirs")
              }
            >
              Use the saved file
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[3px] border border-error bg-surface px-3 py-2">
          <span className="t-meta text-error">{error}</span>
          <button
            className="t-micro ml-3 text-ink-3 hover:text-ink"
            onClick={() => set({ error: null })}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A PDF download can fail -- the document may not typeset -- and a plain
 *  link would save the error as a .pdf.  Fetching first lets it say why. */
async function downloadPdf(projectId: string, name: string) {
  try {
    const response = await fetch(api.downloadUrl(projectId, { format: "pdf" }), {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "the project did not typeset");
    }
    saveBlob(await response.blob(), `${name || "project"}.pdf`);
  } catch (error: any) {
    set({ error: `Could not download the PDF: ${error.message}` });
  }
}

function AppControls({
  theme,
  onTheme,
  projectId,
  projectName,
  onSwitch,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  projectId: string | null;
  projectName: string;
  onSwitch: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 pr-1">
      <button
        className="quiet t-meta flex h-[26px] max-w-[200px] items-center gap-1 rounded-[3px] px-2 font-serif hover:bg-surface-3"
        onClick={onSwitch}
        title="Switch project"
      >
        <span className="truncate text-ink">{projectName}</span>
        <Chevron direction="down" />
      </button>
      <ThemeToggle theme={theme} onChange={onTheme} />
      <button
        className="quiet t-micro h-[26px] rounded-[3px] px-2 hover:bg-surface-3"
        title="Download the whole project as a zip"
        onClick={() =>
          projectId && startDownload(api.downloadUrl(projectId, { format: "zip" }))
        }
      >
        Zip
      </button>
      <button
        className="quiet t-micro h-[26px] rounded-[3px] px-2 hover:bg-surface-3"
        title="Download the typeset PDF"
        onClick={() => projectId && downloadPdf(projectId, projectName)}
      >
        PDF
      </button>
    </div>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <button
      className="quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
      title={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={() => onChange(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8 5.6 5.6 0 1 0 13.2 9.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3" />
          </g>
        </svg>
      )}
    </button>
  );
}

/** One chevron drawing, so the app speaks one language of arrows. */
export function Chevron({
  direction = "left",
}: {
  direction?: "left" | "right" | "up" | "down";
}) {
  const path = {
    left: "M6 1 L2 5 L6 9",
    right: "M2 1 L6 5 L2 9",
    up: "M1 6 L5 2 L9 6",
    down: "M1 2 L5 6 L9 2",
  }[direction];
  const size = direction === "left" || direction === "right" ? [8, 10] : [10, 8];
  return (
    <svg width={size[0]} height={size[1]} viewBox={direction === "left" || direction === "right" ? "0 0 8 10" : "0 0 10 8"} aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A padded fold control, so it is a button rather than punctuation. */
function FoldButton({
  direction,
  label,
  onClick,
}: {
  direction: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="quiet flex h-[26px] w-[22px] shrink-0 items-center justify-center rounded-[3px] hover:bg-surface-3"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Chevron direction={direction} />
    </button>
  );
}

function Segmented({
  value,
  onChange,
}: {
  value: "source" | "preview";
  onChange: (value: "source" | "preview") => void;
}) {
  return (
    // A group of two buttons with a pressed state, not a tablist: there is
    // no panel associated with either and no arrow-key navigation between
    // them, and claiming a role whose contract is not honoured tells a
    // screen reader something untrue.
    <div
      role="group"
      aria-label="Show the source or the preview"
      data-testid="view-toggle"
      className="mr-2 flex shrink-0 overflow-hidden rounded-[3px] border border-line"
    >
      {(["source", "preview"] as const).map((option) => (
        <button
          key={option}
          aria-pressed={value === option}
          className={`t-micro border-b-2 px-2 py-[3px] transition-colors duration-[90ms] ${
            value === option
              ? "border-hint bg-surface text-ink"
              : "border-transparent text-ink-3 hover:text-hint"
          }`}
          onClick={() => onChange(option)}
        >
          {option === "source" ? "Source" : "Preview"}
        </button>
      ))}
    </div>
  );
}

function Handle({
  onPointerDown,
  onReset,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  onReset?: () => void;
}) {
  return (
    <div
      className="nx-handle relative w-px shrink-0 cursor-col-resize"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    >
      <span className="absolute -left-1 top-0 h-full w-[9px]" />
    </div>
  );
}
