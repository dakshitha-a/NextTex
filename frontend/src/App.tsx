import { useCallback, useEffect, useRef, useState } from "react";
import api, { captureToken, startDownload } from "./api";
import {
  connect,
  disconnect,
  get,
  handlers,
  refreshContext,
  refreshGit,
  replayTranscript,
  set,
  useStore,
} from "./store";
import Editor, { type EditorHandle } from "./panes/Editor";
import Pdf, { type PdfHandle } from "./panes/Pdf";
import Chat, { type ChatHandle } from "./panes/Chat";
import Tabs from "./panes/Tabs";
import Status from "./panes/Status";
import Diagnostics from "./panes/Diagnostics";
import FileTree from "./panes/FileTree";
import Projects from "./panes/Projects";
import SignIn from "./panes/SignIn";
import ContextPanel from "./panes/ContextPanel";
import Collapsed from "./panes/Collapsed";
import { applyTheme, storedTheme, type Theme } from "./theme";
import GitPanel from "./panes/GitPanel";

const DRAWER_CLOSED = 0;
const DRAWER_OPEN = 168;

type Widths = { rail: number; editor: number; chat: number };
const DEFAULTS: Widths = { rail: 240, editor: 0.5, chat: 380 };

export default function App() {
  const [view, setView] = useState<"loading" | "signin" | "projects" | "editor">(
    "loading",
  );
  const [widths, setWidths] = useState<Widths>(DEFAULTS);
  const [drawer, setDrawer] = useState(DRAWER_CLOSED);
  const [drawerDismissed, setDrawerDismissed] = useState(false);
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

  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const error = useStore((s) => s.error);

  // ---- first load -------------------------------------------------------
  useEffect(() => {
    captureToken();
    (async () => {
      const status = await api.claudeStatus().catch(() => null);
      set({ claude: status });
      setView(status?.loggedIn ? "projects" : "signin");
    })();
  }, []);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---- opening a project ------------------------------------------------
  const openProject = useCallback(async (id: string) => {
    const project = await api.open(id);
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
    // Open the main file so the first frame shows the document, not an
    // empty editor.
    const main = project.main ?? "main.tex";
    openFile(main).catch(() => undefined);
    api.compile(id).catch(() => undefined);
  }, []);

  const openFile = useCallback(async (path: string, line?: number) => {
    const state = get();
    if (!state.tabs.some((tab) => tab.path === path)) {
      set({ tabs: [...state.tabs, { path, dirty: false }] });
    }
    set({
      activePath: path,
      pendingOpen: { path, line, nonce: Date.now() },
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

  const refreshTree = useCallback(async () => {
    const id = get().projectId;
    if (!id) return;
    set({ tree: await api.tree(id) });
  }, []);

  // ---- events from the server ------------------------------------------
  useEffect(() => {
    handlers.onFilesChanged = (paths) => {
      refreshTree();
      for (const path of paths) editor.current?.reload(path);
    };
    handlers.onReveal = (path, line) => {
      openFile(path, line);
    };
    handlers.onAgentEdit = (path) => {
      editor.current?.reload(path);
      refreshTree();
    };
    handlers.onCompileDone = (result) => {
      const errors = result.diagnostics?.some((item) => item.severity === "error");
      // Auto-open once per build that has errors; a user who closes it is
      // not overruled until the next failing build.
      if (errors && !drawerDismissed) setDrawer(DRAWER_OPEN);
      if (!errors) setDrawerDismissed(false);
    };
    return () => {
      handlers.onFilesChanged = undefined;
      handlers.onReveal = undefined;
      handlers.onAgentEdit = undefined;
      handlers.onCompileDone = undefined;
    };
  }, [refreshTree, drawerDismissed, openFile]);

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
  const startDrag = (which: "rail" | "split" | "chat") => (event: React.PointerEvent) => {
    event.preventDefault();
    const box = shell.current?.getBoundingClientRect();
    if (!box) return;
    const move = (moveEvent: PointerEvent) => {
      const x = moveEvent.clientX - box.left;
      setWidths((current) => {
        if (which === "rail") {
          return { ...current, rail: Math.min(Math.max(x, 180), 400) };
        }
        if (which === "chat") {
          const width = box.width - x;
          return { ...current, chat: Math.min(Math.max(width, 320), 560) };
        }
        const rail = railHidden ? 0 : current.rail;
        const available = box.width - rail - (chatOver ? 0 : current.chat);
        const fraction = (x - rail) / available;
        return { ...current, editor: Math.min(Math.max(fraction, 0.25), 0.75) };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const id = get().projectId;
      if (id) {
        window.localStorage.setItem(
          `nexttex.widths.${id}`,
          JSON.stringify(get_widths()),
        );
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const get_widths = () => widthsRef.current;

  useEffect(() => {
    setChatOver(narrow);
    setChatOpen(!narrow);
  }, [narrow]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
          set({ claude: await api.claudeStatus().catch(() => null) });
          setView("projects");
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
            <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-line px-[10px]">
              <button
                className="t-ui-lg truncate font-serif transition-colors duration-[90ms] hover:text-hint"
                onClick={() => setView("projects")}
                title="Switch project"
              >
                {projectName}
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
            <FileTree onOpen={openFile} onRefresh={refreshTree} />
            <ContextPanel
              openFor={contextRequest}
              onHandled={() => setContextRequest(null)}
            />
            <GitPanel />
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
                  onSwitch={() => setView("projects")}
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
          <div className="relative min-h-0 flex-1">
            <Editor handleRef={(handle) => (editor.current = handle)} />
            {tabs.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center bg-surface">
                <p className="t-display text-ink-3">Open a file from the list.</p>
              </div>
            ) : null}
          </div>
          <Status
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
            onClose={() => {
              setDrawer(DRAWER_CLOSED);
              setDrawerDismissed(true);
            }}
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
            <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-2 pr-1">
              {railFolded && folded.editor ? (
                <AppControls
                  theme={theme}
                  onTheme={setTheme}
                  projectId={projectId}
                  projectName={projectName}
                  onSwitch={() => setView("projects")}
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
          <Pdf
            handleRef={(handle) => (pdf.current = handle)}
            onNavigate={(file, line) => openFile(file, line)}
          />
        </div>
        {folded.pdf && !tight ? (
          <Collapsed label="Preview" side="right" onExpand={() => fold("pdf")} />
        ) : null}
      </div>

      {!chatOver && !folded.chat ? (
        <Handle
          onPointerDown={startDrag("chat")}
          onReset={() => setWidths((current) => ({ ...current, chat: DEFAULTS.chat }))}
        />
      ) : null}
      {folded.chat && !chatOver ? (
        <Collapsed label="Claude" side="right" onExpand={() => fold("chat")} />
      ) : null}
      <div
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
      >
        {chatOver ? (
          <button
            className="t-micro absolute right-2 top-[8px] z-10 text-ink-3 hover:text-ink"
            onClick={() => setChatOpen(false)}
            aria-label="Hide the Claude panel"
          >
            Hide
          </button>
        ) : null}
        <Chat
          onAddContext={(kind) => {
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
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name || "project"}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
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
    <div className="mr-2 flex shrink-0 overflow-hidden rounded-[3px] border border-line">
      {(["source", "preview"] as const).map((option) => (
        <button
          key={option}
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
