import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import api, { type Engine } from "../api";
import { get, set, useStore } from "../store";
import { agentName } from "../agent-name";
import {
  DEFAULTS,
  EDITOR_SIZES,
  EDITOR_WEIGHTS,
  HOVER_KINDS,
  SCALES,
  WEIGHT_NAMES,
  applyAppearance,
  isDefault,
  readStored,
  step,
  storedAppearance,
  writeStored,
  type Appearance,
  type HoverKind,
} from "../appearance";
import { shortcut } from "../keys";
import { Button, IconButton } from "../ui/Button";
import { Chip, ChipToggle, Heading, Pressable, Segmented, Switch, useLabelId } from "../ui/controls";
import { Sheet } from "../ui/Sheet";
import { CloseIcon } from "../ui/icons";

/** Everything the writer gets to choose, in one sheet, master-detail.
 *
 *  It was a popover 248 pixels wide, then a two-column sheet, and by the
 *  time it held a theme, two sizes, a weight, a ground, two highlighting
 *  choices, spelling and its variety, a keymap, a preview quality, four
 *  per-project switches and two ways out, two columns were twenty rows
 *  to read before finding one. The direction page drew this instead: a
 *  narrow list of the four groups at the left, each named for the
 *  question it answers and saying where its choices live, and one group's
 *  rows at the right, so the writer holds four things in mind and then
 *  seven, never twenty. The group is remembered per browser, and opening
 *  inside a project lands on "This project" when that is where the sheet
 *  was last closed.
 *
 *  Below 720 px the list becomes a row of four segments above the rows.
 *  The list is a tablist: arrows move between groups, Tab enters the
 *  rows.
 *
 *  Split from its own trigger so it is fetched when it is opened. The cog
 *  is on screen in every session and this is opened in very few of them,
 *  and `bundle.initial_kb` counts only what a first visit downloads.
 */

type GroupId = "look" | "write" | "project" | "install";

const GROUPS: { id: GroupId; title: string; where: string; whereLong: string }[] = [
  { id: "look", title: "How it looks", where: "on this computer", whereLong: "on this computer, in every project" },
  { id: "write", title: "While you write", where: "on this computer", whereLong: "on this computer, in every project" },
  { id: "project", title: "This project", where: "kept with the project", whereLong: "kept with the project, on every computer" },
  { id: "install", title: "This install", where: "", whereLong: "who may open it, and who writes with you" },
];

const GROUP_KEY = "nexttex.settings.group";

/** The writer's names for the hover cards.  "Cross-references" and
 *  "Citations" rather than "References", which is the bibliography
 *  drawer's name and would read as \cite. */
