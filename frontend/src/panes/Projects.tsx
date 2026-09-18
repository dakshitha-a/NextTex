import { lazy, Suspense, useEffect, useRef, useState } from "react";
import api, {
  saveBlob,
  startDownload,
  type JoinOffer,
  type JoinOpened,
  type OfferedFile,
  type ProjectSummary,
} from "../api";
import Logo from "../Logo";
import Settings from "./Settings";
import UpdateFooter from "./UpdateFooter";
import PasswordNudge from "./PasswordNudge";
import InstanceBadge from "./InstanceBadge";
import { agentName } from "../agent-name";
import { set, useStore } from "../store";
import { openedWords, rowAfterKey, rowMarks, shortPath } from "../project-row";
import { tabStopFor } from "../tree";
import { LONG_LIST, matches } from "../project-filter";

// Lazy, like the in-project tutorial: help text is not something a first
// visit should have to download before the project list appears.
const ScreenGuide = lazy(() => import("./tutorial/ScreenGuide"));

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
  /** What is typed into the filter a long list gets. */
  const [query, setQuery] = useState("");
  const filterBox = useRef<HTMLInputElement | null>(null);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"add" | "create" | "join">("create");
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
    } catch (problem: any) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // A long list has a filter, and `/` reaches it from anywhere on the
  // screen that is not already a field, the way it does in a browser's
  // own find and on most sites with a list worth searching.
  const long = projects.length >= LONG_LIST;
  useEffect(() => {
    if (!long) return;
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
  }, [long]);
  const shown = long ? projects.filter((project) => matches(project, query)) : projects;
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
    } catch (problem: any) {
      setRowError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const takePdf = async (project: ProjectSummary) => {
    setBusy(project.id);
    setError(null);
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
      setError(`${project.name}: ${problem.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="nx-furniture flex h-full flex-col items-center overflow-auto bg-surround px-6 py-10">
      {/* A sheet, not a column of controls floating on the table.
          Everything else in this application is drawn as something lying on
          the proofing grey -- the typeset page, the panes, the cards -- and
          this screen was the one place that idea was dropped: a masthead, a
          form and a status line, centred in a field with nothing under them.
          At 1000px tall that is three hundred pixels of nothing above the
          first word. The sheet costs one class and makes the screen read as
          designed rather than as unfinished.

          Centred by its own `my-auto`, and deliberately not by
          `justify-center` on the column. Auto margins take the free space
          when there is some and collapse to nothing when there is none;
          `justify-center` centres either way, and a sheet taller than the
          window then overflows upward into a region no scroll position
          reaches. At about nine projects on a 1000px screen the masthead,
          the cog, help and Back were all above the top with no way to
          them. */}
      <div
        className="nx-sheet my-auto w-full max-w-[680px] rounded-[5px] border border-line bg-surface px-7 py-6"
        // Six projects or more, and on a window 960px or wider the sheet
        // widens and the ways in stand beside the list rather than under
        // it (styles.css, `.nx-sheet[data-long]`).  With five or fewer the
        // sheet is the one it always was: a second column beside one row
        // is a column beside nothing.
        data-long={long ? "" : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="t-display flex items-center gap-3">
              <Logo size={26} />
              NextTex
              <InstanceBadge />
            </h1>
            <p className="t-meta mt-1 text-ink-2">{tagline}</p>
            {/* The only way to an agent used to be a settings row that
                described the writer's situation rather than naming the
                control, so somebody who had chosen "no agent" at install
                time had nothing on this screen telling them it was a
                decision they could revisit.  One line, under the strapline
                that stops mentioning an agent at all in that case. */}

          </div>
          <div className="relative flex shrink-0 items-center gap-3">
            {canClose ? (
              <button className="t-ui text-ink-2 hover:text-ink" onClick={onClose}>
                Back
              </button>
            ) : null}
            {/* Understand, adjust, then change what is writing with you:
                three controls in the cog's own chrome so they read as a set.
                The agent one used to be a text link under the strapline,
                shown only when there was no agent at all, so somebody on
                one provider who wanted the other had to find it inside the
                settings sheet. It says which agent it is rather than only
                that there is one, because that is the question somebody
                opening it has. */}
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
            {/* Understand, then adjust: help sits left of the cog, and wears
                the cog's own chrome so the two read as a pair. */}
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
        </div>

        {lost ? (
          <div
            role="status"
            data-testid="folder-lost"
            className="mt-6 flex items-start gap-3 rounded-[3px] border border-line bg-surface-2 px-4 py-3"
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
        <div className="nx-sheet-body">
        {/* Not rendered rather than hidden when there is nothing to list:
            the specs wait for the first thing on the screen that says
            "Projects", and a hidden heading is a first thing that never
            shows. */}
        {projects.length ? (
        <div className="min-w-0">
          {/* A heading, which is also what every spec waits for on this
              screen, and the count; a long list gets its filter here. */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="t-meta text-ink-2">Projects</span>
              <span className="t-micro text-ink-3" data-testid="project-count">
                {projects.length}
              </span>
            </div>
            {long ? (
              <input
                ref={filterBox}
                value={query}
                placeholder="Find a project"
                aria-label="Find a project"
                data-testid="project-filter"
                className="t-ui h-[28px] min-w-0 flex-1 max-w-[220px] rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Escape clears, then leaves; Enter opens the first
                  // row still showing, which is what typing a name and
                  // pressing Enter means.
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
            ) : null}
          </div>
        <div className="mt-2 rounded-[3px] border border-line bg-surface-2">
          {long && !shown.length ? (
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
                        setError(`${project.name}: ${problem.message}`);
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
                    startDownload(api.downloadUrl(project.id, { format: "zip" }))
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
        </div>
        ) : null}

        {/* The ways in.  Beside the list when the list is long and the
            window wide, and then sticky, so starting something does not
            mean scrolling past everything already started. */}
        <div className="nx-ways min-w-0">
        <div className="nx-ways-tabs mt-6 flex gap-3">
          {(["create", "add", "join"] as const).map((option) => (
            <button
              key={option}
              aria-pressed={mode === option}
              className={`nx-ways-tab nx-hover t-ui border-b-2 pb-1 ${
                mode === option
                  ? "border-hint text-ink"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
              // The message under this form belongs to whichever of the
              // three the writer was last doing.  Carried across, it reads
              // as an error about the tab they have just moved to.
              onClick={() => {
                setError(null);
                setMode(option);
              }}
            >
              {option === "create"
                ? "Start something new"
                : option === "add"
                ? "Point at a folder"
                : "Join a shared project"}
            </button>
          ))}
        </div>
        <p className="t-ui mt-2 text-ink-2">
          {mode === "create"
            ? agentCopy
            : mode === "add"
            ? "Point NextTex at a folder that already contains a LaTeX document. Nothing is copied or moved."
            : "Paste an invite somebody sent you. The whole project arrives here, the files and their history both, and stays in step with everyone else's copy, including anything written while you were offline."}
        </p>
        {mode === "create" ? (
          <input
            value={newName}
            placeholder="What is it called?"
            className="t-ui mt-3 h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setNewName(event.target.value)}
          />
        ) : null}
        {mode === "join" ? (
          <textarea
            value={invite}
            rows={3}
            placeholder="Paste the invite here"
            aria-label="The invite you were sent"
            data-testid="invite-input"
            className="t-code-sm mt-3 w-full resize-none rounded-[3px] border border-line bg-surface px-2 py-1 outline-none placeholder:text-ink-3"
            onChange={(event) => setInvite(event.target.value)}
          />
        ) : null}
        {/* Wrapping, so on a phone the button drops under the folder field
            rather than running off the right of the sheet, which it did. */}
        <div className={`nx-ways-fields mt-2 flex flex-wrap gap-2 ${mode === "join" ? "flex-col" : ""}`}>
          <input
            value={path}
            placeholder={
              mode === "create"
                ? "Where to put it, e.g. ~/writing/my-paper"
                : mode === "add"
                ? "/path/to/your/writing/project"
                : "A folder to put it in, e.g. ~/writing/their-paper"
            }
            // `flex-1` only where the row is a row.  Joining stacks this
            // under the invite box, and in a column `flex: 1 1 0%` is a
            // rule about *height*: the basis of 0 beat `h-[28px]` and the
            // field collapsed to the 17px of its own text, which is what
            // made one box tall and the other a slot.  The cross axis
            // stretches on its own, so the width needs nothing said.
            className={`t-code-sm h-[28px] rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3 ${
              mode === "join" ? "w-full" : "min-w-[200px] flex-1"
            }`}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          {mode === "create" && templates.length > 1 ? (
            /* Hidden when there is only one, which is what an install with
               its templates trimmed looks like: a chooser offering a single
               choice is a control that asks a question with one answer. */
            <select
              value={template}
              aria-label="What to start from"
              data-testid="template-choice"
              className="t-ui h-[28px] shrink-0 rounded-[3px] border border-line bg-surface px-2 text-ink outline-none"
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
            className={`h-[28px] px-3 t-ui ${
              mode === "join" ? "pen-button self-start" : "ghost-button"
            }`}
            onClick={add}
            disabled={busy === "add"}
          >
            {busy === "add" && mode === "join"
              ? "Joining…"
              : mode === "create"
              ? "Create project"
              : mode === "add"
              ? "Open folder"
              : "Join"}
          </button>
        </div>
        {offer ? <JoinOfferCard
          offer={offer}
          onAccept={acceptOffer}
          onDiscard={discardOffer}
        /> : null}
        {error ? <p className="t-meta mt-3 text-error">{error}</p> : null}
        </div>
        </div>
        <PasswordNudge />
        <UpdateFooter onBusy={setLocked} />
      </div>
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


/** What a peer is offering, before a byte of it is written.
 *
 *  Accepting an invite is downloading somebody else's files, and until this
 *  existed the first moment anybody could look at what they had accepted was
 *  after all of it was on their disk. The documents are held open on the
 *  server while this is on screen, so discarding really does leave nothing
 *  behind rather than deleting something that was written a moment ago.
 */
function JoinOfferCard({
  offer,
  onAccept,
  onDiscard,
}: {
  offer: JoinOffer;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const landing = offer.files.filter((file) => !file.refused);
  const refused = offer.files.filter((file) => file.refused);
  const total = landing.reduce((sum, file) => sum + file.size, 0);

  return (
    <div
      className="mt-3 rounded-[3px] border border-line bg-surface"
      data-testid="join-offer"
    >
      <div className="border-b border-line px-3 py-2">
        <p className="t-ui text-ink">
          {landing.length} {landing.length === 1 ? "file" : "files"}, {size(total)}
        </p>
        <p className="t-meta mt-[2px] text-ink-2">
          {offer.existing ? (
            <>
              Nothing has been written yet. <span className="t-code-sm">{offer.path}</span>{" "}
              already has files, and this is what accepting would do to each.
              The shared project wins where they disagree; nothing of yours is
              lost, it goes to the file's history or to the trash.
            </>
          ) : (
            <>
              Nothing has been written yet. This is what would arrive in{" "}
              <span className="t-code-sm">{offer.path}</span>.
            </>
          )}
        </p>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {landing.map((file) => (
          <div
            key={file.path}
            className="flex items-baseline justify-between gap-3 px-3 py-[3px]"
            data-outcome={offer.existing ? file.outcome : undefined}
          >
            <span className="t-code-sm truncate text-ink">{file.path}</span>
            <span className="t-micro shrink-0 text-ink-3">
              {offer.existing ? (
                <>
                  <span className={file.outcome === "same" || file.outcome === "behind" ? "" : "text-ink-2"}>
                    {outcomeWords(file.outcome)}
                  </span>
                  {" · "}
                </>
              ) : null}
              {size(file.size)}
            </span>
          </div>
        ))}
      </div>
      {refused.length ? (
        <div className="border-t border-line px-3 py-2">
          <p className="t-meta text-ink-2">
            {refused.length}{" "}
            {refused.length === 1 ? "file was offered" : "files were offered"}{" "}
            that NextTex will not write, because the build would run{" "}
            {refused.length === 1 ? "it" : "them"}:{" "}
            <span className="t-code-sm">
              {refused.map((file) => file.path).join(", ")}
            </span>
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <button
          className="ghost-button h-[26px] px-3 t-ui"
          data-testid="discard-join"
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="pen-button h-[26px] px-3 t-ui"
          data-testid="accept-join"
          onClick={onAccept}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

function isOpened(answer: JoinOffer | JoinOpened): answer is JoinOpened {
  return (answer as JoinOpened).opened === true;
}

/** What accepting does to a file of a folder that already had files, in
 *  the words of the person whose files they are. */
function outcomeWords(outcome: OfferedFile["outcome"]): string {
  switch (outcome) {
    case "same":
      return "same as yours";
    case "differs":
      return "replaces yours; yours kept in its history";
    case "behind":
      return "newer than yours; replaces it, git has yours";
    case "merged":
      return "your edits merged in; goes to everybody";
    case "new here":
      return "only here; goes to everybody";
    case "deleted elsewhere":
      return "deleted by the others; yours goes to the trash";
    default:
      return "new from the others";
  }
}

/** A size a person reads. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
