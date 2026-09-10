import { useRef, useState } from "react";
import api from "../api";
import { get, set, useStore } from "../store";
import { agentName } from "../agent-name";
import { useDismiss } from "../useDismiss";
import {
  DEFAULTS,
  EDITOR_SIZES,
  EDITOR_WEIGHTS,
  SCALES,
  WEIGHT_NAMES,
  applyAppearance,
  isDefault,
  step,
  storedAppearance,
  type Appearance,
  type EditorTheme,
} from "../appearance";

/** Everything the writer gets to choose, in one sheet.
 *
 *  It was a popover 248 pixels wide, and by the time it held a theme, two
 *  sizes, six editor grounds, a highlighting mode, a preview quality, a
 *  spelling switch, a way into the access sheet, the agent, and three
 *  per-project switches, it was thirteen rows in a single column hanging
 *  off a 26 pixel cog.  That is a preferences window pretending to be a
 *  menu, and it had two costs beyond the length.  Rows that answer to
 *  entirely different things -- how this machine looks, who may open this
 *  install, how this project builds -- sat in one undifferentiated stack
 *  separated by hairlines.  And no control had room for the sentence it
 *  wanted, which is why the switches put theirs underneath and the rest
 *  went without.
 *
 *  A sheet is what this app already does when something outgrows a row:
 *  access, sharing, the tutorial and the paper chooser are all sheets.  So
 *  is this now, in two columns, with each group named for the question it
 *  answers rather than for the part of the program it belongs to.
 *
 *  Split from its own trigger so it is fetched when it is opened.  The cog
 *  is on screen in every session and this is opened in very few of them,
 *  and `bundle.initial_kb` counts only what a first visit downloads.
 */
