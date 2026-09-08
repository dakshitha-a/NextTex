import { Suspense, lazy, useEffect, useState } from "react";
import api from "../api";

const AccessCard = lazy(() => import("./AccessCard"));

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
 *  It asks the server once, on mount, and never on a timer.
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
    api
      .auth()
      .then((state) => live && setNeeded(!state.hasPassword))
      // Silent on failure. A nudge that cannot check is not a thing to
      // report; the writer came here to open a document.
      .catch(() => undefined);
    return () => {
      live = false;
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

  if (!needed || gone) {
    return open ? (
      <Suspense fallback={null}>
        <AccessCard
          onClose={() => {
            setOpen(false);
            api.auth().then((state) => setNeeded(!state.hasPassword)).catch(() => undefined);
          }}
        />
      </Suspense>
    ) : null;
  }

  return (
    <>
      <div
        className="mt-6 border-t border-line pt-3"
        data-testid="password-nudge"
      >
        {/* `--warn` because this is a state and not a note. It sat at the
            foot of the page in plain body text, under the fold of
            attention, reading like a settings row. */}
        <p className="t-meta border-l-2 border-warn pl-[10px] text-ink-2">
          This install has no password. Anyone with the link the server printed
          can read and edit your projects.
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

      {open ? (
        <Suspense fallback={null}>
          <AccessCard
            onClose={() => {
              setOpen(false);
              api
                .auth()
                .then((state) => setNeeded(!state.hasPassword))
                .catch(() => undefined);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
