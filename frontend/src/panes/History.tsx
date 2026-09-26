import { useEffect, useRef, useState } from "react";
import api, { type Version } from "../api";
import { get, refreshHistory, set, useStore } from "../store";
import { download } from "../chrome";
import { Button, IconButton } from "../ui/Button";
import { Input, Pressable, Segmented } from "../ui/controls";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons";
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
  // A change somebody made to the file on disk, outside NextTex: another
  // editor, a pull, another agent. Nobody here typed it, so it is the
  // disk's, and whose disk when it was a collaborator's.
  if (version.by === "outside") {
    return mine ? "On disk" : `On ${version.who || `${version.peer!.slice(0, 6)}…`}'s disk`;
  }
  if (mine) return version.by === "claude" ? "Claude" : "you";
  const them = version.who || `${version.peer!.slice(0, 6)}…`;
  return version.by === "claude" ? `${them}'s Claude` : them;
}

/** The author's ink: the agent's pen, the disk in the second ink, since
 *  nobody here wrote it, and a person in the first. */
export function whoInk(version: Version): string {
  return version.by === "claude" ? "text-pen" : version.by === "outside" ? "text-ink-2" : "text-ink";
}

/** What this file used to say.
 *
 *  Versions are listed newest first and grouped by day, because "some time
 *  on Tuesday" is how people remember losing a paragraph. */
