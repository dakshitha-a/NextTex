import { lazy, Suspense, useEffect, useRef, useState } from "react";
import api, {
  saveBlob,
  startDownload,
  type JoinOffer,
  type ProjectSummary,
} from "../api";
import Logo from "../Logo";
import Settings from "./Settings";
import UpdateFooter from "./UpdateFooter";
import PasswordNudge from "./PasswordNudge";
import InstanceBadge from "./InstanceBadge";
import { agentName } from "../agent-name";
import { useStore } from "../store";

// Lazy, like the in-project tutorial: help text is not something a first
// visit should have to download before the project list appears.
const ScreenGuide = lazy(() => import("./tutorial/ScreenGuide"));

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
  const [guide, setGuide] = useState(false);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"add" | "create" | "join">("create");
  const [invite, setInvite] = useState("");
  /** What a peer is offering, before any of it is written. */
  const [offer, setOffer] = useState<JoinOffer | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  // Saying where a folder went, keyed by the entry's old path.  The error
  // belongs to the row rather than to the screen: the shared message at the
  // bottom sits under the create form, where it reads as a create error.
  const [relocating, setRelocating] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  // While an update is running the server is about to exit.  Opening a
  // project then means typing into a document whose server disappears
  // mid-save, so the screen stops offering it.
  const [locked, setLocked] = useState(false);
  // The strapline names whichever agent is configured, and says nothing
  // about one at all when the writer chose to work on their own.
  const provider = useStore((s) => s.agent?.provider);
  const tagline =
    provider === "none"
      ? "Write LaTeX beside the typeset page."
      : `Write LaTeX with ${agentName(provider)} beside the typeset page.`;
  const agentCopy =
    provider === "none"
      ? "A new project starts blank — one empty document, ready to write in."
      : `A new project starts blank — one empty document. Give ${agentName(provider)} your template or handbook afterwards and it will shape the project around it.`;

  const refresh = async () => {
    try {
      const result = await api.projects();
      setProjects(result.projects);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    if (!path.trim()) return;
    setError(null);
    try {
      if (mode === "join") {
        // Nothing is on disk yet. What comes back is the list of what the
        // other end is offering, and the decision is the next screen.
        setOffer(await api.joinShare(invite.trim(), path.trim()));
        return;
      }
      const project =
        mode === "create"
          ? await api.createProject(path.trim(), newName.trim())
          : await api.addProject(path.trim());
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
      saveBlob(await response.blob(), `${project.name}.pdf`);
    } catch (problem: any) {
      setError(`${project.name}: ${problem.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="nx-furniture flex h-full flex-col items-center justify-center overflow-auto bg-surround px-6 py-10">
      {/* A sheet, not a column of controls floating on the table.
          Everything else in this application is drawn as something lying on
          the proofing grey -- the typeset page, the panes, the cards -- and
          this screen was the one place that idea was dropped: a masthead, a
          form and a status line, centred in a field with nothing under them.
          At 1000px tall that is three hundred pixels of nothing above the
          first word. The sheet costs one class and makes the screen read as
          designed rather than as unfinished. */}
      <div className="my-auto w-full max-w-[680px] rounded-[5px] border border-line bg-surface px-7 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="t-display flex items-center gap-3">
              <Logo size={26} />
              NextTex
              <InstanceBadge />
            </h1>
            <p className="t-meta mt-1 text-ink-2">{tagline}</p>
          </div>
          <div className="relative flex shrink-0 items-center gap-3">
            {canClose ? (
              <button className="t-ui text-ink-2 hover:text-ink" onClick={onClose}>
                Back
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

        <div
          className={
            projects.length
              ? "mt-6 rounded-[3px] border border-line bg-surface-2"
              : "hidden"
          }
        >
          {projects.map((project) => (
            <div
              key={project.path}
              role={!project.missing && !locked ? "button" : undefined}
              tabIndex={!project.missing && !locked ? 0 : undefined}
              className={`group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${
                locked
                  ? "opacity-40"
                  : !project.missing
                    ? "cursor-pointer hover:bg-surface-2"
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
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!project.missing) onOpen(project.id);
              }}
            >
              <div className="min-w-0 flex-1">
                <span
                  className={`t-ui-lg block max-w-full truncate font-serif ${
                    project.missing ? "text-ink-3" : "text-ink group-hover:text-hint"
                  }`}
                >
                  {project.name}
                </span>
                <div className="t-code-sm truncate text-ink-3">{project.path}</div>
                {project.missing ? (
                  <div className="t-meta mt-1 text-warn">
                    This folder is no longer there.
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
                <div className="flex shrink-0 items-center gap-2">
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
                      await api.forgetProject(project.id);
                      refresh();
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
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-meta text-ink-2 hover:text-ink disabled:opacity-40"
                  disabled={locked || project.missing}
                  onClick={() =>
                    startDownload(api.downloadUrl(project.id, { format: "zip" }))
                  }
                >
                  Zip
                </button>
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-meta text-ink-2 hover:text-ink disabled:opacity-40"
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
                      setRelocating(project.path);
                    }}
                  >
                    Find it…
                  </button>
                ) : null}
                <button
                  className="h-[28px] rounded-[3px] px-2 t-meta text-ink-3 hover:text-error"
                  onClick={() => setForgetting(project.path)}
                >
                  Remove
                </button>
              </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          {(["create", "add", "join"] as const).map((option) => (
            <button
              key={option}
              className={`nx-hover t-ui border-b-2 pb-1 ${
                mode === option
                  ? "border-hint text-ink"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
              onClick={() => setMode(option)}
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
            : "Paste an invite somebody sent you. The whole project arrives here — the files and their history — and stays in step with everyone else's copy, including anything written while you were offline."}
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
        <div className={`mt-2 flex gap-2 ${mode === "join" ? "flex-col" : ""}`}>
          <input
            value={path}
            placeholder={
              mode === "create"
                ? "Where to put it, e.g. ~/writing/my-paper"
                : mode === "add"
                ? "/path/to/your/writing/project"
                : "An empty folder to put it in, e.g. ~/writing/their-paper"
            }
            // `flex-1` only where the row is a row.  Joining stacks this
            // under the invite box, and in a column `flex: 1 1 0%` is a
            // rule about *height*: the basis of 0 beat `h-[28px]` and the
            // field collapsed to the 17px of its own text, which is what
            // made one box tall and the other a slot.  The cross axis
            // stretches on its own, so the width needs nothing said.
            className={`t-code-sm h-[28px] rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3 ${
              mode === "join" ? "w-full" : "flex-1"
            }`}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <button
            className={`h-[28px] px-3 t-ui ${
              mode === "join" ? "pen-button self-start" : "ghost-button"
            }`}
            onClick={add}
          >
            {mode === "create"
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
          Nothing has been written yet. This is what would arrive in{" "}
          <span className="t-code-sm">{offer.path}</span>.
        </p>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {landing.map((file) => (
          <div
            key={file.path}
            className="flex items-baseline justify-between gap-3 px-3 py-[3px]"
          >
            <span className="t-code-sm truncate text-ink">{file.path}</span>
            <span className="t-micro shrink-0 text-ink-3">{size(file.size)}</span>
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

/** A size a person reads. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
