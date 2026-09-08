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
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState("");
  const sheet = useRef<HTMLDivElement | null>(null);

  useDismiss(sheet, true, onClose);

  const refresh = () =>
    api.collab(projectId).then(setState).catch(() => setError(
      "Could not read this project's sharing.",
    ));

  useEffect(() => {
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
        className="nx-arrive max-h-full w-[420px] overflow-y-auto rounded-[5px] border border-line bg-surface shadow-float"
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
        ) : !state.shared ? (
          <div className="px-[12px] pb-[12px]">
            <p className="t-meta text-ink-2">
              Sharing sends this project to other people running NextTex. Each
              of them keeps a whole copy — the files, the history, their own
              git — and everyone's editing is merged as it happens, including
              anything written while somebody was offline.
            </p>
            <p className="t-micro mt-[8px] text-ink-3">
              Nobody owns a shared project. Anyone in it can invite somebody
              else, and anyone can disconnect anybody.
            </p>
            <button
              className="ghost-button t-ui mt-[10px] h-[28px] w-full"
              disabled={busy}
              data-testid="start-sharing"
              onClick={share}
            >
              {busy ? "Starting…" : "Share this project"}
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
                className="ghost-button t-ui mt-[8px] h-[28px] w-full"
                disabled={busy}
                data-testid="make-invite"
                onClick={makeInvite}
              >
                {busy ? "Making…" : "Create an invite"}
              </button>
              {invite ? (
                <>
                  <textarea
                    readOnly
                    value={invite}
                    data-testid="invite-text"
                    aria-label="The invite to send"
                    rows={3}
                    className="t-code-sm mt-[8px] w-full resize-none rounded-[3px] border border-line bg-surround px-[8px] py-[5px] text-ink"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <p className="t-micro mt-[4px] text-ok empty:hidden">
                    {copied ? "Copied to your clipboard." : ""}
                  </p>
                </>
              ) : null}
            </div>

            <Heading>In this project</Heading>
            <ul className="px-[12px] py-[4px]">
              {others.length === 0 ? (
                <li className="t-micro py-[3px] text-ink-3">
                  Only you, so far.
                </li>
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
                        they already have — they keep the files, the history
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

            <p className="t-micro px-[12px] pt-[2px] pb-[12px] text-ink-3">
              Your peer name is{" "}
              <code className="t-code-sm">{state.me.slice(0, 12)}…</code>
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
