import { useEffect, useState } from "react";
import api, { startDownload, type Version } from "../api";
import { get, refreshHistory, set, useStore } from "../store";
import { Chevron } from "../chrome";
import { isRenderable, isText, isViewable } from "./file-kinds";
import { sizeOf } from "../size";

/** Whose version this is.
 *
 *  `by` is the role -- the person or their agent -- and `peer` is the
 *  install.  Both are needed: "you" on a shared project means you and not
 *  your collaborator, and their agent's edits have to read as theirs rather
 *  than as Claude in the abstract.
 *
 *  A version with no peer was written here, which is what every version made
 *  before a project was shared says, so an old history reads exactly as it
 *  did.
 */
export function who(version: Version, me: string): string {
  const mine = !version.peer || version.peer === me;
  if (mine) return version.by === "claude" ? "Claude" : "you";
  const them = version.who || `${version.peer!.slice(0, 6)}…`;
  return version.by === "claude" ? `${them}'s Claude` : them;
}

/** What this file used to say.
 *
 *  Versions are listed newest first and grouped by day, because "some time
 *  on Tuesday" is how people remember losing a paragraph. */
export default function History({
  onView,
  onOpen,
  onClose,
  docked,
}: {
  onView: (sha: string | null) => void;
  /** Bring a file to the front. Only the whole-project list needs it: a
   *  version belongs to a file, and reading one means being in that file. */
  onOpen: (path: string) => void | Promise<void>;
  onClose: () => void;
  /** Docked beside the editor when there is room; over it when there is not. */
  docked: boolean;
}) {
  const versions = useStore((s) => s.history);
  const failed = useStore((s) => s.historyFailed);
  const viewing = useStore((s) => s.viewing);
  const activePath = useStore((s) => s.activePath);
  const projectId = useStore((s) => s.projectId);
  const compile = useStore((s) => s.compile);
  const [labelling, setLabelling] = useState<string | null>(null);
  // A figure has no text to read, so selecting one of its versions opens
  // it in place here instead of parking the editor in a viewing mode that
  // would have nothing to show and nothing to diff.
  const [opened, setOpened] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Which question this panel is answering. "file" is what this file used
   *  to say; "project" is what I changed this afternoon, which was
   *  previously only answerable by opening every file in turn. */
  const [scope, setScope] = useState<"file" | "project">("file");
  const [timeline, setTimeline] = useState<(Version & { path: string })[]>([]);
  const [timelineFailed, setTimelineFailed] = useState(false);
  const [held, setHeld] = useState("");
  const binary = Boolean(activePath) && !isText(activePath!);
  const blobUrl = (sha: string, download = false) =>
    projectId && activePath
      ? api.historyBlobUrl(projectId, activePath, sha, download)
      : "";

  useEffect(() => {
    if (projectId && activePath) refreshHistory(projectId, activePath);
  }, [projectId, activePath, compile]);

  // What the whole history costs on disk. Read with the panel and again
  // after a build, which is when it can have grown.
  useEffect(() => {
    if (!projectId) return;
    let dropped = false;
    api
      .historySize(projectId)
      .then((answer) => !dropped && setHeld(sizeOf(answer.bytes)))
      .catch(() => !dropped && setHeld(""));
    return () => {
      dropped = true;
    };
  }, [projectId, compile]);

  // Read on the way into the whole-project view and again after a build,
  // which is the same trigger the per-file list uses: a build is the point
  // at which a session's typing has become versions.
  useEffect(() => {
    if (scope !== "project" || !projectId) return;
    let dropped = false;
    api
      .timeline(projectId)
      .then((answer) => {
        if (dropped) return;
        setTimeline(answer.versions);
        setTimelineFailed(false);
      })
      .catch(() => {
        if (!dropped) setTimelineFailed(true);
      });
    return () => {
      dropped = true;
    };
  }, [scope, projectId, compile]);

  /** What the list is showing. Both shapes are versions; the project one
   *  carries the file each belongs to, which is the only difference. */
  const rows: (Version & { path?: string })[] =
    scope === "project" ? timeline : versions;
  const name = activePath?.split("/").pop() ?? "";
  // Which install this is, so a version can say "you" rather than a name.
  const me = useStore((s) => s.peerId);

  const choose = async (version: Version & { path?: string }, selected: boolean) => {
    const sha = version.sha;
    // A row in the whole-project list belongs to a file that may not be
    // the one on screen. Reading it means being in that file, so the file
    // comes to the front and the panel goes back to answering the
    // per-file question, which is the one it can answer from there.
    if (scope === "project" && version.path && version.path !== activePath) {
      await onOpen(version.path);
      setScope("file");
      if (projectId) await refreshHistory(projectId, version.path);
    }
    // Two versions of a file open in two different places, and which of
    // them applies is a question about the file rather than the version.
    //
    // A picture or a PDF opens in the pane that shows the file, at the size
    // the writer chooses, with the same zoom and the same page controls as
    // the current one.  Judging a figure is the whole reason to open an old
    // one, and a 180px thumbnail inside a 264px panel is not judging it --
    // and a PDF figure, which is the format figures are kept in precisely
    // because it scales, had no preview here at all.
    //
    // What still opens in place is a version this machine does not hold,
    // which has nothing to show anywhere, and a file neither viewer can
    // draw, where the honest offer is the download.
    const shown = Boolean(activePath) && isViewable(activePath!);
    if (version.here === false || (binary && !shown)) {
      setConfirming(null);
      setOpened((current) => (current === sha ? null : sha));
      return;
    }
    onView(selected ? null : sha);
  };

  const restore = async (sha: string) => {
    const projectId = get().projectId;
    if (!projectId || !activePath) return;
    try {
      await api.restoreVersion(projectId, activePath, sha);
      setConfirming(null);
      setOpened(null);
      refreshHistory(projectId, activePath);
      // The pane showing the file is keyed on this, so the restored figure
      // appears rather than the browser's cached copy of the old one.
      set({ pdfStamp: Date.now() });
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  return (
    <div
      className={
        docked
          ? "nx-arrive flex h-full w-[264px] shrink-0 flex-col border-l border-line bg-surface-2"
          : "nx-arrive absolute right-0 top-0 z-20 flex h-full w-[264px] flex-col border-l border-line bg-surface-2 shadow-float"
      }
    >
      <div
        className="flex h-[32px] shrink-0 cursor-pointer items-center justify-between border-b border-line bg-surface-3 px-[10px] transition-colors duration-[90ms] hover:bg-surface"
        title="Close the history"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="t-ui-lg font-serif">History</span>
          {/* The same two-way micro toggle the preview footer uses for
              Scroll and Page. Two questions, not two panels: what this
              file used to say, and what I changed this afternoon. The
              second was answerable only by opening every file in turn. */}
          <span
            className="flex shrink-0 self-center overflow-hidden rounded-[3px] border border-line"
            onClick={(event) => event.stopPropagation()}
          >
            {(["file", "project"] as const).map((option) => (
              <button
                key={option}
                className={`t-micro border-b-2 px-2 py-[1px] transition-colors duration-[90ms] ${
                  scope === option
                    ? "border-hint bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:text-hint"
                }`}
                onClick={() => setScope(option)}
                title={
                  option === "file"
                    ? "Versions of the file in the editor"
                    : "Every file's versions, newest first"
                }
              >
                {option === "file" ? "This file" : "Whole project"}
              </button>
            ))}
          </span>
          {scope === "file" && name ? (
            <span className="t-meta truncate text-ink-3">{name}</span>
          ) : null}
          {/* What the project's history is holding, before anybody decides
              whether to empty it. `/history/size` has had a client wrapper
              and no caller since it was written. */}
          {held ? (
            <span className="t-micro shrink-0 text-ink-3" data-testid="history-size">
              {held}
            </span>
          ) : null}
        </span>
        <button className="quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px]" aria-label="Close the history" onClick={onClose}>
          <Chevron direction="right" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && (scope === "file" ? failed : timelineFailed) ? (
          <p className="t-meta p-3 text-ink-3" data-testid="history-unavailable">
            {scope === "file"
              ? "Could not read the versions of this file. Nothing has been lost; this is about reaching the server, not about the file."
              : "Could not read the project's versions. Nothing has been lost; this is about reaching the server."}
          </p>
        ) : null}
        {rows.length === 0 && !(scope === "file" ? failed : timelineFailed) ? (
          <p className="t-meta p-3 text-ink-3">
            {scope === "project"
              ? "Nothing yet in this project. Versions are kept from the moment a file is first changed."
              : binary
                ? `Nothing yet for ${name}. Versions are kept from the moment it is first replaced.`
                : `Nothing yet for ${name || "this file"}. Versions are kept from the moment you first change it.`}
          </p>
        ) : null}
        {rows.map((version, index) => {
          const day = dayOf(version.at);
          const first = index === 0 || dayOf(rows[index - 1].at) !== day;
          const selected = viewing?.sha === version.sha;
          // Listed, and not on this disk. A collaborator's version arrives
          // as a line and its contents come when somebody asks for them.
          const elsewhere = version.here === false;
          // Whose file this row is about. In the per-file list that is
          // always the file on screen; in the project list it is whatever
          // the row says, and the thumbnail and the extension have to
          // follow the row rather than the editor.
          const rowPath = version.path ?? activePath ?? "";
          const rowBinary = Boolean(rowPath) && !isText(rowPath);
          return (
            <div key={`${version.sha}-${version.at}`}>
              {first ? (
                <div className="t-micro sticky top-0 bg-surface px-[10px] py-1 text-ink-3">
                  {day}
                </div>
              ) : null}
              {/* A plain div with a click handler, not `role="button"`.
                  The role turned the row into a widget with a naming
                  input and a row menu inside it, which is the axe rule
                  `nested-interactive`, impact serious: assistive
                  technology is told the row is one button and the
                  controls in it are folded into its name or unreachable.
                  Without the role it is a clickable region, and the
                  keyboard route is the real button below, which carries
                  the row's name. The keydown guard that used to be here,
                  ignoring keys aimed at children, was the same problem
                  seen from the inside: every space typed into a name was
                  swallowed by the row's own Space handler and toggled the
                  version on the way past. Real controls do not need it. */}
              <div
                data-testid="version"
                data-sha={version.sha}
                data-by={version.by}
                className={`group relative flex cursor-pointer flex-col gap-[2px] px-[10px] py-[6px] ${
                  selected ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
                onClick={() => choose(version, selected)}
              >
                {/* The keyboard's way in, and the row's accessible name.
                    `pointer-events-none` so a click is the row's, once:
                    the row above already answers the pointer, and a
                    button stacked over it would answer the same press a
                    second time and toggle the version straight back. */}
                <button
                  className="pointer-events-none absolute inset-0"
                  aria-label={`Version from ${who(version, me)} at ${timeOf(version.at)}`}
                  onClick={() => choose(version, selected)}
                />
                {selected ? (
                  <span className="absolute left-0 top-0 z-10 h-full w-[2px] bg-pen" />
                ) : null}
                <div className="relative z-10 flex flex-col gap-[2px]">
                <div className="flex items-baseline gap-2">
                  {rowBinary ? (
                    <span
                      aria-hidden
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center self-center overflow-hidden rounded-[3px] bg-surface-3"
                    >
                      {isRenderable(rowPath) && !elsewhere ? (
                        <img
                          src={blobUrl(version.sha)}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="nx-mono-11 text-ink-3">
                          {rowPath.split(".").pop()?.slice(0, 3)}
                        </span>
                      )}
                    </span>
                  ) : null}
                  <span className="t-micro tnum text-ink">{timeOf(version.at)}</span>
                  <span
                    className={`t-micro ${
                      version.by === "claude" ? "text-pen" : "text-ink-3"
                    }`}
                  >
                    {who(version, me)}
                  </span>
                  <span className="flex-1" />
                  {/* The naming control takes the size's place on hover
                      rather than sitting on top of it. */}
                  <span
                    className="t-micro tnum text-ink-3 group-hover:hidden"
                    title={
                      elsewhere
                        ? "Only a collaborator has this one"
                        : undefined
                    }
                  >
                    {elsewhere ? "elsewhere" : size(version.bytes)}
                  </span>
                  <button
                    className="quiet t-micro hidden group-hover:block"
                    title="Name this version so it is never thinned away"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLabelling(version.sha);
                    }}
                  >
                    {version.label ? "Rename" : "Name it"}
                  </button>
                </div>
                {scope === "project" ? (
                  <span
                    className="t-micro truncate text-ink-3"
                    data-testid="history-scope-path"
                  >
                    {version.path}
                  </span>
                ) : null}
                {version.label ? (
                  <span className="t-meta text-ink">{version.label}</span>
                ) : version.why ? (
                  <span className="t-micro truncate text-ink-2">{version.why}</span>
                ) : null}
                {elsewhere && opened === version.sha ? (
                  <div className="mt-2" data-testid="version-elsewhere">
                    <span className="t-micro text-ink-2">
                      Only a collaborator has this one. It arrives when they
                      are next online.
                    </span>
                  </div>
                ) : null}
                {binary && !elsewhere && opened === version.sha ? (
                  <div className="mt-2" data-testid="version-open">
                    {/* No thumbnail here any more.  A file that reaches this
                        branch is one neither viewer can draw, so there was
                        never a picture to show; the ones that can be drawn
                        now open in the pane. */}
                    <div className="flex items-center gap-3">
                      {confirming === version.sha ? (
                        <>
                          <span className="t-micro text-ink-2">
                            Replace the file with this?
                          </span>
                          <button
                            className="quiet t-micro"
                            data-tone="danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              void restore(version.sha);
                            }}
                          >
                            Restore
                          </button>
                          <button
                            className="quiet t-micro"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirming(null);
                            }}
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          className="quiet t-micro"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirming(version.sha);
                          }}
                        >
                          Restore this
                        </button>
                      )}
                      <button
                        className="quiet t-micro"
                        onClick={(event) => {
                          event.stopPropagation();
                          startDownload(blobUrl(version.sha, true));
                        }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ) : null}
                {labelling === version.sha ? (
                  <input
                    autoFocus
                    defaultValue={version.label ?? ""}
                    placeholder="Name this version"
                    className="t-micro mt-1 w-full border-b border-pen bg-transparent outline-none"
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setLabelling(null)}
                    onKeyDown={async (event) => {
                      if (event.key === "Escape") setLabelling(null);
                      if (event.key !== "Enter") return;
                      const value = event.currentTarget.value.trim();
                      setLabelling(null);
                      const id = get().projectId;
                      if (!id || !activePath) return;
                      // A name that did not stick used to say nothing at
                      // all: the input closed on Enter whatever happened,
                      // and the refusal was an unhandled rejection.
                      try {
                        await api.labelVersion(id, activePath, version.sha, value);
                      } catch (error: any) {
                        set({ error: error.message });
                      }
                      refreshHistory(id, activePath);
                    }}
                  />
                ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The strip that says you are not looking at now.
 *
 *  It has to be unmistakably not the tab bar: read-only, historical text
 *  in the editor is the single most consequential state this app has, and
 *  announcing it in the same fill as more toolbar is how somebody types
 *  into last Tuesday and wonders why nothing happens. */
export function ViewingBanner({
  version,
  onRestore,
  onBack,
  onToggleChanges,
  showingChanges,
  onDownload,
}: {
  version: Version;
  onRestore: () => void;
  onBack: () => void;
  onToggleChanges: () => void;
  showingChanges: boolean;
  /** Present when what is being viewed is a figure rather than text.
   *
   *  Two things follow from it, and they are the same fact twice: there is
   *  no diff to show, so the toggle that offers one goes; and the panel's
   *  own download button went with the thumbnail it sat under, so it comes
   *  back here, where the version it applies to is the one on screen. */
  onDownload?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const me = useStore((s) => s.peerId);

  // Escape leaves, as it does everywhere else in the app.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === "TEXTAREA" || active?.tagName === "INPUT") return;
      onBack();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onBack]);

  return (
    <div
      className={`nx-arrive flex h-[26px] shrink-0 items-center gap-3 border-b border-line px-[10px] ${
        version.by === "claude" ? "bg-pen-wash" : "bg-hint-wash"
      }`}
      style={{ boxShadow: "inset 0 2px 0 var(--hint)" }}
    >
      <span className="t-micro text-ink">
        Viewing {timeOf(version.at)}
      </span>
      <Rule />
      <span className="t-micro text-ink-2">{who(version, me)}</span>
      {version.label || version.why ? (
        <>
          <Rule />
          <span className="t-micro min-w-0 flex-1 truncate text-ink-2">
            {version.label || version.why}
          </span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {onDownload ? (
        <button className="quiet t-micro" onClick={onDownload}>
          Download
        </button>
      ) : (
        <button className="quiet t-micro" onClick={onToggleChanges}>
          {showingChanges ? "Hide what's gone" : "Show what's gone"}
        </button>
      )}
      <Rule />
      {confirming ? (
        <>
          <span className="t-micro text-ink-2">Replace the file with this?</span>
          <button
            className="quiet t-micro"
            data-tone="danger"
            onClick={() => {
              setConfirming(false);
              onRestore();
            }}
          >
            Restore
          </button>
          <button className="quiet t-micro" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <button className="quiet t-micro" onClick={() => setConfirming(true)}>
          Restore this
        </button>
      )}
      <Rule />
      <button className="quiet t-micro" data-tone="on" onClick={onBack}>
        Back to now
      </button>
    </div>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// Moved to `../size`, where the file tree and this panel can share one
// answer: two formatters would round the same number two ways.
const size = sizeOf;

