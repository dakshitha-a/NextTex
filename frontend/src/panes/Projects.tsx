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
import { agentName } from "../agent-name";
import { set, useStore } from "../store";
import { openedWords, rowAfterKey, rowMarks, shortPath } from "../project-row";
import { tabStopFor } from "../tree";
import { SORT_STORAGE, sortKeyFrom, visibleProjects, type SortKey } from "../project-filter";
import { APPEARANCE_CHANGED, readStored, writeStored } from "../appearance";
import { breakpoints } from "../layout";
import { viewportWidth } from "../viewport";
import { onFrame } from "../timing";
import { useDismiss } from "../useDismiss";

// Lazy, like the in-project tutorial: help text is not something a first
// visit should have to download before the project list appears.
const ScreenGuide = lazy(() => import("./tutorial/ScreenGuide"));
// The offer card likewise: it is on screen only between a join answering
// and the writer deciding, and nobody reaches that from a cold start.
const JoinOfferCard = lazy(() => import("./JoinOfferCard"));
// And the folder picker, which is behind a button most visits never press.
const FolderPicker = lazy(() => import("./FolderPicker"));
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
const START_FROM: Record<string, string> = {
  basic: "An article",
  report: "A report, in chapters",
  beamer: "A talk",
  letter: "A letter",
};

/** The four ways in: the word on the tile, and the whole phrase that is
 *  the button's name.  The fourth brings a project that exists somewhere
 *  else: a zip, an arXiv id or a git URL, into a new folder. */
