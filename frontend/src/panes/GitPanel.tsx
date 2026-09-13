import { useCallback, useEffect, useState } from "react";
import api from "../api";
import { refreshGit, set, useStore } from "../store";
import { Chevron } from "../chrome";
import Patch from "./Patch";



/** The rail footer: what has changed, and how to get it somewhere safe.
 *
 *  Four operations and no more.  A thesis needs to be committed, sent
 *  somewhere that is not this machine, and pulled back on another; branching
 *  and history rewriting belong in a terminal where the mistakes are
 *  recoverable.
 *
 *  A panel like the others in the rail: a 26px header that folds it, in the
 *  `SectionsPanel` idiom, with the open state held by the app so that it is
 *  remembered per project. It was the one thing in the rail that could not
 *  fold, and the first-run card is the tallest thing the rail holds. */
export default function GitPanel({
  open,
  onToggle,
  onOpen,
}: {
  open: boolean;
  onToggle: () => void;
  onOpen?: (path: string) => void;
}) {
  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const status = useStore((s) => s.git);
  const failed = useStore((s) => s.gitFailed);
  const [listOpen, setListOpen] = useState(false);
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
    setDismissed(
      window.localStorage.getItem(`nexttex.backup.dismissed.${projectId}`) === "1",
    );
    // Everything else this panel holds belongs to the project that is
    // leaving, and only the dismissal was being re-read. A half-written
    // commit message, a pasted personal access token and a half-finished
    // GitHub wizard all followed the writer into the next project.
    setMessage("");
    setWizard(false);
    setUrl("");
    setToken("");
    setListOpen(false);
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
    <div className="shrink-0 border-t border-line" data-testid="git-panel">
      <button
        className="flex h-[26px] w-full items-center justify-between px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        aria-expanded={open}
        data-testid="git-toggle"
        onClick={onToggle}
      >
        <span className="t-micro text-ink-2">Git</span>
        <span className="flex items-center gap-2">
          {/* How much the panel is hiding, as Files and Sections say. */}
          {dirty ? <span className="t-micro tnum text-ink-3">{dirty}</span> : null}
          <span className={`text-ink-3 ${open ? "rotate-180" : ""}`}>
            <Chevron direction="down" />
          </span>
        </span>
      </button>
      {open ? body() : null}
    </div>
  );

  /** What sits under the header: one of the panel's states. */
  function body() {
    // Could not ask, which is not the same as no repository. Drawing the
    // GitHub card here offered to set up a backup to a project that may
    // already have one.
    if (failed) {
      return (
        <div className="px-[10px] py-[6px]">
          <span className="t-micro text-ink-3" data-testid="git-unavailable">
            Could not read this project's git status.
          </span>
          <button className="ml-2 quiet t-micro" onClick={refresh}>
            Try again
          </button>
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
      return (
        <div className="p-[8px]" data-testid="git-setup">
          <div className="rounded-[5px] border border-line p-3">
            <div className="t-ui text-ink">
              {status.repository ? "Back this up to GitHub" : "Keep versions of this project"}
            </div>
            <p className="t-meta mt-1 text-ink-2">
              {status.repository
                ? "A copy somewhere that is not this machine, updated whenever you ask. Private by default."
                : "Git keeps a record of the project as a whole, alongside the per-file history NextTex already keeps. It works with no account and no connection; sending a copy to GitHub is a separate step you can take later."}
            </p>
            {/* Two rows, not one. The rail is 240px wide by default and can
                be dragged to 180, and three labels of this length in one
                row wrapped inside their own 26px boxes, so the card showed
                the top half of each word. The primary is full width, as the
                footer's "Commit and push" is, and the rest is the footer's
                quiet control, so the card has the two typographies the
                panel already has and not a third. */}
            {status.repository ? (
              <button
                className="mt-3 h-[26px] w-full ghost-button whitespace-nowrap t-ui"
                data-testid="git-backup"
                onClick={() => setWizard(true)}
              >
                Back up to GitHub
              </button>
            ) : (
              <button
                className="mt-3 h-[26px] w-full ghost-button whitespace-nowrap t-ui"
                data-testid="git-init"
                disabled={busy === "init"}
                onClick={() => act("init")}
              >
                {busy === "init" ? "Making it…" : "Keep versions here"}
              </button>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {status.repository ? null : (
                <button
                  className="t-micro whitespace-nowrap text-ink-3 hover:text-ink"
                  data-testid="git-backup"
                  onClick={() => setWizard(true)}
                >
                  Back up to GitHub
                </button>
              )}
              <button
                className="t-micro ml-auto whitespace-nowrap text-ink-3 hover:text-ink"
                onClick={() => {
                  setDismissed(true);
                  window.localStorage.setItem(
                    `nexttex.backup.dismissed.${projectId}`,
                    "1",
                  );
                }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (wizard) {
      return (
        <div className="p-[8px]" data-testid="git-wizard">
          <div className="t-ui text-ink">Back up to GitHub</div>
          {status?.gh ? (
            <>
              <p className="t-meta mt-1 text-ink-2">
                The GitHub CLI is signed in, so NextTex can make the repository
                for you.
              </p>
              <button
                className="mt-2 h-[26px] w-full ghost-button whitespace-nowrap t-ui"
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
              </button>
            </>
          ) : (
            <p className="t-meta mt-1 text-ink-2">{status?.ghReason}</p>
          )}
          <div className="t-micro mt-3 text-ink-2">Or use a repository you already have</div>
          <input
            value={url}
            placeholder="https://github.com/you/paper.git"
            className="t-code-sm mt-1 h-[26px] w-full rounded-[3px] border border-line px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            value={token}
            type="password"
            placeholder="Personal access token (optional)"
            className="t-code-sm mt-1 h-[26px] w-full rounded-[3px] border border-line px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="h-[26px] ghost-button whitespace-nowrap px-3 t-ui"
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
            </button>
            <button
              className="t-micro whitespace-nowrap px-2 text-ink-3 hover:text-ink"
              onClick={() => setWizard(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (!status?.repository) return null;

    return (
      <div className="px-[10px] py-[6px]">
        <div className="flex items-center gap-2">
          {dirty === 0 ? <span className="h-[6px] w-[6px] rounded-full bg-ok" /> : null}
          <span className="t-code-sm text-ink">{status.branch || "detached"}</span>
          {status.ahead || status.behind ? (
            <span className="t-micro tnum text-ink-3">
              ↑{status.ahead} ↓{status.behind}
            </span>
          ) : null}
          <span className="flex-1" />
          {/* A way back in after "Not now". The dismissal is written per
              project and was read back only to keep the card away, so a
              writer who set it aside once had no route to the wizard for the
              life of that project except clearing their browser storage. */}
          {!status.remote ? (
            <button
              className="t-micro text-ink-3 hover:text-ink"
              data-testid="back-up-again"
              onClick={() => setWizard(true)}
            >
              Back up
            </button>
          ) : null}
          {status.behind > 0 ? (
            <button
              className="t-micro text-ink-3 hover:text-ink"
              onClick={() => act("pull")}
            >
              {busy === "pull" ? "Pulling" : "Pull"}
            </button>
          ) : null}
        </div>

        {dirty > 0 ? (
          <>
            <button
              className="t-micro mt-1 text-ink-2 hover:text-ink"
              onClick={() => setListOpen(!listOpen)}
            >
              {dirty} {dirty === 1 ? "file changed" : "files changed"}
            </button>
            {listOpen ? (
              <div className="mt-1 max-h-[260px] overflow-auto">
                {status.changes.map((change) => (
                  <ChangeRow
                    key={change.path}
                    change={change}
                    projectId={projectId}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            ) : null}
            <input
              value={message}
              placeholder="What changed"
              className="t-ui mt-2 h-[26px] w-full rounded-[3px] border border-line px-2 outline-none placeholder:text-ink-3"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && message.trim()) act("commit");
              }}
            />
          </>
        ) : null}

        {dirty > 0 || status.ahead > 0 ? (
          <button
            className="mt-2 h-[26px] w-full ghost-button t-ui"
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
          </button>
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
      <div className="flex w-full items-baseline gap-1 rounded-[3px] px-1 hover:bg-surface-2">
        <button
          className="shrink-0 text-ink-3 hover:text-ink"
          aria-expanded={showing}
          aria-label={showing ? `Hide what changed in ${change.path}` : `Show what changed in ${change.path}`}
          data-testid="git-change-toggle"
          onClick={() => setShowing(!showing)}
        >
          <span className={`inline-block ${showing ? "rotate-180" : ""}`}>
            <Chevron direction="down" />
          </span>
        </button>
        <button
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          title={`Open ${change.path}`}
          onClick={() => onOpen?.(change.path)}
        >
          <span className="t-code-sm w-[14px] shrink-0 text-ink-3">
            {change.state}
          </span>
          <span className="t-code-sm truncate text-ink-2">{change.path}</span>
        </button>
      </div>
      {showing ? (
        patch === null ? (
          <p className="t-micro px-1 text-ink-3">Reading</p>
        ) : patch ? (
          <Patch text={patch} testId="git-patch" />
        ) : (
          <p className="t-micro px-1 text-ink-3">Nothing to show for this file.</p>
        )
      ) : null}
    </div>
  );
}

