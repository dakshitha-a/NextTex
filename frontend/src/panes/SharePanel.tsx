import { useEffect, useState } from "react";
import api, { type CollabState } from "../api";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Heading as KitHeading } from "../ui/controls";

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
export default function SharePanel({ projectId, onClose, onLeft }: {
  projectId: string;
  onClose: () => void;
  /** The copy on this machine was deleted on the way out of the share,
   *  so there is no project to stay in. */
  onLeft?: () => void;
}) {
  const [state, setState] = useState<CollabState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleteCopy, setDeleteCopy] = useState(false);
  const [me, setMe] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState("");


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

  const leave = async (del: boolean) => {
    setLeaving(false);
    setBusy(true);
    try {
      const answer = await api.leaveShare(projectId, del);
      if (answer.deleted) {
        onLeft?.();
        onClose();
        return;
      }
      refresh();
    } catch {
      setError("Could not leave this project.");
    } finally {
      setBusy(false);
    }
  };

  const others = (state?.members ?? []).filter(
    (member) => member.peer !== state?.me && !member.removed,
  );

  return (
    <Sheet open onClose={onClose} labelledBy="share-heading" testid="share-panel" width={420}>
        <div className="flex items-center justify-between pb-[6px]">
          <KitHeading id="share-heading">Share this project</KitHeading>
          <Button data-testid="share-close" onClick={onClose}>
            Close
          </Button>
        </div>

        {!state ? (
          <div className="t-meta pb-[4px] text-ink-3">Reading…</div>
        ) : !state.available ? (
          <div className="pb-[4px]">
            <p className="t-meta text-ink-2">
              Peer-to-peer collaboration is not available on this platform yet.
            </p>
            <p className="t-micro mt-[6px] text-ink-3">
              It needs iroh, which publishes builds for Linux, Windows and
              Apple-silicon Macs. Everything else in NextTex works as it does
              anywhere.
            </p>
          </div>
        ) : state.shared && state.removed ? (
          /* Somebody removed this install. Said plainly, once, with what it
             does and does not mean: the copy is here, the history is here,
             and nothing typed from now on reaches anyone. The dial loop
             has already stopped; without this the panel showed every
             member as away, which reads as a network problem. */
          <div className="pb-[4px]" data-testid="removed-notice">
            <p className="t-meta text-ink-2">
              {state.removedBy ? (
                <>
                  <span className="text-ink">{state.removedBy}</span> removed you
                  from this project.
                </>
              ) : (
                "You were removed from this project."
              )}{" "}
              Your copy stays on this machine, with its history, and nothing
              you type here reaches anyone now.
            </p>
            <p className="t-meta mt-[8px] text-ink-2">
              To collaborate on it again, ask somebody in the share for a new
              invite.
            </p>
            {/* The record of the share is still here, saying removed, and
                it would say so on every visit. Keeping the copy makes the
                project an ordinary one of this install's own. */}
            <Button
              variant="pen"
              size="md"
              className="mt-[10px] w-full justify-center"
              disabled={busy}
              data-testid="keep-as-own"
              onClick={() => leave(false)}
            >
              {busy ? "Keeping…" : "Keep it as a project of my own"}
            </Button>
          </div>
        ) : state.shared && !state.member ? (
          /* A project that was copied to this machine. The share record
             travels inside the project and the identity does not, so this
             install is a stranger to a share it holds the record of. Every
             member shows as not connected, and without this the honest
             reading of that is "nobody is here", which sends somebody to
             check their network for a problem that is not there. */
          <div className="pb-[4px]">
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
              accept it into a folder of your own, empty or already holding a
              copy of the files.
            </p>
          </div>
        ) : !state.shared ? (
          <div className="pb-[4px]">
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
            <Button
              variant="pen"
              size="md"
              className="mt-[10px] w-full justify-center"
              disabled={busy}
              data-testid="start-sharing"
              onClick={share}
            >
              {busy ? "Turning it on…" : "Turn on sharing"}
            </Button>
          </div>
        ) : (
          <>
            <Heading>Invite somebody</Heading>
            <div className="py-[4px]">
              <p className="t-micro text-ink-3">
                An invite is a credential: whoever opens it joins. It works
                once and expires after a week, so send it the way you would
                send a password.
              </p>
              <Button
                variant="pen"
                size="md"
                className="mt-[8px] w-full justify-center"
                disabled={busy}
                data-testid="make-invite"
                onClick={makeInvite}
              >
                {busy ? "Making…" : "Create an invite"}
              </Button>
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
                      className="t-code-sm w-full resize-none overflow-auto rounded-control bg-surface-2 px-[8px] py-[5px] text-ink outline-none focus:ring-2 focus:ring-hint-wash"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  ) : (
                    <div className="flex items-center gap-[8px]">
                      <code
                        data-testid="invite-chip"
                        className="t-code-sm min-w-0 flex-1 truncate rounded-control bg-surface-2 px-[8px] py-[5px] text-ink-3"
                      >
                        invite · {invite.slice(-8)} · hidden
                      </code>
                      <Button
                        size="inline" className="shrink-0"
                        onClick={() => setRevealed(true)}
                      >
                        Show it
                      </Button>
                    </div>
                  )}
                  <div className="mt-[5px] flex items-baseline gap-[10px]">
                    <span className="t-micro text-ok empty:hidden">
                      {copied ? "Copied to your clipboard." : ""}
                    </span>
                    <span className="flex-1" />
                    <Button
                      size="inline" className="shrink-0"
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
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <Heading>In this project</Heading>
            <ul className="py-[2px]">
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
                      <Button
                        size="inline"
                        onClick={() => setConfirming(
                          confirming === member.peer ? "" : member.peer,
                        )}
                      >
                        Remove
                      </Button>
                    </span>
                  </div>
                  {confirming === member.peer ? (
                    <div className="nx-confirm">
                      <p className="t-micro text-ink-2">
                        This disconnects them. It does not take back the copy
                        they already have: they keep the files, the history
                        and any backup they have made.
                      </p>
                      <div className="nx-confirm-actions">
                        <Button
                          variant="danger" size="inline"
                          data-testid="confirm-remove"
                          onClick={() => remove(member.peer)}
                        >
                          Disconnect them
                        </Button>
                        <Button
                          size="inline"
                          onClick={() => setConfirming("")}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <Heading>Leave</Heading>
            <div className="py-[4px]">
              {!leaving ? (
                <Button
                  size="inline"
                  data-testid="leave-share"
                  disabled={busy}
                  onClick={() => setLeaving(true)}
                >
                  Leave this project
                </Button>
              ) : (
                <div className="nx-confirm">
                  <p className="t-micro text-ink-2" data-testid="leave-words">
                    {deleteCopy
                      ? "The others keep their copies and carry on without you. Your copy on this computer is deleted, with its history. To collaborate on it again you will need a new invite."
                      : "The others keep their copies and carry on without you. Your copy stays on this computer as a project of your own, with its history. To collaborate on it again you will need a new invite."}
                  </p>
                  <label className="t-micro mt-[6px] flex items-center gap-[6px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={deleteCopy}
                      data-testid="leave-delete"
                      onChange={(event) => setDeleteCopy(event.target.checked)}
                    />
                    and delete my copy from this computer
                  </label>
                  <div className="nx-confirm-actions">
                    <Button
                      variant="danger" size="inline"
                      data-testid="confirm-leave"
                      onClick={() => leave(deleteCopy)}
                    >
                      {deleteCopy ? "Leave and delete my copy" : "Leave"}
                    </Button>
                    <Button
                      size="inline"
                      onClick={() => setLeaving(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* The app has a name for you; answering "who am I here" with a
                hash contradicted the field that asked for one. */}
            <p className="t-micro pt-[10px] text-ink-3">
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
          <p className="t-micro pt-[8px] text-error" data-testid="share-error">
            {error}
          </p>
        ) : null}
    </Sheet>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="nx-section-label">{children}</div>;
}
