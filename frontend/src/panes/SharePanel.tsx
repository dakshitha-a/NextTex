import { useEffect, useRef, useState } from "react";
import api, { type CollabState } from "../api";
import { useDismiss } from "../useDismiss";

/** Sharing a project with somebody else's NextTex.
 *
 *  Every collaborator installs NextTex and holds the whole project: the
 *  files, the version history, their own git repository.  There is no server
 *  in the middle and there is no owner, so this card has no roles in it and
 *  no permissions to set -- every member can invite, and every member can
 *  remove.
 *
 *  Two things are said out loud here rather than left in the documentation,
 *  because both are the kind of thing a person discovers at the worst
 *  possible moment.
 *
 *  An invite is a **credential**: whoever holds it joins.  It is single-use
 *  and it expires, and the card says to send it the way you would send a
 *  password.
 *
 *  Removing somebody **disconnects them; it does not take anything back**.
 *  They keep the copy they already have, and very likely a git remote too.
 *  A button that looks like revocation and is not is worse than no button,
 *  so the sentence sits next to it and not in a footnote.
 */
export default function SharePanel({ projectId, onClose }: {
  projectId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<CollabState | null>(null);
  const [me, setMe] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState("");
  const sheet = useRef<HTMLDivElement | null>(null);

  useDismiss(sheet, true, onClose);

  const refresh = () =>
    api.collab(projectId)
      .then((answer) => {
        setState(answer);
        // Cleared on success. It was set and never unset, so one failed
        // poll, on a four-second timer, left "Could not read this
        // project's sharing" under a panel that had been reading it fine
        // for the rest of the session.
        setError(answer.error || "");
      })
      .catch(() => setError("Could not read this project's sharing."));

  useEffect(() => {
    api.auth().then((who) => setMe(who.displayName)).catch(() => undefined);
    refresh();
    // Polled rather than pushed: whether a peer is connected changes on its
    // own, and a card nobody has open costs nothing.
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    setBusy(true);
    setError("");
    try {
      setState(await api.startSharing(projectId));
    } catch (failure: any) {
      setError(failure?.message || "Could not start sharing this project.");
    } finally {
      setBusy(false);
    }
  };

  const makeInvite = async () => {
    setBusy(true);
    setError("");
    try {
      const { invite: made } = await api.makeInvite(projectId);
      setInvite(made);
      setRevealed(false);
      try {
        await navigator.clipboard.writeText(made);
        setCopied(true);
      } catch {
        // No clipboard permission: the box below is selectable, which is
        // the fallback rather than an error worth reporting.
      }
      refresh();
    } catch (failure: any) {
      setError(failure?.message || "Could not make an invite.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (peer: string) => {
    setConfirming("");
    try {
      setState(await api.removeMember(projectId, peer));
    } catch {
      setError("Could not remove that collaborator.");
    }
  };

  const others = (state?.members ?? []).filter(
    (member) => member.peer !== state?.me && !member.removed,
  );

  return (
    <div className="nx-scrim fixed inset-0 z-50 grid place-items-center p-6"
         role="presentation">
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-heading"
        data-testid="share-panel"
        className="nx-furniture nx-arrive max-h-full w-[420px] overflow-y-auto rounded-[5px] border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between px-[12px] pt-[10px] pb-[6px]">
          <span id="share-heading" className="t-ui text-ink">Share this project</span>
          <button className="quiet t-micro" data-testid="share-close" onClick={onClose}>
            Close
          </button>
        </div>

        {!state ? (
          <div className="t-meta px-[12px] pb-[12px] text-ink-3">Reading…</div>
        ) : !state.available ? (
          <div className="px-[12px] pb-[12px]">
            <p className="t-meta text-ink-2">
              Peer-to-peer collaboration is not available on this platform yet.
            </p>
            <p className="t-micro mt-[6px] text-ink-3">
              It needs iroh, which publishes builds for Linux, Windows and
              Apple-silicon Macs. Everything else in NextTex works as it does
              anywhere.
            </p>
          </div>
        ) : state.shared && !state.member ? (
          /* A project that was copied to this machine. The share record
             travels inside the project and the identity does not, so this
             install is a stranger to a share it holds the record of. Every
             member shows as not connected, and without this the honest
             reading of that is "nobody is here", which sends somebody to
             check their network for a problem that is not there. */
          <div className="px-[12px] pb-[12px]">
            <p className="t-meta text-ink-2">
              This copy of the project is not in its own share. That happens
              when a project folder is moved to another machine or restored
              from a backup: the share travels with the files and the identity
              does not, because it belongs to the install rather than to the
              project.
            </p>
            <p className="t-meta mt-[8px] text-ink-2">
              The work is not affected and nothing has been lost. To collaborate
              from here, ask somebody already in the share for a new invite, and
              accept it into an empty folder.
            </p>
          </div>
        ) : !state.shared ? (
          <div className="px-[12px] pb-[12px]">
            {/* The consequence first. The paragraph that matters most here
                is the one about there being no owner, and it was second and
                dimmer than the one describing the mechanism. */}
            <p className="t-meta text-ink-2">
              Nobody owns a shared project. Anyone in it can invite somebody
              else, and anyone can remove anybody, including you.
            </p>
            <p className="t-meta mt-[8px] text-ink-2">
              Everyone you invite gets a whole copy: the files, the history,
              their own git. Edits merge as they happen, including anything
              written while somebody was offline.
            </p>
            {/* "Share this project" was the dialog's title repeated, and it
                described something the press does not do -- nothing is sent
                to anybody until an invite is made. */}
            <button
              className="pen-button t-ui mt-[10px] h-[28px] w-full"
              disabled={busy}
              data-testid="start-sharing"
              onClick={share}
            >
              {busy ? "Turning it on…" : "Turn on sharing"}
            </button>
          </div>
        ) : (
          <>
            <Heading>Invite somebody</Heading>
            <div className="px-[12px] py-[8px]">
              <p className="t-micro text-ink-3">
                An invite is a credential: whoever opens it joins. It works
                once and expires after a week, so send it the way you would
                send a password.
              </p>
              <button
                className="pen-button t-ui mt-[8px] h-[28px] w-full"
                disabled={busy}
                data-testid="make-invite"
                onClick={makeInvite}
              >
                {busy ? "Making…" : "Create an invite"}
              </button>
              {invite ? (
                <div className="mt-[8px]">
                  {/* Not printed in full.  The paragraph above calls this a
                      credential and then the first version put it on screen
                      at full size, where a screenshare or somebody walking
                      past collects it -- and clipped it mid-line, so it also
                      looked broken.  It is on the clipboard, which is where
                      it is wanted; the rest is for the rare case where the
                      clipboard did not work. */}
                  {revealed ? (
                    <textarea
                      readOnly
                      autoFocus
                      value={invite}
                      data-testid="invite-text"
                      aria-label="The invite to send"
                      rows={3}
                      className="t-code-sm w-full resize-none overflow-auto rounded-[3px] border border-line bg-surround px-[8px] py-[5px] text-ink"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  ) : (
                    <div className="flex items-center gap-[8px]">
                      <code
                        data-testid="invite-chip"
                        className="t-code-sm min-w-0 flex-1 truncate rounded-[3px] border border-line bg-surround px-[8px] py-[5px] text-ink-3"
                      >
                        invite · {invite.slice(-8)} · hidden
                      </code>
                      <button
                        className="quiet t-micro shrink-0"
                        onClick={() => setRevealed(true)}
                      >
                        Show it
                      </button>
                    </div>
                  )}
                  <div className="mt-[5px] flex items-baseline gap-[10px]">
                    <span className="t-micro text-ok empty:hidden">
                      {copied ? "Copied to your clipboard." : ""}
                    </span>
                    <span className="flex-1" />
                    <button
                      className="quiet t-micro shrink-0"
                      data-testid="copy-invite"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(invite);
                          setCopied(true);
                        } catch {
                          setRevealed(true);
                        }
                      }}
                    >
                      Copy again
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <Heading>In this project</Heading>
            <ul className="px-[12px] py-[4px]">
              {others.length === 0 ? (
                <li className="t-micro py-[3px] text-ink-3">Only you.</li>
              ) : null}
              {others.map((member) => (
                <li key={member.peer} className="py-[3px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="t-meta min-w-0 truncate text-ink">
                      {member.name || "Unnamed"}
                    </span>
                    <span className="flex shrink-0 items-center gap-[8px]">
                      <span
                        className={`t-micro ${
                          member.connected ? "text-ok" : "text-ink-3"
                        }`}
                      >
                        {member.connected ? "connected" : "away"}
                      </span>
                      <button
                        className="quiet t-micro"
                        onClick={() => setConfirming(
                          confirming === member.peer ? "" : member.peer,
                        )}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                  {confirming === member.peer ? (
                    <div className="mt-[4px] rounded-[3px] border border-warn/60 px-[8px] py-[6px]">
                      <p className="t-micro text-ink-2">
                        This disconnects them. It does not take back the copy
                        they already have: they keep the files, the history
                        and any backup they have made.
                      </p>
                      <div className="mt-[6px] flex gap-2">
                        <button
                          className="t-micro text-error"
                          data-testid="confirm-remove"
                          onClick={() => remove(member.peer)}
                        >
                          Disconnect them
                        </button>
                        <button
                          className="quiet t-micro"
                          onClick={() => setConfirming("")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* The app has a name for you; answering "who am I here" with a
                hash contradicted the field that asked for one. */}
            <p className="t-micro px-[12px] pt-[2px] pb-[12px] text-ink-3">
              {me ? (
                <>
                  You are {me}{" "}
                  <code className="t-code-sm">{state.me.slice(0, 8)}</code>
                </>
              ) : (
                <>
                  You have not set a name, so collaborators will see{" "}
                  <code className="t-code-sm">{state.me.slice(0, 8)}</code>.
                  The cog sets one.
                </>
              )}
            </p>
          </>
        )}

        {error ? (
          <p className="t-micro px-[12px] pb-[10px] text-error" data-testid="share-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="t-micro border-t border-line bg-surface-2 px-[12px] py-[3px] text-ink-3">
      {children}
    </div>
  );
}
