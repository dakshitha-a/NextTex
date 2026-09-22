import { Button, IconButton } from "./ui/Button";
import { shellTheme } from "./ui/FloatingCard";
import { useCallback, useEffect, useRef, useMemo, useState, lazy, Suspense, type ReactNode } from "react";
import type { WordHint } from "./panes/locate-word";
import api, {
  captureToken, countOf, engineOf, landingAfter, shellEscapeOf,
  type ScriptResult, type WordScope,
} from "./api";
import { Followed } from "./followed";
import { forget, keep, recall, recallText } from "./remember";
import { rangeFor, scopesFor } from "./words";
import { createTwoFilesPatch } from "diff";
import Patch from "./panes/Patch";
import {
  Chevron,
  download,
  downloadPdf,
  downloadZip,
  FoldButton,
  Segmented,
  Handle,
  NameWell,
} from "./chrome";
import { resultFrom, troubleshootPrompt } from "./script-run";
import { busyTyping, onFrame } from "./timing";
import {
  afterClosing, movedPath, neighbour, orphanedBy, pushClosed, renamePaths, tabsUnder,
  unfollowed, viewingClosed,
} from "./tabs";
import { followDecision } from "./follow-preview";
import {
  DOUBLE_CLICK_MS, headerClick as headerVerdict, type Pane, type Pending,
} from "./header-gesture";
import { orderRows, rowKey } from "./panes/diagnostic-rows";
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
/** The script pane, in place of the page while a script tab is in front.
 *  Behind a click on a `.py`, so a session that never opens one never
 *  downloads it. */
const Script = lazy(() => import("./panes/Script"));
/** The Markdown pane, likewise: behind a click on a `.md`. */
const Markdown = lazy(() => import("./panes/Markdown"));
// Lazy for the same reason Pdf is: the tutorial carries a dozen screenshots
// and a thousand words, and none of it belongs in what a first visit has to
// download before the editor appears.
const Tutorial = lazy(() => import("./panes/tutorial/Tutorial"));
/** Lazily loaded, like the tutorial. Most sessions never open it, and the
 *  entry bundle is measured. */
const PeoplePanel = lazy(() => import("./panes/PeoplePanel"));
const DownloadPanel = lazy(() => import("./panes/DownloadPanel"));
const ReportSheet = lazy(() => import("./panes/ReportSheet"));
const CommandPalette = lazy(() => import("./panes/CommandPalette"));
/** The sign-in screen is a whole screen, and a machine that is signed in
 *  never draws it; fetched when it is shown. */
const AgentSheet = lazy(() => import("./panes/AgentSheet"));
/** The version panel and the strip that says you are looking at an old
 *  version.  Two exports of one module, so they arrive together in one
 *  chunk -- and the strip is only ever reachable through the panel, so by
 *  the time it can be mounted the module is already here.  Both are
 *  behind a click on a session where anybody opens history at all, and
 *  most sessions do not. */
const HistoryPanel = lazy(() => import("./panes/History"));
// Behind a key and a header row, and the largest panel in the rail:
// a first visit that never searches the project should not download
// it, the way the error drawer and the share sheet are not
// downloaded until something opens them.
const SearchPanel = lazy(() => import("./panes/SearchPanel"));
const ViewingBanner = lazy(() =>
  import("./panes/History").then((m) => ({ default: m.ViewingBanner })),
);
import { type PdfHandle } from "./panes/Pdf";
import Chat, { type ChatHandle } from "./panes/Chat";
import SourceHeader from "./panes/SourceHeader";
import PreviewHeader from "./panes/PreviewHeader";
import AgentButton, { AgentStateDot } from "./panes/AgentButton";
import {
  BuildIcon, DownloadIcon, FileIcon, FolderIcon, GitIcon, HistoryIcon, PapersIcon, PeopleIcon,
  PlusIcon, ReportIcon, SearchIcon, SectionsIcon, SubmitIcon, TrashIcon, UpdateIcon,
} from "./ui/icons";
import { agentName, type Provider } from "./agent-name";
import Status from "./panes/Status";
/** The error drawer, fetched when something opens it.
 *
 *  It draws nothing at all until the drawer has a height, and a session
 *  where every build is clean never opens it: the explanations, the lint
 *  rows and the resizer are all paid for by the writer who has an error to
 *  read. The same reasoning as the tutorial, the PDF pane and the version
 *  panel, and it is what kept the entry chunk under its budget while the
 *  review's fixes went in. */
const Diagnostics = lazy(() => import("./panes/Diagnostics"));
import FileTree from "./panes/FileTree";
import { bibIn } from "./tree";
import Projects from "./panes/Projects";
import Collapsed from "./panes/Collapsed";
import Logo from "./Logo";
import Settings from "./panes/Settings";
import InstanceBadge from "./panes/InstanceBadge";
import { toShell, uiScale, viewportWidth } from "./viewport";
import { APPEARANCE_CHANGED } from "./appearance";
import { pageTitle } from "./page-title";
import { includePath } from "./tree";
import { actionFor } from "./actions";
/** The rail's four footer panels: the trash, the papers, the context and
 *  git.  Each draws nothing, or a header, in a project that has not used
 *  it, and each fetches its own state on mount, which a lazy mount does a
 *  frame later than a static one.  Out of the entry chunk together, which
 *  is what paid for the fold gutter; `bench/thresholds.json` had asked for
 *  exactly this before the budget was raised a third time. */
const TrashPanel = lazy(() => import("./panes/TrashPanel"));
/** The largest panel in the rail after the tree, and the last one that was
 *  not lazy.  It draws headings a moment after a static one would, from
 *  the same outline; taken out when the second roadmap run's fourth tile
 *  and export rows brought the entry chunk to 858.9 of 860 kB, so the
 *  push after it starts with room rather than a raise. */
const SectionsPanel = lazy(() => import("./panes/SectionsPanel"));
const PapersPanel = lazy(() => import("./panes/PapersPanel"));
const SubmitPanel = lazy(() => import("./panes/SubmitPanel"));
const GitPanel = lazy(() => import("./panes/GitPanel"));
import { isScript, isTeX, isText, isViewable } from "./panes/file-kinds";

const DEFAULTS: Widths = { rail: 240, editor: 0.5, chat: 380 };

/** The drawers the activity bar offers, in the bar's order, and the one
 *  a project with nothing stored opens on.  One drawer at a time: the
 *  writer's reason, kept on the record in docs/design.md, is that a
 *  project is either many short files or one long one with many sections,
 *  so the tree or the outline stays open for long stretches and neither
 *  may push the other out.  `context` is not on the bar: What Claude reads
 *  is reached from the agent column, and moves into it with the column's
 *  own rebuild. */
export type DrawerId =
  | "files" | "sections" | "search" | "papers" | "history" | "git" | "people" | "build" | "submit" | "download" | "trash";
