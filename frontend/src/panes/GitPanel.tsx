import { useCallback, useEffect, useState } from "react";
import api from "../api";
import { refreshGit, set, useStore } from "../store";



/** The rail footer: what has changed, and how to get it somewhere safe.
 *
 *  Four operations and no more.  A thesis needs to be committed, sent
 *  somewhere that is not this machine, and pulled back on another; branching
 *  and history rewriting belong in a terminal where the mistakes are
 *  recoverable. */
export default function GitPanel({ onOpen }: { onOpen?: (path: string) => void } = {}) {
  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const status = useStore((s) => s.git);
  const failed = useStore((s) => s.gitFailed);
  const [open, setOpen] = useState(false);
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
    setOpen(false);
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

  // Could not ask, which is not the same as no repository. Drawing the
  // GitHub card here offered to set up a backup to a project that may
  // already have one.
  if (failed) {
    return (
      <div className="shrink-0 border-t border-line px-[10px] py-[6px]">
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
  if (status && (!status.repository || !status.remote) && !dismissed && !wizard) {
    return (
      <div className="shrink-0 border-t border-line p-[8px]" data-testid="git-setup">
        <div className="rounded-[5px] border border-line p-3">
          <div className="t-ui text-ink">Back this up to GitHub</div>
          <p className="t-meta mt-1 text-ink-2">
            A copy somewhere that is not this machine, updated whenever you
            ask. Private by default.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="h-[26px] ghost-button px-3 t-ui"
              onClick={() => setWizard(true)}
            >
              Set up
            </button>
            <button
              className="h-[26px] rounded-[3px] px-2 t-micro text-ink-3 hover:text-ink"
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
      <div className="shrink-0 border-t border-line p-[8px]">
        <div className="t-ui text-ink">Back up to GitHub</div>
        {status?.gh ? (
          <>
            <p className="t-meta mt-1 text-ink-2">
              The GitHub CLI is signed in, so NextTex can make the repository
              for you.
            </p>
            <button
              className="mt-2 h-[26px] ghost-button px-3 t-ui"
              disabled={busy === "create"}
              onClick={async () => {
                setBusy("create");
                try {
                  await api.gitBackup(projectId, {
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
            className="h-[26px] rounded-[3px] border border-line px-3 t-ui"
            disabled={!url || busy === "attach"}
            onClick={async () => {
              setBusy("attach");
              try {
                await api.gitBackup(projectId, { url, token });
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
            className="h-[26px] px-2 t-micro text-ink-3 hover:text-ink"
            onClick={() => setWizard(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!status?.repository) return null;

  const dirty = status.changes.length;

  return (
    <div className="shrink-0 border-t border-line px-[10px] py-[6px]">
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
            onClick={() => setOpen(!open)}
          >
            {dirty} {dirty === 1 ? "file changed" : "files changed"}
          </button>
          {open ? (
            <div className="mt-1 max-h-[96px] overflow-auto">
              {status.changes.map((change) => (
                <button
                  key={change.path}
                  className="flex w-full items-baseline gap-2 rounded-[3px] px-1 text-left hover:bg-surface-2"
                  title={`Open ${change.path}`}
                  onClick={() => onOpen?.(change.path)}
                >
                  <span className="t-code-sm w-[14px] shrink-0 text-ink-3">
                    {change.state}
                  </span>
                  <span className="t-code-sm truncate text-ink-2">{change.path}</span>
                </button>
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
