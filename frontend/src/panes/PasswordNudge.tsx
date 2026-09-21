import { Suspense, lazy, useEffect, useRef, useState } from "react";
import api from "../api";
import { readStored, writeStored } from "../appearance";
import { IconButton, Button } from "../ui/Button";
import { FloatingCard } from "../ui/FloatingCard";
import { LockIcon } from "../ui/icons";

const AccessCard = lazy(() => import("./AccessCard"));
/** Named here rather than imported from the card, which is a lazy chunk:
 *  importing the constant would pull the whole card into the entry bundle
 *  and undo the reason it is lazy. */
const ACCESS_CHANGED = "nexttex:access";

/** A lock on the projects screen's app bar, in the warning colour, while
 *  this install has no password.
 *
 *  Not a modal, and not a screen you have to get past.  The same rule the
 *  update button follows applies here: this is the first screen of every
 *  session, and a thing that blocks it will be dismissed reflexively by the
 *  third time it appears, which teaches people to dismiss it before reading.
 *
 *  So it is one glyph on the bar.  Resting on it, or focusing it, opens a
 *  card with the actual consequence, that anyone with the link can read and
 *  edit your projects, the one action, and the way to put it away for good;
 *  a press on the lock opens the access card straight away.  Somebody
 *  writing alone on a laptop that never leaves the desk is making a
 *  reasonable choice by ignoring it, and the interface should not imply
 *  otherwise.
 *
 *  It asks the server on mount, and again whenever a password is saved
 *  anywhere in the app, and never on a timer.
 */

const DISMISSED = "nexttex.password.dismissed";

export default function PasswordNudge() {
  const [needed, setNeeded] = useState(false);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(false);
  const [gone, setGone] = useState(() => readStored(DISMISSED) === "yes");
  const leave = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const ask = () =>
      api
        .auth()
        .then((state) => live && setNeeded(!state.hasPassword))
        // Silent on failure. A nudge that cannot check is not a thing to
        // report; the writer came here to open a document.
        .catch(() => undefined);
    ask();
    // The card this lock opens is not the only one that can set a password.
    // The settings sheet opens the same card, and a save there used to
    // leave this saying the install had no password for the rest of the
    // visit.  Whichever card saves, it says so, and this hears it.
    window.addEventListener(ACCESS_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(ACCESS_CHANGED, ask);
    };
  }, []);

  useEffect(() => () => {
    if (leave.current) window.clearTimeout(leave.current);
  }, []);

  const dismiss = () => {
    setCard(false);
    setGone(true);
    writeStored(DISMISSED, "yes");
  };

  const recheck = () => {
    setOpen(false);
    api.auth().then((state) => setNeeded(!state.hasPassword)).catch(() => undefined);
  };

  // The card stays while the pointer crosses from the lock to it: leaving
  // either arms a short timer that entering the other cancels.
  const show = () => {
    if (leave.current) window.clearTimeout(leave.current);
    leave.current = null;
    setCard(true);
  };
  const hide = () => {
    if (leave.current) window.clearTimeout(leave.current);
    leave.current = window.setTimeout(() => setCard(false), 160);
  };

  // One `AccessCard`, in one place in the tree, whether or not the lock is
  // still being shown: the moment `needed` turns false the card would
  // otherwise be unmounted mid-"Password set" and remounted as "Change the
  // password", which is the very thing this is meant to stop.
  return (
    <>
      {needed && !gone ? (
        <span
          className="relative flex items-center"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
          }}
        >
          {/* `--warn` because this is a state and not a note. */}
          <IconButton
            label="This install has no password"
            className="nx-appbar-lock"
            data-testid="password-nudge"
            aria-haspopup="dialog"
            onClick={() => {
              setCard(false);
              setOpen(true);
            }}
          >
            <LockIcon size={18} />
          </IconButton>
          {card ? (
            <FloatingCard
              className="nx-lock-card"
              role="tooltip"
              data-testid="password-card"
              onMouseEnter={show}
              onMouseLeave={hide}
            >
              <div className="nx-lock-title">This install has no password</div>
              <p className="nx-lock-text">
                Anyone with the link the server printed can read and edit your
                projects.
              </p>
              <div className="nx-lock-actions">
                <Button
                  variant="ghost"
                  data-testid="set-password"
                  onClick={() => {
                    setCard(false);
                    setOpen(true);
                  }}
                >
                  Set a password
                </Button>
                {/* Not "Not now": the update sheet on this same screen has a
                    button by that name, and two controls with one accessible
                    name doing two different things is a real problem for
                    anybody navigating by name.  Saying the condition under
                    which ignoring this is reasonable is also more honest
                    than a soft deferral. */}
                <Button variant="quiet" data-testid="only-one-here" onClick={dismiss}>
                  I'm the only one here
                </Button>
              </div>
            </FloatingCard>
          ) : null}
        </span>
      ) : null}

      {open ? (
        <Suspense fallback={null}>
          <AccessCard onClose={recheck} />
        </Suspense>
      ) : null}
    </>
  );
}
