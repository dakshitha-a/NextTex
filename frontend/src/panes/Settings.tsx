import { useRef, useState } from "react";
import api from "../api";
import { get, set, useStore } from "../store";
import { useDismiss } from "../useDismiss";
import {
  DEFAULTS,
  EDITOR_SIZES,
  SCALES,
  applyAppearance,
  isDefault,
  step,
  storedAppearance,
  type Appearance,
} from "../appearance";

/** Everything the writer gets to choose, in one card.
 *
 *  This used to be the appearance card, and its trigger read `Aa` --
 *  correct while the card held three typographic controls, and wrong the
 *  moment the same card also decided whether the document compiles as you
 *  type.  A cog is the glyph people look for when the thing they want is
 *  not on screen anywhere else.
 *
 *  Two sections, because the two halves answer to different things.
 *  Appearance is global and lives in localStorage: a person's eyes do not
 *  change between documents.  The three switches are per project and live
 *  in its nexttex.toml, because whether a document compiles as you type is
 *  a fact about the document -- a forty-file dissertation takes nineteen
 *  seconds to build and a one-page note takes one.
 *
 *  The appearance half owns its state rather than taking it as a prop:
 *  there is exactly one appearance, it is stamped on the document, and
 *  threading it through four mount points would be four chances to
 *  disagree.
 */