const WAYS = {
  create: { word: "New", label: "Start something new" },
  add: { word: "Folder", label: "Point at a folder" },
  join: { word: "Join", label: "Join a shared project" },
  bring: { word: "Bring", label: "Bring one from elsewhere" },
} as const;
type Way = keyof typeof WAYS;

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
  const [waysOpen, setWaysOpen] = useState(false);
  const drawer = phone && waysOpen;
  // A window widened past the breakpoint with the drawer open would keep
  // `data-open` on a column that no longer needs it.
  useEffect(() => {
    if (!phone) setWaysOpen(false);
  }, [phone]);
  const waysRef = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement | null>(null);
  useDismiss(waysRef, drawer, () => setWaysOpen(false), newButton);
  const [path, setPath] = useState("");
  const pathBox = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Way>("create");
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
      .then((answer) => setTemplates(answer.templates))
      .catch(() => setTemplates([]));
  }, []);
  // The strapline names whichever agent is configured, and says nothing
  // about one at all when the writer chose to work on their own.
  const provider = useStore((s) => s.agent?.provider);
  // Why the editor just closed on its own: the folder went away from
  // under it.  The row below says the folder is missing, as it does for
  // one that went while the server was down, but not that this is the
  // project the writer was in a moment ago.
  const lost = useStore((s) => s.lostFolder);
  const tagline =
    provider === "none"
      ? "Write LaTeX beside the typeset page."
      : `Write LaTeX with ${agentName(provider)} beside the typeset page.`;
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
  // sites with a list worth searching.  Not while the drawer is open on a
  // phone: the box is behind the drawer then, and Escape is its key.
  useEffect(() => {
    if (drawer) return;
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
  }, [drawer]);
  // Filtered and then sorted, in `project-filter.ts`: the one list the
  // screen draws and the arrow keys walk.
  const shown = visibleProjects(projects, query, sort);
  // A roving tabindex, the file tree's idiom: the list is one Tab stop and
  // the arrow keys move inside it. `focusId` remembers the row that had
  // focus; `tabStopFor` falls back to the first openable row when that
  // one is gone, which the filter does on every keystroke, so a stale
  // preference is ignored rather than leaving the list with no stop at
  // all (the lesson recorded over `tabStopFor`). The rows' own buttons
  // stay in the tab order, as the tree's do.
  const [focusId, setFocusId] = useState<string | null>(null);
  const order = shown.filter((project) => !project.missing && !locked).map((p) => p.id);
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
          ? await api.createProject(path.trim(), newName.trim())
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
      // The card is drawn under Join in the rail, which on a phone is the
      // drawer: opened, so the offer is seen rather than waiting unseen.
      setWaysOpen(true);
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
      className="nx-furniture nx-projects h-full bg-surround"
      // Whether this is a phone is decided in shell pixels, the way the
      // editor decides its narrow layouts, so the interface size counts
      // (`layout.ts`, `BREAKPOINTS.phone`).  A media query would judge the
      // window and be wrong by the zoom.
      data-phone={phone ? "" : undefined}
    >
      {/* The rail: everything on this screen that is not a project.  It
          never scrolls away, which is the whole reason the sheet this
          screen used to be is gone: with fourteen projects on it the ways
          in, the cog and the update were all above or below the window,
          and the only thing in view was the middle of the list.  On a
          phone it is a strip along the top and the ways in open from New
          as a drawer; the same elements, placed by the grid in
          styles.css, so the cog and the help exist exactly once. */}
      <aside className="nx-projects-rail bg-surface" aria-label="NextTex">
        <div className="nx-rail-brand">
          <h1 className="t-display flex items-center gap-3">
            <Logo size={26} />
            NextTex
            <InstanceBadge />
          </h1>
          <p className="nx-rail-tagline t-meta mt-1 text-ink-2">{tagline}</p>
        </div>
        <button
          ref={newButton}
          type="button"
          className="nx-rail-new pen-button h-[28px] px-3 t-ui"
          aria-expanded={waysOpen}
          aria-controls="nx-ways"
          data-testid="ways-open"
          onClick={() => setWaysOpen((open) => !open)}
        >
          New
        </button>
        <section
          id="nx-ways"
          ref={waysRef}
          className="nx-ways"
          aria-label="Ways in"
          // A dialog only while it is a drawer on a phone: then Escape and
          // a press outside close it and focus goes in and comes back to
          // New, all of which `useDismiss` does for a dialog and none of
          // which a column in a rail wants.
          role={drawer ? "dialog" : undefined}
          aria-modal={drawer ? true : undefined}
          data-open={waysOpen ? "" : undefined}
        >
          {/* Which agent is writing with you, and the way to change it.  It
              says which agent it is rather than only that there is one,
              because that is the question somebody opening it has. */}
          {onChangeAgent ? (
            <button
              className="quiet flex h-[26px] items-center gap-[5px] rounded-[3px] px-[5px] hover:bg-surface-3"
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
              <Nib />
              <span className="t-micro">
                {provider === "none" ? "No agent" : agentName(provider)}
              </span>
            </button>
          ) : null}
          {/* The three ways in as a row of tiles, the chosen one filled,
              and one form under all three.  They were a stacked list with
              the chosen one unfolded in place, which put the other two
              under the Create button where they read as its children, and
              a text label with a rule on its left did not say "press me".
              The writer chose the tiles from five variants drawn for them.
              The visible word is short so three fit across the rail; the
              accessible name is the whole phrase, which contains the word,
              so a screen reader hears the sentence and every spec that
              finds the buttons by name still does.  The message under the
              fields belongs to whichever of the three the writer was last
              doing; carried across, it reads as an error about the one
              they have just moved to, so a change clears it. */}
          <div className="nx-way-tiles" role="group" aria-label="Ways in">
            {(["create", "add", "join", "bring"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="nx-way-tile"
                aria-pressed={mode === option}
                aria-label={WAYS[option].label}
                data-way={option}
                onClick={() => {
                  setError(null);
                  setPicking(false);
                  setMode(option);
                }}
              >
                {option === "create" ? <Plus /> : option === "add" ? <Folder /> : option === "join" ? <Link /> : <Inbox />}
                <span>{WAYS[option].word}</span>
              </button>
            ))}
          </div>
          <div className="nx-way-form" data-testid="way-form">
            <p className="t-meta text-ink-2">
              {mode === "create"
                ? agentCopy
                : mode === "add"
                ? "Point NextTex at a folder that already contains a LaTeX document. Nothing is copied or moved."
                : mode === "bring"
                ? "A zip somebody sent, an arXiv id, or a git URL. The project arrives in a new folder; a zip's build files and anything that would run are left out."
                : "Paste an invite somebody sent you. The whole project arrives here, the files and their history both, and stays in step with everyone else's copy, including anything written while you were offline."}
            </p>
            {mode === "create" ? (
              <input
                value={newName}
                placeholder="What is it called?"
                className="t-ui h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
                onChange={(event) => setNewName(event.target.value)}
              />
            ) : null}
            {mode === "bring" ? (
              <div className="flex gap-2">
                <input
                  value={source}
                  placeholder="2301.01234, or https://github.com/you/paper"
                  aria-label="An arXiv id, a git URL, or the zip chosen beside"
                  data-testid="bring-source"
                  className="t-code-sm h-[28px] min-w-0 flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
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
                <button
                  type="button"
                  className="ghost-button h-[28px] shrink-0 px-2 t-meta"
                  data-testid="bring-choose-zip"
                  onClick={() => zipInput.current?.click()}
                >
                  Choose a zip…
                </button>
              </div>
            ) : null}
            {mode === "join" ? (
              <textarea
                value={invite}
                rows={3}
                placeholder="Paste the invite here"
                aria-label="The invite you were sent"
                data-testid="invite-input"
                className="t-code-sm w-full resize-none rounded-[3px] border border-line bg-surface px-2 py-1 outline-none placeholder:text-ink-3"
                onChange={(event) => setInvite(event.target.value)}
              />
            ) : null}
            {/* The folder, typed or browsed.  Browse walks the
                machine's disk in a card, since a browser's own
                folder dialog hands back files and not a path on
                the server; what it fills in depends on the way
                in (`FolderPicker`). */}
            <div className="flex gap-2">
              <input
                ref={pathBox}
                value={path}
                placeholder={
                  mode === "create"
                    ? "Where to put it, e.g. ~/writing/my-paper"
                    : mode === "add"
                    ? "/path/to/your/writing/project"
                    : mode === "bring"
                    ? "Where to put it, e.g. ~/writing/their-paper"
                    : "A folder to put it in, e.g. ~/writing/their-paper"
                }
                className="t-code-sm h-[28px] min-w-0 flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && add()}
              />
              <button
                ref={browseButton}
                type="button"
                className="ghost-button h-[28px] shrink-0 px-2 t-meta"
                aria-haspopup="dialog"
                aria-expanded={picking}
                data-testid="browse-folder"
                onClick={() => setPicking((open) => !open)}
              >
                Browse…
              </button>
            </div>
            {picking ? (
              <Suspense fallback={null}>
                <FolderPicker
                  mode={mode === "bring" ? "create" : mode}
                  name={mode === "bring" ? nameFor(source, zipFile) : newName}
                  typed={path}
                  anchor={browseButton}
                  onPick={picked}
                  onClose={() => setPicking(false)}
                />
              </Suspense>
            ) : null}
            {mode === "create" && templates.length > 1 ? (
              /* Hidden when there is only one, which is what an
                 install with its templates trimmed looks like: a
                 chooser offering a single choice is a control that
                 asks a question with one answer. */
              <select
                value={template}
                aria-label="What to start from"
                data-testid="template-choice"
                className="t-ui h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 text-ink outline-none"
                onChange={(event) => setTemplate(event.target.value)}
              >
                {templates.map((name) => (
                  <option key={name} value={name}>
                    {START_FROM[name] ?? name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className={`h-[28px] self-start px-3 t-ui ${
                mode === "join" ? "pen-button" : "ghost-button"
              }`}
              onClick={add}
              disabled={busy === "add"}
            >
              {busy === "add" && mode === "join"
                ? "Joining…"
                : busy === "add" && mode === "bring"
                ? "Bringing…"
                : mode === "create"
                ? "Create project"
                : mode === "add"
                ? "Open folder"
                : mode === "bring"
                ? "Bring it"
                : "Join"}
            </button>
            {error ? <p className="t-meta text-error">{error}</p> : null}
          </div>
          {/* After the third item, so it sits under Join whatever is
              chosen: a rejoin from a row can produce an offer while the
              chosen way in is still Start something new. */}
          {offer ? (
            <Suspense fallback={null}>
              <JoinOfferCard offer={offer} onAccept={acceptOffer} onDiscard={discardOffer} />
            </Suspense>
          ) : null}
        </section>
        {/* Understand, then adjust: help sits left of the cog and wears the
            cog's own chrome so the two read as a pair. */}
        <div className="nx-rail-tools">
          <button
            ref={helpButton}
            className={`quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3 ${
              guide ? "bg-surface-3" : ""
            }`}
            data-tone={guide ? "on" : undefined}
            aria-label="About this screen"
            title="About this screen"
            aria-haspopup="dialog"
            aria-expanded={guide}
            data-testid="about-screen"
            onClick={() => setGuide((open) => !open)}
          >
            <QuestionMark />
          </button>
          {guide ? (
            <Suspense fallback={null}>
              <ScreenGuide anchor={helpButton} onClose={() => setGuide(false)} />
            </Suspense>
          ) : null}
          <Settings onChangeAgent={onChangeAgent} />
        </div>
      </aside>

      <main className="nx-projects-main bg-surface" aria-label="Projects">
        {/* Drawn once the list has answered, so the heading, which is also
            what every spec waits for on this screen, appears when the rows
            do and not a moment before.  The search and the sort are here
            whatever the count: a control that appears at six projects is
            one nobody has learned by the time they need it. */}
        {loaded ? (
          <div className="nx-projects-head">
            <div className="flex items-baseline gap-2">
              <h2 className="t-meta text-ink-2">Projects</h2>
              <span className="t-micro text-ink-3" data-testid="project-count">
                {projects.length}
              </span>
            </div>
            <input
              ref={filterBox}
              value={query}
              placeholder="Find a project"
              aria-label="Find a project"
              data-testid="project-filter"
              className="t-ui h-[28px] min-w-0 flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
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
            <select
              value={sort}
              aria-label="Sort projects"
              data-testid="project-sort"
              className="t-ui h-[28px] shrink-0 rounded-[3px] border border-line bg-surface px-2 text-ink outline-none"
              onChange={(event) => chooseSort(sortKeyFrom(event.target.value))}
            >
              <option value="recent">Last opened</option>
              <option value="name">Name, A to Z</option>
            </select>
            {canClose ? (
              <button className="t-ui shrink-0 text-ink-2 hover:text-ink" onClick={onClose}>
                Back
              </button>
            ) : null}
          </div>
        ) : null}
        {/* The one thing on the screen that scrolls. */}
        <div className="nx-projects-list" data-testid="project-list">
          {lost ? (
            <div
              role="status"
              data-testid="folder-lost"
              className="mb-4 flex items-start gap-3 rounded-[3px] border border-line bg-surface-2 px-4 py-3"
            >
              <div className="t-ui min-w-0 flex-1 text-ink">
                The folder for {lost.name ? <b className="font-medium">{lost.name}</b> : "that project"} is
                gone from this disk, so it was closed.
                {lost.shared
                  ? " Your collaborators still have their copies; nothing was deleted for them."
                  : ""}{" "}
                If you moved it, point NextTex at where it is now from its row below.
              </div>
              <button
                type="button"
                className="h-[28px] shrink-0 px-2 t-meta text-ink-3 hover:text-ink"
                onClick={() => set({ lostFolder: null })}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {/* A row's own failure, a PDF that did not typeset or a remove
              the server refused, is said above the rows rather than under
              the form in the rail, where it read as an error about
              starting something. */}
          {listError ? (
            <p className="t-meta mb-2 text-error" data-testid="list-error">{listError}</p>
          ) : null}
          {loaded && !projects.length ? (
            <p className="t-ui text-ink-2" data-testid="no-projects">
              Nothing here yet.{" "}
              {phone ? "Press New to start something." : "Start something on the left."}
            </p>
          ) : null}
          {projects.length ? (
        <div className="rounded-[3px] border border-line bg-surface-2">
          {query.trim() && !shown.length ? (
            <div className="t-meta px-4 py-3 text-ink-3" data-testid="no-match">
              Nothing matches “{query.trim()}”
            </div>
          ) : null}
          {shown.map((project) => (
            <div
              key={project.path}
              data-testid="project-row"
              data-project-id={project.id}
              role={!project.missing && !locked ? "button" : undefined}
              tabIndex={
                !project.missing && !locked
                  ? tabStop === project.id
                    ? 0
                    : -1
                  : undefined
              }
              onFocus={(event) => {
                if (event.target === event.currentTarget) setFocusId(project.id);
              }}
              // Wrapping, so that on a narrow screen the tail of the row
              // (the time, the actions) drops under the name rather than
              // squeezing it to ten characters beside three buttons.
              className={`nx-project-row group flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 ${
                locked
                  ? "opacity-40"
                  : !project.missing
                    ? "cursor-pointer hover:bg-surface-3"
                    : ""
              }`}
              onClick={(event) => {
                if (locked) return;
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
                if (!project.missing) onOpen(project.id);
              }}
            >
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={`t-ui-lg min-w-0 truncate font-serif ${
                      project.missing ? "text-ink-3" : "text-ink group-hover:text-hint"
                    }`}
                  >
                    {project.name}
                  </span>
                  {/* Only a shared project wears a mark: a mark on every
                      row is a mark on none. */}
                  {rowMarks({ ...project, open: watched.includes(project.id) }).map((mark) => (
                    <span key={mark} className="t-micro shrink-0 text-ink-3">
                      {mark}
                    </span>
                  ))}
                </div>
                {/* Home folded to `~`, the whole path in the title.  Twelve
                    rows used to begin with the same forty characters and
                    the truncation cut the part that differed. */}
                <div className="t-code-sm truncate text-ink-3" title={project.path}>
                  {shortPath(project.path, home)}
                </div>
                {project.missing ? (
                  <div className="t-meta mt-1 text-warn">
                    This folder is no longer there.
                  </div>
                ) : null}
                {rejoining === project.path ? (
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={rejoinTo}
                        placeholder="A folder for it to arrive in, empty or holding a copy"
                        className="t-code-sm h-[28px] min-w-0 flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
                        onChange={(event) => setRejoinTo(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") rejoin(project);
                          if (event.key === "Escape") setRejoining(null);
                        }}
                      />
                      <button
                        className="ghost-button h-[28px] shrink-0 px-3 t-meta"
                        data-testid="confirm-rejoin"
                        disabled={busy === project.id}
                        onClick={() => rejoin(project)}
                      >
                        {busy === project.id ? "Asking…" : "Rejoin"}
                      </button>
                      <button
                        className="h-[28px] shrink-0 px-2 t-meta text-ink-3 hover:text-ink"
                        onClick={() => setRejoining(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="t-meta mt-1 text-ink-3">
                      Your collaborators send the project as it is now. Nothing
                      is written until you accept what they offer.
                    </p>
                    {rowError ? (
                      <p className="t-meta mt-1 text-error">{rowError}</p>
                    ) : null}
                  </div>
                ) : null}
                {relocating === project.path ? (
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={movedTo}
                        placeholder="Where is it now? e.g. ~/Papers/thesis"
                        className="t-code-sm h-[28px] min-w-0 flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
                        onChange={(event) => setMovedTo(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") relocate(project);
                          if (event.key === "Escape") setRelocating(null);
                        }}
                      />
                      <button
                        className="ghost-button h-[28px] shrink-0 px-3 t-meta"
                        data-testid="confirm-relocate"
                        onClick={() => relocate(project)}
                      >
                        Use this folder
                      </button>
                      <button
                        className="h-[28px] shrink-0 px-2 t-meta text-ink-3 hover:text-ink"
                        onClick={() => setRelocating(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    {rowError ? (
                      <p className="t-meta mt-1 text-error">{rowError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {forgetting === project.path ? (
                <div className="flex shrink-0 items-center gap-2" data-testid="row-actions">
                  <span className="t-meta text-ink-2">
                    Remove from NextTex? The files stay where they are.
                  </span>
                  <button
                    className="h-[28px] rounded-[3px] px-2 t-meta text-error"
                    onClick={async () => {
                      setForgetting(null);
                      // No guard on the id: a registry entry has one whether
                      // or not its folder is still there.  There used to be
                      // one, and because a missing project's id was null it
                      // swallowed the only action left on a dead entry --
                      // the confirmation collapsed and nothing happened.
                      //
                      // And the same symptom again from the other side: this
                      // was the one file operation here with no catch, so a
                      // refusal collapsed the confirmation, never reached
                      // `refresh`, and said nothing at all.  Remove, Remove,
                      // and apparently nothing happened.
                      try {
                        await api.forgetProject(project.id);
                        await refresh();
                      } catch (problem: any) {
                        setListError(`${project.name}: ${problem.message}`);
                      }
                    }}
                  >
                    Remove
                  </button>
                  <button
                    className="h-[28px] px-2 t-meta text-ink-3 hover:text-ink"
                    onClick={() => setForgetting(null)}
                  >
                    Keep
                  </button>
                </div>
              ) : (
              /* One slot at the end of the row, two things in it.  At rest
                 it says when the project was last opened, which is also
                 why the list is in the order it is in; pointed at, or
                 holding focus, it is Zip, PDF and Remove instead
                 (styles.css, `.nx-row-tail`).  Twelve rows of three
                 bordered buttons were thirty-six buttons, and the most
                 visible thing on the right of the list was Remove.  The
                 buttons stay in the DOM and the tab order; a missing
                 folder's row keeps them shown, since they are the row's
                 whole point, as does a row that is typesetting, and a
                 screen with nothing to point with shows both. */
              <div className="nx-row-tail ml-auto shrink-0">
              <span className="nx-row-when t-micro text-ink-3" data-testid="row-opened">
                {openedWords(project.lastOpened)}
              </span>
              <div
                className="nx-row-actions flex items-center gap-1"
                data-testid="row-actions"
                data-always={project.missing || busy === project.id ? "" : undefined}
              >
                <button
                  className="h-[28px] rounded-[3px] px-2 t-meta text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
                  disabled={locked || project.missing}
                  onClick={() =>
                    void downloadZip(project.id, `${project.name}.zip`)
                  }
                >
                  Zip
                </button>
                <button
                  className="h-[28px] rounded-[3px] px-2 t-meta text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
                  disabled={locked || project.missing || busy === project.id}
                  onClick={() => takePdf(project)}
                >
                  {busy === project.id ? "Typesetting" : "PDF"}
                </button>
                {/* Only on a dead entry.  Nothing is moved by this -- the
                    folder already moved, and this is where you tell the app
                    where it went -- so it is named for what the writer is
                    doing rather than for what it does to the registry. */}
                {project.missing && relocating !== project.path ? (
                  <button
                    className="h-[28px] rounded-[3px] border border-line px-2 t-meta text-ink-2 hover:text-ink"
                    data-testid="find-project"
                    onClick={() => {
                      setRowError(null);
                      setMovedTo("");
                      setRejoining(null);
                      setRelocating(project.path);
                    }}
                  >
                    Find it…
                  </button>
                ) : null}
                {/* The other way back for a shared project: the folder is
                    really gone, and the collaborators still have theirs.
                    Not offered to an install that was removed, which the
                    share panel explains once the copy is opened elsewhere;
                    a rejoin would only be refused after thirty seconds. */}
                {project.missing && project.shared && !project.removed
                  && rejoining !== project.path ? (
                  <button
                    className="h-[28px] rounded-[3px] border border-line px-2 t-meta text-ink-2 hover:text-ink"
                    data-testid="rejoin-project"
                    onClick={() => {
                      setRowError(null);
                      setRejoinTo(project.path);
                      setRelocating(null);
                      setRejoining(project.path);
                    }}
                  >
                    Rejoin from collaborators…
                  </button>
                ) : null}
                <button
                  className="h-[28px] rounded-[3px] px-2 t-meta text-ink-3 hover:bg-surface-3 hover:text-error"
                  onClick={() => setForgetting(project.path)}
                >
                  Remove
                </button>
              </div>
              </div>
              )}
            </div>
          ))}
        </div>
          ) : null}
        </div>
      </main>

      {/* Under the rail, after the list in the document: the nudge says
          "your projects", and the first thing on the screen that says
          Projects has to be the heading. */}
      <footer className="nx-projects-foot bg-surface">
        <Suspense fallback={null}>
          <UpdateFooter onBusy={setLocked} />
        </Suspense>
        <PasswordNudge />
      </footer>
      {drawer ? <div className="nx-scrim nx-ways-scrim" /> : null}
    </div>
  );
}

/** A question mark, at the cog's weight.
 *
 *  1.7px stroke at this size is what keeps the bowl open at 100% and the
 *  counter clear at 150%; the dot is filled rather than stroked, because a
 *  ring that small closes up into a blob. */
/** A nib, at the cog's weight.
 *
 *  Deliberately not the current provider's mark, which the floating agent
 *  button draws: that button opens the panel of the agent you have, and
 *  this one changes which agent you have. A control that wears Claude's
 *  mark and takes you to a screen offering ChatGPT and nothing is wearing
 *  the wrong thing.
 *
 *  A nib rather than a robot or a spark, for the reason the logo section
 *  gives about this app's own mark: what happens here is writing, and the
 *  only saturated colour in the chrome is the pen the agent writes with.
 */
function Nib() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 12.8 L6 12 L13 5 A1.6 1.6 0 0 0 11 3 L4 10 Z" />
      <path d="M4 10 L6 12" />
    </svg>
  );
}

/** The three tiles' marks, at the cog's weight: a plus for something
 *  new, a folder for one that exists, a link for one that is shared. */
function Plus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function Folder() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.5 1.6h5.5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

/** A tray with an arrow into it: something arriving. */
function Inbox() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v7M5.5 6.5 8 9l2.5-2.5M2.5 9.5v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5M2.5 9.5h3l1 1.5h3l1-1.5h3" />
    </svg>
  );
}

function Link() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M5.5 8 4.3 9.2a2.5 2.5 0 0 0 3.5 3.5L9 11.5" />
    </svg>
  );
}

function QuestionMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.3 5.9A2.75 2.75 0 1 1 8.6 9.0L8 9.9" />
      <circle cx="8" cy="12.6" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

function isOpened(answer: JoinOffer | JoinOpened): answer is JoinOpened {
  return (answer as JoinOpened).opened === true;
}
