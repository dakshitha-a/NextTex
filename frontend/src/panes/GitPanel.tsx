import { useCallback, useEffect, useState } from "react";
import api, { type GitBlame, type GitCommit } from "../api";
import { readStored, writeStored } from "../appearance";
import { refreshGit, set, useStore } from "../store";
import Patch from "./Patch";
import { Button } from "../ui/Button";
import { Empty, Field } from "../ui/controls";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons";



/** The Git drawer: what has changed, and how to get it somewhere safe.
 *
 *  Four operations and no more.  A thesis needs to be committed, sent
 *  somewhere that is not this machine, and pulled back on another;
 *  branching and history rewriting belong in a terminal where the
 *  mistakes are recoverable. Inside the activity bar's drawer, which draws
 *  the heading row and holds one instrument at a time.
 *
 *  Reading history is not a fifth operation, since it changes nothing:
 *  under the changes, "The line you are on" says which commit last
 *  touched the caret's line, and History lists the commits, each opening
 *  to its patch the way a changed file does. */
/** A small count as a word, the way a sentence says it: "Two files". */
function spelled(count: number): string {
  const words = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[count - 2] ?? String(count);
}

export default function GitPanel({
  onOpen,
}: {
  onOpen?: (path: string) => void;
}) {
  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const status = useStore((s) => s.git);
  const failed = useStore((s) => s.gitFailed);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [wizard, setWizard] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  // Bumped after anything that moves HEAD, so History reads again.
  const [moved, setMoved] = useState(0);

  const refresh = useCallback(async () => {
    if (projectId) await refreshGit(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setDismissed(readStored(`nexttex.backup.dismissed.${projectId}`) === "1");
    // Everything else this panel holds belongs to the project that is
    // leaving, and only the dismissal was being re-read. A half-written
    // commit message, a pasted personal access token and a half-finished
    // GitHub wizard all followed the writer into the next project.
    setMessage("");
    setWizard(false);
    setUrl("");
    setToken("");
  }, [projectId]);

  /** True when it worked. The caller below has to know whether *this*
   *  action succeeded before it decides to push, and it used to ask
   *  `get().error`, which is the store's session-wide error slot: about
   *  thirty unrelated places write to it and nothing clears it, so one
   *  failure anywhere in the app stopped every later push, silently, until
   *  the tab was reloaded. */
  const act = async (action: string): Promise<boolean> => {
    if (!projectId) return false;
    setBusy(action);
    try {
      await api.gitAction(projectId, action, message);
      if (action === "commit") setMessage("");
      await refresh();
      setMoved((n) => n + 1);
      return true;
    } catch (error: any) {
      set({ error: error.message });
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!projectId) return null;
  // Narrowed once here; the body below is a function, and the narrowing
  // does not follow `projectId` into it.
  const id = projectId;

  const dirty = status?.repository ? status.changes.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="git-panel">
      {body()}
    </div>
  );

  /** What sits under the header: one of the panel's states. */
  function body() {
    // Could not ask, which is not the same as no repository. Drawing the
    // GitHub card here offered to set up a backup to a project that may
    // already have one.
    if (failed) {
      return (
        <div className="nx-line">
          <span className="t-meta text-ink-3" data-testid="git-unavailable">
            Could not read this project&rsquo;s git status.
          </span>
          <Button size="inline" onClick={refresh}>Try again</Button>
        </div>
      );
    }

    // First run: one card, dismissible, and once it is gone it stays gone.
    //
    // Two conditions, not one. A project with no repository at all and a
    // project with a repository and no remote are different situations, and
    // folding them into one card offered the network answer to both: the
    // local half of version control, which needs no account and no
    // connection, was reachable only from a terminal, and the panel that
    // exists to make it reachable was the thing hiding it.
    if (status && (!status.repository || !status.remote) && !dismissed && !wizard) {
      // One sentence and two actions, as the page draws it: the card, its
      // heading and its second paragraph went, and the sentence about
      // GitHub is a note under the offer. A project with no repository and
      // one with a repository and no remote are different offers: the
      // local half of version control needs no account and no connection.
      return (
        <div className="flex flex-col" data-testid="git-setup">
          <Empty
            action={
              <>
                {status.repository ? (
                  <Button variant="ghost" data-testid="git-backup" onClick={() => setWizard(true)}>
                    Back up to GitHub
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    data-testid="git-init"
                    disabled={busy === "init"}
                    onClick={() => act("init")}
                  >
                    {busy === "init" ? "Making it…" : "Keep versions here"}
                  </Button>
                )}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDismissed(true);
                    writeStored(`nexttex.backup.dismissed.${projectId}`, "1");
                  }}
                >
                  Not now
                </Button>
              </>
            }
          >
            {status.repository
              ? "A copy somewhere that is not this machine, updated whenever you ask. Private by default."
              : "Keep a record of the project as a whole, beside the per-file history NextTex already keeps. No account, no connection."}
          </Empty>
          {status.repository ? null : (
            <p className="nx-note">
              Sending a copy to GitHub is a separate step you can take later.{" "}
              <button className="text-ink-2 hover:text-ink" data-testid="git-backup" onClick={() => setWizard(true)}>
                Set it up now
              </button>
            </p>
          )}
        </div>
      );
    }

    if (wizard) {
      return (
        <div className="flex flex-col gap-2 px-3 py-2" data-testid="git-wizard">
          <div className="t-ui font-medium text-ink">Back up to GitHub</div>
          {status?.gh ? (
            <>
              <p className="t-meta mt-1 text-ink-2">
                The GitHub CLI is signed in, so NextTex can make the repository
                for you.
              </p>
              <Button
                variant="ghost"
                className="self-start"
                disabled={busy === "create"}
                onClick={async () => {
                  setBusy("create");
                  try {
                    await api.gitBackup(id, {
                      name: projectName.replace(/\s+/g, "-").toLowerCase(),
                      private: true,
                    });
                    setWizard(false);
                    await refresh();
                  } catch (error: any) {
                    set({ error: error.message });
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === "create" ? "Creating" : "Create a private repository"}
              </Button>
            </>
          ) : (
            <p className="t-meta mt-1 text-ink-2">{status?.ghReason}</p>
          )}
          <div className="t-meta mt-1 text-ink-2">Or use a repository you already have</div>
          <Field
            frameClassName="w-full"
            value={url}
            placeholder="https://github.com/you/paper.git"
            className="font-mono text-[12.5px]"
            onChange={(event) => setUrl(event.target.value)}
          />
          <Field
            frameClassName="w-full"
            value={token}
            type="password"
            placeholder="Personal access token (optional)"
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!url || busy === "attach"}
              onClick={async () => {
                setBusy("attach");
                try {
                  await api.gitBackup(id, { url, token });
                  setWizard(false);
                  setToken("");
                  await refresh();
                } catch (error: any) {
                  set({ error: error.message });
                } finally {
                  setBusy("");
                }
              }}
            >
              Connect
            </Button>
            <Button variant="quiet" onClick={() => setWizard(false)}>
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    // Nothing to show while the status is still on its way.
    if (!status) return null;

    // No repository and the card set aside. The footer below has had a
    // way back to the wizard since the dismissal was found to have no
    // later, but that footer only draws for a project with a repository,
    // so on a project without one "Not now" was "not ever": the route to
    // init was gone for the life of the project short of clearing the
    // browser's storage.
    if (!status.repository) {
      return (
        <div className="nx-line flex-wrap" data-testid="git-aside">
          <span className="t-meta text-ink-3">Not kept in versions.</span>
          <Button size="inline" data-testid="git-init-again" disabled={busy === "init"} onClick={() => act("init")}>
            {busy === "init" ? "Making it…" : "Keep versions"}
          </Button>
          <Button size="inline" onClick={() => setWizard(true)}>
            Back up
          </Button>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The status row: the dot green when clean and amber with
            changes, the branch in the mono, ahead and behind, and Pull. */}
        <div className="nx-git-status">
          <span className={`nx-git-dot ${dirty ? "bg-warn" : "bg-ok"}`} />
          {status.branch ? (
            <span className="t-code-sm text-ink">{status.branch}</span>
          ) : (
            // A detached head names the commit it is at (Q-024).
            <span className="t-meta text-ink-2" data-testid="git-detached">
              detached at{" "}
              <span className="t-code-sm text-ink">{status.detached || "an unknown commit"}</span>
            </span>
          )}
          {status.ahead || status.behind ? (
            <span className="t-meta tnum text-ink-3">
              {status.ahead ? `↑${status.ahead}` : ""}
              {status.ahead && status.behind ? " " : ""}
              {status.behind ? `↓${status.behind}` : ""}
            </span>
          ) : null}
          <span className="flex-1" />
          {/* A way back in after "Not now": the dismissal is per project
              and used to leave no route to the wizard. */}
          {!status.remote ? (
            <Button size="inline" data-testid="back-up-again" onClick={() => setWizard(true)}>
              Back up
            </Button>
          ) : null}
          {status.behind > 0 ? (
            <Button size="inline" onClick={() => act("pull")}>
              {busy === "pull" ? "Pulling" : "Pull"}
            </Button>
          ) : null}
        </div>

        {/* A merge a terminal left unfinished: said, with the files in
            conflict, and nothing is committed until it is done (Q-023). */}
        {status.merging && status.conflicts?.length ? (
          <div className="nx-git-here" data-testid="git-merging">
            {/* One paragraph, so the names and the full stop flow as a
                sentence; the block itself stacks its children. */}
            <p className="m-0">
              <span className="font-medium text-ink">A merge is in progress.</span>{" "}
              {status.conflicts.length === 1
                ? "One file still has"
                : `${spelled(status.conflicts.length)} files still have`}{" "}
              conflicts:{" "}
              {status.conflicts.slice(0, 3).map((path, index) => (
                <span key={path}>
                  {index ? (index === Math.min(status.conflicts!.length, 3) - 1 ? " and " : ", ") : ""}
                  <span className="t-code-sm text-ink">{path}</span>
                </span>
              ))}
              {status.conflicts.length > 3 ? " and more" : ""}. Finish the merge in a
              terminal; committing here waits until it is done.
            </p>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {dirty > 0 ? (
            <>
              <p className="nx-group">{dirty} {dirty === 1 ? "file changed" : "files changed"}</p>
              {status.changes.map((change) => (
                <ChangeRow
                  key={change.path}
                  change={change}
                  projectId={projectId}
                  onOpen={onOpen}
                />
              ))}
            </>
          ) : (
            <p className="nx-group">Nothing to commit</p>
          )}
          <LineYouAreOn projectId={id} moved={moved + dirty} />
          <History projectId={id} moved={moved} latexdiff={Boolean(status.latexdiff)} />
        </div>

        {(dirty > 0 || status.ahead > 0) && !(status.merging && status.conflicts?.length) ? (
          <div className="flex flex-col gap-2 px-2 pb-2 pt-2">
            {dirty > 0 ? (
              <Field
                frameClassName="w-full"
                value={message}
                placeholder="What changed"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && message.trim()) act("commit");
                }}
              />
            ) : null}
            <Button
              variant="ghost"
              className="self-start"
              disabled={Boolean(busy) || (dirty > 0 && !message.trim())}
              onClick={async () => {
                if (dirty > 0 && !(await act("commit"))) return;
                await act("push");
              }}
            >
              {busy
                ? busy === "commit"
                  ? "Committing"
                  : "Pushing"
                : dirty > 0
                  ? "Commit and push"
                  : `Push ${status.ahead}`}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
}

/** One changed file: its state, its path, and its patch on request.
 *
 *  The row still opens the file, as it always has. The chevron beside it
 *  is the agent's edit chip idiom, and it fetches the patch when it is
 *  opened rather than for every row when the panel draws, because a
 *  `git diff` per changed file after every build is not a cost the panel
 *  should pay for a list most people only read. */
function ChangeRow({
  change,
  projectId,
  onOpen,
}: {
  change: { state: string; path: string };
  projectId: string | null;
  onOpen?: (path: string) => void;
}) {
  const [showing, setShowing] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  useEffect(() => {
    if (!showing || !projectId) return;
    let cancelled = false;
    api
      .gitDiff(projectId, change.path)
      .then((answer) => !cancelled && setPatch(answer.patch))
      .catch(() => !cancelled && setPatch(""));
    return () => {
      cancelled = true;
    };
  }, [showing, projectId, change.path]);
  return (
    <div data-testid="git-change" data-path={change.path}>
      <div className="nx-git-change">
        <button
          className="nx-git-chevron"
          aria-expanded={showing}
          aria-label={showing ? `Hide what changed in ${change.path}` : `Show what changed in ${change.path}`}
          data-testid="git-change-toggle"
          onClick={() => setShowing(!showing)}
        >
          {showing ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`Open ${change.path}`}
          onClick={() => onOpen?.(change.path)}
        >
          <span className="t-code-sm w-[12px] shrink-0 text-ink-3">{change.state}</span>
          <span className="truncate text-ink-2">{change.path}</span>
        </button>
      </div>
      {showing ? (
        patch === null ? (
          <p className="nx-note">Reading</p>
        ) : patch ? (
          <Patch text={patch} testId="git-patch" className="mx-2 mb-[6px] ml-[26px]" />
        ) : (
          <p className="nx-note">Nothing to show for this file.</p>
        )
      ) : null}
    </div>
  );
}


/** "19 Sep", or "19 Sep 2025" in another year. */
export function dayOf(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString([], {
    day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Which commit last touched the line the caret is on, following it.
 *  Asked a moment after the caret settles rather than on every key, and
 *  of the editor's own text, so a line typed since the last commit says
 *  so instead of naming whatever held that number on disk. */
function LineYouAreOn({ projectId, moved }: { projectId: string; moved: number }) {
  const path = useStore((s) => s.activePath);
  const line = useStore((s) => s.cursor.line);
  const [blame, setBlame] = useState<GitBlame | null>(null);
  useEffect(() => {
    if (!path) {
      setBlame(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .gitBlame(projectId, path, line)
        .then((answer) => !cancelled && setBlame(answer.blame))
        .catch(() => !cancelled && setBlame(null));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, path, line, moved]);
  if (!path || !blame) return null;
  return (
    <>
      <p className="nx-group">The line you are on</p>
      <div className="nx-git-here" data-testid="git-line">
        {blame.uncommitted ? (
          <span className="text-ink-2">Not committed yet</span>
        ) : (
          <>
            <span>
              <span className="font-medium text-ink">{blame.mine ? "You" : blame.author}</span>
              <span className="text-ink-3">, {dayOf(blame.when)}</span>
            </span>
            <span className="text-ink-2">
              {blame.subject} <span className="t-code-sm text-ink-3">{blame.short}</span>
            </span>
          </>
        )}
        <span className="text-ink-3">
          {path}, line {blame.line}
        </span>
      </div>
    </>
  );
}

/** The newest commits, each a row that opens to its patch. */
function History({ projectId, moved, latexdiff }: { projectId: string; moved: number; latexdiff: boolean }) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .gitLog(projectId)
      .then((answer) => !cancelled && setCommits(answer.commits))
      .catch(() => !cancelled && setCommits([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, moved]);
  if (!commits || commits.length === 0) return null;
  return (
    <>
      <p className="nx-group">History</p>
      <div data-testid="git-history">
        {commits.map((commit) => (
          <CommitRow key={commit.sha} commit={commit} projectId={projectId} latexdiff={latexdiff} />
        ))}
      </div>
    </>
  );
}

function CommitRow({ commit, projectId, latexdiff }: { commit: GitCommit; projectId: string; latexdiff: boolean }) {
  const [showing, setShowing] = useState(false);
  const [building, setBuilding] = useState(false);
  /** The document as it is against the one at this commit, marked up by
   *  latexdiff the way a journal wants a revision, in a tab of its own
   *  (Q-048). The tab is opened at the press, so a browser that refuses a
   *  window opened later by a script still gives this one. */
  const changesAsPdf = async () => {
    const tab = window.open("", "_blank");
    setBuilding(true);
    try {
      const answer = await api.gitChangesPdf(projectId, commit.sha);
      if (tab) tab.location.href = answer.url;
      else window.location.assign(answer.url);
    } catch (problem: any) {
      tab?.close();
      set({ error: problem?.message ?? String(problem) });
    } finally {
      setBuilding(false);
    }
  };
  const [patch, setPatch] = useState<string | null>(null);
  useEffect(() => {
    if (!showing || patch !== null) return;
    let cancelled = false;
    api
      .gitCommit(projectId, commit.sha)
      .then((answer) => !cancelled && setPatch(answer.patch))
      .catch(() => !cancelled && setPatch(""));
    return () => {
      cancelled = true;
    };
  }, [showing, projectId, commit.sha, patch]);
  return (
    <div data-testid="git-commit" data-sha={commit.short} className="nx-git-row">
      {latexdiff ? (
        <span className="nx-row-actions nx-git-row-actions" data-always={building || undefined}>
          <Button size="inline" data-testid="git-changes-pdf" disabled={building} onClick={() => void changesAsPdf()}>
            {building ? "Building the PDF" : "Changes as PDF"}
          </Button>
        </span>
      ) : null}
      <button
        className="nx-git-commit"
        aria-expanded={showing}
        title={showing ? "Hide what this commit changed" : "Show what this commit changed"}
        onClick={() => setShowing(!showing)}
      >
        <span className="nx-git-commit-subject">{commit.subject}</span>
        <span className="nx-git-commit-meta">
          <span>{commit.mine ? "You" : commit.author}</span>
          <span className="tnum">{dayOf(commit.when)}</span>
          <span className="t-code-sm">{commit.short}</span>
        </span>
      </button>
      {showing ? (
        patch === null ? (
          <p className="nx-note">Reading</p>
        ) : patch ? (
          <Patch text={patch} testId="git-commit-patch" className="mx-2 mb-[6px]" />
        ) : (
          <p className="nx-note">Nothing to show for this commit.</p>
        )
      ) : null}
    </div>
  );
}