export default function History({
  onView,
  onOpen,
  onCompare,
  onClose,
  docked,
}: {
  onView: (sha: string | null) => void;
  /** Show the patch between the version being viewed and this one.
   *  Offered on every other row of the same file while a version is on
   *  screen, because a version on screen is the only thing there is to
   *  compare against. */
  onCompare?: (version: Version) => void;
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
  // Whether the list has had its first answer, per scope: an empty list
  // before it means nothing is known yet, not "Nothing yet", and the
  // sentence is drawn only once it is true.
  const [fileKnown, setFileKnown] = useState(false);
  const [timelineKnown, setTimelineKnown] = useState(false);
  const [held, setHeld] = useState("");
  /** Which folded row, by its stamp, is showing the files it holds. */
  const [unfolded, setUnfolded] = useState<string | null>(null);
  const binary = Boolean(activePath) && !isText(activePath!);
  const blobUrl = (sha: string, download = false) =>
    projectId && activePath
      ? api.historyBlobUrl(projectId, activePath, sha, download)
      : "";

  // A new file is unknown until its first answer; a build on the same
  // file keeps what is known while the list is read again.
  useEffect(() => {
    setFileKnown(false);
  }, [projectId, activePath]);
  useEffect(() => {
    if (!projectId || !activePath) return;
    let dropped = false;
    void refreshHistory(projectId, activePath).then(() => {
      if (!dropped) setFileKnown(true);
    });
    return () => {
      dropped = true;
    };
  }, [projectId, activePath, compile]);

  // And whenever the server says a file's log gained a version.  A build
  // was the only trigger, which is right for a `.tex` and nothing else:
  // a `.md` typed into never builds, so its versions were recorded and
  // the panel went on showing the list from when it opened.  The size
  // and the timeline follow the same event, since both can have grown.
  const changed = useStore((s) => s.historyChanged);
  const [grown, setGrown] = useState(0);
  useEffect(() => {
    if (!changed || !projectId) return;
    if (activePath && changed.paths.includes(activePath)) {
      refreshHistory(projectId, activePath);
    }
    setGrown(changed.at);
  }, [changed]);

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
  }, [projectId, compile, grown]);

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
      })
      .finally(() => {
        if (!dropped) setTimelineKnown(true);
      });
    return () => {
      dropped = true;
    };
  }, [scope, projectId, compile, grown]);

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

  // The keyboard arrives with the panel.  Opened from the status strip or
  // the tree's row menu, the panel took focus nowhere, so Escape and Tab
  // did nothing until somebody clicked into it; the design record has said
  // since the agent shortcut landed that this panel owns Escape while it
  // is open, and for a long time only the banner did.
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-testid="history-panel"
      // On the second surface with no rule at its edge: the step of tone
      // is the separation, as the page draws every drawer.  The bar and
      // the one drawer come with the activity bar; until then the panel
      // keeps its dock beside the editor and its overlay over it.
      className={`outline-none ${
        docked
          ? "nx-arrive flex h-full w-full min-w-0 shrink-0 flex-col bg-surface-2"
          : "nx-arrive absolute right-0 top-0 z-20 flex h-full w-66 flex-col bg-surface-2 shadow-float"
      }`}
      onKeyDown={(event) => {
        // Escape leaves one level at a time, the way it does on the agent
        // screen: a version being viewed goes back to now first, which the
        // banner's own listener answers, and the next press closes the
        // panel.  The naming input stops its own Escape before it gets
        // here, so cancelling a name does not close anything.
        if (event.key !== "Escape" || viewing) return;
        event.preventDefault();
        onClose();
      }}
    >
      {/* Two rows.  The first version put the title, the scope toggle,
          the file name, the size and the close chevron in one 32px row,
          and everything but the name was shrink-0: about 300px of it in a
          264px panel, so the name was squeezed to nothing and the chevron
          was drawn over the size.  The first row is the handle: the
          title, the file, and the one control that closes it.  The
          second is a toolbar, which is a different kind of thing and does
          not close on a click. */}
      {/* The drawer's heading row, as the page draws every drawer: the
          title, the file it is about in the third ink, and the one
          control that closes it.  The row is the handle. */}
      <div
        className="flex shrink-0 cursor-pointer items-center gap-2 pb-1.5 pl-3.5 pr-2 pt-2.5"
        title="Close the history"
        data-testid="history-header"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        <span className="t-ui-lg shrink-0 text-ink">History</span>
        {scope === "file" && name ? (
          <span className="t-meta min-w-0 flex-1 truncate text-ink-3" title={activePath ?? undefined}>
            {name}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <IconButton label="Close the history" onClick={onClose}>
          <ChevronRightIcon />
        </IconButton>
      </div>
      <div
        className="flex h-8 shrink-0 items-center justify-between px-2"
        data-testid="history-toolbar"
      >
        {/* Two questions, not two panels: what this file used to say, and
            what I changed this afternoon.  The second was answerable only
            by opening every file in turn. */}
        <Segmented
          tone="drawer"
          label="Which versions"
          value={scope}
          options={[
            { value: "file", label: "This file", title: "Versions of the file in the editor" },
            { value: "project", label: "Whole project", title: "Every file's versions, newest first" },
          ]}
          onChange={setScope}
        />
        {/* What the project's history is holding, before anybody decides
            whether to empty it. */}
        {held ? (
          <span
            className="t-meta shrink-0 pr-2 text-ink-3"
            data-testid="history-size"
            title="What this project's history holds on disk"
          >
            {held} kept
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2">
        {rows.length === 0 && (scope === "file" ? failed : timelineFailed) ? (
          <p className="t-meta p-2 text-ink-2" data-testid="history-unavailable">
            {scope === "file"
              ? "Could not read the versions of this file. Nothing has been lost; this is about reaching the server, not about the file."
              : "Could not read the project's versions. Nothing has been lost; this is about reaching the server."}
          </p>
        ) : null}
        {rows.length === 0 && (scope === "file" ? fileKnown && !failed : timelineKnown && !timelineFailed) ? (
          <p className="t-meta p-2 text-ink-2">
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
          // A tick's row stands for several files, so the controls that
          // belong to one version, naming and comparing, are not drawn on
          // it; they are reached through the file's own list.
          const folded = scope === "project" && (version.count ?? 1) > 1;
          // A row that has been chosen, by viewing its version or by
          // opening a figure's in place.  Its controls are drawn without
          // a pointer over it: hover is the only way they appeared, and a
          // finger has no hover, nor does a keyboard.  Focus inside the
          // row shows them too, for the same reason.
          const lit = selected || opened === version.sha;
          const reveal = lit
            ? "flex"
            : "hidden group-hover:flex group-focus-within:flex";
          return (
            <div key={`${version.sha}-${version.at}`}>
              {first ? (
                <div className="t-meta sticky top-0 bg-surface-2 px-2 pb-0.5 pt-2.5 text-ink-3">
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
                // `bg-surface`, not `bg-surface-2`: the panel's own ground
                // is surface-2, so a hover or a selection drawn in it was
                // invisible and the pen bar was all that marked the row.
                // The file tree draws the same rule one step off its own
                // ground, which is what this is.
                // As the page draws a version: the time in the third ink,
                // who in the first (the pen for Claude), the size at the
                // right giving way to Compare and Rename under the pointer,
                // and the reason or the name as a second line.  The chosen
                // row and the hovered row take the wash.
                className={`group relative flex cursor-pointer flex-col gap-0.5 rounded-control px-2 py-1.25 text-compact leading-4.5 text-ink-2 hover:bg-wash ${
                  lit ? "bg-wash" : ""
                }`}
                onClick={() => choose(version, selected)}
              >
                {/* The keyboard's way in, and the row's accessible name.
                    `pointer-events-none` so a click is the row's, once:
                    the row above already answers the pointer, and a
                    button stacked over it would answer the same press a
                    second time and toggle the version straight back. */}
                <Pressable
                  className="pointer-events-none absolute inset-0"
                  aria-label={`Version from ${who(version, me)} at ${timeOf(version.at)}`}
                  onClick={() => choose(version, selected)}
                />
                <div className="relative z-10 flex flex-col gap-0.5">
                <div className="flex items-center gap-2.5">
                  {rowBinary ? (
                    <span
                      aria-hidden
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center self-center overflow-hidden rounded-mark bg-surface-3"
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
                  <span className="t-meta tnum text-ink-3">{timeOf(version.at)}</span>
                  <span className={whoInk(version)} data-testid="version-who">
                    {who(version, me)}
                  </span>
                  <span className="flex-1" />
                  {/* The controls take the size's place on hover rather
                      than sitting on top of it. */}
                  <span
                    className={`t-meta tnum text-ink-3 ${
                      lit ? "hidden" : "group-hover:hidden group-focus-within:hidden"
                    }`}
                    title={
                      elsewhere
                        ? "Only a collaborator has this one"
                        : undefined
                    }
                  >
                    {elsewhere ? "elsewhere" : size(version.bytes)}
                  </span>
                  <span className={`items-center gap-0.5 ${reveal}`}>
                    {!folded &&
                    onCompare &&
                    viewing?.version &&
                    viewing.version.sha !== version.sha &&
                    viewing.path === rowPath &&
                    !rowBinary ? (
                      <Button
                        size="inline"
                        title="Show what changed between the version on screen and this one"
                        data-testid="version-compare"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCompare(version);
                        }}
                      >
                        Compare
                      </Button>
                    ) : null}
                    {!folded ? (
                      <Button
                        size="inline"
                        title="Name this version so it is never thinned away"
                        onClick={(event) => {
                          event.stopPropagation();
                          setLabelling(version.sha);
                        }}
                      >
                        {version.label ? "Rename" : "Name it"}
                      </Button>
                    ) : null}
                  </span>
                </div>
                {scope === "project" && !folded ? (
                  <span
                    className="t-meta truncate text-ink-3"
                    data-testid="history-scope-path"
                    title={version.path}
                  >
                    {version.path}
                  </span>
                ) : null}
                {folded ? (
                  /* One watcher tick, many files: a `git pull`. The row
                     says how many and unfolds to name them, and each name
                     is the way into that file's own history, which is
                     where a version can be opened, named or restored. */
                  <div className="flex flex-col gap-0.5" data-testid="history-tick">
                    <Pressable
                      className="flex items-center gap-1 self-start text-small text-ink-3 hover:text-ink"
                      aria-expanded={unfolded === version.source}
                      data-testid="history-tick-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setUnfolded((current) =>
                          current === version.source ? null : version.source ?? null,
                        );
                      }}
                    >
                      {unfolded === version.source ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                      {version.why}, {version.count} files
                    </Pressable>
                    {unfolded === version.source
                      ? version.paths!.map((path) => (
                          <Pressable
                            key={path}
                            className="t-meta truncate pl-4 text-left text-ink-3 hover:text-ink"
                            data-testid="history-tick-path"
                            onClick={(event) => {
                              event.stopPropagation();
                              void choose({ ...version, path }, false);
                            }}
                          >
                            {path}
                          </Pressable>
                        ))
                      : null}
                  </div>
                ) : version.label ? (
                  <span className="text-small text-ink">{version.label}</span>
                ) : version.why ? (
                  <span className="truncate text-small text-ink-3" title={version.why}>
                    {version.why}
                  </span>
                ) : null}
                {elsewhere && opened === version.sha ? (
                  <div className="mt-1" data-testid="version-elsewhere">
                    <span className="t-meta text-ink-2">
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
                    <div className="flex flex-wrap items-center gap-2">
                      {confirming === version.sha ? (
                        <>
                          <span className="t-meta text-ink-2">
                            Replace the file with this?
                          </span>
                          <Button
                            size="inline"
                            variant="danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              void restore(version.sha);
                            }}
                          >
                            Restore
                          </Button>
                          <Button
                            size="inline"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirming(null);
                            }}
                          >
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="inline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirming(version.sha);
                          }}
                        >
                          Restore this
                        </Button>
                      )}
                      <Button
                        size="inline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void download(blobUrl(version.sha, true), name, "the version");
                        }}
                      >
                        Download
                      </Button>
                    </div>
                  </div>
                ) : null}
                {labelling === version.sha ? (
                  <Input
                    autoFocus
                    defaultValue={version.label ?? ""}
                    placeholder="Name this version"
                    className="t-meta mt-1 w-full border-b border-pen bg-transparent text-ink outline-none"
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setLabelling(null)}
                    onKeyDown={async (event) => {
                      if (event.key === "Escape") {
                        // The name is cancelled and nothing else: the
                        // panel's own Escape would close it otherwise.
                        event.stopPropagation();
                        setLabelling(null);
                      }
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
  /** One control for what changed, where there were two: the shading in
   *  the editor that marks what is gone, in place, and the unified patch
   *  under the banner that shows what arrived as well.  They answer one
   *  question, so "What changed" turns both on and "Hide what changed"
   *  both off, as the page draws it. */
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

  // A row that wraps rather than one that tears.  The banner was a fixed
  // 26px with nothing said about wrapping, and the editor pane beside a
  // docked history panel is narrow enough that the buttons' own labels
  // broke across two lines inside it, "Show what's" over "gone", with
  // the second line drawn outside the bar.  Each control keeps its rule
  // with it, so a second row, when there has to be one, starts with a
  // label rather than a stray line.
  // As the page draws it: a 32 px strip in the pen wash for Claude's
  // version and the hint wash for a person's, the time, who, the reason,
  // and at the right What changed, Restore and Back to now, with no rules
  // between them.  It wraps rather than tears in a narrow pane.
  return (
    <div
      className={`nx-arrive t-meta flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 whitespace-nowrap px-3 ${
        version.by === "claude" ? "bg-pen-wash" : "bg-hint-wash"
      }`}
      data-testid="viewing-banner"
    >
      <span className="h-8 leading-8 text-ink">Viewing {timeOf(version.at)}</span>
      <span className={whoInk(version)}>{who(version, me)}</span>
      {version.label || version.why ? (
        <span
          className="min-w-0 flex-1 truncate text-ink-2"
          title={version.label || version.why}
        >
          {version.label || version.why}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="flex h-8 items-center gap-0.5">
        {onDownload ? (
          <Button size="inline" onClick={onDownload}>
            Download
          </Button>
        ) : (
          <Button size="inline" onClick={onToggleChanges} data-testid="toggle-patch">
            {showingChanges ? "Hide what changed" : "What changed"}
          </Button>
        )}
        {confirming ? (
          <>
            <span className="px-1 text-ink-2">Replace the file with this?</span>
            <Button
              size="inline"
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onRestore();
              }}
            >
              Restore
            </Button>
            <Button size="inline" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="inline" onClick={() => setConfirming(true)}>
            Restore this
          </Button>
        )}
        <Button size="inline" className="!text-ink" onClick={onBack}>
          Back to now
        </Button>
      </span>
    </div>
  );
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

