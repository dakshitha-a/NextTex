import { IconButton } from "../ui/Button";
import { SettingsIcon } from "../ui/icons";
import { Suspense, lazy, useEffect, useRef, useState } from "react";

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
  openNonce = 0,
}: {
  onTutorial?: () => void;
  onChangeAgent?: () => void;
  /** Whether a project is on screen.  See the note in `SettingsSheet`. */
  inProject?: boolean;
  /** Counted up by the command palette to open the sheet from there: the
   *  sheet is this trigger's own state, and the trigger sits in whichever
   *  bar the layout is drawing, so a count is what reaches it. */
  openNonce?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openNonce) setOpen(true);
  }, [openNonce]);
  const [access, setAccess] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="relative flex items-center">
      <IconButton
        ref={trigger}
        label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="appearance"
        on={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsIcon />
      </IconButton>

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

/* The settings control is the kit's sliders glyph now (ui/icons.tsx); the
   six-toothed cog that stood here is in the history if it is wanted. */