export default function Settings({
  onTutorial,
  align = "right",
  inProject = false,
}: {
  /** Opens the tutorial sheet.  Absent on the projects screen, which has a
   *  question mark of its own for the same job. */
  onTutorial?: () => void;
  align?: "left" | "right";
  /** Whether a project is on screen.  Asked of the mount point rather than
   *  read from the store: leaving the editor for the project list does not
   *  clear `projectId` -- the app keeps it so a reload comes back to the
   *  document -- so the store cannot tell the two screens apart, and the
   *  card would offer three per-project switches on a screen listing every
   *  project. */
  inProject?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [look, setLook] = useState<Appearance>(() => storedAppearance());
  const projectId = useStore((s) => s.projectId);
  const project = useStore((s) => s.settings);
  const card = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useDismiss(card, open, close, trigger);

  const change = (patch: Partial<Appearance>) => {
    const next = { ...look, ...patch };
    setLook(next);
    applyAppearance(next);
  };

  const toggle = (
    patch: Partial<{ autocompile: boolean; markErrors: boolean; markWarnings: boolean }>,
  ) => {
    if (!projectId) return;
    // Applied here and confirmed by the server's `project_changed`, so the
    // switch answers the click rather than the round trip.
    set({ settings: { ...get().settings, ...patch } });
    api.setProjectSettings(projectId, patch).catch(() => {
      set({ settings: get().settings, error: "Could not save that setting." });
    });
  };

  // Which way the card opens is the mount point's business: in the rail it
  // sits near the left edge of a pane narrower than the card, so anchoring
  // it to the trigger's right edge would hang it off the window.
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
        <div
          ref={card}
          role="dialog"
          aria-labelledby="settings-heading"
          className={`nx-arrive absolute top-[30px] z-40 w-[248px] rounded-[5px] border border-line bg-surface shadow-float ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div id="settings-heading" className="t-ui px-[10px] pt-2 pb-1 text-ink">
            Settings
          </div>

          <Heading>Appearance</Heading>
          <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
            <span className="t-meta text-ink-2">Theme</span>
            <div
              role="group"
              aria-label="Theme"
              className="flex shrink-0 overflow-hidden rounded-[3px] border border-line"
            >
              {(["light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  aria-pressed={look.theme === option}
                  className={`t-micro px-2 py-[3px] transition-colors duration-[90ms] ${
                    look.theme === option
                      ? "bg-surface-3 text-ink"
                      : "text-ink-3 hover:text-ink"
                  }`}
                  onClick={() => change({ theme: option })}
                >
                  {option === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>

          <SizeRow
            label="Interface"
            what="interface"
            value={look.scale}
            steps={SCALES}
            display={`${look.scale}%`}
            onChange={(scale) => change({ scale })}
          />
          <SizeRow
            label="Editor text"
            what="editor text"
            value={look.editor}
            steps={EDITOR_SIZES}
            display={`${look.editor}px`}
            onChange={(editor) => change({ editor })}
          />

          {/* Absent rather than disabled when there is no project open --
              on the project list and the sign-in screen.  A control that
              cannot be enabled from where you are standing advertises a
              capability and then refuses, and three switches with no
              project would be lying about which project they belonged to.
              The app already works this way: the trash section appears
              only when it holds something. */}
          {inProject && projectId ? (
            <>
              <Heading>This project</Heading>
              <Switch
                label="Compile as you type"
                on={project.autocompile}
                off="⌘S compiles. Or Compile in the strip."
                onChange={(autocompile) => toggle({ autocompile })}
              />
              <Switch
                label="Mark errors in the text"
                on={project.markErrors}
                off="The status strip still counts them."
                onChange={(markErrors) => toggle({ markErrors })}
              />
              <Switch
                label="Mark warnings in the text"
                on={project.markWarnings}
                off="They stay in the diagnostics list."
                onChange={(markWarnings) => toggle({ markWarnings })}
              />
            </>
          ) : null}

          {/* Appearance only, and it says so.  A reset that quietly turned
              compile-as-you-type back on would be an action nobody asked
              for, hiding inside a word that sounds harmless. */}
          {/* Tutorial sits in the actions row rather than among the
              switches: it is something the card *does*, not something it
              holds the state of. */}
          <div className="flex h-[32px] items-center justify-between border-t border-line px-[10px]">
            {inProject && projectId && onTutorial ? (
              <button
                className="quiet t-micro"
                data-testid="tutorial-open"
                onClick={() => {
                  // `close()` rather than `setOpen(false)`: it puts focus
                  // back on the cog, which is what the sheet then reads as
                  // the thing to return focus to when it is dismissed.
                  close();
                  onTutorial();
                }}
              >
                Tutorial
              </button>
            ) : (
              <span />
            )}
            <button
              className="quiet t-micro"
              disabled={isDefault(look)}
              onClick={() => {
                setLook(DEFAULTS);
                applyAppearance(DEFAULTS);
              }}
            >
              Reset appearance
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="t-micro flex h-[22px] items-center border-t border-line px-[10px] text-ink-3">
      {children}
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

/** A switch, and the app's first.  Radius 3 rather than a pill, because
 *  radius means something here -- 0 panes, 3 rows and controls, 5 cards --
 *  and a 999-radius toggle would be the only object in the interface
 *  encoding nothing.  `--hint` because this is live interactive state that
 *  is not the agent, which is what the second accent exists for.
 *
 *  The knob's position changes at 0ms.  A sliding knob would be the only
 *  sliding thing in the app, and reduced motion strips transform
 *  transitions anyway, so animating it would give two behaviours for no
 *  gain.
 *
 *  The sub-line exists only in the off position, and answers the one
 *  question turning a switch off raises: did I just stop being told?
 */
function Switch({
  label,
  on,
  off,
  onChange,
}: {
  label: string;
  on: boolean;
  off: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="border-t border-line">
      <button
        role="switch"
        aria-checked={on}
        className="nx-hover flex h-[30px] w-full items-center justify-between px-[10px] hover:bg-surface-2"
        onClick={() => onChange(!on)}
      >
        <span className="t-meta text-ink-2">{label}</span>
        <span
          className={`flex h-[12px] w-[22px] shrink-0 items-center rounded-[3px] border p-[1px] ${
            on ? "border-hint bg-hint-wash" : "border-line"
          }`}
        >
          <span
            className={`h-[8px] w-[8px] rounded-[2px] ${
              on ? "ml-auto bg-hint" : "bg-ink-3"
            }`}
          />
        </span>
      </button>
      {on ? null : (
        <div className="t-micro px-[10px] pb-[5px] text-ink-3">{off}</div>
      )}
    </div>
  );
}

/** The stepper, twice.  Deliberately the same shape as the PDF pane's zoom
 *  control, which is the answer this app already gives to "make this
 *  bigger". */
function SizeRow({
  label,
  what,
  value,
  steps,
  display,
  onChange,
}: {
  label: string;
  what: string;
  value: number;
  steps: number[];
  display: string;
  onChange: (value: number) => void;
}) {
  const first = value <= steps[0];
  const last = value >= steps[steps.length - 1];
  return (
    <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
      <span className="t-meta text-ink-2">{label}</span>
      <div className="flex shrink-0 items-center">
        <button
          className="nx-hover t-ui px-[6px] text-ink-2 hover:text-ink disabled:text-ink-3 disabled:opacity-40"
          disabled={first}
          aria-label={`Smaller ${what}`}
          onClick={() => onChange(step(value, steps, -1))}
        >
          −
        </button>
        <span className="t-micro tnum w-[46px] text-center text-ink-3">{display}</span>
        <button
          className="nx-hover t-ui px-[6px] text-ink-2 hover:text-ink disabled:text-ink-3 disabled:opacity-40"
          disabled={last}
          aria-label={`Larger ${what}`}
          onClick={() => onChange(step(value, steps, 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
