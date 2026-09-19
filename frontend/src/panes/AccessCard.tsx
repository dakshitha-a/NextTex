import { useCallback, useEffect, useRef, useState } from "react";
import api, { type AuthState } from "../api";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Field as KitField, Heading as KitHeading } from "../ui/controls";
import { ago } from "../when";

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
/** Announced the moment a password is saved, rather than on the way out.
 *
 *  It was a callback prop, and a prop only reaches the one place that passes
 *  it.  This card has two mount points -- the nudge at the foot of the
 *  project list, and the settings row behind the cog -- and only the first
 *  passed the callback, so setting a password from the cog left the nudge
 *  three inches below still saying the install had no password, for the rest
 *  of the visit.  An event reaches both, and a third mount point later cannot
 *  forget to wire it.  The same shape as APPEARANCE_CHANGED in appearance.ts,
 *  and for the same reason: the thing that needs to know is not the thing
 *  that opened this. */
export const ACCESS_CHANGED = "nexttex:access";

export default function AccessCard({
  onClose,
  focus = "password",
}: {
  onClose: () => void;
  /** Which field takes the cursor.  The nudge on the projects screen opens
   *  this wanting the password; the settings row opens it wanting whatever
   *  the reader came for, which is usually the name. */
  focus?: "password" | "name";
}) {
  const [state, setState] = useState<AuthState | null>(null);
  const [reading, setReading] = useState(true);
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [done, setDone] = useState("");
  const first = useRef<HTMLInputElement | null>(null);
  const leaving = useRef<number | null>(null);
  const alive = useRef(true);


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

  /** Read the install's settings.  Pulled out of its effect so the failure
   *  path has something to offer: it used to be a bare one-shot, and a
   *  failed read set `error` while leaving `state` null -- but the region
   *  that draws `error` is inside the branch that requires `state`, so the
   *  card sat on "Reading…" with no message, no retry and no way to find
   *  out what had happened, and reopening it ran the same one shot again. */
  const read = useCallback(() => {
    setError("");
    setReading(true);
    return api
      .auth()
      .then((next) => {
        if (!alive.current) return;
        setState(next);
        setName(next.displayName);
      })
      .catch(() => {
        if (alive.current) setError("Could not read this install's settings.");
      })
      .finally(() => {
        if (alive.current) setReading(false);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    read();
    return () => {
      alive.current = false;
    };
  }, [read]);

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
      window.dispatchEvent(new CustomEvent(ACCESS_CHANGED));
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
    // Cleared on the way in, as saving a password already did. An error
    // wins the region below outright and has no timer, so one that is left
    // standing does not merely linger: it hides the confirmation of every
    // action that succeeds afterwards.
    setError("");
    try {
      await api.setDisplayName(trimmed);
      setState({ ...state, displayName: trimmed });
      setSaid("Name saved.");
    } catch {
      setError("Could not save that name.");
    }
  };

  const signOutOthers = async () => {
    setError("");
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
    <Sheet open onClose={onClose} labelledBy="access-heading" testid="access-card" width={420}>
        <div className="flex items-center justify-between pb-[6px]">
          <KitHeading id="access-heading">Access</KitHeading>
          <Button data-testid="access-close" onClick={onClose}>
            Close
          </Button>
        </div>

        {done ? (
          <p
            role="status"
            data-testid="access-done"
            className="t-meta pt-[2px] pb-[6px] text-ok"
          >
            {done}
          </p>
        ) : !state ? (
          // Reading, or the read failed. The second case used to be
          // indistinguishable from the first, for ever.
          <div className="pb-[4px]">
            {reading ? (
              <div className="t-meta text-ink-3">Reading…</div>
            ) : (
              <>
                <p className="t-meta text-error" data-testid="access-error">
                  {error || "Could not read this install's settings."}
                </p>
                <Button
                  variant="ghost"
                  className="mt-2"
                  data-testid="access-retry"
                  onClick={() => read()}
                >
                  Try again
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* --- the name ------------------------------------------- */}
            <Heading>Your name</Heading>
            <div className="py-[4px]">
              <p className="t-micro mb-[6px] text-ink-3">
                What collaborators see beside your cursor and your versions.
                Nothing leaves this machine until you share a project.
              </p>
              <KitField
                ref={focus === "name" ? first : undefined}
                value={name}
                data-testid="display-name"
                aria-label="Your name"
                placeholder="Your name"
                maxLength={60}
                frameClassName="w-full"
                onChange={(event) => setName(event.target.value)}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </div>

            {/* --- the password --------------------------------------- */}
            <Heading>{hasPassword ? "Change the password" : "Set a password"}</Heading>
            <form className="py-[4px]" onSubmit={savePassword}>
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
              <Button
                type="submit"
                variant="ghost"
                size="md"
                disabled={busy}
                data-testid="save-password"
                className="mt-[10px]"
              >
                {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
              </Button>
              {hasPassword ? (
                <p className="t-micro mt-[6px] text-ink-3">
                  Changing it signs every other browser out.
                </p>
              ) : null}
            </form>

            {/* --- who is signed in ----------------------------------- */}
            <Heading>Signed-in browsers</Heading>
            <ul className="py-[2px]">
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
                    title={`First signed in ${ago(one.created)}`}
                  >
                    {ago(one.lastSeen)}
                  </span>
                </li>
              ))}
              {state.sessions.length === 0 ? (
                <li className="t-micro py-[3px] text-ink-3">
                  None. This browser is using the printed link.
                </li>
              ) : null}
            </ul>
            <div className="pt-[6px] pb-[4px]">
              {others === 0 ? (
                <span className="t-micro text-ink-3">
                  No other browsers are signed in.
                </span>
              ) : (
                <Button data-testid="sign-out-others" onClick={signOutOthers}>
                  {`Sign out ${others} other browser${others === 1 ? "" : "s"}`}
                </Button>
              )}
            </div>

            <div aria-live="polite" className="pt-[8px] empty:hidden">
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
    </Sheet>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="nx-section-label">{children}</div>;
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
      <KitField
        ref={inputRef}
        type="password"
        value={value}
        autoComplete={autoComplete}
        frameClassName="w-full"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