const HOVER_LABELS: Record<HoverKind, string> = {
  maths: "Equations",
  tables: "Tables",
  figures: "Figures",
  refs: "Cross-references",
  cites: "Citations",
  files: "Files",
};
const NARROW = 720;

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
   *  clear `projectId`, the app keeps it so a reload comes back to the
   *  document, so the store cannot tell the two screens apart, and this
   *  would offer four per-project rows on a screen listing every project. */
  inProject: boolean;
}) {
  const [look, setLook] = useState<Appearance>(() => storedAppearance());
  const projectId = useStore((s) => s.projectId);
  const provider = useStore((s) => s.agent)?.provider;
  const project = useStore((s) => s.settings);
  const projectLanguage = project.language;
  const hasProject = inProject && Boolean(projectId);
  const groups = GROUPS.filter((group) => group.id !== "project" || hasProject);
  const [group, setGroup] = useState<GroupId>(() => {
    const kept = readStored(GROUP_KEY) as GroupId | null;
    return kept && groups.some((candidate) => candidate.id === kept) ? kept : "look";
  });
  const tabs = useRef<Map<GroupId, HTMLButtonElement>>(new Map());
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  const headingId = useLabelId();

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const choose = (next: GroupId, focus = false) => {
    setGroup(next);
    writeStored(GROUP_KEY, next);
    if (focus) tabs.current.get(next)?.focus();
  };

  // Arrows move between the groups; Home and End to the ends. Tab leaves
  // the list for the rows, which is what a tablist does.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = groups.findIndex((candidate) => candidate.id === group);
    const forward = narrow ? "ArrowRight" : "ArrowDown";
    const back = narrow ? "ArrowLeft" : "ArrowUp";
    let to = -1;
    if (event.key === forward) to = (at + 1) % groups.length;
    else if (event.key === back) to = (at - 1 + groups.length) % groups.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = groups.length - 1;
    if (to < 0) return;
    event.preventDefault();
    choose(groups[to].id, true);
  };

  const change = (patch: Partial<Appearance>) => {
    const next = { ...look, ...patch };
    setLook(next);
    applyAppearance(next);
  };

  const toggle = (
    patch: Partial<{
      autocompile: boolean;
      markErrors: boolean;
      markWarnings: boolean;
      engine: Engine | "";
      language: string;
    }>,
  ) => {
    if (!projectId) return;
    // Applied here and confirmed by the server's `project_changed`, so the
    // switch answers the click rather than the round trip.
    set({ settings: { ...get().settings, ...patch } });
    api.setProjectSettings(projectId, patch).catch(() => {
      set({ settings: get().settings, error: "Could not save that setting." });
    });
  };

  const current = groups.find((candidate) => candidate.id === group) ?? groups[0];

  return (
    <Sheet
      open
      onClose={onClose}
      label="Settings"
      testid="settings-sheet"
      width={780}
      className="nx-settings"
      data-narrow={narrow || undefined}
    >
      <div className="nx-settings-nav">
        <Heading level={2} display className="nx-settings-title">Settings</Heading>
        {/* The tabs alone in the tablist: a tablist may hold nothing else. */}
        <div className="nx-settings-tabs" role="tablist" aria-label="Settings" aria-orientation={narrow ? "horizontal" : "vertical"}>
        {groups.map((candidate) => (
          <Pressable
            key={candidate.id}
            ref={(node) => {
              if (node) tabs.current.set(candidate.id, node);
              else tabs.current.delete(candidate.id);
            }}
            type="button"
            role="tab"
            id={`settings-tab-${candidate.id}`}
            aria-selected={candidate.id === current.id}
            aria-controls="settings-pane"
            tabIndex={candidate.id === current.id ? 0 : -1}
            data-on={candidate.id === current.id || undefined}
            data-testid={`settings-group-${candidate.id}`}
            className="nx-settings-tab"
            onClick={() => choose(candidate.id)}
            onKeyDown={onTabKey}
          >
            <span>{candidate.title}</span>
            {candidate.where ? <small>{candidate.where}</small> : null}
          </Pressable>
        ))}
        </div>
        <span className="nx-settings-grow" />
        {/* What this sheet does rather than what it holds: the tutorial,
            and a reset of this computer's choices, which is the two groups
            that live here and never the project's. */}
        {hasProject && onTutorial ? (
          <Button
            variant="quiet"
            data-testid="tutorial-open"
            onClick={() => {
              onClose();
              onTutorial();
            }}
          >
            Tutorial
          </Button>
        ) : null}
        <Button
          variant="quiet"
          disabled={isDefault(look)}
          onClick={() => {
            setLook(DEFAULTS);
            applyAppearance(DEFAULTS);
          }}
        >
          Reset this computer&rsquo;s choices
        </Button>
      </div>

      <div
        className="nx-settings-pane"
        role="tabpanel"
        id="settings-pane"
        aria-labelledby={`settings-tab-${current.id}`}
      >
        <div className="nx-settings-head">
          <Heading level={2} id={headingId} className="!text-sheet-title">{current.title}</Heading>
          <span className="nx-settings-where">{current.whereLong}</span>
          <IconButton label="Close" data-testid="settings-close" className="ml-auto" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        {current.id === "look" ? (
          <>
            <SRow title="Theme">
              <Segmented
                label="Theme"
                value={look.theme}
                options={[
                  { value: "light", label: "Light", testid: "theme-light", ariaLabel: "Theme light" },
                  { value: "dark", label: "Dark", testid: "theme-dark", ariaLabel: "Theme dark" },
                ]}
                onChange={(theme) => change({ theme })}
              />
            </SRow>
            <SRow title="Interface size" note="Everything but the typeset page.">
              <Stepper
                what="interface"
                value={look.scale}
                steps={SCALES}
                display={`${look.scale}%`}
                onChange={(scale) => change({ scale })}
              />
            </SRow>
            <SRow title="Editor text">
              <Stepper
                what="editor text"
                value={look.editor}
                steps={EDITOR_SIZES}
                display={`${look.editor} px`}
                onChange={(editor) => change({ editor })}
              />
            </SRow>
            {/* Dark type on a bright page looks thinner than light type on
                a dark one at the same weight, so the editor already sets
                its text a step heavier on a light ground; see
                --nx-editor-weight-lift in styles.css.  This is the writer
                saying that the compensation went too far or not far
                enough, on a face that has three usable steps and no more.
                Named rather than numbered for the same reason: the number
                would be true on one ground and wrong on the other. */}
            <SRow title="Editor weight">
              <Segmented
                label="Editor weight"
                value={String(look.weight)}
                options={EDITOR_WEIGHTS.map((weight) => ({
                  value: String(weight),
                  label: WEIGHT_NAMES[weight] ?? String(weight),
                  testid: `weight-${(WEIGHT_NAMES[weight] ?? String(weight)).toLowerCase()}`,
                  ariaLabel: `${WEIGHT_NAMES[weight] ?? weight} editor weight`,
                }))}
                onChange={(weight) => change({ weight: Number(weight) })}
              />
            </SRow>
            {/* Two grounds, the theme's own and the page's white; the shades
                of white that sat between them went in the overhaul at the
                writer's request. */}
            <SRow title="Editor page" note="The theme's own ground, or the white of the typeset page.">
              <Segmented
                label="Editor page"
                value={look.editorTheme}
                options={[
                  { value: "match", label: "Theme", testid: "editor-theme-match", ariaLabel: "Editor page theme" },
                  { value: "white", label: "White", testid: "editor-theme-white", ariaLabel: "Editor page white" },
                ]}
                onChange={(editorTheme) => change({ editorTheme })}
              />
            </SRow>
            {/* Colouring the control sequences is a setting rather than the
                look, and it is off by default.  The rendered page is two
                panes away and has to stay the loudest thing on screen, so
                the source earns its colour only when somebody asks for it. */}
            <SRow title="Highlighting" note="Colour gives each command family its own hue.">
              <Segmented
                label="Syntax highlighting"
                value={look.syntax}
                options={[
                  { value: "subtle", label: "Subtle", testid: "syntax-subtle", ariaLabel: "Highlighting subtle" },
                  { value: "colour", label: "Colour", testid: "syntax-colour", ariaLabel: "Highlighting colour" },
                ]}
                onChange={(syntax) => change({ syntax })}
              />
            </SRow>
            {/* The other half of highlighting: whether a command is set
                heavier than the prose. */}
            <SRow title="Emphasis">
              <Segmented
                label="Command emphasis"
                value={look.emphasis}
                options={[
                  { value: "bold", label: "Bold commands", testid: "emphasis-bold", ariaLabel: "Emphasis bold commands" },
                  { value: "plain", label: "Plain", testid: "emphasis-plain", ariaLabel: "Emphasis plain" },
                ]}
                onChange={(emphasis) => change({ emphasis })}
              />
            </SRow>
          </>
        ) : null}

        {current.id === "write" ? (
          <>
            {/* Off by default.  It fetches a word list, and until a writer
                has told it about the vocabulary of their own subject it has
                something to say about a great many correctly spelled words,
                which is the state in which a checker gets switched off and
                never switched back on. */}
            <SRow title="Spelling">
              <Segmented
                label="Spell checking"
                value={look.spelling ? "on" : "off"}
                options={[
                  { value: "off", label: "Off", testid: "spelling-off", ariaLabel: "Spelling off" },
                  { value: "on", label: "On", testid: "spelling-on", ariaLabel: "Spelling on" },
                ]}
                onChange={(spelling) => change({ spelling: spelling === "on" })}
              />
            </SRow>
            {look.spelling ? (
              <>
                {/* Which English.  "Document" means what the open
                    document's own preamble says, from its babel or
                    polyglossia options, and both spellings of every word
                    when it says nothing: half the literature a thesis
                    cites is American. */}
                <SRow title="Variety" note="Document follows the preamble's babel or polyglossia line.">
                  <Segmented
                    label="English variety"
                    value={look.spellingVariety}
                    options={[
                      { value: "follow", label: "Document", testid: "variety-follow", ariaLabel: "Variety document" },
                      { value: "british", label: "British", testid: "variety-british", ariaLabel: "Variety British" },
                      { value: "american", label: "American", testid: "variety-american", ariaLabel: "Variety American" },
                    ]}
                    onChange={(spellingVariety) => change({ spellingVariety })}
                  />
                </SRow>
                {hasProject ? <AddedWords /> : null}
              </>
            ) : null}
            {/* Grammar beside spelling, per computer like it, since some
                writers want no checker at all. Harper, locally; the note
                says the two things a writer turning it on should know. */}
            <SRow
              title="Grammar"
              note={
                projectLanguage && projectLanguage !== "en"
                  ? "English only, so it rests while this project is spelled in another language."
                  : "Checked in the browser, nothing sent. Fetched the first time, 16 MB."
              }
            >
              <Segmented
                label="Grammar checking"
                value={look.grammar ? "on" : "off"}
                options={[
                  { value: "off", label: "Off", testid: "grammar-off", ariaLabel: "Grammar off" },
                  { value: "on", label: "On", testid: "grammar-on", ariaLabel: "Grammar on" },
                ]}
                onChange={(grammar) => change({ grammar: grammar === "on" })}
              />
            </SRow>
            {/* The cards the editor draws when the pointer rests on maths,
                a table, a figure, a reference, a citation or an input.
                One switch for all of them, so "not now" is one gesture,
                and under it the kinds as toggle chips rather than six
                switch rows, which would take this group to ten.  The off
                sentence answers the question turning it off raises. */}
            <SwitchRow
              title="Hover cards"
              checked={look.hover}
              off={`${shortcut("Mod-click").both} still follows a reference or a file.`}
              onChange={(hover) => change({ hover })}
              testid="hover-cards"
            />
            {look.hover ? (
              <SRow title="Show for" stack testid="hover-kinds">
                <div className="nx-settings-chips">
                  {HOVER_KINDS.map((kind) => (
                    <ChipToggle
                      key={kind}
                      pressed={look.hoverKinds[kind]}
                      data-testid={`hover-${kind}`}
                      onChange={(pressed) => change({ hoverKinds: { ...look.hoverKinds, [kind]: pressed } })}
                    >
                      {HOVER_LABELS[kind]}
                    </ChipToggle>
                  ))}
                </div>
              </SRow>
            ) : null}
            {/* Whose fingers the editor answers to.  Fetched only when
                chosen, so a session that wants neither pays nothing; and
                each keymap's own undo is rebound to the shared document's,
                because two histories over one document once emptied a file
                for everyone (`docs/architecture.md`). */}
            <SRow
              title="Keymap"
              note={
                look.keymap !== "default"
                  ? "Undo stays the document's under either: it undoes what you typed, never what a collaborator did."
                  : undefined
              }
            >
              <Segmented
                label="Editor keymap"
                value={look.keymap}
                options={[
                  { value: "default", label: "Default", testid: "keymap-default", ariaLabel: "Keymap default" },
                  { value: "vim", label: "Vim", testid: "keymap-vim", ariaLabel: "Keymap Vim" },
                  { value: "emacs", label: "Emacs", testid: "keymap-emacs", ariaLabel: "Keymap Emacs" },
                ]}
                onChange={(keymap) => change({ keymap })}
              />
            </SRow>
            {/* What the preview spends on a page.  The page is rasterised
                at the device ratio times the interface scale, which is
                where the work is and what "Faster" caps; "Sharper"
                oversamples instead, which keeps a figure crisp when a
                reader zooms into it. */}
            <SRow title="Preview">
              <Segmented
                label="Preview quality"
                value={look.preview}
                options={[
                  { value: "faster", label: "Faster", testid: "preview-faster", ariaLabel: "Preview faster" },
                  { value: "balanced", label: "Balanced", testid: "preview-balanced", ariaLabel: "Preview balanced" },
                  { value: "sharper", label: "Sharper", testid: "preview-sharper", ariaLabel: "Preview sharper" },
                ]}
                onChange={(preview) => change({ preview })}
              />
            </SRow>
          </>
        ) : null}

        {current.id === "project" && projectId ? (
          <>
            {/* The off sentence answers the one question turning a switch
                off raises: did I just stop being told? */}
            <SwitchRow
              title="Compile as you type"
              checked={project.autocompile}
              off={`${shortcut("Mod-S").both} compiles. Or Compile in the strip.`}
              onChange={(autocompile) => toggle({ autocompile })}
            />
            <SwitchRow
              title="Mark errors in the text"
              checked={project.markErrors}
              off="The status strip still counts them."
              onChange={(markErrors) => toggle({ markErrors })}
            />
            <SwitchRow
              title="Mark warnings in the text"
              checked={project.markWarnings}
              off="They stay in the diagnostics list."
              onChange={(markWarnings) => toggle({ markWarnings })}
            />
            {/* "" is the default and is drawn as pdflatex, so the row never
                shows nothing pressed; picking pdflatex writes "" so the
                project's toml carries no key it does not need. */}
            <SRow
              title="Engine"
              note={
                <>
                  A <span className="font-mono">% !TeX program = xelatex</span> line at the top
                  of a document wins over this.
                </>
              }
            >
              <Segmented
                label="Engine"
                value={(project.engine || "pdflatex") as Engine}
                options={[
                  { value: "pdflatex", label: "pdflatex", testid: "engine-pdflatex" },
                  { value: "xelatex", label: "xelatex", testid: "engine-xelatex" },
                  { value: "lualatex", label: "lualatex", testid: "engine-lualatex" },
                ]}
                onChange={(engine) => toggle({ engine: engine === "pdflatex" ? "" : engine })}
              />
            </SRow>
            <LanguageRow
              projectId={projectId}
              chosen={project.language}
              onChange={(language) => toggle({ language })}
            />
            {/* Shown only when the project asks, because a row that reads
                "Shell escape: off" on every project advertises a switch,
                and this is not a switch: the project asks in its own file
                and this machine answers, once, per project. */}
            {project.shellEscape !== "off" ? (
              <ShellEscapeRow state={project.shellEscape} projectId={projectId} />
            ) : null}
          </>
        ) : null}

        {current.id === "install" ? (
          <>
            {/* Who may open this install and who is writing alongside you.
                Both are one row and a way out of here, because what each
                of them opens is bigger than a row. */}
            <SRow title="Password and browsers">
              <Button
                variant="ghost"
                data-testid="open-access"
                onClick={() => {
                  onClose();
                  onOpenAccess();
                }}
              >
                Open
              </Button>
            </SRow>
            {onChangeAgent ? (
              /* Named rather than described, and the verb follows the
                 state: "Not set up" with "Set up" says what the control
                 does, which "Working on your own" with "Change" did not. */
              <SRow
                title="Writing agent"
                note={provider === "none" ? "Not set up." : `${agentName(provider)}.`}
              >
                <Button
                  variant={provider === "none" ? "pen" : "ghost"}
                  data-testid="change-agent"
                  onClick={() => {
                    onClose();
                    onChangeAgent();
                  }}
                >
                  {provider === "none" ? "Set up" : "Change"}
                </Button>
              </SRow>
            ) : null}
          </>
        ) : null}

        <div className="nx-sheet-foot nx-settings-foot">
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** One setting: a title, a subtitle only where it earns its place, and
 *  the control at the right. */
function SRow({
  title,
  note,
  children,
  testid,
  stack = false,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  testid?: string;
  /** The control under the title rather than at its right: for a run of
   *  chips, which is wider than a row's tail. */
  stack?: boolean;
}) {
  return (
    <div className="nx-settings-row" data-testid={testid} data-stack={stack ? "" : undefined}>
      <div className="nx-settings-text">
        <span>{title}</span>
        {note ? <small>{note}</small> : null}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  title,
  checked,
  off,
  onChange,
  testid,
}: {
  title: string;
  checked: boolean;
  /** What still happens once this is off. */
  off: string;
  onChange: (checked: boolean) => void;
  testid?: string;
}) {
  const id = useLabelId();
  return (
    <div className="nx-settings-row">
      <div className="nx-settings-text">
        <span id={id}>{title}</span>
        {checked ? null : <small>{off}</small>}
      </div>
      <Switch checked={checked} onChange={onChange} aria-labelledby={id} data-testid={testid} />
    </div>
  );
}

/** The stepper, twice: the shape the page draws for a size, minus, the
 *  value, plus, with the readout wide enough to hold "13.5 px". */
function Stepper({
  what,
  verbs = ["Smaller", "Larger"],
  value,
  steps,
  display,
  onChange,
}: {
  what: string;
  verbs?: readonly [string, string];
  value: number;
  steps: number[];
  display: string;
  onChange: (value: number) => void;
}) {
  const first = value <= steps[0];
  const last = value >= steps[steps.length - 1];
  return (
    <div className="nx-stepper">
      <IconButton label={`${verbs[0]} ${what}`} disabled={first} onClick={() => onChange(step(value, steps, -1))}>
        <span aria-hidden="true">−</span>
      </IconButton>
      <b className="tnum">{display}</b>
      <IconButton label={`${verbs[1]} ${what}`} disabled={last} onClick={() => onChange(step(value, steps, 1))}>
        <span aria-hidden="true">+</span>
      </IconButton>
    </div>
  );
}

/** The project's request for shell escape, and this machine's answer. */
function ShellEscapeRow({
  state,
  projectId,
}: {
  state: "asked" | "on";
  projectId: string;
}) {
  const [busy, setBusy] = useState(false);
  // Two presses to allow, the pip card's shape, and one to revoke: a
  // build that runs programs is the one thing here that must not happen
  // on a slip, and taking it back needs no such care.
  const [asked, setAsked] = useState(false);
  const answer = async (allow: boolean) => {
    if (allow && !asked) {
      setAsked(true);
      return;
    }
    setBusy(true);
    try {
      const body = await api.allowShellEscape(projectId, allow);
      set({ settings: { ...get().settings, shellEscape: body.shellEscape } });
      setAsked(false);
    } catch {
      set({ error: "Could not save that answer." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SRow
      title="Shell escape"
      note={state === "on" ? "Allowed on this computer." : "The project asks for it."}
      testid="shell-escape-row"
    >
      {state === "on" ? (
        <Button variant="ghost" data-testid="shell-escape-revoke" disabled={busy} onClick={() => void answer(false)}>
          Revoke
        </Button>
      ) : (
        <Button
          variant={asked ? "pen" : "ghost"}
          data-testid="shell-escape-allow"
          disabled={busy}
          onClick={() => void answer(true)}
        >
          {asked ? "Yes, allow it on this computer" : "Allow"}
        </Button>
      )}
    </SRow>
  );
}

/** The words this project's writer has told the checker about.
 *
 *  `DELETE /dictionary` and `api.forgetWord` both existed and nothing
 *  called either, so a word added by a slip of the hand was added for the
 *  life of the project: the underline was gone and there was no way to ask
 *  for it back. The list is per project, which is why it lives beside the
 *  switch rather than in an application-wide preference.
 */
function AddedWords() {
  const projectId = useStore((s) => s.projectId);
  const [words, setWords] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let dropped = false;
    api
      .dictionary(projectId)
      .then((answer) => !dropped && setWords(answer.words))
      .catch(() => !dropped && setWords([]));
    return () => {
      dropped = true;
    };
  }, [projectId]);

  const forget = async (word: string) => {
    if (!projectId) return;
    try {
      const answer = await api.forgetWord(projectId, word);
      setWords(answer.words);
      setProblem("");
      // The editor holds its own copy of this list, in another tree.
      set({ dictionaryStamp: get().dictionaryStamp + 1 });
    } catch (error: any) {
      setProblem(error.message);
    }
  };

  // Nothing at all until there is something to show. An empty row would
  // be a permanent reminder of a feature nobody has used yet, in a sheet
  // whose whole job is to be quiet.
  if (!words || words.length === 0) return null;

  return (
    <SRow title="Words you added" note={problem ? <span className="text-error">{problem}</span> : "Kept with this project."}>
      <div className="flex max-w-[60%] flex-wrap justify-end gap-1.5">
        {words.map((word) => (
          <Chip key={word} onRemove={() => forget(word)} removeLabel={`Forget ${word}`}>
            {word}
          </Chip>
        ))}
      </div>
    </SRow>
  );
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
] as const;

/** The project's spelling language.  Kept in `nexttex.toml`, since every
 *  collaborator needs the same answer.  Until somebody chooses, the main
 *  document's babel or polyglossia line decides, and the row says which
 *  line; choosing English over such a line writes "en" so the line stops
 *  deciding, and choosing it with no line to overrule writes nothing. */
function LanguageRow({
  projectId,
  chosen,
  onChange,
}: {
  projectId: string;
  chosen: string;
  onChange: (language: string) => void;
}) {
  const activePreview = useStore((s) => s.activePreview);
  const [declared, setDeclared] = useState<{ code: string; line: string } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .symbols(projectId)
      .then((symbols) => {
        if (!live) return;
        const all = symbols.languages ?? {};
        setDeclared((activePreview && all[activePreview]) || Object.values(all)[0] || null);
      })
      .catch(() => live && setDeclared(null));
    return () => {
      live = false;
    };
  }, [projectId, activePreview]);
  const value = (chosen || declared?.code || "en") as (typeof LANGUAGES)[number]["value"];
  return (
    <SRow
      title="Spelling language"
      note={
        !chosen && declared ? (
          <>
            Suggested by <span className="whitespace-nowrap font-mono">{declared.line}</span>.
          </>
        ) : undefined
      }
    >
      <Segmented
        label="Spelling language"
        testid="spelling-language"
        value={value}
        options={LANGUAGES.map((option) => ({
          value: option.value,
          label: option.label,
          testid: `language-${option.value}`,
        }))}
        onChange={(language) => onChange(language === "en" ? (declared ? "en" : "") : language)}
      />
    </SRow>
  );
}
