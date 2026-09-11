import { Suspense, lazy, useEffect, useState } from "react";
import api from "../api";

const AccessCard = lazy(() => import("./AccessCard"));
/** Named here rather than imported from the card, which is a lazy chunk:
 *  importing the constant would pull the whole card into the entry bundle
 *  and undo the reason it is lazy. */
const ACCESS_CHANGED = "nexttex:access";

/** A quiet line at the foot of the project list, when this install has no
 *  password.
 *
 *  Not a modal, and not a screen you have to get past.  The same rule the
 *  update footer turns on applies here: this is the first screen of every
 *  session, and a thing that blocks it will be dismissed reflexively by the
 *  third time it appears, which teaches people to dismiss it before reading.
 *
 *  So it states the actual consequence -- anyone with the link can read and
 *  edit your projects -- offers the one action, and can be put away for
 *  good.  Somebody writing alone on a laptop that never leaves the desk is
 *  making a reasonable choice by ignoring it, and the interface should not
 *  imply otherwise.
 *
 *  It asks the server on mount, and again whenever a password is saved
 *  anywhere in the app, and never on a timer.
 */

const DISMISSED = "nexttex.password.dismissed";

export default function PasswordNudge() {
  const [needed, setNeeded] = useState(false);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED) === "yes";
    } catch {
      return false;
    }
  });

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
    // The card this line opens is not the only one that can set a password.
    // The cog opens the same card from the settings sheet, and a save there
    // used to leave this line three inches below still saying the install
    // had no password, for the rest of the visit: the answer was read once
    // on mount and the only thing that revised it was this card's own
    // callback. Whichever card saves, it says so, and this hears it.
    window.addEventListener(ACCESS_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(ACCESS_CHANGED, ask);
    };
  }, []);

  const dismiss = () => {
    setGone(true);
    try {
      window.localStorage.setItem(DISMISSED, "yes");
    } catch {
      /* a private window: the choice lasts this session */
    }
  };

  const recheck = () => {
    setOpen(false);
    api.auth().then((state) => setNeeded(!state.hasPassword)).catch(() => undefined);
  };

  // One `AccessCard`, in one place in the tree, whether or not the line
  // above it is still being shown.  It used to be written out twice, once
  // in each branch of an early return, and React treats those as two
  // different elements: the moment `needed` turned false the open card was
  // unmounted and a fresh one mounted in the other branch, which threw away
  // the "Password set" it was in the middle of showing and re-read the
  // settings -- so the card came back as *"Change the password"*, which is
  // the very thing this is meant to stop.
  return (
    <>
      {needed && !gone ? (
        <div
          className="mt-6 border-t border-line pt-3"
          data-testid="password-nudge"
        >
          {/* `--warn` because this is a state and not a note. It sat at the
              foot of the page in plain body text, under the fold of
              attention, reading like a settings row. */}
          <p className="t-meta border-l-2 border-warn pl-[10px] text-ink-2">
            This install has no password. Anyone with the link the server
            printed can read and edit your projects.
          </p>
          <div className="mt-2 flex items-center gap-4">
            <button
              className="ghost-button h-[26px] px-3 t-ui"
              data-testid="set-password"
              onClick={() => setOpen(true)}
            >
              Set a password
            </button>
            {/* Not "Not now": the update footer on this same screen already
                has a button by that name, and two controls with one
                accessible name doing two different things is a real problem
                for anybody navigating by name rather than by position.
                Saying the condition under which ignoring this is reasonable
                is also more honest than a soft deferral -- somebody writing
                alone on a laptop that never leaves the desk is making a fine
                choice here. */}
            <button className="quiet t-micro" onClick={dismiss}>
              I'm the only one here
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <Suspense fallback={null}>
          <AccessCard onClose={recheck} />
        </Suspense>
      ) : null}
    </>
  );
}
