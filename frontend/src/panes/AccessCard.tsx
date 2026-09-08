import { useEffect, useRef, useState } from "react";
import api, { type AuthState } from "../api";
import { useDismiss } from "../useDismiss";

/** The password, the name collaborators see, and every browser signed in.
 *
 *  A sheet rather than another section of the settings card, which is 248px
 *  wide and already holds nine rows.  This one has a list in it whose length
 *  is not known in advance, and three of its controls are destructive enough
 *  to want a sentence of explanation beside them rather than a label.
 *
 *  The three things here belong together because they are the same subject
 *  seen three ways: what the front door is, who is currently through it, and
 *  what your name is once you are inside.  That last one reads oddly here
 *  until collaboration is switched on, at which point it is the first thing
 *  anyone looks for.
 */
export default function AccessCard({
  onClose,
  onSaved,
  focus = "password",
}: {
  onClose: () => void;
  /** Said as soon as a password is saved, rather than on the way out.
   *  Without it the nudge that opened this card goes on reading "this
   *  install has no password" underneath a card saying one has just been
   *  set -- for the second or so before the card leaves, the screen
   *  contradicts itself. */
  onSaved?: () => void;
  /** Which field takes the cursor.  The nudge on the projects screen opens
   *  this wanting the password; the settings row opens it wanting whatever
   *  the reader came for, which is usually the name. */
  focus?: "password" | "name";
}) {
  const [state, setState] = useState<AuthState | null>(null);
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [done, setDone] = useState("");
  const sheet = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  const leaving = useRef<number | null>(null);

  useDismiss(sheet, true, onClose);

  // A card whose whole job is done should not need dismissing. Left open,
  // it re-rendered as *"Change the password"*, complete with a Current
  // password field -- so the writer who had just set one was looking at a
  // screen implying it had not taken. Say it worked, then leave.
  useEffect(() => {
    if (!done) return;
    leaving.current = window.setTimeout(onClose, 1800);
    return () => {
      if (leaving.current) window.clearTimeout(leaving.current);
    };
  }, [done, onClose]);

  useEffect(() => {
    let live = true;
    api
      .auth()
      .then((next) => {
        if (!live) return;
        setState(next);
        setName(next.displayName);
      })
      .catch(() => live && setError("Could not read this install's settings."));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state) first.current?.focus();
  }, [state, focus]);

  // Said out loud rather than left as a colour change, and cleared after a
  // moment so the card does not accumulate a log of everything you did.
  useEffect(() => {
    if (!said) return;
    const timer = window.setTimeout(() => setSaid(""), 4000);
    return () => window.clearTimeout(timer);
  }, [said]);

  const hasPassword = state?.hasPassword ?? false;

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least eight characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two do not match.");
      return;
    }
    setBusy(true);
    try {
      const chosen = name.trim();
      await api.setPassword(password, current, chosen || undefined);
      setCurrent("");
      setPassword("");
      setConfirm("");
      // Not `said`, which clears itself after four seconds and would race
      // the close; and not a re-read of the state, which is what turned
      // this back into a form.
      onSaved?.();
      setDone(
        hasPassword
          ? "Password changed. Your other browsers were signed out."
          : chosen
            ? `Password set, and you are ${chosen} to your collaborators.`
            : "Password set. This browser stays signed in.",
      );
    } catch (failure: any) {
      setError(failure?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!state || trimmed === state.displayName) return;
    try {
      await api.setDisplayName(trimmed);
      setState({ ...state, displayName: trimmed });
      setSaid("Name saved.");
    } catch {
      setError("Could not save that name.");
    }
  };

  const signOutOthers = async () => {
    try {
      const { sessions } = await api.signOutOthers();
      setState(state ? { ...state, sessions } : state);
      setSaid("Every other browser was signed out.");
    } catch {
      setError("Could not sign the other browsers out.");
    }
  };

  const others = (state?.sessions ?? []).filter((one) => !one.current).length;

  return (
    <div
      className="nx-scrim fixed inset-0 z-50 grid place-items-center p-6"
      role="presentation"
    >
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-heading"
        data-testid="access-card"
        className="nx-arrive max-h-full w-[380px] overflow-y-auto rounded-[5px] border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between px-[12px] pt-[10px] pb-[6px]">
          <span id="access-heading" className="t-ui text-ink">
            Access
          </span>
          <button
            className="quiet t-micro"
            data-testid="access-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {done ? (
          <p
            role="status"
            data-testid="access-done"
            className="t-meta px-[12px] pt-[2px] pb-[14px] text-ok"
          >
            {done}
          </p>
        ) : !state ? (
          <div className="t-meta px-[12px] pb-[12px] text-ink-3">Reading…</div>
        ) : (
          <>
            {/* --- the name ------------------------------------------- */}
            <Heading>Your name</Heading>
            <div className="px-[12px] py-[8px]">
              <p className="t-micro mb-[6px] text-ink-3">
                What collaborators see beside your cursor and your versions.
                Nothing leaves this machine until you share a project.
              </p>
              <input
                ref={focus === "name" ? first : undefined}
                value={name}
                data-testid="display-name"
                aria-label="Your name"
                placeholder="Your name"
                maxLength={60}
                className="w-full rounded-[3px] border border-line bg-surround px-[8px] py-[5px] text-ink"
                onChange={(event) => setName(event.target.value)}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </div>

            {/* --- the password --------------------------------------- */}
            <Heading>{hasPassword ? "Change the password" : "Set a password"}</Heading>
            <form className="px-[12px] py-[8px]" onSubmit={savePassword}>
              {!hasPassword ? (
                <p className="t-micro mb-[8px] border-l-2 border-warn pl-[8px] text-ink-2">
                  Until you set one, the only way in is the link the server
                  printed, and anyone holding that link can read and edit your
                  projects.
                </p>
              ) : null}
              {hasPassword ? (
                <Field
                  label="Current password"
                  value={current}
                  autoComplete="current-password"
                  onChange={setCurrent}
                  inputRef={focus === "password" ? first : undefined}
                />
              ) : null}
              <Field
                label={hasPassword ? "New password" : "Password"}
                value={password}
                autoComplete="new-password"
                onChange={setPassword}
                inputRef={!hasPassword && focus === "password" ? first : undefined}
              />
              <Field
                label="Again"
                value={confirm}
                autoComplete="new-password"
                onChange={setConfirm}
              />
              <button
                type="submit"
                disabled={busy}
                data-testid="save-password"
                className="pen-button t-ui mt-[10px] h-[28px] w-full"
              >
                {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
              </button>
              {hasPassword ? (
                <p className="t-micro mt-[6px] text-ink-3">
                  Changing it signs every other browser out.
                </p>
              ) : null}
            </form>

            {/* --- who is signed in ----------------------------------- */}
            <Heading>Signed-in browsers</Heading>
            <ul className="px-[12px] py-[4px]">
              {state.sessions.map((one) => (
                <li
                  key={one.id}
                  className="flex items-baseline justify-between gap-2 py-[3px]"
                >
                  <span className="t-meta min-w-0 truncate text-ink-2">
                    {one.label || "A browser"}
                    {one.current ? (
                      <span className="t-micro ml-[6px] rounded-[3px] bg-surface-3 px-[4px] text-ink-3">
                        this one
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="t-micro tnum shrink-0 text-ink-3"
                    title={`First signed in ${when(one.created)}`}
                  >
                    {when(one.lastSeen)}
                  </span>
                </li>
              ))}
              {state.sessions.length === 0 ? (
                <li className="t-micro py-[3px] text-ink-3">
                  None. This browser is using the printed link.
                </li>
              ) : null}
            </ul>
            <div className="px-[12px] pt-[2px] pb-[12px]">
              {others === 0 ? (
                <span className="t-micro text-ink-3">
                  No other browsers are signed in.
                </span>
              ) : (
                <button
                  className="ghost-button t-micro h-[24px] px-2"
                  data-testid="sign-out-others"
                  onClick={signOutOthers}
                >
                  {`Sign out ${others} other browser${others === 1 ? "" : "s"}`}
                </button>
              )}
            </div>

            <div aria-live="polite" className="px-[12px] pb-[10px] empty:hidden">
              {error ? (
                <p className="t-micro text-error" data-testid="access-error">
                  {error}
                </p>
              ) : said ? (
                <p className="t-micro text-ok" data-testid="access-said">
                  {said}
                </p>
              ) : null}
            </div>
          </>
        )}
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

function Field({
  label,
  value,
  autoComplete,
  onChange,
  inputRef,
}: {
  label: string;
  value: string;
  autoComplete: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="mt-[6px] block first:mt-0">
      {label ? (
        <span className="t-micro mb-[3px] block text-ink-3">{label}</span>
      ) : null}
      <input
        ref={inputRef}
        type="password"
        value={value}
        autoComplete={autoComplete}
        className="w-full rounded-[3px] border border-line bg-surround px-[8px] py-[5px] text-ink"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** "4 minutes ago", roughly.  Rough is the point: the row exists so someone
 *  can recognise a machine, and a timestamp to the second invites reading it
 *  as a security log, which it is not. */
function when(at: number): string {
  const seconds = Math.max(0, (Date.now() - at * 1000) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
