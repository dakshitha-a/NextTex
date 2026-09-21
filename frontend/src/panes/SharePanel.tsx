import { useEffect, useState } from "react";
import api, { type CollabState, type Member } from "../api";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Field, Heading } from "../ui/controls";

/** Sharing a project with somebody else's NextTex.
 *
 *  Every collaborator installs NextTex and holds the whole project: the
 *  files, the version history, their own git repository.  There is no server
 *  in the middle and there is no owner, so this has no roles in it and no
 *  permissions to set: every member can invite, and every member can
 *  remove.
 *
 *  One body, two places.  `useSharing` holds the state and the actions,
 *  and the words for the three states that need explaining are components
 *  of their own, so the sheet the projects screen opens on a row and the
 *  People drawer inside a project (`PeoplePanel.tsx`) are two layouts of
 *  one thing rather than two copies of it.  The sheet is what a row on
 *  the projects screen gets, since a project can be shared without being
 *  opened; the drawer is where the people are while the project is open.
 *
 *  "Turn on sharing" used to be a step of its own before an invite could
 *  be made, and it did nothing anyone could see: nothing reaches anybody
 *  until an invite is made, and the invite route shares the project on
 *  the way.  So one filled button makes the invite in both states, the
 *  invite appears once there is one, and "Stop sharing" is there only
 *  while there is something to stop.
 *
 *  Two things are said out loud here rather than left in the documentation,
 *  because both are the kind of thing a person discovers at the worst
 *  possible moment.
 *
 *  An invite is a **credential**: whoever holds it joins.  It is single-use
 *  and it expires, and the label says so.
 *
 *  Removing somebody **disconnects them; it does not take anything back**.
 *  They keep the copy they already have, and very likely a git remote too.
 *  A button that looks like revocation and is not is worse than no button,
 *  so the sentence sits next to it and not in a footnote.
 */

export type Sharing = ReturnType<typeof useSharing>;

/** The share's state and the actions on it, polled every four seconds
 *  while mounted: whether a peer is connected changes on its own, and a
 *  panel nobody has open costs nothing. */
export function useSharing(projectId: string, onLeft?: () => void, onClosed?: () => void) {
  const [state, setState] = useState<CollabState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleteCopy, setDeleteCopy] = useState(false);
  const [me, setMe] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
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
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard permission: the field is selectable, which is the
      // fallback rather than an error worth reporting.
    }
  };

  const makeInvite = async () => {
    setBusy(true);
    setError("");
    try {
      // The route shares the project first if it is not shared yet.
      const { invite: made } = await api.makeInvite(projectId);
      setInvite(made);
      await copy(made);
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
        onClosed?.();
        return;
      }
      setInvite("");
      refresh();
    } catch {
      setError("Could not leave this project.");
    } finally {
      setBusy(false);
    }
  };

  const others: Member[] = (state?.members ?? []).filter(
    (member) => member.peer !== state?.me && !member.removed,
  );
  const sharing = Boolean(state && state.available && state.shared && state.member && !state.removed);
  const ordinary = Boolean(state && state.available && (!state.shared || sharing));
  /** One word for the layouts' `data-state`: reading, shared, private, or
   *  one of the states `ShareWords` explains. */
  const standing = !state ? "reading" : sharing ? "shared" : ordinary ? "private" : "other";

  return {
    state, me, invite, busy, error, copied, confirming, setConfirming,
    leaving, setLeaving, deleteCopy, setDeleteCopy,
    copy, makeInvite, remove, leave, others, sharing, ordinary, standing,
  } as const;
}

/** The three states that need a paragraph rather than a list: no iroh on
 *  this platform, removed from the share, and a copy that is a stranger
 *  to the share it holds the record of.  Null for the two ordinary states. */
export function ShareWords({ state }: { state: CollabState }) {
  if (!state.available) {
    return (
      <>
        <p className="t-meta mt-1 text-ink-2">
          Peer-to-peer collaboration is not available on this platform yet.
        </p>
        <p className="t-meta mt-2 text-ink-2">
          It needs iroh, which publishes builds for Linux, Windows and
          Apple-silicon Macs. Everything else in NextTex works as it does
          anywhere.
        </p>
      </>
    );
  }
  if (state.shared && state.removed) {
    /* Somebody removed this install. Said plainly, once, with what it
       does and does not mean: the copy is here, the history is here,
       and nothing typed from now on reaches anyone. The dial loop
       has already stopped; without this the panel showed every
       member as away, which reads as a network problem. */
    return (
      <div data-testid="removed-notice">
        <p className="t-meta mt-1 text-ink-2">
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
        <p className="t-meta mt-2 text-ink-2">
          To collaborate on it again, ask somebody in the share for a new
          invite.
        </p>
      </div>
    );
  }
  if (state.shared && !state.member) {
    /* A project that was copied to this machine. The share record
       travels inside the project and the identity does not, so this
       install is a stranger to a share it holds the record of. Every
       member shows as not connected, and without this the honest
       reading of that is "nobody is here", which sends somebody to
       check their network for a problem that is not there. */
    return (
      <>
        <p className="t-meta mt-1 text-ink-2">
          This copy of the project is not in its own share. That happens
          when a project folder is moved to another machine or restored
          from a backup: the share travels with the files and the identity
          does not, because it belongs to the install rather than to the
          project.
        </p>
        <p className="t-meta mt-2 text-ink-2">
          The work is not affected and nothing has been lost. To collaborate
          from here, ask somebody already in the share for a new invite, and
          accept it into a folder of your own, empty or already holding a
          copy of the files.
        </p>
      </>
    );
  }
  return null;
}

