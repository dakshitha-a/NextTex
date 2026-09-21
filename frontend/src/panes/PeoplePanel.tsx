import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty } from "../ui/controls";
import {
  InviteField, LeaveConfirm, RemoveConfirm, ShareWords, useSharing,
} from "./SharePanel";

/** The People drawer: who is in this project, and the way in for others.
 *
 *  The writer asked for the share panel to become "the collaborator
 *  management hub: a place where the user can see collaborators, invite
 *  new ones, kick out existing ones".  It is a drawer on the bar now,
 *  between Git and Build, and the strip's faces open it.  The logic is
 *  `SharePanel.tsx`'s `useSharing`, shared with the sheet the projects
 *  screen opens on a row; this is the drawer's layout of it, as the
 *  direction page draws it.
 *
 *  Presence on a row comes from two records that do not know each other:
 *  the share's member list (who is in, and whether their install is
 *  connected) and the live collaborators (who has a cursor in a file, and
 *  whether they typed within the last minute), joined by name, since the
 *  member record carries no client id and the cursor no peer id.  The dot
 *  is the collaborator's colour, filled while they are typing, outlined
 *  while they are only present; a member whose install is connected but
 *  who has no cursor is "connected", and one whose install is not is "not
 *  connected", with the dot in the third ink.  "You" is first, in the
 *  file you are in.
 */
export default function PeoplePanel({ inviteNonce, onLeft }: {
  /** Bumped by the drawer's heading button: make an invite. */
  inviteNonce: number;
  /** The copy on this machine was deleted on the way out of the share. */
  onLeft: () => void;
}) {
  const projectId = useStore((s) => s.projectId) ?? "";
  const collaborators = useStore((s) => s.collaborators);
  const activePath = useStore((s) => s.activePath);
  const sharing = useSharing(projectId, onLeft);
  const { state, invite, busy, error, confirming, leaving } = sharing;

  const lastNonce = useRef(inviteNonce);
  useEffect(() => {
    if (inviteNonce === lastNonce.current) return;
    lastNonce.current = inviteNonce;
    void sharing.makeInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteNonce]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="share-panel"
      data-state={sharing.standing}
    >
      {!state ? (
        <p className="nx-note">Reading</p>
      ) : !sharing.ordinary ? (
        <div className="px-4 pt-1"><ShareWords state={state} /></div>
      ) : !sharing.sharing ? (
        <>
          <Empty
            action={
              <Button variant="pen" data-testid="share-start" disabled={busy} onClick={sharing.makeInvite}>
                {busy ? "Sharing…" : "Share this project"}
              </Button>
            }
          >
            Share this project and everyone in it keeps a whole copy, online
            or off, with the history. There is no owner: every member can
            invite, and every member can remove.
          </Empty>
          <p className="nx-note">
            An invite is for one person and usable once. Send it the way you
            would send a password.
          </p>
        </>
      ) : (
        <>
          <div className="nx-drawer-label">In this project</div>
          <ul className="nx-people" data-testid="people-list">
            <li className="nx-person" style={{ color: "var(--ink-3)" }}>
              <span className="nx-person-dot" data-in="true" aria-hidden="true" />
              <span className="nx-person-name">You</span>
              <span className="nx-person-what">{activePath ? shortPath(activePath) : "not in a file"}</span>
            </li>
            {sharing.others.map((member) => {
              const live = collaborators.find((person) => person.name === member.name);
              // A cursor is the stronger evidence: it says where they are.
              const what = live
                ? live.path ? shortPath(live.path) : "not in a file"
                : member.connected ? "connected" : "not connected";
              return (
                <li
                  key={member.peer}
                  className="nx-person"
                  style={{ color: live ? live.colour : "var(--ink-3)" }}
                  data-testid="member-row"
                  data-connected={member.connected ? "true" : undefined}
                >
                  <span className="nx-person-dot" data-in={live?.active ? "true" : undefined} aria-hidden="true" />
                  <span className="nx-person-name">{member.name || "Unnamed"}</span>
                  <span className="nx-person-what" title={live?.path || undefined}>{what}</span>
                  <Button
                    variant="quiet"
                    size="sm"
                    className="nx-person-remove !text-error"
                    data-testid="member-remove"
                    onClick={() => sharing.setConfirming(confirming === member.peer ? "" : member.peer)}
                  >
                    Remove
                  </Button>
                  {confirming === member.peer ? <RemoveConfirm sharing={sharing} peer={member.peer} /> : null}
                </li>
              );
            })}
          </ul>
          {invite ? (
            <>
              <div className="nx-drawer-label">An invite for one person, usable once</div>
              <div className="px-2"><InviteField sharing={sharing} /></div>
              <p className="nx-note">Expires in a week. Send it the way you would send a password.</p>
            </>
          ) : null}
        </>
      )}

      {error ? (
        <p className="nx-note text-error" data-testid="share-error">{error}</p>
      ) : null}

      <span className="flex-1" />

      {leaving ? <div className="px-2"><LeaveConfirm sharing={sharing} /></div> : null}

      {sharing.sharing || (state?.shared && state.removed) ? (
        <div className="nx-drawer-foot">
          {sharing.sharing && !leaving ? (
            <Button
              variant="quiet"
              size="sm"
              className="!text-error"
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
              size="sm"
              disabled={busy}
              data-testid="keep-as-own"
              onClick={() => sharing.leave(false)}
            >
              {busy ? "Keeping…" : "Keep it as a project of my own"}
            </Button>
          ) : null}
          <span className="flex-1" />
          {sharing.sharing ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              data-testid="make-invite-foot"
              onClick={sharing.makeInvite}
            >
              {busy ? "Making…" : "Make an invite"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** `chapters/02_theory.tex` as `02_theory.tex`: the folder is rarely the
 *  interesting half, and the row is narrow. */
function shortPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