export default function SettingsSheet({
  onClose,
  onTutorial,
  onChangeAgent,
  onOpenAccess,
  inProject,
}: {
  onClose: () => void;
  /** Opens the tutorial sheet.  Absent on the projects screen, which has a
   *  question mark of its own for the same job. */
  onTutorial?: () => void;
  /** Goes back to the screen that chose the agent. */
  onChangeAgent?: () => void;
  onOpenAccess: () => void;
  /** Whether a project is on screen.  Asked of the mount point rather than
   *  read from the store: leaving the editor for the project list does not
   *  clear `projectId` -- the app keeps it so a reload comes back to the
   *  document -- so the store cannot tell the two screens apart, and this
   *  would offer three per-project switches on a screen listing every
   *  project. */
  inProject: boolean;
}) {
  const [look, setLook] = useState<Appearance>(() => storedAppearance());
  const projectId = useStore((s) => s.projectId);
  const provider = useStore((s) => s.agent)?.provider;
  const project = useStore((s) => s.settings);
  const sheet = useRef<HTMLDivElement | null>(null);

  useDismiss(sheet, true, onClose);

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

  return (
    <div
      className="nx-scrim fixed inset-0 z-50 grid place-items-center p-6"
      role="presentation"
    >
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-sheet"
        className="nx-furniture nx-arrive max-h-full w-[540px] max-w-full overflow-y-auto rounded-[5px] border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between px-[12px] pt-[10px] pb-[8px]">
          <span className="t-ui text-ink">Settings</span>
          <button className="quiet t-micro" data-testid="settings-close" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Two columns on anything wide enough, and one below that, which
            is the tablet in portrait and the phone-sized window nobody is
            writing a thesis in but somebody will open. */}
        <div className="grid grid-cols-1 gap-x-[14px] gap-y-[14px] px-[12px] pb-[12px] sm:grid-cols-2">
          <div className="flex flex-col gap-[14px]">
            <Group title="How it looks" note="On this computer, in every project.">
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
              {/* Dark type on a bright page looks thinner than light type on
                  a dark one at the same weight, so the editor already sets
                  its text a step heavier on any of the light grounds -- see
                  --nx-editor-weight-lift in styles.css.  This is the writer
                  saying that the compensation went too far or not far
                  enough, on a face that has three usable steps and no more.
                  Named rather than numbered for the same reason: the number
                  would be true on one ground and wrong on the other five. */}
              <SizeRow
                label="Editor weight"
                what="editor weight"
                verbs={["Lighter", "Heavier"]}
                value={look.weight}
                steps={EDITOR_WEIGHTS}
                display={WEIGHT_NAMES[look.weight] ?? "Normal"}
                onChange={(weight) => change({ weight })}
              />
            </Group>

            {/* The editor is lit separately because the two are answering
                different questions.  The shell is chrome, and plenty of
                people want it out of the way in the dark; the editor is the
                page being written, and a writer who thinks in paper wants
                that white whatever the frame is doing. */}
            <Group
              title="The page you write on"
              note="The editor can be lit on its own terms, whatever the frame is doing."
            >
              <Grounds
                value={look.editorTheme}
                onPick={(editorTheme) => change({ editorTheme })}
              />
              {/* Colouring the control sequences is a setting rather than
                  the look, and it is off by default.  The rendered page is
                  two panes away and has to stay the loudest thing on
                  screen, so the source earns its colour only when somebody
                  asks for it -- and then it earns it properly, because a
                  long chapter is far easier to skim for its equations and
                  its headings when they are not all one shade of ink. */}
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
            </Group>
          </div>

          <div className="flex flex-col gap-[14px]">
            <Group title="While you write">
              {/* Off by default.  It fetches a word list, and until a
                  writer has told it about the vocabulary of their own
                  subject it has something to say about a great many
                  correctly spelled words -- which is the state in which a
                  checker gets switched off and never switched back on. */}
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
              {/* What the preview spends on a page.  The page is rasterised
                  at the device ratio times the interface scale, so a retina
                  screen or a scaled-up interface already costs several
                  times the pixels of an ordinary one: that is where the
                  work is, and that is what "Faster" caps.  "Sharper"
                  oversamples instead, which keeps a figure crisp when a
                  reader zooms into it. */}
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
            </Group>

            {/* Absent rather than disabled when there is no project open.
                A control that cannot be enabled from where you are standing
                advertises a capability and then refuses, and three switches
                with no project would be lying about which project they
                belonged to. */}
            {inProject && projectId ? (
              <Group title="This project" note="Kept in the project, not on this computer.">
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
              </Group>
            ) : null}

            {/* Who may open this install and who is writing alongside you.
                Both are one row and a way out of here, because what each of
                them opens is bigger than a row. */}
            <Group title="This install">
              <Away
                label="Password and browsers"
                action="Open"
                testId="open-access"
                onClick={() => {
                  onClose();
                  onOpenAccess();
                }}
              />
              {onChangeAgent ? (
                /* Named rather than described, and the verb follows the
                   state.  This row used to read "Working on your own" with
                   a "Change" beside it, which describes how things are
                   without saying what the control does: somebody who wanted
                   an agent had no reason to think this was the way to one.
                   "Writing agent: not set up" with "Set up" says both. */
                <Away
                  label={
                    provider === "none"
                      ? "Writing agent: not set up"
                      : `Writing agent: ${agentName(provider)}`
                  }
                  action={provider === "none" ? "Set up" : "Change"}
                  emphasis={provider === "none"}
                  testId="change-agent"
                  onClick={() => {
                    onClose();
                    onChangeAgent();
                  }}
                />
              ) : null}
            </Group>
          </div>
        </div>

        {/* Appearance only, and it says so.  A reset that quietly turned
            compile-as-you-type back on would be an action nobody asked for,
            hiding inside a word that sounds harmless.  Tutorial sits beside
            it rather than among the controls: it is something this sheet
            does, not something it holds the state of. */}
        <div className="flex h-[36px] items-center justify-between border-t border-line px-[12px]">
          {inProject && projectId && onTutorial ? (
            <button
              className="quiet t-micro"
              data-testid="tutorial-open"
              onClick={() => {
                onClose();
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
    </div>
  );
}

/** One subject, named for the question it answers.
 *
 *  The note is the room the old column did not have.  "Kept in the project,
 *  not on this computer" is the single most useful sentence in this sheet
 *  and there was nowhere to put it: a writer with two machines had no way
 *  to know which of these choices travelled with the project and which did
 *  not. */
function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="t-meta text-ink">{title}</h3>
      {/* Above the controls, not below them.  Under the box it sat closer
          to the next group's heading than to the one it describes, which
          for "Kept in the project, not on this computer" is the sentence
          reading as a caption for the wrong thing. */}
      {note ? <p className="t-micro mb-[5px] text-ink-3">{note}</p> : null}
      <div
        className={`overflow-hidden rounded-[3px] border border-line [&>*:first-child]:border-t-0 ${
          note ? "" : "mt-[5px]"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/** A row that leaves rather than sets. */
function Away({
  label,
  action,
  testId,
  onClick,
  emphasis = false,
}: {
  label: string;
  action: string;
  testId: string;
  onClick: () => void;
  /** For a row offering something the writer does not have yet, rather than
   *  reporting something they do.  One row in the sheet at most: an accent
   *  spent on everything is an accent spent on nothing. */
  emphasis?: boolean;
}) {
  return (
    <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
      <span
        className={[
          "t-meta min-w-0 truncate",
          emphasis ? "text-ink" : "text-ink-2",
        ].join(" ")}
      >
        {label}
      </span>
      <button
        className={["quiet t-micro shrink-0", emphasis ? "text-pen" : ""].join(" ")}
        data-testid={testId}
        onClick={onClick}
      >
        {action}
      </button>
    </div>
  );
}

/** A row offering two or three mutually exclusive settings.
 *
 *  The names have to be distinct in the accessibility tree -- "Light" means
 *  one thing in the Theme row and another among the editor grounds -- so
 *  each button is labelled with its group's name as well as its own.
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
 *  in this row and "Light" in the Theme row mean two different things,
 *  which is why every button in a Choice has to carry its group's name in
 *  its accessibility label to be comprehensible at all.  Six grounds could
 *  not have survived that.  A colour is also simply the honest way to offer
 *  a colour.
 *
 *  Each swatch is painted by putting the app's own palette class on it and
 *  filling with var(--surface), so what the writer sees is the real token
 *  and there is no second list of hexes here to drift from styles.css.
 *  "Match" is drawn as both palettes at once, because that is what it
 *  means.  The caption names the current choice, so the row is readable
 *  rather than a guessing game of six grey rectangles.
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
                should be the sheet's pen rather than the swatch's own, or a
                pale violet ring lands on a pale card. */}
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

/** The stepper, three times.  Deliberately the same shape as the PDF pane's
 *  zoom control, which is the answer this app already gives to "make this
 *  bigger".
 *
 *  The readout is wide enough for a word because one of the three shows one:
 *  a weight is named rather than measured here, and the slot is fixed across
 *  all three so the plus and minus stay in a column. */
function SizeRow({
  label,
  what,
  verbs = ["Smaller", "Larger"],
  value,
  steps,
  display,
  onChange,
}: {
  label: string;
  what: string;
  /** What stepping down and up is called, for the accessibility tree.  Two
   *  of these rows make a thing bigger and the third makes it heavier, and
   *  "Larger editor weight" is a button that describes nothing a screen
   *  reader could act on. */
  verbs?: readonly [string, string];
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
          aria-label={`${verbs[0]} ${what}`}
          onClick={() => onChange(step(value, steps, -1))}
        >
          −
        </button>
        <span className="t-micro tnum w-[54px] text-center text-ink-3">{display}</span>
        <button
          className="nx-hover t-ui px-[6px] text-ink-2 hover:text-ink disabled:text-ink-3 disabled:opacity-40"
          disabled={last}
          aria-label={`${verbs[1]} ${what}`}
          onClick={() => onChange(step(value, steps, 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