/** The invite, once made: a mono field with Copy, and what it is. */
export function InviteField({ sharing }: { sharing: Sharing }) {
  return (
    <Field
      readOnly
      value={sharing.invite}
      data-testid="invite-text"
      aria-label="The invite to send"
      frameClassName="w-full"
      className="font-mono text-[12.5px]"
      onFocus={(event) => event.currentTarget.select()}
      trailing={
        <Button
          size="inline"
          className="shrink-0"
          data-testid="copy-invite"
          onClick={() => sharing.copy(sharing.invite)}
        >
          {sharing.copied ? "Copied" : "Copy"}
        </Button>
      }
    />
  );
}

/** The question under a member's Remove. */
export function RemoveConfirm({ sharing, peer }: { sharing: Sharing; peer: string }) {
  return (
    <div className="nx-confirm basis-full">
      <p className="t-micro text-ink-2">
        This disconnects them. It does not take back the copy
        they already have: they keep the files, the history
        and any backup they have made.
      </p>
      <div className="nx-confirm-actions">
        <Button
          variant="danger" size="inline"
          data-testid="confirm-remove"
          onClick={() => sharing.remove(peer)}
        >
          Disconnect them
        </Button>
        <Button size="inline" onClick={() => sharing.setConfirming("")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The question under Stop sharing, with the delete-my-copy choice. */
export function LeaveConfirm({ sharing }: { sharing: Sharing }) {
  const { deleteCopy, setDeleteCopy } = sharing;
  return (
    <div className="nx-confirm mt-3">
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
          onClick={() => sharing.leave(deleteCopy)}
        >
          {deleteCopy ? "Stop sharing and delete my copy" : "Stop sharing"}
        </Button>
        <Button size="inline" onClick={() => sharing.setLeaving(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The sheet: the projects screen's row opens it, so a project can be
 *  shared without opening it. */
export default function SharePanel({ projectId, name, onClose, onLeft }: {
  projectId: string;
  /** The project's name, for the title. */
  name: string;
  onClose: () => void;
  /** The copy on this machine was deleted on the way out of the share,
   *  so there is no project to stay in. */
  onLeft?: () => void;
}) {
  const sharing = useSharing(projectId, onLeft, onClose);
  const { state, me, invite, busy, error, confirming, leaving } = sharing;

  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy="share-heading"
      testid="share-panel"
      width={520}
      data-state={sharing.standing}
    >
      <Heading level={2} display id="share-heading">Share {name}</Heading>

      {!state ? (
        <p className="t-meta mt-1 text-ink-3">Reading…</p>
      ) : !sharing.ordinary ? (
        <ShareWords state={state} />
      ) : (
        <>
          <p className="t-meta mt-1 text-ink-2">
            Everyone with an invite edits the same project, online or off,
            and keeps a whole copy. There is no owner: every member can
            invite, and every member can remove.
          </p>

          {invite ? (
            <>
              <div className="nx-sheet-label">An invite for one person, usable once</div>
              <InviteField sharing={sharing} />
            </>
          ) : null}

          <div className="nx-sheet-label">Members</div>
          <ul className="nx-members">
            <li className="nx-member">
              <span className="text-ink">You</span>
              <span className="nx-member-tail">this computer</span>
            </li>
            {sharing.others.map((member) => (
              <li key={member.peer} className="nx-member" data-testid="member-row">
                <span className="min-w-0 truncate text-ink">
                  {member.name || "Unnamed"}
                </span>
                <span className="nx-member-tail">
                  {/* Only the word that carries news: "away" on every
                      row read as a network problem. */}
                  {member.connected ? <span className="text-ok">connected</span> : null}
                  <Button
                    size="inline"
                    className="nx-member-remove"
                    onClick={() => sharing.setConfirming(
                      confirming === member.peer ? "" : member.peer,
                    )}
                  >
                    Remove
                  </Button>
                </span>
                {confirming === member.peer ? <RemoveConfirm sharing={sharing} peer={member.peer} /> : null}
              </li>
            ))}
          </ul>
          {/* The app has a name for you; answering "who am I here" with a
              hash contradicted the field that asked for one, so the hash
              is said only while there is no name. */}
          {!me && state.me ? (
            <p className="t-micro mt-1 text-ink-3">
              You have not set a name, so collaborators will see{" "}
              <code className="t-code-sm">{state.me.slice(0, 8)}</code>.
              Settings sets one.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="t-meta mt-3 text-error" data-testid="share-error">
          {error}
        </p>
      ) : null}

      {leaving ? <LeaveConfirm sharing={sharing} /> : null}

      <div className="nx-sheet-foot">
        {sharing.sharing && !leaving ? (
          <Button
            variant="quiet"
            className="mr-auto !text-error"
            data-testid="leave-share"
            disabled={busy}
            onClick={() => sharing.setLeaving(true)}
          >
            Stop sharing
          </Button>
        ) : state?.shared && state.removed ? (
          /* The record of the share is still here, saying removed, and
             it would say so on every visit. Keeping the copy makes the
             project an ordinary one of this install's own. */
          <Button
            variant="quiet"
            className="mr-auto"
            disabled={busy}
            data-testid="keep-as-own"
            onClick={() => sharing.leave(false)}
          >
            {busy ? "Keeping…" : "Keep it as a project of my own"}
          </Button>
        ) : null}
        <Button variant="quiet" data-testid="share-close" onClick={onClose}>
          Done
        </Button>
        {sharing.ordinary ? (
          <Button
            variant="pen"
            disabled={busy}
            data-testid="make-invite"
            onClick={sharing.makeInvite}
          >
            {busy ? "Making…" : "Make an invite"}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
