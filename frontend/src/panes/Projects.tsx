import { lazy, Suspense, useEffect, useRef, useState } from "react";
import api, {
  saveBlob,
  type JoinOffer,
  type JoinOpened,
  type ProjectSummary,
} from "../api";
import Logo from "../Logo";
import { downloadZip } from "../chrome";
import Settings from "./Settings";
import PasswordNudge from "./PasswordNudge";
import InstanceBadge from "./InstanceBadge";
import { Button, IconButton } from "../ui/Button";
import { Empty, Field, Heading, Kbd, Segmented } from "../ui/controls";
import { Menu, MenuItem } from "../ui/Menu";
import { Sheet } from "../ui/Sheet";
import {
  ChevronDownIcon, HelpIcon, PlusIcon, ReportIcon, SearchIcon, ShareIcon, SparkIcon, UpdateIcon,
} from "../ui/icons";
import type { Wanted } from "../place-menu";
import { toShell } from "../viewport";
import type { UpdateState } from "./UpdateFooter";
import { agentName } from "../agent-name";
import { set, useStore } from "../store";
import { openedWords, rowAfterKey, rowMarks, shortPath, stateWords } from "../project-row";
import { tabStopFor } from "../tree";
import {
  SORT_STORAGE, sortKeyFrom, viewCounts, visibleProjects, type ProjectView, type SortKey,
} from "../project-filter";
import { START_FROM, templateOrder } from "../templates";
import { APPEARANCE_CHANGED, readStored, writeStored } from "../appearance";
import { breakpoints } from "../layout";
import { viewportWidth } from "../viewport";
import { onFrame } from "../timing";

// Lazy, like the in-project tutorial: help text is not something a first
// visit should have to download before the project list appears.
const ScreenGuide = lazy(() => import("./tutorial/ScreenGuide"));
// The offer card likewise: it is on screen only between a join answering
// and the writer deciding, and nobody reaches that from a cold start.
const JoinOfferCard = lazy(() => import("./JoinOfferCard"));
// And the folder picker, which is behind a button most visits never press.
const FolderPicker = lazy(() => import("./FolderPicker"));
const SharePanel = lazy(() => import("./SharePanel"));
/** The update footer draws nothing while it rests and asks the server
 *  for its state on mount, which a lazy mount does a frame later; at
 *  thirteen kilobytes it was the largest thing in the entry chunk that
 *  most visits never draw. */
const UpdateFooter = lazy(() => import("./UpdateFooter"));
import { classify, nameFor } from "../arrive-source";

/** What each template is, in the words somebody choosing one would use.
 *  A directory called `beamer` is a name only a LaTeX writer knows, and the
 *  people this chooser is for are exactly the ones who may not. Anything
 *  the server lists that is not here falls back to its own name, so an
 *  install with a template of its own is offered it rather than hidden. */
/** The four ways in. New project is the one filled button on the
 *  screen; the other three sit behind a quiet menu, each with a line
 *  saying what it does, and all four open the same sheet with their own
 *  field and copy. The fourth brings a project that exists somewhere
 *  else: a zip, an arXiv id or a git URL, into a new folder. */
type Way = "create" | "add" | "join" | "bring";
const WAY_TITLES: Record<Way, string> = {
  create: "New project",
  add: "Open a folder",
  join: "Join a shared project",
  bring: "Bring one from elsewhere",
};
const OTHER_WAYS: { key: Way; label: string; note: string }[] = [
  { key: "add", label: "Open a folder", note: "One that already holds a LaTeX document. Nothing is copied or moved." },
  { key: "join", label: "Join a shared project", note: "Paste the invite somebody sent you." },
  { key: "bring", label: "Bring one from elsewhere", note: "A zip, an arXiv id, or a git URL." },
];

/** The project list.  Downloads live here as well as inside an open project:
 *  the moment a copy is most wanted is often before opening anything. */
