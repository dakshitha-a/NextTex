import { Suspense, lazy, useRef, useState } from "react";

/** Both of these are fetched when they are opened rather than before
 *  anything draws.  The cog is on screen in every session; the sheet
 *  behind it is opened in very few, and `bundle.initial_kb` counts only
 *  what a first visit has to download. */
const AccessCard = lazy(() => import("./AccessCard"));
const SettingsSheet = lazy(() => import("./SettingsSheet"));

/** The way in to everything the writer gets to choose.
 *
 *  This file used to be the card as well as the button, and the card had
 *  grown to thirteen rows in a 248 pixel column hanging off a 26 pixel
 *  cog.  The card is a sheet now and lives in `SettingsSheet.tsx`; what is
 *  left here is the cog, which is the part that is always on screen.
 *
 *  The cog rather than `Aa`: the glyph read `Aa` while the card held three
 *  typographic controls, and stopped being right the moment the same card
 *  also decided whether the document compiles as you type.  A cog is what
 *  people look for when the thing they want is not on screen anywhere else.
 */
export default function Settings({
  onTutorial,
  onChangeAgent,
  inProject = false,
}: {
  onTutorial?: () => void;
  onChangeAgent?: () => void;
  /** Whether a project is on screen.  See the note in `SettingsSheet`. */
  inProject?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="relative flex items-center">
      <button
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="appearance"
        title="Settings"
        aria-label="Settings"
        className="quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
        onClick={() => setOpen((value) => !value)}
      >
        <Cog />
      </button>

      {open ? (
        <Suspense fallback={null}>
          <SettingsSheet
            onClose={close}
            onTutorial={onTutorial}
            onChangeAgent={onChangeAgent}
            onOpenAccess={() => setAccess(true)}
            inProject={inProject}
          />
        </Suspense>
      ) : null}

      {/* Outside the sheet deliberately: the settings sheet closes on its
          way to opening this one, and this must not go with it. */}
      {access ? (
        <Suspense fallback={null}>
          <AccessCard onClose={() => setAccess(false)} focus="name" />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Six teeth, not eight, and filled rather than stroked.  A stroked gear at
 *  13px puts a 1.4px line either side of a 1.5px tooth and the teeth close
 *  up -- the same way the logo's two chevrons did at 18px.  Geometry, so it
 *  can be redrawn: centre (8,8), root radius 5.1, tip radius 7.1, six teeth
 *  at 60° with a 20° root half-angle and a 10.5° tip half-angle, hub radius
 *  2.4 knocked out with evenodd so the button's hover fill shows through. */
function Cog() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.26 3.21 L6.71 1.02 A7.10 7.10 0 0 1 9.29 1.02 L9.74 3.21 A5.10 5.10 0 0 1 11.28 4.09
           L13.40 3.39 A7.10 7.10 0 0 1 14.69 5.63 L13.02 7.11 A5.10 5.10 0 0 1 13.02 8.89
           L14.69 10.37 A7.10 7.10 0 0 1 13.40 12.61 L11.28 11.91 A5.10 5.10 0 0 1 9.74 12.79
           L9.29 14.98 A7.10 7.10 0 0 1 6.71 14.98 L6.26 12.79 A5.10 5.10 0 0 1 4.72 11.91
           L2.60 12.61 A7.10 7.10 0 0 1 1.31 10.37 L2.98 8.89 A5.10 5.10 0 0 1 2.98 7.11
           L1.31 5.63 A7.10 7.10 0 0 1 2.60 3.39 L4.72 4.09 A5.10 5.10 0 0 1 6.26 3.21 Z
           M5.60 8.00 a2.40 2.40 0 1 0 4.80 0 a2.40 2.40 0 1 0 -4.80 0 Z"
      />
    </svg>
  );
}