const BAR_ITEMS: { id: DrawerId; title: string; Icon: () => ReactNode }[] = [
  { id: "files", title: "Files", Icon: () => <FileIcon size={18} /> },
  { id: "sections", title: "Sections", Icon: () => <SectionsIcon size={18} /> },
  { id: "search", title: "Search", Icon: () => <SearchIcon size={18} /> },
  // "References" at the writer's word (21 September): the drawer is the
  // bibliography's front door and its foot checks the entries, so it is
  // named for what it manages.  The id, the panel and the icon keep the
  // code's older name; a rename there is churn a writer never sees.
  { id: "papers", title: "References", Icon: () => <PapersIcon size={18} /> },
  { id: "history", title: "History", Icon: () => <HistoryIcon size={18} /> },
  { id: "git", title: "Git", Icon: () => <GitIcon size={18} /> },
  { id: "people", title: "People", Icon: () => <PeopleIcon size={18} /> },
  { id: "build", title: "Build", Icon: () => <BuildIcon size={18} /> },
  { id: "submit", title: "Before you submit", Icon: () => <SubmitIcon size={18} /> },
  { id: "download", title: "Download", Icon: () => <DownloadIcon size={18} /> },
  { id: "trash", title: "Deleted", Icon: () => <TrashIcon size={18} /> },
];
const DRAWER_DEFAULT: DrawerId = "files";

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
    "loading" | "offline" | "projects" | "editor"
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
  const [widths, setWidths] = useState<Widths>(DEFAULTS);
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
  // Docked when the editor can spare the width; over it when it cannot.
  // The panel exists to be read *beside* the file, and an overlay that
  // covers the right third of a wrapped LaTeX line defeats it.
  const [showingChanges, setShowingChanges] = useState(false);
  /** The patch drawn under the banner while a version is viewed: between
   *  the version and the live file, or between it and a second version
   *  chosen with Compare. Null when there is none. */
  const [patchView, setPatchView] = useState<{ title: string; text: string } | null>(null);
  /** Which of the rail's folding panels are open.  Kept apart from
   *  `folded`, which is the pane layout the focus modes save and restore:
   *  these are sections inside one pane and have nothing to do with it. */
  const [drawerId, setDrawerId] = useState<DrawerId>(DRAWER_DEFAULT);
  // A nonce rather than a flag, so a second press of the shortcut while
  // the panel is already open puts the caret back in the box.
  const [focusSearch, setFocusSearch] = useState(0);
  // Bumped by the Papers heading's folder button; the drawer opens its
  // chooser on each change.
  const [choosePapers, setChoosePapers] = useState(0);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  /** Bumped by the People drawer's heading button: make an invite. */
  const [inviteNonce, setInviteNonce] = useState(0);
  const shared = useStore((s) => Boolean(s.share?.shared && !s.share.removed));
  const [reporting, setReporting] = useState(false);
  /** The command palette, and a count the settings trigger watches so
   *  the palette can open the sheet whichever bar the trigger is in. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsNonce, setSettingsNonce] = useState(0);
  // Every pane folds away, and says where it went.  Editor and preview are
  // mutually exclusive: folding one gives the other the whole space, and
  // folding both would leave nothing to work in.
  const [folded, setFolded] = useState({
    rail: false,
    editor: false,
    pdf: false,
    chat: false,
  });
  // History is a drawer: open means the drawer is showing it.
  const historyOpen = drawerId === "history" && !railHidden && !folded.rail;
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
  // Remembered, and four scopes rather than two. It was plain `useState`,
  // so a writer who counts their chapter chose it again every session.
  const outline = useStore((s) => s.outline);
  const cursor = useStore((s) => s.cursor);
  const selected = useStore((s) => s.selected);
  // How long the file is, for a section that runs to the end of it. The
  // store does not hold the text, and the count only has to be right when
  // the caret is in the last section, so the outline's own last line plus
  // a generous tail would be a guess: this is the editor's own number.
  const lineCount = useStore((s) => s.lineCount);
  const [wordScope, setWordScope] = useState<WordScope>(
    () => (recallText("nexttex.words") as WordScope) || "document",
  );
  const [words, setWords] = useState<number | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  /** Whether the agent screen was opened by somebody, as opposed to being
   *  shown at boot because no agent has been chosen yet. Only the second
   *  has nowhere to go back to. */
  // "What writes with you", the one sheet the agent is chosen and set up
  // in, over whichever screen is showing.
  const [agentOpen, setAgentOpen] = useState(false);
  const pdf = useRef<PdfHandle | null>(null);
  /** Tabs closed in this session, newest last, so the last one can come
   *  back. A ref rather than state: nothing draws it, and putting it in
   *  the store would redraw the strip every time a tab was closed. */
  const closed = useRef<string[]>([]);
  /** The documents this window put on the preview strip by following a
   *  file that was opened, and nothing the writer asked for by name. A
   *  document in here may leave the strip when its last open file does;
   *  one added with `+`, restored on load, or touched on the strip may
   *  not. A ref for the reason `closed` is one, and per window on
   *  purpose: the strip is shared between windows and this is a memory of
   *  what *this* one did. Kept in the window's own session storage, so a
   *  reload does not turn every followed document into one asked for; see
   *  `followed.ts`. */
  const followed = useRef(new Followed());
  /** `stopPreviewingMany`, reachable from `closeMany`, which is defined
   *  first because the preview removals close tabs through it. */
  const dropPreviews = useRef<((paths: string[], quiet: boolean) => Promise<void>) | null>(null);
  /** Where the agent last wrote, held until the build that edit scheduled
   *  has landed, because forward search reads the previous build's map. */
  const agentWrote = useRef<{ path: string; line: number } | null>(null);
  /** Whether the build now running was caused by this person typing, which
   *  is what decides whether the preview follows their caret when it
   *  lands. */
  const followCaret = useRef(false);
  const chat = useRef<ChatHandle | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const editorPane = useRef<HTMLDivElement | null>(null);
  const pdfPane = useRef<HTMLDivElement | null>(null);

  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const instance = useStore((s) => s.instance);
  // The tab names the paper while one is open.  On `view` rather than on
  // the project: leaving a project keeps its name in the store so the list
  // can offer a way back, and the tab should not.
  useEffect(() => {
    document.title = pageTitle(view, projectName, instance);
  }, [view, projectName, instance]);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const notices = useStore((s) => s.notices);
  const viewing = useStore((s) => s.viewing);
  // A patch belongs to the version it was built from. Viewing another one,
  // or coming back to now, takes it down rather than leaving a patch about
  // a version that is no longer on screen.
  const viewedSha = viewing?.version?.sha ?? null;
  useEffect(() => {
    setPatchView(null);
  }, [viewedSha]);

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
          // Which optional tools the machine has, once: the download
          // menu's export rows and the submission panel read it.  Not in
          // the pair above, because a slow `which` must not hold up the
          // first screen, and nothing on it needs the answer.
          void api.tools().then((tools) => set({ tools })).catch(() => undefined);
          // An install whose agent is not set up yet gets the sheet over
          // its list rather than a screen of its own; the list, and
          // everything but the Claude column, works without one.
          if (!status?.ready) setAgentOpen(true);
          await resumeOrList();
          return;
        } catch (problem: any) {
          if (landingAfter(problem) === "signin") {
            // The server no longer knows this browser: the password
            // changed, or the session was signed out.  Its own sign-in
            // page is the way back, and it draws before the bundle is
            // authorised, so the page is asked for again without the
            // stale token in the address.
            window.location.replace(window.location.pathname);
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
    // `closeCollab` is exported and was called from nowhere, so going back
    // to the projects screen left every document socket open and the
    // collaborator strip showing whoever had been in the project that was
    // left. Opening another project then built a second set beside them.
    // Imported on demand, never statically: `collab.ts` pulls in Yjs, and
    // a static import here would put a hundred kilobytes of it into the
    // entry bundle for every writer who never shares anything.
    void import("./collab").then((module) => module.closeCollab());
    // And the event stream, which only the tab closing used to end: left
    // open, the project just left went on counting as in use, so the
    // reaper never evicted it and the list's "open in another window"
    // would have marked the row the reader had just come from.
    disconnect();
    set({ collaborators: [], share: null, connection: "offline" });
    setView("projects");
  }, []);

  // ---- opening a project ------------------------------------------------
  const openProject = useCallback(async (id: string) => {
    const project = await api.open(id);
    set({
      projectId: id,
      projectName: project.name ?? "",
      lostFolder: null,
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
        engine: engineOf(project.engine),
        shellEscape: shellEscapeOf(project.shellEscape),
        pageLimit: countOf(project.pageLimit),
        blind: project.blind === true,
      },
      // The last project's import progress, which belongs to the last
      // project. It was left, so opening another one showed a papers
      // panel reporting a scan of a folder that has nothing to do with it.
      library: null,
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
    // A stored drawer that no longer exists, or one that is not on the
    // bar, comes back as the default rather than as an empty drawer.
    const remembered = recall(`nexttex.drawer.${id}`, { open: DRAWER_DEFAULT }).open;
    setDrawerId(
      BAR_ITEMS.some((item) => item.id === remembered) ? remembered : DRAWER_DEFAULT,
    );
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
    // The previewed documents arrive with the project rather than in a
    // second round trip, because the strip is drawn on the first frame.
    // There is no main document: the file to put in front when nothing is
    // remembered is the one the server has in front, and a folder with no
    // document yet has neither.
    const previewed: string[] = (project as any).previews ?? [];
    const visible: string = (project as any).visible || previewed[0] || "";
    const inTree = new Set(pathsIn(project.tree));
    const active = inTree.has(front) ? front : visible;
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
    if (active && !strip.includes(active)) strip.push(active);
    set({
      tabs: strip.map((path): Tab => ({ path })),
      previews: previewed,
      activePreview: previewed.includes(active) ? active : visible,
      candidates: (project as any).candidates ?? [],
      owners: (project as any).owners ?? {},
    });
    if (active) openFile(active).catch(() => undefined);
    // Every previewed document, not only the one in front: a second
    // preview opening on a stale page from the last session is the thing
    // the tab strip most obviously must not do.
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
     *  this came from, with what the page could say about its line. The
     *  editor puts the cursor on it rather than at the start of the line. */
    word?: string | WordHint,
    /** False when this is the agent saying where it is about to write.
     *  The pane scrolls and the range flashes; the caret is left where the
     *  writer put it. */
    steal = true,
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
        ? { pendingOpen: { path, line, word, steal, nonce: Date.now() } }
        : {}),
    });
  }, []);

  /** Show a drawer, and remember which.  Kept out of `folded`, which the
   *  focus modes save and restore: the choice of drawer is a choice inside
   *  one pane rather than a pane. */
  const openDrawer = useCallback((which: DrawerId) => {
    setDrawerId(which);
    railByHand.current = true;
    setRailHidden(false);
    setFolded((current) => (current.rail ? { ...current, rail: false } : current));
    const id = get().projectId;
    try {
      if (id) keep(`nexttex.drawer.${id}`, { open: which });
    } catch {
      /* private browsing: the app works, it just forgets */
    }
  }, []);
  /** The bar's click: a second press on the drawer that is showing folds
   *  it, any other press shows that one. */
  const toggleDrawer = useCallback((which: DrawerId) => {
    const showing = !railHiddenRef.current && !foldedRef.current.rail;
    if (showing && drawerIdRef.current === which) {
      railByHand.current = true;
      setRailHidden(true);
      return;
    }
    // Opened from the bar, the drawer takes the keyboard: the press was
    // asking for it, and a Tab that went to the next icon instead would
    // walk the bar rather than the thing just opened.
    drawerWantsFocus.current = true;
    openDrawer(which);
  }, [openDrawer]);
  const drawerWantsFocus = useRef(false);
  const drawerEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!drawerWantsFocus.current) return;
    drawerWantsFocus.current = false;
    drawerEl.current?.focus({ preventScroll: true });
  }, [drawerId, railHidden, folded.rail]);

  /** Go to a heading in the Sections list.  A row standing for an
   *  `\include` opens the file it names; every other row moves the caret
   *  inside the document already in front. */
  const resolveInclude = useCallback(
    (path: string) => includePath(get().tree, get().activePreview, path),
    [],
  );

  const jumpToHeading = useCallback(
    (heading: { line: number; path?: string }) => {
      if (heading.path) {
        // A row whose file is not in the project is drawn as unavailable
        // and cannot be clicked, so this only ever has somewhere to go.
        const target = includePath(get().tree, get().activePreview, heading.path);
        if (target) openFile(target);
        return;
      }
      const path = get().activePath;
      if (path) openFile(path, heading.line);
    },
    [openFile],
  );

  /** Take files off the strip, in one write.
   *
   *  Every close goes through here: one tab, the menu's "the others" and
   *  "all", and the files a preview takes with it when it stops. One
   *  calculation and one `set` rather than `closeFile` in a loop, which
   *  recomputed the tab in front, dispatched a `pendingOpen` and re-read
   *  the store after an await per tab, so a strip of twelve redrew twelve
   *  times and wrote the session out twelve times. `extra` is whatever the
   *  caller wants written in the same `set`, which is how the preview
   *  strip and the source strip move together: if the tabs moved first the
   *  follow effect would run against a strip that still had the document
   *  on it.
   *
   *  `nextActive` is the tab to put in front, or undefined to keep the one
   *  there unless it was closed, in which case the last remaining, the
   *  way a browser lands.
   */
  const closeMany = useCallback(
    async (
      paths: string[],
      nextActive?: string | null,
      extra: Partial<Parameters<typeof set>[0]> = {},
    ) => {
      const state = get();
      // Read now, not after the `set` below: `get()` hands back the live
      // state, so `state.activePath` is whatever was last written, and
      // comparing against it after writing it never found a change.  A
      // close of the tab in front then moved the strip and left the view
      // on the closed file's text, which is what "the editor goes crazy
      // when an open file is deleted" turned out to be.
      const wasActive = state.activePath;
      const closing = paths.filter((path) => state.tabs.some((tab) => tab.path === path));
      if (!closing.length) {
        if (Object.keys(extra).length) set(extra);
        return;
      }
      // Gathered rather than awaited one at a time: releasing a buffer
      // touches no disk and no network -- the keystrokes are in the shared
      // document already -- so a strip of twelve is one turn of the loop
      // rather than twelve.
      await Promise.all(closing.map((path) => editor.current?.close(path)));
      const tabs = state.tabs.filter((tab) => !closing.includes(tab.path));
      const activePath =
        nextActive !== undefined
          ? nextActive
          : wasActive && closing.includes(wasActive)
            ? (tabs[tabs.length - 1]?.path ?? null)
            : wasActive;
      // A figure's `viewing` is set here rather than by the editor, which
      // has no buffer to park for one, so nothing else would clear it and
      // the banner would go on offering the past of a file that is gone.
      const stillViewing = !viewingClosed(state.viewing, closing);
      // Remembered before they go, so Mod-Alt-Shift-T can bring them back.
      closed.current = pushClosed(closed.current, closing);
      // The Markdown tab is its file's rendering and nothing else, so it
      // goes with the file, the way a followed document leaves with its
      // last file.  It stayed on the strip after its file's tab had gone,
      // showing the text of a file the editor no longer held.
      const markdown = state.markdown;
      const markdownGoes = Boolean(markdown && closing.includes(markdown.path));
      set({
        ...(markdownGoes
          ? {
              markdown: null,
              previewShowing: state.previewShowing === "markdown" ? "document" : state.previewShowing,
            }
          : {}),
        ...extra,
        tabs,
        activePath,
        ...(stillViewing ? {} : { viewing: null }),
      });
      // Only when the file in front actually changed.  "Close the others"
      // from the tab already in front must not scroll the pane or move the
      // caret, which is what a `pendingOpen` does.
      if (activePath && activePath !== wasActive) {
        set({ pendingOpen: { path: activePath, nonce: Date.now() } });
      }
      // A document this window followed onto the strip leaves it with its
      // last file, quietly: the writer closed a tab, and a notice about a
      // preview they never asked for is not what that gesture wants.
      const after = get();
      const going = unfollowed(
        followed.current, after.previews, after.activePreview, after.tabs, after.owners,
      );
      if (going.length) {
        for (const document of going) followed.current.delete(document);
        void dropPreviews.current?.(going, true);
      }
    },
    [],
  );

  const closeFile = useCallback(
    (path: string) => closeMany([path]),
    [closeMany],
  );

  /** Close every tab but one, every tab, or every tab after one. The
   *  decision is one calculation, in `afterClosing`, which has the
   *  interesting cases: a strip of one, a target that is no longer in the
   *  strip, and a tab in front that is not the tab the menu was opened
   *  on. */
  const closeTabs = useCallback(
    async (what: "others" | "all" | "right", target: string) => {
      const state = get();
      const next = afterClosing(state.tabs, state.activePath, what, target);
      if (!next.closed.length) return;
      await closeMany(next.closed, next.activePath);
    },
    [closeMany],
  );

  const viewVersion = useCallback(async (sha: string | null) => {
    const state = get();
    const path = state.activePath;
    if (!path) return;
    setShowingChanges(false);
    // A figure has no buffer to park, so `viewing` is set here rather than
    // by the editor: the pane showing the file is simply pointed at the
    // version's own bytes instead of at the ones on disk.
    if (!isText(path)) {
      if (!sha) {
        set({ viewing: null });
        return;
      }
      const version = state.history.find((item) => item.sha === sha);
      if (version) set({ viewing: { path, sha, version } });
      return;
    }
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
    // `backToNow` puts a parked buffer back and is a no-op when there is
    // none; a figure has no buffer, so its state is cleared outright.
    editor.current?.backToNow();
    if (get().viewing) set({ viewing: null });
    setShowingChanges(false);
    // Closing History folds the drawer, as the second press on its icon
    // does; the drawer remembers History, so the icon brings it back.
    railByHand.current = true;
    setRailHidden(true);
  }, []);

  /** Leaving the file stops viewing its past.
   *
   *  The editor does this for itself when it opens another buffer.  A
   *  figure has no buffer to open, so without this the banner went on
   *  saying you were looking at last Tuesday's plot while the pane below it
   *  showed the file you had just clicked. */
  useEffect(() => {
    const looking = get().viewing;
    if (looking && !isText(looking.path) && looking.path !== activePath) {
      set({ viewing: null });
    }
  }, [activePath]);

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
    const state = get();
    // The editor follows the same prefix rule over its own buffers, so one
    // call moves every open file under a renamed folder.
    editor.current?.renamed(from, to);
    // A document this window followed onto the strip is still followed
    // under its new name.
    for (const document of [...followed.current]) {
      const next = movedPath(document, from, to);
      if (next !== null) followed.current.rename(document, next);
    }
    // The store's own fields.  When the rename reached this window as a
    // `previews_changed` carrying the mapping, the store has already moved
    // them together with the strip and there is nothing left to do here.
    const moved = renamePaths(state, { [from]: to });
    if (!moved.touched) return;
    set({
      tabs: moved.tabs,
      activePath: moved.activePath,
      viewing: moved.viewing as typeof state.viewing,
      previews: moved.previews,
      activePreview: moved.activePreview,
      builds: moved.builds,
      diagnosticsByDoc: moved.diagnosticsByDoc,
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

  /** Copy the file in front, beside itself, and show where it landed. */
  const duplicateFile = useCallback(async (path: string) => {
    const id = get().projectId;
    if (!id) return;
    try {
      const made = await api.duplicateFile(id, path);
      await refreshTree();
      // The tree opens collapsed, so a copy in a folder that is shut has,
      // from where the writer is sitting, not arrived.
      set({ revealInTree: { path: made.path, nonce: Date.now() } });
    } catch (problem: any) {
      set({ error: `Could not duplicate that file: ${problem.message}` });
    }
  }, [refreshTree]);

  // A name asked about from the editor: the search panel answers, so it
  // is opened the way Mod-Shift-F opens it.
  const symbolRequest = useStore((s) => s.symbolRequest);
  useEffect(() => {
    if (!symbolRequest) return;
    openDrawer("search");
  }, [symbolRequest?.nonce]);

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
    // A deleted file's tab closes, whichever side deleted it.  It used to
    // stay, bound to a document the manifest had trashed, until the writer
    // closed it by hand.
    handlers.onFilesGone = (gone) => {
      const closing = tabsUnder(get().tabs, gone);
      if (closing.length) void closeMany(closing);
    };
    handlers.onRootLost = () => {
      leaveProject();
    };
    handlers.onReveal = (path, line) => {
      openFile(path, line);
    };
    handlers.onShowPage = (_document, page) => {
      pdf.current?.goTo(page);
    };
    // Where the agent is *about* to write, from the moment the fence
    // approves the call. Never takes the caret: see `busyTyping`.
    handlers.onAgentFocus = (path, line) => {
      if (busyTyping()) return;
      void openFile(path, line, undefined, false);
    };
    handlers.onAgentEdit = async (path, line) => {
      // Nothing to reload: the agent's edit went into the shared document,
      // so it is already on screen. What is left is going to look at it.
      refreshTree();
      // And the preview follows too, but not yet: forward search reads the
      // `.synctex.gz` from the last build, so asking now would answer for
      // the document as it was before this edit. The build that this edit
      // schedules is when there is something true to move to, so the place
      // is held here and used by `onCompileDone`.
      agentWrote.current = { path, line };
      // Go and look at what changed, and never take the caret to do it.
      // This used to move the caret and then hand it back if the writer had
      // been in the composer, which spared one of the two places somebody
      // can be typing: a writer typing in the *editor* had their cursor
      // thrown across the document by the agent's own edit.
      if (busyTyping()) return;
      await openFile(path, line, undefined, false);
    };
    // The drawer is never opened for you.  A build fires while you are
    // still typing an equation, and having the error list jump up over the
    // document at that moment is the most irritating thing this app can do.
    // The status strip colours its dot; opening the list stays your choice.
    //
    // The preview is the other half of that rule and it points the other
    // way. An agent edit puts content somewhere the writer was not looking,
    // which is exactly what forward search is for, so the page follows it
    // once the build that produced it has landed. The reader's own typing
    // deliberately does not move the preview: the build fires 1.6 seconds
    // after every pause, and a page that jumps then is the diagnostics
    // drawer's mistake in the other pane.
    // Whether this build was caused by the writer's own typing, decided
    // when it starts rather than when it lands.
    //
    // At the end it cannot be decided at all: the build fires 1.6 seconds
    // after a pause and takes a third of a second on a chapter, so a
    // keystroke is recent when that lands; but a full thesis takes
    // seventeen seconds, by which time the same test says nobody has typed
    // and the preview would follow a chapter build and not a thesis one.
    // At the start the question has a stable answer whatever the build
    // costs.
    handlers.onCompileStart = () => {
      followCaret.current = agentWrote.current === null && busyTyping();
    };
    handlers.onCompileDone = () => {
      const wrote = agentWrote.current;
      if (wrote) {
        agentWrote.current = null;
        followCaret.current = false;
        if (busyTyping()) return;
        // Gentle: it moves the view only if the reader is not already
        // looking at that part of the page, and flashes the box either way.
        void pdf.current?.reveal(wrote.path, wrote.line, true);
        return;
      }
      // The writer's own build, so the page goes to where they are writing.
      //
      // The caret is read now rather than when the build started, because
      // where they are is a better answer than where they were: if they
      // have moved to a file this document does not include, forward search
      // finds nothing and the preview stays where it is, which is the right
      // outcome and needs no test of its own.
      if (!followCaret.current) return;
      followCaret.current = false;
      const state = get();
      if (!state.activePath || state.viewing) return;
      void pdf.current?.reveal(state.activePath, state.cursor.line, true);
    };
    return () => {
      handlers.onFilesChanged = undefined;
      handlers.onRenamed = undefined;
      handlers.onFilesGone = undefined;
      handlers.onRootLost = undefined;
      handlers.onReveal = undefined;
      handlers.onShowPage = undefined;
      handlers.onAgentEdit = undefined;
      handlers.onAgentFocus = undefined;
      handlers.onCompileDone = undefined;
      handlers.onCompileStart = undefined;
    };
  }, [refreshTree, openFile, renameOpenFile, leaveProject]);

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

  // Roughly as often as the files on disk change, and it costs one
  // `git status`.
  useEffect(() => {
    if (projectId) refreshGit(projectId);
  }, [projectId, builtAt]);
  // The span the count is of, and the only thing about the caret the count
  // depends on. Computed here rather than in the effect because the
  // effect's dependencies would otherwise have to be the cursor line, the
  // outline, the line count and the selection, all of which change on
  // every arrow key: a document-scoped count has no span at all, and a
  // section-scoped one changes only when the caret crosses a heading.
  const span = useMemo(
    () => rangeFor(
      wordScope,
      outline,
      cursor.line,
      lineCount,
      selected && selected.path === activePath ? selected : null,
    ),
    [wordScope, outline, cursor.line, lineCount, selected, activePath],
  );
  const spanFirst = span?.first ?? null;
  const spanLast = span?.last ?? null;
  useEffect(() => {
    if (!projectId) return;
    const scoped = wordScope === "selection" || wordScope === "section";
    // A scope with no range to count is not an error and not a zero: the
    // caret is above the first heading, or the selection has gone. The
    // strip falls back to its dash, which is what it shows before the
    // first count arrives too.
    if (scoped && spanFirst === null) {
      setWords(null);
      return;
    }
    let cancelled = false;
    // A selection is written to the store as it is dragged, undebounced by
    // design because the strip's other readings follow the caret. The
    // count behind it is a subprocess, so it waits for the drag to settle,
    // on the same 400 ms the cursor sync uses.
    const timer = setTimeout(() => {
      api
        .words(
          projectId,
          activePath ?? "",
          wordScope,
          spanFirst === null ? undefined : { first: spanFirst, last: spanLast! },
        )
        .then((result) => !cancelled && setWords(result.words))
        .catch(() => !cancelled && setWords(null));
    }, wordScope === "selection" ? 400 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, activePath, wordScope, builtAt, spanFirst, spanLast]);

  useEffect(() => {
    keep("nexttex.words", wordScope);
  }, [wordScope]);

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

  /** A double click on a divider puts that pane back to its default
   *  width, and remembers it the way the end of a drag does.  It did not,
   *  so the reset lasted until the next reload, which brought back
   *  whatever width the last drag had stored. */
  const resetWidth = useCallback((which: keyof Widths) => {
    const next = { ...widthsRef.current, [which]: DEFAULTS[which] };
    setWidths(next);
    const id = get().projectId;
    if (id) keep(`nexttex.widths.${id}`, next);
  }, []);

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
  const drawerIdRef = useRef(drawerId);
  drawerIdRef.current = drawerId;
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
    setAgentOpen(true);
  }, []);
  const agentStanding = useStore((s) => s.agent);

  /** The one sheet the agent is chosen in, over the list or the editor. */
  const agentSheet = agentOpen ? (
    <Suspense fallback={null}>
      <AgentSheet
        standing={agentStanding}
        onClose={() => setAgentOpen(false)}
        onDone={async () => {
          setAgentOpen(false);
          set({ agent: await api.agentStatus().catch(() => null) });
        }}
      />
    </Suspense>
  ) : null;

  /** Hand a question about the selection to the agent.
   *
   *  Seeded into the composer rather than sent, which is the `Fix` button's
   *  rule: the writer always presses Enter on their own message. The
   *  selection itself is already in the store and already travels with the
   *  question, so the seeded text is the verb and the writer's own
   *  qualification goes after it.
   *
   *  Opens the panel first if it is closed, since below 1400px it is an
   *  overlay and a question seeded into a box nobody can see is a question
   *  nobody asks. */
  const askAboutSelection = useCallback((prompt: string) => {
    if (get().agent?.provider === "none") return;
    if (chatOverRef.current && !chatOpenRef.current) setChatOpen(true);
    window.setTimeout(() => {
      chat.current?.seed(prompt);
      chat.current?.focusComposer();
    }, 60);
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
  const script = useStore((s) => s.script);
  const markdown = useStore((s) => s.markdown);
  const previewShowing = useStore((s) => s.previewShowing);
  /** Removals in flight, during which the preview does not follow the
   *  editor; see `stopPreviewingMany`. */
  const [removing, setRemoving] = useState(0);

  /** Bring a document's preview forward, and its source with it.
   *
   *  Both directions are automatic and neither moves the keyboard: a tab
   *  click that stole focus from the composer or the editor would make the
   *  strip unusable while typing.  The server is told which document is in
   *  front every time, because that document builds first and waits the
   *  shorter debounce.
   *
   *  `withSource` is false when the preview is following the editor: a
   *  chapter coming to the front shows the document that reads it, and
   *  opening that document's own file as well would put a tab on the
   *  source strip the writer did not ask for. */
  /** Run a script, from the header, from Mod-Enter, from the tree's row
   *  menu or from the pane.  The script tab comes forward at once with
   *  the run marked as going, and the answer fills it; the `script_done`
   *  event says the same thing to every other window.  The tab is this
   *  window's, so the strip is not asked. */
  const runScript = useCallback(async (path: string) => {
    const id = get().projectId;
    if (!id || !isScript(path)) return;
    const held = get().script;
    set({
      script: {
        path,
        running: true,
        result: held?.path === path ? held.result : null,
        // The start frame brings the run's own number; until then an
        // empty buffer, so the pane shows the run rather than the past.
        live: held?.path === path && held.live ? held.live : { run: 0, out: "", err: "" },
        changedByAgent: false,
      },
      previewShowing: "script",
    });
    try {
      const result = await api.runScript(id, path);
      const now = get().script;
      if (now?.path !== path) return;
      set({ script: { ...now, running: false, result, live: null, changedByAgent: false } });
    } catch (problem: any) {
      const now = get().script;
      if (now?.path === path) set({ script: { ...now, running: false, live: null } });
      set({ error: problem.message });
    }
  }, []);

  const stopScript = useCallback((path: string) => {
    const id = get().projectId;
    if (!id) return;
    api.stopScript(id, path).catch((problem: any) => set({ error: problem.message }));
  }, []);

  /** Hand a failed run to the agent, seeded into the composer with the
   *  tail of what the script said.  Seeded rather than sent, which is the
   *  `Fix` button's rule: the writer presses Enter on their own message. */
  const askAboutScript = useCallback((path: string, result: ScriptResult) => {
    if (get().agent?.provider === "none") return;
    if (chatOverRef.current && !chatOpenRef.current) setChatOpen(true);
    window.setTimeout(() => {
      chat.current?.seed(troubleshootPrompt(path, result));
      chat.current?.focusComposer();
    }, 60);
  }, []);

  const showPreview = useCallback((path: string, withSource = true) => {
    // A click on the strip is asking for the document by name, so it is no
    // longer one this window merely followed and may not leave on its own.
    if (withSource) followed.current.delete(path);
    if (!path) return;
    // The source first, and before the early return: a document tab
    // clicked while the Markdown pane or a script's run is in front is
    // already the active preview, so the return below used to swallow
    // the click's other half and the source stayed on the notes.
    if (withSource && get().activePath !== path) openFile(path);
    if (path === get().activePreview) return;
    set({ activePreview: path });
    const id = get().projectId;
    if (id) {
      api
        .setFocus(id, get().activePath ?? "", undefined, undefined, undefined, path)
        .catch(() => undefined);
    }
  }, [openFile]);

  const startPreviewing = useCallback(async (path: string) => {
    const id = get().projectId;
    if (!id) return;
    try {
      const body = await api.addPreview(id, path);
      followed.current.delete(body.document);
      set({ previews: body.previews, candidates: body.candidates, owners: body.owners });
      showPreview(body.document);
    } catch (problem: any) {
      set({ error: problem.message });
    }
  }, [showPreview]);

  /** Stop previewing a document, and close its files.
   *
   *  The files are found with `orphanedBy` against the owners map as it
   *  stood before the request, because the answer to the removal no longer
   *  mentions the document that went, and they are closed only once the
   *  server has agreed: a 409 for the last document on the strip leaves
   *  the source strip exactly as it was. Both strips move in one `set`,
   *  through `closeMany`. Only this window closes tabs: another window's
   *  removal arrives as `previews_changed` and touches nothing here, since
   *  its tabs are its own and so are this one's.
   *
   *  `quiet` is for a removal the writer did not ask for by name, the
   *  followed document leaving with its last file, where a refusal is not
   *  theirs to read.
   */
  const stopPreviewingMany = useCallback(async (paths: string[], quiet = false) => {
    const id = get().projectId;
    if (!id || !paths.length) return;
    const before = get().owners;
    // The follow effect stands down until both strips have moved. The
    // server publishes `previews_changed` before it answers the request,
    // so for a moment the strip is without the document while its chapter
    // is still the tab in front, and the effect would ask for the document
    // straight back.
    setRemoving((count) => count + 1);
    try {
      // One request per document, in sequence, and the store set from the
      // last answer: the route removes one at a time and each answer is
      // the whole list, so setting state after every one would redraw the
      // strip once per tab.
      let body: Awaited<ReturnType<typeof api.removePreview>> | null = null;
      for (const path of paths) body = await api.removePreview(id, path);
      if (!body) return;
      for (const path of paths) followed.current.delete(path);
      const active = get().activePreview;
      await closeMany(orphanedBy(get().tabs, before, body.previews), undefined, {
        previews: body.previews, candidates: body.candidates, owners: body.owners,
        activePreview: active && body.previews.includes(active) ? active : body.visible,
      });
    } catch (problem: any) {
      if (!quiet) set({ error: problem.message });
    } finally {
      setRemoving((count) => count - 1);
    }
  }, [closeMany]);
  dropPreviews.current = stopPreviewingMany;

  const stopPreviewing = useCallback(
    (path: string) => stopPreviewingMany([path]),
    [stopPreviewingMany],
  );

  /** Download PDF, from the preview tab's menu: the document under the
   *  tab, named after its file rather than after the project. */
  const downloadPreviewPdf = useCallback((path: string) => {
    const id = get().projectId;
    if (!id) return;
    followed.current.delete(path);
    void downloadPdf(id, path);
  }, []);

  /** The preview follows the file you open.  A document in its own right
   *  comes to the front; a chapter brings the document that reads it, up
   *  the whole chain of parts; a root nobody has previewed yet is put on
   *  the strip by the server, which knows the graph.  A fragment nothing
   *  reads has nothing to preview and is left alone, and is not asked
   *  about again until the graph changes, because a writer switching
   *  between a scratch file and a chapter must not send a request per
   *  switch. */
  const orphans = useRef(new Set<string>());
  const owners = useStore((s) => s.owners);
  useEffect(() => {
    orphans.current.clear();
  }, [owners]);
  // A followed document that left the strip some other way, another
  // window's removal or a project switch, is forgotten rather than kept
  // for a strip it is no longer on.
  // Declared ahead of the prune below so that on a project switch the
  // new project's memory is loaded before the strip of the old one is
  // measured against it.
  useEffect(() => {
    followed.current.load(projectId);
  }, [projectId]);
  useEffect(() => {
    followed.current.retain(previews);
  }, [previews]);
  useEffect(() => {
    if (removing) return;
    const decision = followDecision(activePath, previews, activePreview, owners);
    // A script in front brings its tab forward, with what it last did;
    // a chapter in front puts the page back.  The tab stays on the strip
    // either way, since a run's output is read beside the script and
    // beside the page in turn.
    if (decision.kind === "script") {
      const path = decision.path;
      const held = get().script;
      if (held?.path !== path) {
        set({
          script: { path, running: false, result: null, live: null, changedByAgent: false },
          previewShowing: "script",
        });
        const id = get().projectId;
        if (id) {
          api.lastScriptRun(id, path).then(
            (last) => {
              const now = get().script;
              if (now?.path !== path) return;
              // A first run still going answers no result; the pane
              // shows it running and `script_done` brings the rest.
              set({ script: {
                ...now,
                running: last.running,
                result: resultFrom(last, now.result),
                live: last.running ? (last.live ?? null) : null,
              } });
            },
            () => undefined,
          );
        }
      } else if (get().previewShowing !== "script") {
        set({ previewShowing: "script" });
      }
      return;
    }
    // A Markdown file in front brings its rendering forward, the way a
    // script brings its run; the text follows from the editor.  A tab
    // closed by the writer stays closed while they type in the file, and
    // comes back when the file next comes to the front.
    if (decision.kind === "markdown") {
      const path = decision.path;
      if (get().markdown?.path !== path) set({ markdown: { path } });
      if (get().previewShowing !== "markdown") set({ previewShowing: "markdown" });
      return;
    }
    if (activePath && isTeX(activePath) && get().previewShowing !== "document") {
      set({ previewShowing: "document" });
    }
    if (decision.kind === "show") {
      showPreview(decision.document, false);
      return;
    }
    if (decision.kind !== "ask" || !activePath || orphans.current.has(activePath)) return;
    const id = get().projectId;
    if (!id) return;
    const asked = activePath;
    // The strip as it was before asking, not as it is when the answer
    // comes: the server publishes the new strip before it answers, so by
    // then the document is already on it.
    const had = get().previews;
    api.addPreview(id, asked).then(
      (body) => {
        // The writer has moved on; the answer is about a file no longer in
        // front, and the switch that follows will ask its own question.
        if (get().activePath !== asked) return;
        // A document the strip did not have until this file was opened is
        // one this window followed, and may leave when the file does.
        if (!had.includes(body.document)) followed.current.add(body.document);
        set({ previews: body.previews, candidates: body.candidates, owners: body.owners });
        showPreview(body.document, false);
      },
      (problem: any) => {
        if (problem?.status === 404) {
          orphans.current.add(asked);
          return;
        }
        // A jobname collision, said rather than swallowed: the preview
        // silently staying where it was is exactly what a writer cannot
        // work out the cause of.
        set({ error: problem.message });
      },
    );
  }, [activePath, previews, activePreview, owners, removing, showPreview]);



  /** Give one pane the whole window, and give it back.
   *
   *  Reading mode and writing mode are the same mechanism pointed at
   *  different panes: everything else folds away, and a second double
   *  click restores the layout exactly as it was rather than unfolding
   *  everything -- a writer who had the agent hidden before does not want
   *  it back for having read a page.
   *
   *  Deliberately not persisted. The folded state that is remembered in
   *  the browser is the arrangement the writer chose, so a reload in the
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

  // The two modes, from the keyboard.  The gestures that enter them are a
  // double click on either pane's tab in front or on the empty run of its
  // strip; the keys were added when the empty run was the only handle and
  // shrank to nothing as tabs filled the strip, and they stay because a
  // key is a good route whether or not the gesture has a handle.  R for
  // reading and E for editing, in the app's own Mod-Alt space, both free
  // in CodeMirror's keymap and in the browser's; W was the obvious letter
  // for writing and is already Close the tab in front.  Pressing the same
  // one again gives the layout back, like the second double click.
  // Every chord the app answers from anywhere is a row of `ACTIONS` in
  // `actions.ts`, and this is the one place they are dispatched: the
  // registry says which action a keydown names, `runAction` does it, and
  // the same map answers the command palette's rows.  The chords used to
  // be literal `if` blocks here, in two effects, with the Tutorial and the
  // README each carrying a copy of the list; the copies drifted.
  //
  // Next and previous error, from anywhere: the drawer answered nothing
  // but a click, and a writer fixing a build reads the list once and then
  // works down it, which is a keyboard's job.  The drawer opens if it is
  // shut, since stepping to an error the writer cannot see is a jump with
  // no explanation beside it.
  const stepError = useCallback((step: 1 | -1) => {
    const state = get();
    const rows = orderRows(state.diagnostics, state.lint);
    if (!rows.length) return;
    const at = rows.findIndex((row) => rowKey(row) === state.selectedDiagnostic);
    const next = at === -1
      ? (step === 1 ? rows[0] : rows[rows.length - 1])
      : rows[(at + step + rows.length) % rows.length];
    set({ selectedDiagnostic: rowKey(next) });
    // The Build drawer shows on the way, as the tray opened: stepping to
    // an error the writer cannot see is a jump with no explanation.
    if (railHiddenRef.current || foldedRef.current.rail || drawerIdRef.current !== "build") {
      openDrawer("build");
    }
    if (next.file && next.line) void openFile(next.file, next.line);
  }, [openFile, openDrawer]);

  const runAction = useCallback((id: string) => {
    const state = get();
    switch (id) {
      case "save":
        // With compile-as-you-type off, save is also the build: it is the
        // Overleaf convention, it is what the hands already do, and it
        // saves inventing a second binding for a thing the writer now has
        // to ask for explicitly.
        if (state.settings.autocompile) editor.current?.saveNow();
        else void buildNow(false);
        break;
      case "build":
        void buildNow(false);
        break;
      case "build-full":
        void buildNow(true);
        break;
      case "reveal": {
        // On a script, the key runs it; on a chapter it goes to the page.
        const path = state.activePath;
        if (!path) break;
        if (isScript(path)) void runScript(path);
        else pdf.current?.reveal(path, state.cursor.line);
        break;
      }
      case "rail":
        railByHand.current = true;
        setRailHidden((value) => !value);
        break;
      case "agent":
        toggleChat();
        break;
      case "next-preview": {
        // Cycle the previewed documents; see docs/design.md for the key.
        const open = state.previews;
        if (open.length > 1) {
          const at = open.indexOf(state.activePreview);
          showPreview(open[(at + 1 + open.length) % open.length]);
        }
        break;
      }
      case "search":
        // Find in the project, from anywhere. Mod-F belongs to the
        // editor's own find panel and searches the file in front of you;
        // this is the same question asked of every file.
        openDrawer("search");
        setFocusSearch((count) => count + 1);
        break;
      case "quick-open":
        // Open a file by name: the filter row, the search, and Enter
        // opening the first match were all built and none had a key.
        openDrawer("files");
        set({ focusTreeSearch: state.focusTreeSearch + 1 });
        break;
      case "next-tab":
      case "previous-tab": {
        const to = neighbour(state.tabs, state.activePath, id === "next-tab" ? 1 : -1);
        if (to) void openFile(to);
        break;
      }
      case "close-tab":
        if (state.activePath) void closeFile(state.activePath);
        break;
      case "reopen-tab": {
        const path = closed.current[closed.current.length - 1];
        if (path) {
          closed.current = closed.current.slice(0, -1);
          void openFile(path);
        }
        break;
      }
      case "reading":
        toggleFocus("pdf");
        break;
      case "writing":
        toggleFocus("editor");
        break;
      case "next-error":
        stepError(1);
        break;
      case "previous-error":
        stepError(-1);
        break;
      case "palette":
        setPaletteOpen(true);
        break;
      case "settings":
        setSettingsNonce((count) => count + 1);
        break;
      case "tutorial":
        openTutorial();
        break;
      case "history":
        if (historyOpen) closeHistory();
        else openDrawer("history");
        break;
      case "share":
        openDrawer("people");
        break;
      case "download-zip":
        if (state.projectId) void downloadZip(state.projectId);
        break;
      case "download-pdf":
        if (state.projectId) void downloadPdf(state.projectId, state.activePreview);
        break;
      case "projects":
        leaveProject();
        break;
    }
  }, [
    buildNow, runScript, toggleChat, showPreview, openFile, closeFile, toggleFocus,
    stepError, openTutorial, historyOpen, closeHistory, leaveProject,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A key the editor has already answered is not the app's: with the
      // Emacs keymap on, Ctrl-K kills to the end of the line and must not
      // also open the palette.  The editor's handlers run on the content
      // element before this window listener sees the event.
      if (event.defaultPrevented) return;
      const action = actionFor(event);
      if (action) {
        // Mod-Enter means nothing without a file in front, and must not
        // eat the key from whatever else wanted it.
        if (action.id === "reveal" && !get().activePath) return;
        event.preventDefault();
        runAction(action.id);
        return;
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
        // The history panel is not among them: docked, it covers nothing,
        // and it answers Escape only while the keyboard is inside it, so a
        // writer in the composer with the panel open still closes the
        // panel they are in.
        if (tutorialOpen || showingChanges) return;
        const active = document.activeElement as HTMLElement | null;
        if (!active?.closest?.("[data-nx-chat]")) return;
        // A popover inside the panel claims Escape by preventing the
        // default, and window listeners run in the order they were added --
        // those components mount long after this one, so the claim is only
        // visible once the dispatch is over.  Hence the wait.
        window.setTimeout(() => {
          if (event.defaultPrevented) return;
          // Stop first, close second, and the order is the whole point.
          // Stop is the writer's one escape hatch from a turn that is
          // doing the wrong thing, and it was a `t-micro` text button in a
          // 32px header that can be folded away entirely. Escape is where
          // a hand already goes when something should stop.
          //
          // Not both: pressing it once should not also shut the panel and
          // hide the transcript of what the turn had got to before it was
          // stopped, which is the thing the writer is about to read.
          if (get().thinking && get().projectId) {
            api.interrupt(get().projectId!).catch(() => undefined);
            return;
          }
          closeChat();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAction, closeChat, tutorialOpen, showingChanges]);

  /** One header, two gestures, on the tab in front and on the empty run.
   *
   *  The arithmetic is `header-gesture.ts`, which has the tests; this is
   *  the timer.  A double click arrives as two clicks, so the fold waits
   *  DOUBLE_CLICK_MS to find out which one it is.  The pending fold
   *  carries which header it was on: a click on the preview followed
   *  quickly by one on the source is two single clicks, not a double click
   *  on whichever came second.  And a selection is recorded per pane, so
   *  the second click of a double click that selected a tab, which lands
   *  on a tab that is now in front, does not fold the pane under a writer
   *  who only meant to switch. */
  const headerTimer = useRef<number | null>(null);
  const pendingFold = useRef<Pending | null>(null);
  const selectedAt = useRef<Record<Pane, number | null>>({ editor: null, pdf: null });
  const noteSelect = useCallback((pane: Pane) => {
    selectedAt.current[pane] = performance.now();
  }, []);
  const headerClick = useCallback(
    (pane: Pane) => {
      const now = performance.now();
      const verdict = headerVerdict(pendingFold.current, selectedAt.current[pane], pane, now);
      if (verdict.kind === "ignore") return;
      if (headerTimer.current !== null) window.clearTimeout(headerTimer.current);
      headerTimer.current = null;
      pendingFold.current = null;
      if (verdict.kind === "mode") {
        toggleFocus(pane);
        return;
      }
      if (verdict.kind === "fold-then-arm") fold(verdict.fold);
      headerTimer.current = window.setTimeout(() => {
        headerTimer.current = null;
        pendingFold.current = null;
        fold(pane);
      }, DOUBLE_CLICK_MS);
      pendingFold.current = { pane, at: now };
    },
    [fold, toggleFocus],
  );
  useEffect(
    () => () => {
      if (headerTimer.current !== null) window.clearTimeout(headerTimer.current);
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
  /** How many files the project holds, for the Files header. */
  const bibName = useMemo(() => bibIn(tree), [tree]);
  const gitStatus = useStore((s) => s.git);
  const gitDirty = gitStatus?.repository ? gitStatus.changes.length : 0;
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

  /** The version of the open figure being looked at, if one is.
   *
   *  Hoisted rather than asked inline: `viewing?.path === node.path` does
   *  not narrow `viewing` for the expression after it, so asking twice in
   *  one attribute costs a non-null assertion that this avoids. */
  const viewedFigure =
    viewing && activeBinary && viewing.path === activeBinary.path
      ? viewing
      : null;

  if (view === "loading") {
    // Words rather than a spinner, because §6 of the specification does not
    // have spinners and because a coloured rectangle is not a loading state,
    // it is an absence. This is the first thing anybody sees, and on a slow
    // first connection it was the only thing, for as long as it took.
    return (
      <div className="flex h-full items-center justify-center bg-surround" data-testid="loading-screen">
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
      <div className="flex h-full items-center justify-center bg-surround" data-testid="offline-screen">
        <div className="max-w-[420px] px-6 text-center">
          <p className="t-ui text-ink">Waiting for NextTex</p>
          <p className="t-meta mt-1 text-ink-2">
            {waitingBecause || "The server is not answering."} This page
            reconnects on its own.
          </p>
        </div>
      </div>
    );
  }
  if (view === "projects") {
    return (
      <>
        <Projects
          onOpen={openProject}
          current={projectId ?? undefined}
          canClose={Boolean(projectId)}
          onClose={() => setView("editor")}
          onChangeAgent={changeAgent}
        />
        {agentSheet}
      </>
    );
  }

  const editorFraction = widths.editor;
  // Whether the drawer is showing, and whether it overlays the panes rather
  // than taking a column of its own; the bar is there either way.
  const drawerShown = !(railHidden || folded.rail);
  const drawerOver = width < BREAKPOINTS.rail;

  return (
    // Two elements rather than one, and which is which matters.  `nx-frame`
    // is the scroll port, so a window narrower than the layout's stated
    // minimum can be scrolled across instead of having its right hand edge
    // quietly cut off.  `nx-shell` inside it clips with `overflow: clip` and
    // is therefore not a scroll container at all, which is what stops a
    // browser scrolling a focused element into view and taking the whole
    // layout with it.  See the rules in styles.css for both.
    <div className="nx-frame bg-surround">
    <div ref={shell} className="nx-shell relative flex h-full w-full flex-col bg-surround">
      <div className="relative flex min-h-0 flex-1">
      {/* The left column: the project's name row over the activity bar and
          the drawer.  There is no title bar: the writer found a full-width
          strip with the name at one end and two buttons at the other, and
          every column starting again under it, did not fit the rest of the
          view.  The row is the first of the four heads that make the band
          across the top, and it shrinks to the bar's width, the mark
          alone, when the drawer is folded or overlays.  The column's
          width is stated, the bar, the drawer and its 1 px handle, rather
          than left to its contents: without that the column grew to the
          name, and a drawer dragged narrower than the name left the name
          hanging over the source pane and pushed the tabs along with it. */}
      <div
        className="nx-left flex shrink-0 flex-col"
        data-testid="left-column"
        style={{ width: drawerShown && !drawerOver ? 44 + widths.rail + 1 : 44 }}
      >
        <div className="nx-name-row nx-band flex h-[36px] w-full shrink-0 items-center" data-testid="title-bar">
          <button
            className="flex h-full min-w-0 flex-1 items-center pr-2 transition-colors duration-[90ms] hover:text-hint"
            data-testid="switch-project"
            onClick={leaveProject}
            title={`${projectName}: switch project`}
          >
            {/* The mark centred on the bar's column under it, the name
                starting on the drawer's own gutter, so the row's two parts
                sit over the two columns they head; the chevron at the
                row's end, past the well the name fades in. */}
            <span className="flex w-[44px] shrink-0 justify-center"><Logo size={18} /></span>
            {drawerShown && !drawerOver ? (
              <>
                <NameWell name={projectName} />
                <span className="ml-1 shrink-0 text-ink-3"><Chevron direction="down" /></span>
                <InstanceBadge />
              </>
            ) : null}
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
      {/* The activity bar: one button per drawer, the one showing marked by
          ink and the wash, Settings pinned at the bottom.  Always on
          screen; below the rail breakpoint the drawer it opens overlays
          the panes instead of taking a column. */}
      <nav
        aria-label="Drawers"
        data-testid="activity-bar"
        className="flex w-[44px] shrink-0 flex-col items-center gap-[2px] bg-surround pt-2"
      >
        {BAR_ITEMS.map(({ id, title, Icon }) => (
          <IconButton
            key={id}
            label={title}
            title={id === "build" ? "Build (double-click to rebuild)" : undefined}
            data-testid={`bar-${id}`}
            className="nx-bar-button"
            on={drawerShown && drawerId === id}
            aria-pressed={drawerShown && drawerId === id}
            // "As a shortcut, double clicking the compiler drawer icon
            // should rebuild": the first click shows the drawer, the
            // second is ignored as a press (it would fold what the first
            // showed), and the double-click rebuilds with the drawer in
            // view, so the result lands where it can be read.
            onClick={(event) => {
              if (id === "build" && event.detail > 1) return;
              toggleDrawer(id);
            }}
            onDoubleClick={
              id === "build"
                ? () => {
                    openDrawer("build");
                    void buildNow(false);
                  }
                : undefined
            }
          >
            <Icon />
          </IconButton>
        ))}
        <div className="mb-2 mt-auto">
          <Settings
            inProject
            onTutorial={openTutorial}
            onChangeAgent={changeAgent}
            openNonce={settingsNonce}
          />
        </div>
      </nav>
      {drawerShown ? (
        <>
          <div
            className={
              drawerOver
                ? "nx-pane absolute left-[44px] top-[36px] z-30 flex h-[calc(100%-36px)] flex-col bg-surface-2 shadow-float outline-none"
                : "nx-pane flex min-h-0 shrink-0 flex-col bg-surface-2 outline-none"
            }
            style={{ width: widths.rail }}
            data-testid="drawer"
            data-drawer={drawerId}
            ref={drawerEl}
            tabIndex={-1}
          >
            {drawerId === "history" || drawerId === "files" ? (
              // History and Files draw their own heading rows: History's
              // carries the file it is about and the close control, Files'
              // the four buttons that are the tree's own.
              <Suspense fallback={null}>
            {drawerId === "files" ? (
            <FileTree
            onPreview={startPreviewing}
            onUnpreview={stopPreviewing}
              onOpen={openFile}
              onRefresh={refreshTree}
              onRename={renameOpenFile}
              onDeleted={(path) => {
                const closing = tabsUnder(get().tabs, [path]);
                if (closing.length) void closeMany(closing);
              }}
              onDuplicate={duplicateFile}
              onHistory={() => openDrawer("history")}
              onAskAbout={noAgent ? undefined : askAboutSelection}
              onRunScript={(path) => {
                openFile(path);
                void runScript(path);
              }}
            />
            ) : (
            <HistoryPanel
              onCompare={async (other) => {
                const pair = editor.current?.viewed();
                const shown = get().viewing?.version;
                if (!projectId || !pair || !shown) return;
                try {
                  const path = get().viewing?.path ?? "";
                  const fetched = await api.historyVersion(projectId, path, other.sha);
                  // Older on the left, whichever was clicked, so a
                  // patch always reads forwards in time.
                  const forwards = other.at >= shown.at;
                  const name = path.split("/").pop() ?? "";
                  const when = new Date(other.at).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit",
                  });
                  setPatchView({
                    title: forwards
                      ? `From the version on screen to the one from ${when}`
                      : `From the version from ${when} to the one on screen`,
                    text: createTwoFilesPatch(
                      name, name,
                      forwards ? pair.old : fetched.text,
                      forwards ? fetched.text : pair.old,
                      "", "", { context: 2 },
                    ),
                  });
                } catch (error: any) {
                  set({ error: error.message });
                }
              }}
              docked
              onView={viewVersion}
              onOpen={(path) => openFile(path)}
              onClose={closeHistory}
            />
            )}
              </Suspense>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-[2px] pb-[6px] pl-[14px] pr-2 pt-[10px]">
                  <span className="t-ui-lg flex-1 truncate text-ink">
                    {BAR_ITEMS.find((item) => item.id === drawerId)?.title ?? `What ${agentName(agentProvider as Provider | undefined)} reads`}
                  </span>
                  {drawerId === "git" && gitDirty ? (
                    <span className="t-meta tnum pr-1 text-ink-3">{gitDirty}</span>
                  ) : null}
                  {drawerId === "papers" && bibName ? (
                    <IconButton label="Read a folder of PDFs" onClick={() => setChoosePapers((n) => n + 1)}>
                      <FolderIcon />
                    </IconButton>
                  ) : null}
                  {drawerId === "people" && shared ? (
                    <IconButton label="Make an invite" data-testid="make-invite" onClick={() => setInviteNonce((n) => n + 1)}>
                      <PlusIcon />
                    </IconButton>
                  ) : null}
                  {drawerId === "build" ? (
                    <IconButton label="Rebuild" title="Rebuild the document" data-testid="rebuild-quick" onClick={() => void buildNow(false)}>
                      <UpdateIcon />
                    </IconButton>
                  ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  {drawerId === "search" ? (
                    <Suspense fallback={null}>
                      <SearchPanel onOpen={openFile} focusNonce={focusSearch} />
                    </Suspense>
                  ) : null}
                  <Suspense fallback={null}>
                    {drawerId === "sections" ? (
                <SectionsPanel
                  drawer
                  onJump={jumpToHeading}
                  grow
                  resolve={resolveInclude}
                />
                    ) : null}
                    {drawerId === "trash" ? <TrashPanel onRefresh={refreshTree} /> : null}
                    {drawerId === "papers" ? (
                      <PapersPanel onRefresh={refreshTree} chooseNonce={choosePapers} />
                    ) : null}
                    {drawerId === "submit" ? (
                <SubmitPanel
                  onJump={(file, line) => openFile(file, line)}
                  onPage={(page) => pdf.current?.goTo(page)}
                />
                    ) : null}
                    {drawerId === "git" ? (
                <GitPanel onOpen={openFile} />
                    ) : null}
                    {drawerId === "people" ? (
                <PeoplePanel inviteNonce={inviteNonce} onLeft={leaveProject} />
                    ) : null}
                    {drawerId === "download" ? <DownloadPanel /> : null}
                    {drawerId === "build" ? (
                <Diagnostics
                  onJump={(file, line) => openFile(file, line)}
                  onFix={(text) => chat.current?.seed(text)}
                  onRebuild={(full) => void buildNow(full)}
                />
                    ) : null}
                  </Suspense>
                </div>
              </>
            )}
            {/* The drawer's foot, level with the strips under the source and
                the preview: the one way to report a problem from inside a
                project, where a problem is usually met. */}
            <div
              className="nx-foot t-meta flex h-[28px] shrink-0 items-center px-3 text-ink-2"
              data-testid="drawer-foot"
            >
              <button
                className="flex items-center gap-[6px] hover:text-ink"
                data-testid="report-problem"
                onClick={() => setReporting(true)}
              >
                <ReportIcon size={13} />
                Report a problem
              </button>
            </div>
          </div>
          {drawerOver ? null : (
            <Handle
              onPointerDown={startDrag("rail")}
              onReset={() => resetWidth("rail")}
            />
          )}
        </>
      ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {folded.editor && !tight ? (
          <Collapsed label="Source" side="left" onExpand={() => fold("editor")} />
        ) : null}
        <div
          ref={editorPane}
          data-testid="editor-pane"
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
          <SourceHeader
            onSelect={(path) => {
              noteSelect("editor");
              openFile(path);
            }}
            onClose={closeFile}
            onCloseTabs={closeTabs}
            onDuplicate={duplicateFile}
            onRunScript={(path) => void runScript(path)}
            onStopScript={stopScript}
            // The tab in front and the empty run of the strip: fold, or
            // double-click for writing mode.  Below 900px nothing folds.
            onHeaderClick={!tight ? () => headerClick("editor") : undefined}
            onPeople={() => toggleDrawer("people")}
            trailing={
              tight ? (
                <Segmented value={showing} onChange={setShowing} />
              ) : (
                <FoldButton
                  direction="left"
                  label="Fold the source away"
                  onClick={() => fold("editor")}
                />
              )
            }
          />
          {viewing ? (
            <Suspense fallback={null}>
            <ViewingBanner
              // Keyed by the version, so the "Replace the file with this?"
              // confirmation dies with the version that raised it. It was
              // component state on a banner that survived a change of
              // version, so pressing Restore and then clicking a different
              // version left the confirmation up, now asking about a file
              // it had never been asked about.
              key={viewing.version?.sha ?? viewing.path}
              version={viewing.version}
              showingChanges={showingChanges}
              onDownload={
                projectId && !isText(viewing.path) && isViewable(viewing.path)
                  ? () =>
                      void download(
                        api.historyBlobUrl(
                          projectId,
                          viewing.path,
                          viewing.sha,
                          true,
                        ),
                        viewing.path.split("/").pop() ?? viewing.path,
                        "the version",
                      )
                  : undefined
              }
              onRestore={restoreVersion}
              onBack={() => {
                // A figure was never parked in a buffer, so there is
                // nothing for the editor to put back: clearing the state
                // is the whole of going back to now.
                if (isText(viewing.path)) editor.current?.backToNow();
                else set({ viewing: null });
                setShowingChanges(false);
                setPatchView(null);
              }}
              // One control for both readings of the change: the shading
              // in the editor of what is gone, and the patch under the
              // banner of what arrived as well.
              onToggleChanges={() => {
                const next = !showingChanges;
                setShowingChanges(next);
                editor.current?.showChanges(next);
                if (!next) {
                  setPatchView(null);
                  return;
                }
                const pair = editor.current?.viewed();
                if (!pair) return;
                const name = viewing.path.split("/").pop() ?? viewing.path;
                setPatchView({
                  title: "From that version to the file as it stands",
                  text: createTwoFilesPatch(name, name, pair.old, pair.live, "", "", {
                    context: 2,
                  }),
                });
              }}
            />
            </Suspense>
          ) : null}
          {viewing && patchView ? (
            <div className="shrink-0 border-b border-line px-[10px] pb-2" data-testid="history-patch">
              <p className="t-micro pt-1 text-ink-2">{patchView.title}</p>
              <Patch text={patchView.text} />
            </div>
          ) : null}
          <div className="relative flex min-h-0 flex-1">
            <div className="relative min-h-0 flex-1">
              <Editor
                handleRef={(handle) => (editor.current = handle)}
                onAskAbout={askAboutSelection}
                onOpen={openFile}
              />

              {/* A figure is a file in this project like any other: it has
                  a tab, a place in the tree, and -- since it can now be
                  replaced without losing what it replaced -- a history.
                  All three of those go through "the active document", so
                  one that CodeMirror cannot hold has to be shown here. */}
              {activeBinary ? (
                <div className="absolute inset-0">
                  <Suspense fallback={null}>
                    <FileView
                      path={activeBinary.path}
                      size={activeBinary.size}
                      // An old version of this figure, when one is being
                      // looked at.  Keyed on the sha as well, so switching
                      // between two versions remounts the viewer rather
                      // than leaving the first one's zoom and page on the
                      // second one's pages.
                      key={viewedFigure ? viewedFigure.sha : "now"}
                      source={
                        projectId && viewedFigure
                          ? api.historyBlobUrl(
                              projectId,
                              activeBinary.path,
                              viewedFigure.sha,
                            )
                          : undefined
                      }
                    />
                  </Suspense>
                </div>
              ) : null}

              {tabs.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center bg-surface">
                  <p className="t-display text-ink-3">Open a file from the list.</p>
                </div>
              ) : null}
            </div>
          </div>
          <Status
            words={words}
            wordScope={wordScope}
            wordScopes={scopesFor(Boolean(selected && selected.path === activePath))}
            onToggleWordScope={() =>
              setWordScope((value) => {
                const cycle = scopesFor(
                  Boolean(selected && selected.path === activePath),
                ) as WordScope[];
                const at = cycle.indexOf(value);
                return cycle[(at + 1) % cycle.length] ?? "document";
              })
            }
            onOpenBuild={() => openDrawer("build")}
            onRebuild={(full) => void buildNow(full)}
          />
        </div>

        {tight || folded.editor || folded.pdf ? null : (
          <Handle
            onPointerDown={startDrag("split")}
            onReset={() => resetWidth("editor")}
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
          {!tight || showing === "preview" ? (
            // The same header as the source pane's, built once.  Below
            // 900px the two panes share one view, so the strip shares the
            // row with the source/preview toggle and nothing folds; without
            // that there was no way to change document with a mouse there.
            // When the rail and the editor are both folded away this header
            // also carries the project controls, beside the fold chevron
            // rather than in the strip's place, so the second half of the
            // double click that leaves reading mode cannot land on "switch
            // project" and leave the document entirely.
            <PreviewHeader
              onSelect={(path) => {
                noteSelect("pdf");
                showPreview(path);
              }}
              // The Markdown tab brings its file, as a document tab
              // brings its document's: the rendering and the source
              // are one file, and choosing to read it is choosing to be
              // in it.  Nothing moves the keyboard, the strip's rule.
              onSelectMarkdown={(path) => {
                noteSelect("pdf");
                if (get().activePath !== path) openFile(path);
              }}
              // Closing the rendering closes its file, as stopping a
              // document's preview closes the document's files: both
              // strips move in one write, and the file goes onto the
              // reopen stack so Mod-Alt-Shift-T brings both back.
              onCloseMarkdown={(path) => {
                const showing = get().previewShowing;
                void closeMany([path], undefined, {
                  markdown: null,
                  previewShowing: showing === "markdown" ? "document" : showing,
                });
              }}
              onClose={stopPreviewing}
              onCloseMany={(paths) => {
                // "The others" names the one that stays, so it is asked
                // for and no longer merely followed.
                for (const document of get().previews) {
                  if (!paths.includes(document)) followed.current.delete(document);
                }
                void stopPreviewingMany(paths);
              }}
              onDownload={downloadPreviewPdf}
              onAdd={startPreviewing}
              onRunScript={(path) => void runScript(path)}
              onStopScript={stopScript}
              onHeaderClick={!tight ? () => headerClick("pdf") : undefined}
              trailing={
                tight ? (
                  <Segmented value={showing} onChange={setShowing} />
                ) : (
                  <>
                    <FoldButton
                      direction="right"
                      label="Fold the preview away"
                      onClick={() => fold("pdf")}
                    />
                  </>
                )
              }
            />
          ) : null}
          {/* Its own boundary as well as the root's: the preview is the
              largest chunk and the one most likely to be missing after an
              update, and losing the pane is a great deal better than
              losing the window. */}
          <Boundary>
          <Suspense fallback={<div className="h-full bg-surface-2" />}>
          {/* The script pane in front of the page, not instead of it: the
              page stays mounted and hidden, the way a folded pane does,
              so coming back finds it at the same scroll and zoom rather
              than fetching it again, and the reveal handle the build
              reaches for is a live one throughout. */}
          {script ? (
            <div className={previewShowing === "script" ? "contents" : "hidden"}>
              <Script
                onRun={(path) => void runScript(path)}
                onStop={stopScript}
                onOpen={(path) => openFile(path)}
                onAsk={noAgent ? undefined : askAboutScript}
              />
            </div>
          ) : null}
          {/* The Markdown pane, on the same terms as the script's: in
              front of the page, never instead of it. */}
          {markdown ? (
            <div className={previewShowing === "markdown" ? "contents" : "hidden"}>
              {/* The same road the page's double-click takes: the file,
                  the line, and the word for the caret to find on it. */}
              <Markdown onNavigate={(path, line, hint) => openFile(path, line, hint)} />
            </div>
          ) : null}
          <div
            className={
              (previewShowing === "script" && script) || (previewShowing === "markdown" && markdown)
                ? "hidden"
                : "contents"
            }
            data-testid="page-behind-script"
          >
          <Pdf
            document={activePreview}
            handleRef={(handle) => (pdf.current = handle)}
            onNavigate={(file, line, hint) => openFile(file, line, hint)}
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
          </div>
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
          onReset={() => resetWidth("chat")}
        />
      ) : null}
      {/* The pill is the way to the agent only while the column is an
          overlay and parked: then nothing else on screen stands for it.
          While the column is open its own fold control closes it, and
          while it is docked and folded the strip below stands in for it,
          so in both of those the pill would be a second control for one
          act, and it goes. */}
      {!noAgent && chatOver && !chatOpen ? <AgentButton onShow={toggleChat} /> : null}
      {tutorialOpen ? (
        <Suspense
          fallback={
            <div
              className="absolute inset-y-0 z-40 w-[380px] max-w-full bg-surface-2 shadow-float"
              style={{ right: tutorialRight }}
            />
          }
        >
          <Tutorial right={tutorialRight} onClose={() => setTutorialOpen(false)} />
        </Suspense>
      ) : null}

      {/* Docked and folded, the column leaves a strip behind like the
          Source and Preview panes do, carrying the agent's state dot so
          that "waiting for you" survives the fold. */}
      {!noAgent && !chatOver && folded.chat ? (
        <Collapsed
          label="Claude"
          shows="Claude"
          side="right"
          mark={<AgentStateDot />}
          onExpand={toggleChat}
        />
      ) : null}
      {noAgent ? null : (
      <div
        className={
          chatOver
            ? "absolute right-0 top-0 z-30 h-full shadow-float"
            : folded.chat
              ? "hidden"
              : "nx-pane min-h-0 shrink-0"
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
            // What Claude reads is a view of the column; the picker opens
            // on the kind the welcome's action named.
            if (chatOverRef.current) setChatOpen(true);
            else if (foldedRef.current.chat) fold("chat");
            window.setTimeout(() => chat.current?.showReads(kind), 60);
          }}
          onFold={() => (chatOver ? setChatOpen(false) : fold("chat"))}
          onChangeAgent={changeAgent}
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

      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onRun={runAction}
            onOpenFile={(path) => void openFile(path)}
          />
        </Suspense>
      ) : null}
      {agentSheet}
      {reporting ? (
        <Suspense fallback={null}>
          <ReportSheet onClose={() => setReporting(false)} />
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
          <div key={notice.id} className={`nx-notice nx-arrive pointer-events-auto ${shellTheme()}`}>
            <span>{notice.text}</span>
            <Button onClick={() => dismissNotice(notice.id)} aria-label={`Dismiss: ${notice.text}`}>
              Dismiss
            </Button>
          </div>
        ))}
      </div>
      </div>
    </div>
    </div>
  );
}