export default function Projects({
  onOpen,
  onClose,
  canClose,
  onChangeAgent,
}: {
  onOpen: (id: string) => void;
  onClose?: () => void;
  canClose: boolean;
  /** Back to the screen that chose the agent. */
  onChangeAgent?: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  /** Where home is on the machine running NextTex, for the rows' paths. */
  const [home, setHome] = useState("");
  /** Ids a browser is holding open, as of the last fetch of the list. */
  const [watched, setWatched] = useState<string[]>([]);
  const [guide, setGuide] = useState(false);
  /** What is typed into the search box above the list. */
  const [query, setQuery] = useState("");
  const filterBox = useRef<HTMLInputElement | null>(null);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  /** Whether the list has answered once.  The heading and the controls
   *  above the list wait for it, so the screen does not draw a count of
   *  nothing for the length of a fetch. */
  const [loaded, setLoaded] = useState(false);
  /** The list's order, kept per browser: somebody who sorts by name wants
   *  it that way tomorrow. */
  const [sort, setSort] = useState<SortKey>(() => sortKeyFrom(readStored(SORT_STORAGE)));
  const chooseSort = (key: SortKey) => {
    setSort(key);
    writeStored(SORT_STORAGE, key);
  };
  /** A failure that belongs to a row rather than to the form in the rail:
   *  a PDF that did not typeset, a remove the server refused. */
  const [listError, setListError] = useState<string | null>(null);
  // The shell's width, in its own pixels, the way `App.tsx` keeps it: on
  // a phone the rail is a strip and the ways in are a drawer behind New.
  const [width, setWidth] = useState(viewportWidth);
  useEffect(() => {
    const onResize = onFrame(() => setWidth(viewportWidth()));
    window.addEventListener("resize", onResize);
    window.addEventListener(APPEARANCE_CHANGED, onResize);
    return () => {
      onResize.cancel();
      window.removeEventListener("resize", onResize);
      window.removeEventListener(APPEARANCE_CHANGED, onResize);
    };
  }, []);
  const phone = breakpoints(width).phone;
  /** The menu of the other ways in, and where it goes. */
  const [waysOpen, setWaysOpen] = useState(false);
  const [waysAt, setWaysAt] = useState<Wanted | null>(null);
  const waysButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!waysOpen) return;
    const box = waysButton.current?.getBoundingClientRect();
    if (box) setWaysAt({ left: toShell(box.right) - 280, top: toShell(box.bottom) + 4, flip: toShell(box.top) - 4 });
  }, [waysOpen]);
  /** Which way in the sheet is open for, or none. */
  const [way, setWay] = useState<Way | null>(null);
  const mode: Way = way ?? "create";
  const openWay = (chosen: Way) => {
    setError(null);
    setPicking(false);
    setWaysOpen(false);
    setWay(chosen);
  };
  const closeWay = () => {
    setWay(null);
    setPicking(false);
    setError(null);
  };
  /** The update sheet or the problem report, opened from the app bar,
   *  and the word the bar's update button shows. */
  const [sheet, setSheet] = useState<"update" | "report" | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("opening");
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.instance().then((self) => setVersion(self.version ?? "")).catch(() => undefined);
  }, []);
  const [path, setPath] = useState("");
  const pathBox = useRef<HTMLInputElement | null>(null);
  /** The fourth way's field: an arXiv id or a git URL, or the name of the
   *  zip chosen with the button beside it; and what the route left out. */
  const [source, setSource] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const zipInput = useRef<HTMLInputElement | null>(null);
  /** Whether the folder picker is open, off the Browse button. */
  const [picking, setPicking] = useState(false);
  const browseButton = useRef<HTMLButtonElement | null>(null);
  const picked = (folder: string) => {
    setPath(folder);
    setPicking(false);
    // A folder ending in a slash is one the writer finishes: the caret
    // goes to its end, once the field has the new value.
    if (folder.endsWith("/")) {
      requestAnimationFrame(() => {
        const box = pathBox.current;
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    }
  };
  const [invite, setInvite] = useState("");
  /** What a peer is offering, before any of it is written. */
  const [offer, setOffer] = useState<JoinOffer | null>(null);
  const [newName, setNewName] = useState("");
  /** What to fill a new project with. The route listing these has always
   *  existed and nothing ever called it, so every project started as an
   *  article whether or not the writer was writing one. */
  const [templates, setTemplates] = useState<string[]>([]);
  const [template, setTemplate] = useState("basic");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  // Which list is showing: the projects, the archived ones, or the trash.
  // Archived is out of the way and kept; the trash is on the way out.
  // Opening a project from either makes it active again, which the
  // server does; "Delete" in the trash is what "Remove" was, the entry
  // forgotten and the files left where they are.
  const [view, setView] = useState<ProjectView>("active");
  const [emptying, setEmptying] = useState(false);
  const counts = viewCounts(projects);
  // The project whose share sheet is open, from its row.  The routes open
  // a session on demand, so the project itself stays closed.
  const [sharing, setSharing] = useState<ProjectSummary | null>(null);
  // Saying where a folder went, keyed by the entry's old path.  The error
  // belongs to the row rather than to the screen: the shared message at the
  // bottom sits under the create form, where it reads as a create error.
  const [relocating, setRelocating] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  // Rejoining a shared project whose folder is gone, keyed the same way.
  // The folder it arrives into defaults to where it was, since that is
  // usually where the writer wants it back.
  const [rejoining, setRejoining] = useState<string | null>(null);
  const [rejoinTo, setRejoinTo] = useState("");
  // While an update is running the server is about to exit.  Opening a
  // project then means typing into a document whose server disappears
  // mid-save, so the screen stops offering it.
  const [locked, setLocked] = useState(false);

  // Once, on the way in. A list of directory names costs nothing and the
  // chooser is hidden when there is only one, so an install that has had
  // its templates trimmed to the article looks exactly as it did.
  useEffect(() => {
    api
      .templates()
      .then((answer) => setTemplates(templateOrder(answer.templates)))
      .catch(() => setTemplates([]));
  }, []);
  // The strapline names whichever agent is configured, and says nothing
  // about one at all when the writer chose to work on their own.
  const provider = useStore((s) => s.agent?.provider);
  const agentReady = useStore((s) => s.agent?.ready);
  // Why the editor just closed on its own: the folder went away from
  // under it.  The row below says the folder is missing, as it does for
  // one that went while the server was down, but not that this is the
  // project the writer was in a moment ago.
  const lost = useStore((s) => s.lostFolder);
  const agentCopy =
    provider === "none"
      ? "A new project starts from one of the documents below, ready to write in."
      : `A new project starts from one of the documents below. Give ${agentName(provider)} your journal's template or handbook afterwards and it will shape the project around it.`;

  const refresh = async () => {
    try {
      const result = await api.projects();
      setProjects(result.projects);
      setHome(result.home ?? "");
      setWatched(result.watched ?? []);
      // Cleared on success rather than on the way in, so a message does not
      // flicker off and straight back on. This screen holds its error as one
      // string written from five places, and only two of them ever cleared
      // it: a PDF that failed to typeset left its message sitting under the
      // create form until the page was reloaded, and if the writer switched
      // to the Join tab it sat under that instead, where it read as a join
      // error. The notice list in store.ts exists for exactly this, but the
      // region that draws it is mounted after the early return that shows
      // this screen, so it cannot be reached from here.
      setError(null);
      setListError(null);
      setLoaded(true);
    } catch (problem: any) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // `/` reaches the search box from anywhere on the screen that is not
  // already a field, the way it does in a browser's own find and on most
  // sites with a list worth searching.  Not while a sheet is open: the
  // box is behind it then, and Escape is its key.
  useEffect(() => {
    if (way || sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      filterBox.current?.focus();
      filterBox.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [way, sheet]);
  // Filtered and then sorted, in `project-filter.ts`: the one list the
  // screen draws and the arrow keys walk.
  const shown = visibleProjects(projects, query, sort, view);
  const setState = async (project: ProjectSummary, state: ProjectView) => {
    setListError(null);
    try {
      await api.setProjectState(project.id, state);
      await refresh();
    } catch (problem: any) {
      setListError(`${project.name}: ${problem.message}`);
    }
  };
  const forget = async (project: ProjectSummary) => {
    setForgetting(null);
    // No guard on the id: a registry entry has one whether or not its
    // folder is still there.  Caught, so a refusal is said rather than
    // swallowed.
    try {
      await api.forgetProject(project.id);
      await refresh();
    } catch (problem: any) {
      setListError(`${project.name}: ${problem.message}`);
    }
  };
  const emptyTrash = async () => {
    setEmptying(false);
    for (const project of projects) {
      if ((project.state ?? "active") !== "trashed") continue;
      try {
        await api.forgetProject(project.id);
      } catch (problem: any) {
        setListError(`${project.name}: ${problem.message}`);
      }
    }
    await refresh();
  };
  // A roving tabindex, the file tree's idiom: the list is one Tab stop and
  // the arrow keys move inside it. `focusId` remembers the row that had
  // focus; `tabStopFor` falls back to the first openable row when that
  // one is gone, which the filter does on every keystroke, so a stale
  // preference is ignored rather than leaving the list with no stop at
  // all (the lesson recorded over `tabStopFor`). The rows' own buttons
  // stay in the tab order, as the tree's do.
  const [focusId, setFocusId] = useState<string | null>(null);
  const order = view === "trashed"
    ? []
    : shown.filter((project) => !project.missing && !locked).map((p) => p.id);
  const tabStop = tabStopFor([focusId, order[0]], new Set(order));
  const moveFocus = (id: string) => {
    setFocusId(id);
    // Now, not on the next frame: the row is already drawn, and a second
    // arrow pressed before a deferred focus had landed was delivered to
    // the row that still had it, so two presses moved one row.
    document
      .querySelector<HTMLElement>(`[data-project-id="${CSS.escape(id)}"]`)
      ?.focus();
  };

  const add = async () => {
    if (!path.trim() || busy === "add") return;
    setError(null);
    setBusy("add");
    try {
      if (mode === "join") {
        // Nothing is on disk yet. What comes back is the list of what the
        // other end is offering, and the decision is the next screen.
        //
        // This waits for a whole project to sync, which is thirty seconds
        // on a thesis, and the button said "Join" the entire time with
        // nothing disabled. Pressing it again started a second join into
        // the same folder, which the second one then refuses because the
        // first has put `.nexttex` in it.
        const answer = await api.joinShare(invite.trim(), path.trim());
        if (isOpened(answer)) {
          // A folder that already held this share's own records: nothing
          // to offer, it is the project, reconnected.
          setPath("");
          setInvite("");
          setWay(null);
          await refresh();
          onOpen(answer.project.id);
          return;
        }
        setOffer(answer);
        return;
      }
      if (mode === "bring") {
        // Refused here, with the sentence the field wants, before a
        // request: the server decides again with the same patterns.
        if (!classify(source, zipFile)) {
          setError("Type an arXiv id or a git URL, or choose a zip.");
          return;
        }
        const arrived = await api.arrive(path.trim(), zipFile ? "" : source.trim(), zipFile);
        setPath("");
        setSource("");
        setZipFile(null);
        setWay(null);
        await refresh();
        if (arrived.id) onOpen(arrived.id);
        // What the archive carried and the project did not receive, said
        // inside the project it concerns, since this screen is gone the
        // moment the project opens.  A notice, because a file the writer
        // sent and did not get is something to know.
        const left = arrived.skipped ?? [];
        if (left.length) {
          const named = left.slice(0, 6).join(", ") + (left.length > 6 ? ` and ${left.length - 6} more` : "");
          set({ error: `Left out of the archive because it would run or leave the folder: ${named}.` });
        }
        return;
      }
      const project =
        mode === "create"
          ? await api.createProject(path.trim(), newName.trim(), template)
          : await api.addProject(path.trim());
      // Before the project opens, so the writer arrives in a document
      // rather than in an empty one that fills in a moment later. A
      // template that fails to write is not a reason to lose the project
      // that was just made, so it is reported and the project still opens.
      if (mode === "create" && project.id) {
        try {
          await api.loadTemplate(project.id, template);
        } catch (problem: any) {
          setError(`The project was made, but the template did not: ${problem.message}`);
        }
      }
      setPath("");
      setNewName("");
      setWay(null);
      await refresh();
      if (project.id) onOpen(project.id);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  const acceptOffer = async () => {
    if (!offer) return;
    setError(null);
    try {
      const { project } = await api.acceptJoin(offer.token);
      setOffer(null);
      setPath("");
      setInvite("");
      setWay(null);
      await refresh();
      if (project.id) onOpen(project.id);
    } catch (problem: any) {
      setError(problem.message);
      setOffer(null);
    }
  };

  const discardOffer = async () => {
    if (!offer) return;
    const token = offer.token;
    setOffer(null);
    try {
      await api.discardJoin(token);
    } catch {
      /* the server reaps an unanswered join on its own */
    }
  };

  const relocate = async (project: ProjectSummary) => {
    const where = movedTo.trim();
    if (!where) return;
    setRowError(null);
    try {
      await api.relocateProject(project.id, where);
      setRelocating(null);
      setMovedTo("");
      await refresh();
    } catch (problem: any) {
      setRowError(problem.message);
    }
  };

  const rejoin = async (project: ProjectSummary) => {
    const where = rejoinTo.trim();
    if (!where || busy === project.id) return;
    setRowError(null);
    setBusy(project.id);
    try {
      // The same offer card a join shows, drawn under the form; nothing
      // is written until it is accepted.
      const answer = await api.rejoinShare(project.shareId, where);
      setRejoining(null);
      setRejoinTo("");
      if (isOpened(answer)) {
        await refresh();
        onOpen(answer.project.id);
        return;
      }
      setOffer(answer);
      // The card is drawn in the join sheet, so the sheet opens on it.
      setWay("join");
    } catch (problem: any) {
      setRowError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const takePdf = async (project: ProjectSummary) => {
    setBusy(project.id);
    setListError(null);
    try {
      // The PDF may need building first, so this is a fetch rather than a
      // plain link: a failed build should say why, not download an error.
      const response = await fetch(
        api.downloadUrl(project.id, { format: "pdf" }),
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "the project did not typeset");
      }
      // Named after the document the server chose, the one it last had in
      // front, rather than after the project.
      const header = response.headers.get("content-disposition") ?? "";
      const named = /filename="?([^";]+)"?/.exec(header)?.[1];
      saveBlob(await response.blob(), named || `${project.name}.pdf`);
    } catch (problem: any) {
      setListError(`${project.name}: ${problem.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="nx-projects h-full bg-surround"
      // Whether this is a phone is decided in shell pixels, the way the
      // editor decides its narrow layouts, so the interface size counts
      // (`layout.ts`, `BREAKPOINTS.phone`).  A media query would judge the
      // window and be wrong by the zoom.
      data-phone={phone ? "" : undefined}
    >
      {/* The app bar: the mark, the name and the version at the left; at
          the right the agent, and icon buttons for everything the foot
          used to hold, each naming itself on hover and by its label. The
          list is the screen; nothing else takes a column. */}
      <div className="nx-appbar" aria-label="NextTex">
        <h1 className="flex items-center gap-2">
          <Logo size={20} />
          <span className="t-ui font-semibold text-ink">NextTex</span>
          {version ? <span className="t-meta tnum text-ink-3">{version}</span> : null}
          <InstanceBadge />
        </h1>
        <span className="flex-1" />
        {/* Which agent is writing with you, and the way to change it. It
            says which agent it is rather than only that there is one,
            because that is the question somebody opening it has. */}
        {onChangeAgent ? (
          <button
            type="button"
            className="nx-appbar-agent"
            aria-label={
              provider === "none"
                ? "Set up a writing agent"
                : `Writing agent: ${agentName(provider)}. Change it.`
            }
            title={
              provider === "none"
                ? "Set up a writing agent"
                : `Writing with ${agentName(provider)}. Change it.`
            }
            data-testid="set-up-agent"
            onClick={onChangeAgent}
          >
            <SparkIcon size={14} />
            {provider === "none" ? "No agent" : agentReady === false ? "Not set up" : agentName(provider)}
            <ChevronDownIcon size={11} />
          </button>
        ) : null}
        <IconButton
          label={
            updateState === "waiting"
              ? "An update is waiting"
              : updateState === "attention"
                ? "The update needs you"
                : updateState === "busy"
                  ? "Updating"
                  : "Check for updates"
          }
          className="nx-appbar-update"
          data-state={updateState}
          data-testid="update-open"
          on={sheet === "update"}
          onClick={() => setSheet(sheet === "update" ? null : "update")}
        >
          <UpdateIcon size={18} />
        </IconButton>
        <IconButton
          label="Report a problem"
          data-testid="report-problem"
          on={sheet === "report"}
          onClick={() => setSheet(sheet === "report" ? null : "report")}
        >
          <ReportIcon size={18} />
        </IconButton>
        {/* Understand, then adjust: help sits left of the cog. */}
        <IconButton
          ref={helpButton}
          label="About this screen"
          aria-haspopup="dialog"
          aria-expanded={guide}
          on={guide}
          data-testid="about-screen"
          onClick={() => setGuide((open) => !open)}
        >
          <HelpIcon size={18} />
        </IconButton>
        {guide ? (
          <Suspense fallback={null}>
            <ScreenGuide anchor={helpButton} onClose={() => setGuide(false)} />
          </Suspense>
        ) : null}
        {/* The lock, in the warning colour while the install has no
            password; its hover card carries the sentence and the way to
            put it away, and a press opens the access card. */}
        <PasswordNudge />
        <Settings onChangeAgent={onChangeAgent} />
      </div>

      <main className="nx-projects-main" aria-label="Projects">
        {/* Drawn once the list has answered, so the heading, which is also
            what every spec waits for on this screen, appears when the rows
            do and not a moment before.  The search and the sort are here
            whatever the count: a control that appears at six projects is
            one nobody has learned by the time they need it. */}
        {loaded ? (
          <div className="nx-projects-head" data-view={view}>
            <h2 className="t-display text-ink">
              {view === "active" ? "Projects" : view === "archived" ? "Archived" : "Trash"}
            </h2>
            {view !== "active" ? (
              <button
                type="button"
                className="nx-projects-link"
                data-testid="view-back"
                onClick={() => setView("active")}
              >
                Back to projects
              </button>
            ) : null}
            <span className="flex-1" />
            <Field
              ref={filterBox}
              frameClassName="nx-projects-find"
              leading={<SearchIcon size={16} />}
              trailing={<Kbd>/</Kbd>}
              value={query}
              placeholder="Find a project"
              aria-label="Find a project"
              data-testid="project-filter"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape clears, then leaves; Enter opens the first row
                // still showing, which is what typing a name and pressing
                // Enter means.
                if (event.key === "Escape") {
                  if (query) setQuery("");
                  else event.currentTarget.blur();
                }
                if (event.key === "Enter") {
                  const first = shown[0];
                  if (first && !first.missing && !locked) onOpen(first.id);
                }
                // Down from the box lands on the first row still showing.
                if (event.key === "ArrowDown" && order[0]) {
                  event.preventDefault();
                  moveFocus(order[0]);
                }
              }}
            />
            {view === "active" ? (
            <Button
              variant="pen"
              size="md"
              icon={<PlusIcon />}
              data-testid="new-project"
              onClick={() => openWay("create")}
            >
              New project
            </Button>
            ) : null}
            {view === "active" ? (
            <div className="relative">
              <Button
                ref={waysButton}
                variant="quiet"
                size="md"
                aria-haspopup={phone ? "dialog" : "menu"}
                aria-expanded={waysOpen}
                data-on={waysOpen || undefined}
                data-testid="ways-open"
                onClick={() => setWaysOpen((open) => !open)}
              >
                Other ways in <ChevronDownIcon size={12} />
              </Button>
              {/* The three other ways in, each with a line saying what it
                  does: a menu under the button, and on a phone a sheet,
                  where a menu would be a strip of the screen. */}
              {waysOpen && !phone ? (
                <Menu
                  open
                  wanted={waysAt}
                  anchor={waysButton}
                  label="Other ways in"
                  testid="ways-menu"
                  width={280}
                  onClose={() => setWaysOpen(false)}
                >
                  {OTHER_WAYS.map((way) => (
                    <MenuItem key={way.key} note={way.note} onClick={() => openWay(way.key)}>
                      {way.label}
                    </MenuItem>
                  ))}
                </Menu>
              ) : null}
            </div>
            ) : null}
            {canClose ? (
              <Button variant="quiet" size="md" onClick={onClose}>
                Back
              </Button>
            ) : null}
          </div>
        ) : null}
        {waysOpen && phone ? (
          <Sheet open onClose={() => setWaysOpen(false)} label="Other ways in" testid="ways-menu" width={420} list>
            {OTHER_WAYS.map((way) => (
              <MenuItem key={way.key} role="none" note={way.note} onClick={() => openWay(way.key)}>
                {way.label}
              </MenuItem>
            ))}
          </Sheet>
        ) : null}
        {/* The one thing on the screen that scrolls. */}
        <div className="nx-projects-list" data-testid="project-list">
          {loaded && counts[view] ? (
            <div className="nx-projects-line">
              <Segmented
                size="sm"
                label="Sort projects"
                testid="project-sort"
                value={sort}
                options={[
                  { value: "recent", label: "Last opened", testid: "sort-recent" },
                  { value: "name", label: "Name", testid: "sort-name" },
                ]}
                onChange={(key) => chooseSort(sortKeyFrom(key))}
              />
              <span className="flex-1" />
              <span className="t-meta tnum text-ink-3" data-testid="project-count">
                {view === "active"
                  ? `${counts.active} ${counts.active === 1 ? "project" : "projects"}`
                  : view === "archived"
                  ? `${counts.archived} archived`
                  : `${counts.trashed} in the trash`}
              </span>
            </div>
          ) : null}
          {lost ? (
            <div role="status" data-testid="folder-lost" className="nx-confirm !mt-0 mb-3 flex items-start gap-3">
              <div className="t-ui min-w-0 flex-1 text-ink">
                The folder for {lost.name ? <b className="font-medium">{lost.name}</b> : "that project"} is
                gone from this disk, so it was closed.
                {lost.shared
                  ? " Your collaborators still have their copies; nothing was deleted for them."
                  : ""}{" "}
                If you moved it, point NextTex at where it is now from its row below.
              </div>
              <Button variant="quiet" onClick={() => set({ lostFolder: null })}>
                Dismiss
              </Button>
            </div>
          ) : null}
          {/* A row's own failure, a PDF that did not typeset or a remove
              the server refused, is said above the rows. */}
          {listError ? (
            <p className="t-meta mb-2 text-error" data-testid="list-error">{listError}</p>
          ) : null}
          {loaded && view !== "active" && !counts[view] ? (
            <Empty
              data-testid="view-empty"
              action={
                <Button variant="quiet" onClick={() => setView("active")}>
                  Back to projects
                </Button>
              }
            >
              {view === "archived" ? "Nothing is archived." : "The trash is empty."}
            </Empty>
          ) : null}
          {loaded && view === "active" && !counts.active ? (
            <Empty
              action={
                <Button variant="pen" onClick={() => openWay("create")}>
                  New project
                </Button>
              }
            >
              {projects.length
                ? "Nothing here at the moment; the rest is archived or in the trash."
                : "Nothing here yet. Start something, open a folder that already holds a document, or join a project somebody shared."}
            </Empty>
          ) : null}
          {loaded && !projects.length ? (
            <p className="t-ui hidden text-ink-2" data-testid="no-projects">Nothing here yet.</p>
          ) : null}
          {query.trim() && counts[view] && !shown.length ? (
            <div className="t-meta px-4 py-3 text-ink-3" data-testid="no-match">
              Nothing matches “{query.trim()}”
            </div>
          ) : null}
          {shown.map((project) => (
            <div
              key={project.path}
              data-testid="project-row"
              data-project-id={project.id}
              role={!project.missing && !locked && view !== "trashed" ? "button" : undefined}
              tabIndex={
                !project.missing && !locked && view !== "trashed"
                  ? tabStop === project.id
                    ? 0
                    : -1
                  : undefined
              }
              onFocus={(event) => {
                if (event.target === event.currentTarget) setFocusId(project.id);
              }}
              className={`nx-project-row nx-project-card group ${
                locked ? "opacity-40" : !project.missing && view !== "trashed" ? "cursor-pointer" : ""
              }`}
              onClick={(event) => {
                if (locked || view === "trashed") return;
                if ((event.target as HTMLElement).closest("button, input")) return;
                if (!project.missing) onOpen(project.id);
              }}
              onKeyDown={(event) => {
                // As above: only keys aimed at the row, never at a control
                // inside it.  The click handler already says the same thing.
                if (locked) return;
                if (event.target !== event.currentTarget) return;
                const next = rowAfterKey(order, project.id, event.key);
                if (next) {
                  event.preventDefault();
                  moveFocus(next);
                  return;
                }
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!project.missing && view !== "trashed") onOpen(project.id);
              }}
            >
              <div className="nx-project-name">
                <span
                  data-testid="project-name"
                  className={`min-w-0 truncate ${project.missing ? "text-ink-3" : "text-ink"}`}
                >
                  {project.name}
                </span>
                {/* Only a shared project wears a mark: a mark on every
                    row is a mark on none. */}
                {rowMarks({ ...project, open: watched.includes(project.id) }).map((mark) => (
                  <span key={mark} className="nx-project-mark">
                    {mark === "shared" ? <ShareIcon size={12} /> : null}
                    {mark}
                  </span>
                ))}
              </div>
              {/* Home folded to `~`, the whole path in the title.  Twelve
                  rows used to begin with the same forty characters and
                  the truncation cut the part that differed. */}
              <div className="nx-project-where" title={project.path}>
                {project.missing ? (
                  <span className="text-warn">
                    This folder is no longer there.{" "}
                    {relocating !== project.path ? (
                      <button
                        type="button"
                        className="text-ink-2 hover:text-ink"
                        data-testid="find-project"
                        onClick={() => {
                          setRowError(null);
                          setMovedTo("");
                          setRejoining(null);
                          setRelocating(project.path);
                        }}
                      >
                        Find it
                      </button>
                    ) : null}
                  </span>
                ) : (
                  shortPath(project.path, home)
                )}
                {view !== "active" ? (
                  <span className="nx-project-stamp" data-testid="row-state">
                    {" "}· {stateWords(project.state, project.stateAt)}
                  </span>
                ) : null}
              </div>
              {rejoining === project.path ? (
                <div className="nx-project-form">
                  <div className="flex gap-2">
                    <Field
                      autoFocus
                      frameClassName="min-w-0 flex-1"
                      value={rejoinTo}
                      placeholder="A folder for it to arrive in, empty or holding a copy"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => setRejoinTo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") rejoin(project);
                        if (event.key === "Escape") setRejoining(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="md"
                      data-testid="confirm-rejoin"
                      disabled={busy === project.id}
                      onClick={() => rejoin(project)}
                    >
                      {busy === project.id ? "Asking…" : "Rejoin"}
                    </Button>
                    <Button variant="quiet" size="md" onClick={() => setRejoining(null)}>
                      Cancel
                    </Button>
                  </div>
                  <p className="t-meta mt-1 text-ink-3">
                    Your collaborators send the project as it is now. Nothing
                    is written until you accept what they offer.
                  </p>
                  {rowError ? <p className="t-meta mt-1 text-error">{rowError}</p> : null}
                </div>
              ) : null}
              {relocating === project.path ? (
                <div className="nx-project-form">
                  <div className="flex gap-2">
                    <Field
                      autoFocus
                      frameClassName="min-w-0 flex-1"
                      value={movedTo}
                      placeholder="Where is it now? e.g. ~/Papers/thesis"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => setMovedTo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") relocate(project);
                        if (event.key === "Escape") setRelocating(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="md"
                      data-testid="confirm-relocate"
                      onClick={() => relocate(project)}
                    >
                      Use this folder
                    </Button>
                    <Button variant="quiet" size="md" onClick={() => setRelocating(null)}>
                      Cancel
                    </Button>
                  </div>
                  {rowError ? <p className="t-meta mt-1 text-error">{rowError}</p> : null}
                </div>
              ) : null}
              {forgetting === project.path ? (
                <div className="nx-project-tail flex items-center gap-2" data-testid="row-actions">
                  <span className="t-meta text-ink-2">
                    Delete from NextTex? The files stay where they are.
                  </span>
                  <Button
                    size="inline"
                    className="!text-error"
                    data-testid="confirm-delete"
                    onClick={() => forget(project)}
                  >
                    Delete
                  </Button>
                  <Button size="inline" onClick={() => setForgetting(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
              /* One slot at the end of the row, two things in it.  At rest
                 it says when the project was last opened, which is also
                 why the list is in the order it is in; pointed at, or
                 holding focus, it is the actions instead (styles.css,
                 `.nx-row-tail`).  The buttons stay in the DOM and the tab
                 order; a missing folder's row keeps them shown, since they
                 are the row's whole point, as does a row that is
                 typesetting, and a screen with nothing to point with shows
                 both. */
              <div className="nx-row-tail nx-project-tail">
                <span className="nx-row-when t-meta tnum text-ink-3" data-testid="row-opened">
                  {view === "active"
                    ? openedWords(project.lastOpened)
                    : stateWords(project.state, project.stateAt)}
                </span>
                <div
                  className="nx-row-actions flex items-center gap-[2px]"
                  data-testid="row-actions"
                  data-always={project.missing || busy === project.id ? "" : undefined}
                >
                  {view !== "trashed" ? (
                    <Button
                      size="inline"
                      disabled={locked || project.missing}
                      data-testid="row-open"
                      onClick={() => onOpen(project.id)}
                    >
                      Open
                    </Button>
                  ) : null}
                  {view === "active" ? (
                    <>
                      <Button
                        size="inline"
                        disabled={locked || project.missing}
                        data-testid="row-share"
                        onClick={() => setSharing(project)}
                      >
                        Share
                      </Button>
                      <Button
                        size="inline"
                        disabled={locked || project.missing}
                        onClick={() => void downloadZip(project.id, `${project.name}.zip`)}
                      >
                        Zip
                      </Button>
                      <Button
                        size="inline"
                        disabled={locked || project.missing || busy === project.id}
                        onClick={() => takePdf(project)}
                      >
                        {busy === project.id ? "Typesetting" : "PDF"}
                      </Button>
                    </>
                  ) : null}
                  {/* The other way back for a shared project: the folder is
                      really gone, and the collaborators still have theirs. */}
                  {project.missing && project.shared && !project.removed
                    && rejoining !== project.path ? (
                    <Button
                      size="inline"
                      data-testid="rejoin-project"
                      onClick={() => {
                        setRowError(null);
                        setRejoinTo(project.path);
                        setRelocating(null);
                        setRejoining(project.path);
                      }}
                    >
                      Rejoin from collaborators
                    </Button>
                  ) : null}
                  {view === "active" ? (
                    <Button
                      size="inline"
                      data-testid="row-archive"
                      onClick={() => setState(project, "archived")}
                    >
                      Archive
                    </Button>
                  ) : (
                    <Button
                      size="inline"
                      data-testid="row-restore"
                      onClick={() => setState(project, "active")}
                    >
                      Restore
                    </Button>
                  )}
                  {view !== "trashed" ? (
                    <Button
                      size="inline"
                      data-testid="row-trash"
                      onClick={() => setState(project, "trashed")}
                    >
                      Trash
                    </Button>
                  ) : (
                    <Button
                      size="inline"
                      className="!text-error"
                      data-testid="row-delete"
                      onClick={() => setForgetting(project.path)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              )}
            </div>
          ))}
          {/* Under the projects, only when there is something in it: the
              counts, each the way to its view.  Under the trash, the one
              way to empty it, with the same confirm every row has. */}
          {loaded && view === "active" && (counts.archived || counts.trashed) ? (
            <div className="nx-projects-under" data-testid="projects-under">
              {counts.archived ? (
                <button type="button" className="nx-projects-link" data-testid="view-archived" onClick={() => setView("archived")}>
                  {counts.archived} archived
                </button>
              ) : null}
              {counts.archived && counts.trashed ? " · " : null}
              {counts.trashed ? (
                <button type="button" className="nx-projects-link" data-testid="view-trash" onClick={() => setView("trashed")}>
                  {counts.trashed} in the trash
                </button>
              ) : null}
            </div>
          ) : null}
          {loaded && view === "trashed" && counts.trashed ? (
            <div className="nx-projects-under" data-testid="projects-under">
              {emptying ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-ink-2">
                    Delete {counts.trashed === 1 ? "this project" : `these ${counts.trashed} projects`} from
                    NextTex? The files stay where they are.
                  </span>
                  <Button size="inline" className="!text-error" data-testid="confirm-empty-trash" onClick={emptyTrash}>
                    Delete
                  </Button>
                  <Button size="inline" onClick={() => setEmptying(false)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <button type="button" className="nx-projects-link" data-testid="empty-trash" onClick={() => setEmptying(true)}>
                  Empty the trash
                </button>
              )}
            </div>
          ) : null}
        </div>
      </main>

      {/* The one sheet the four ways in share, each with its own field and
          copy: New project with its name, where and what to start from; the
          others with theirs. */}
      {way ? (
        <Sheet open onClose={closeWay} label={WAY_TITLES[way]} testid="way-form" width={520}>
          <Heading level={2} display>{WAY_TITLES[way]}</Heading>
          <p className="t-meta mt-1 text-ink-2">
            {way === "create"
              ? agentCopy
              : way === "add"
              ? "Point NextTex at a folder that already contains a LaTeX document. Nothing is copied or moved."
              : way === "bring"
              ? "A zip somebody sent, an arXiv id, or a git URL. The project arrives in a new folder; a zip's build files and anything that would run are left out."
              : "Paste an invite somebody sent you. The whole project arrives here, the files and their history both, and stays in step with everyone else's copy, including anything written while you were offline."}
          </p>
          {way === "create" ? (
            <>
              <div className="nx-sheet-label">Name</div>
              <Field
                autoFocus
                frameClassName="w-full"
                value={newName}
                placeholder="What is it called?"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && add()}
              />
            </>
          ) : null}
          {way === "bring" ? (
            <>
              <div className="nx-sheet-label">What to bring</div>
              <div className="flex gap-2">
                <Field
                  autoFocus
                  frameClassName="min-w-0 flex-1"
                  value={source}
                  placeholder="2301.01234, or https://github.com/you/paper"
                  aria-label="An arXiv id, a git URL, or the zip chosen beside"
                  data-testid="bring-source"
                  className="font-mono text-[12.5px]"
                  onChange={(event) => {
                    setSource(event.target.value);
                    // Typing over a chosen zip's name means the zip is
                    // no longer what is meant.
                    if (zipFile) setZipFile(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && add()}
                />
                <input
                  ref={zipInput}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  data-testid="bring-zip"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0] ?? null;
                    setZipFile(chosen);
                    if (chosen) setSource(chosen.name);
                    event.target.value = "";
                  }}
                />
                <Button
                  variant="ghost"
                  size="md"
                  data-testid="bring-choose-zip"
                  onClick={() => zipInput.current?.click()}
                >
                  Choose a zip…
                </Button>
              </div>
            </>
          ) : null}
          {way === "join" ? (
            <>
              <div className="nx-sheet-label">The invite</div>
              <textarea
                autoFocus
                value={invite}
                rows={3}
                placeholder="Paste the invite here"
                aria-label="The invite you were sent"
                data-testid="invite-input"
                className="nx-textarea w-full font-mono text-[12.5px]"
                onChange={(event) => setInvite(event.target.value)}
              />
            </>
          ) : null}
          {/* The folder, typed or browsed.  Browse walks the machine's disk
              in a card, since a browser's own folder dialog hands back
              files and not a path on the server; what it fills in depends
              on the way in (`FolderPicker`). */}
          <div className="nx-sheet-label">{way === "add" ? "Folder" : "Where"}</div>
          <div className="relative flex gap-2">
            <Field
              ref={pathBox}
              autoFocus={way === "add"}
              frameClassName="min-w-0 flex-1"
              value={path}
              placeholder={
                way === "create"
                  ? "Where to put it, e.g. ~/writing/my-paper"
                  : way === "add"
                  ? "/path/to/your/writing/project"
                  : way === "bring"
                  ? "Where to put it, e.g. ~/writing/their-paper"
                  : "A folder to put it in, e.g. ~/writing/their-paper"
              }
              className="font-mono text-[12.5px]"
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && add()}
            />
            <Button
              ref={browseButton}
              variant="ghost"
              size="md"
              aria-haspopup="dialog"
              aria-expanded={picking}
              data-testid="browse-folder"
              onClick={() => setPicking((open) => !open)}
            >
              Browse…
            </Button>
          </div>
          {picking ? (
            <Suspense fallback={null}>
              <FolderPicker
                mode={way === "bring" ? "create" : way}
                name={way === "bring" ? nameFor(source, zipFile) : newName}
                typed={path}
                onPick={picked}
                onClose={() => setPicking(false)}
              />
            </Suspense>
          ) : null}
          {way === "create" && templates.length > 1 ? (
            /* Hidden when there is only one, which is what an install
               with its templates trimmed looks like: a chooser offering a
               single choice is a control that asks a question with one
               answer. */
            <>
              <div className="nx-sheet-label">Start from</div>
              <Segmented
                label="What to start from"
                testid="template-choice"
                value={template}
                options={templates.map((name) => ({
                  value: name,
                  label: START_FROM[name] ?? name,
                  testid: `template-${name}`,
                }))}
                onChange={(name) => setTemplate(name)}
              />
            </>
          ) : null}
          {error ? <p className="t-meta mt-3 text-error">{error}</p> : null}
          {/* After the fields, so it sits under Join: a rejoin from a row
              can produce an offer while the sheet is the join sheet. */}
          {offer && way === "join" ? (
            <Suspense fallback={null}>
              <JoinOfferCard offer={offer} />
            </Suspense>
          ) : null}
          {offer && way === "join" ? (
            /* The offer's two answers are the sheet's foot while it is on
               screen: discarding leaves nothing behind, accepting writes
               what the block above says. */
            <div className="nx-sheet-foot">
              <Button variant="quiet" data-testid="discard-join" onClick={discardOffer}>Discard</Button>
              <Button variant="pen" data-testid="accept-join" onClick={acceptOffer}>Accept</Button>
            </div>
          ) : (
          <div className="nx-sheet-foot">
            <Button variant="quiet" onClick={closeWay}>Cancel</Button>
            <Button variant="pen" onClick={add} disabled={busy === "add"}>
              {busy === "add" && way === "join"
                ? "Joining…"
                : busy === "add" && way === "bring"
                ? "Bringing…"
                : way === "create"
                ? "Create project"
                : way === "add"
                ? "Open folder"
                : way === "bring"
                ? "Bring it"
                : "Join"}
            </Button>
          </div>
          )}
        </Sheet>
      ) : null}
      {/* Share from a row: the same sheet the workspace uses, over the list.
          The list is read again when it closes, so the row's mark says
          "shared" the moment it is. */}
      {sharing ? (
        <Suspense fallback={null}>
          <SharePanel
            projectId={sharing.id}
            name={sharing.name}
            onClose={() => {
              setSharing(null);
              void refresh();
            }}
            onLeft={() => void refresh()}
          />
        </Suspense>
      ) : null}
      {/* The update sheet and the problem report, opened from the app bar;
          the component mounts whatever is open, since its check on mount
          is what tells the bar's button what to show. */}
      <Suspense fallback={null}>
        <UpdateFooter
          onBusy={setLocked}
          open={sheet}
          onClose={() => setSheet(null)}
          onState={setUpdateState}
        />
      </Suspense>
    </div>
  );
}

function isOpened(answer: JoinOffer | JoinOpened): answer is JoinOpened {
  return (answer as JoinOpened).opened === true;
}
