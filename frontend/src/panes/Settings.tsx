import { Suspense, lazy, useRef, useState } from "react";
import api from "../api";
import { get, set, useStore } from "../store";
import { agentName } from "../agent-name";
import { useDismiss } from "../useDismiss";

/** Lazily loaded, like the tutorial and the PDF pane.  It is a sheet almost
 *  nobody opens in a given session, and seven kilobytes on the first paint
 *  of every session to carry it is the wrong trade -- `bundle.initial_kb`
 *  counts only the entry script, and this belongs outside it. */
const AccessCard = lazy(() => import("./AccessCard"));
import {
  DEFAULTS,
  EDITOR_SIZES,
  SCALES,
  applyAppearance,
  isDefault,
  step,
  storedAppearance,
  type Appearance,
  type EditorTheme,
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
/** A row offering two or three mutually exclusive settings.
 *
 *  Four of these appear one under another, and they were four copies of the
 *  same markup.  The names have to be distinct in the accessibility tree --
 *  "Light" means one thing in the Theme row and another in the Editor row
 *  directly below it -- so each button is labelled with its group's name as
 *  well as its own.
 */
function Choice<T extends string | boolean>({
  label,
  options,
  value,
  name,
  onPick,
}: {
  label: string;
  options: readonly { value: T; text: string; id: string }[];
  value: T;
  name: string;
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
      <span className="t-meta text-ink-2">{label}</span>
      <div
        role="group"
        aria-label={name}
        className="flex shrink-0 overflow-hidden rounded-[3px] border border-line"
      >
        {options.map((option) => (
          <button
            key={option.id}
            aria-pressed={value === option.value}
            aria-label={`${label} ${option.text.toLowerCase()}`}
            className={`t-micro px-2 py-[3px] transition-colors duration-[90ms] ${
              value === option.value
                ? "bg-surface-3 text-ink"
                : "text-ink-3 hover:text-ink"
            }`}
            data-testid={option.id}
            onClick={() => onPick(option.value)}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The ground the editor draws its page on, chosen by looking at it.
 *
 *  This was a row of three words, and the words were the problem: "Light"
 *  in this row and "Light" in the Theme row directly above it mean two
 *  different things, which is why every button in a Choice has to carry its
 *  group's name in its accessibility label to be comprehensible at all.
 *  Six grounds could not have survived that.  A colour is also simply the
 *  honest way to offer a colour.
 *
 *  Each swatch is painted by putting the app's own palette class on it and
 *  filling with var(--surface), so what the writer sees is the real token
 *  and there is no second list of hexes here to drift from styles.css.
 *  "Match" is drawn as both palettes at once, because that is what it
 *  means.  The caption underneath names the current choice, so the row is
 *  readable rather than a guessing game of six grey rectangles.
 */
const GROUNDS: readonly {
  value: EditorTheme;
  text: string;
  skin: string;
  id: string;
}[] = [
  { value: "match", text: "Matches the theme", skin: "", id: "editor-theme-match" },
  { value: "light", text: "Proofing grey", skin: "nx-theme-light", id: "editor-theme-light" },
  { value: "white", text: "White", skin: "nx-theme-light nx-theme-white", id: "editor-theme-white" },
  { value: "warm", text: "Warm white", skin: "nx-theme-light nx-theme-warm", id: "editor-theme-warm" },
  { value: "cool", text: "Cool white", skin: "nx-theme-light nx-theme-cool", id: "editor-theme-cool" },
  { value: "dark", text: "Dark", skin: "nx-theme-dark", id: "editor-theme-dark" },
];

function Grounds({
  value,
  onPick,
}: {
  value: EditorTheme;
  onPick: (value: EditorTheme) => void;
}) {
  const current = GROUNDS.find((g) => g.value === value) ?? GROUNDS[0];
  return (
    <div className="border-t border-line px-[10px] py-[7px]">
      <div className="flex items-center justify-between">
        <span className="t-meta text-ink-2">Editor page</span>
        <span className="t-micro text-ink-3">{current.text}</span>
      </div>
      <div role="group" aria-label="Editor page" className="mt-[6px] flex gap-[5px]">
        {GROUNDS.map((ground) => (
          <button
            key={ground.id}
            data-testid={ground.id}
            aria-pressed={value === ground.value}
            aria-label={`Editor page ${ground.text.toLowerCase()}`}
            title={ground.text}
            onClick={() => onPick(ground.value)}
            className="nx-swatch"
            data-chosen={value === ground.value ? "yes" : undefined}
          >
            {/* The palette class goes on the fill, not on the button: the
                ring that marks the chosen one is drawn in --pen, and it
                should be the panel's pen rather than the swatch's own, or
                a pale violet ring lands on a pale popover. */}
            {ground.value === "match" ? (
              <>
                <span className="nx-theme-light nx-swatch-half" />
                <span className="nx-theme-dark nx-swatch-half" />
              </>
            ) : (
              <span className={`nx-swatch-half ${ground.skin}`} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings({
  onTutorial,
  onChangeAgent,
  align = "right",
  inProject = false,
}: {
  /** Opens the tutorial sheet.  Absent on the projects screen, which has a
   *  question mark of its own for the same job. */
  onTutorial?: () => void;
  /** Goes back to the screen that chose the agent. */
  onChangeAgent?: () => void;
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
  const [access, setAccess] = useState(false);
  const [look, setLook] = useState<Appearance>(() => storedAppearance());
  const projectId = useStore((s) => s.projectId);
  const provider = useStore((s) => s.agent)?.provider;
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
          className={`nx-furniture nx-arrive absolute top-[30px] z-40 w-[248px] rounded-[5px] border border-line bg-surface shadow-float ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div id="settings-heading" className="t-ui px-[10px] pt-2 pb-1 text-ink">
            Settings
          </div>

          <Heading>Appearance</Heading>
          <Choice
            label="Theme"
            name="Theme"
            value={look.theme}
            options={[
              { value: "light", text: "Light", id: "theme-light" },
              { value: "dark", text: "Dark", id: "theme-dark" },
            ] as const}
            onPick={(theme) => change({ theme })}
          />

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
          {/* The editor is lit separately because the two are answering
              different questions.  The shell is chrome, and plenty of people
              want it out of the way in the dark; the editor is the page
              being written, and a writer who thinks in paper wants that
              white whatever the frame is doing. */}
          <Grounds
            value={look.editorTheme}
            onPick={(editorTheme) => change({ editorTheme })}
          />

          {/* Colouring the control sequences is a setting rather than the
              look, and it is off by default.  The rendered page is two panes
              away and has to stay the loudest thing on screen, so the source
              earns its colour only when somebody asks for it -- and then it
              earns it properly, because a long chapter is far easier to skim
              for its equations and its headings when they are not all the
              same shade of ink. */}
          <Choice
            label="Highlighting"
            name="Syntax highlighting"
            value={look.syntax}
            options={[
              { value: "subtle", text: "Subtle", id: "syntax-subtle" },
              { value: "colour", text: "Colour", id: "syntax-colour" },
            ] as const}
            onPick={(syntax) => change({ syntax })}
          />

          {/* What the preview spends on a page.  The page is rasterised at
              the device ratio times the interface scale, so a retina screen
              or a scaled-up interface already costs several times the pixels
              of an ordinary one: that is where the work is, and that is what
              "Faster" caps.  "Sharper" oversamples instead, which is what
              keeps a figure crisp when a reader zooms into it.  "Balanced"
              is what this pane always did, so nobody who never opens this
              control sees a change. */}
          <Choice
            label="Preview"
            name="Preview quality"
            value={look.preview}
            options={[
              { value: "faster", text: "Faster", id: "preview-faster" },
              { value: "balanced", text: "Balanced", id: "preview-balanced" },
              { value: "sharper", text: "Sharper", id: "preview-sharper" },
            ] as const}
            onPick={(preview) => change({ preview })}
          />

          {/* Off by default.  It fetches a word list, and until a writer
              has told it about the vocabulary of their own subject it has
              something to say about a great many correctly spelled words --
              which is the state in which a checker gets switched off and
              never switched back on. */}
          <Choice
            label="Spelling"
            name="Spell checking"
            value={look.spelling}
            options={[
              { value: false, text: "Off", id: "spelling-off" },
              { value: true, text: "On", id: "spelling-on" },
            ] as const}
            onPick={(spelling) => change({ spelling })}
          />

          {/* Absent rather than disabled when there is no project open --
              on the project list and the sign-in screen.  A control that
              cannot be enabled from where you are standing advertises a
              capability and then refuses, and three switches with no
              project would be lying about which project they belonged to.
              The app already works this way: the trash section appears
              only when it holds something. */}
          {/* Who is writing alongside you.  The sign-in screen has always
              said "You can change this later", and until now nothing in the
              app could: `chooseProvider` was reachable only from that
              screen, which mounts only before an agent is configured or
              after a session expires.  A promise the interface made and
              could not keep. */}
          {/* Who may open this install, and the name a collaborator sees.
              A row rather than a section, because what it opens has a list
              in it whose length is not known in advance and three controls
              that each want a sentence beside them -- none of which fits a
              card 248px wide. */}
          <Heading>Access</Heading>
          <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
            <span className="t-meta text-ink-2">Password and browsers</span>
            <button
              className="quiet t-micro shrink-0"
              data-testid="open-access"
              onClick={() => {
                close();
                setAccess(true);
              }}
            >
              Open
            </button>
          </div>

          {onChangeAgent ? (
            <>
              <Heading>Agent</Heading>
              <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
                <span className="t-meta min-w-0 truncate text-ink-2">
                  {provider === "none"
                    ? "Working on your own"
                    : agentName(provider)}
                </span>
                <button
                  className="quiet t-micro shrink-0"
                  data-testid="change-agent"
                  onClick={() => {
                    close();
                    onChangeAgent();
                  }}
                >
                  Change
                </button>
              </div>
            </>
          ) : null}

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

      {/* Outside the popover deliberately: the settings card closes when you
          look away, and the sheet it opened must not go with it. */}
      {access ? (
        <Suspense fallback={null}>
          <AccessCard onClose={() => setAccess(false)} focus="name" />
        </Suspense>
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
