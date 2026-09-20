import { useCallback, useEffect, useState } from "react";
import api from "../api";
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
 *  the heading row and holds one instrument at a time. */
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
          <span className="t-code-sm text-ink">{status.branch || "detached"}</span>
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

        {dirty > 0 ? (
          <>
            <p className="nx-group">{dirty} {dirty === 1 ? "file changed" : "files changed"}</p>
            <div className="min-h-0 flex-1 overflow-auto">
              {status.changes.map((change) => (
                <ChangeRow
                  key={change.path}
                  change={change}
                  projectId={projectId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </>
        ) : <span className="flex-1" />}

        {dirty > 0 || status.ahead > 0 ? (
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

