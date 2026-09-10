/** What to do with something you have selected.
 *
 *  A writer who has highlighted a paragraph has already said what they mean
 *  by pointing at it, so making them describe it again in a sentence is a
 *  tax. This is the row of verbs that removes it.
 *
 *  It seeds the composer rather than sending. Section 5 settled that rule
 *  for the `Fix` button on a diagnostic and gave the reason: the user always
 *  presses Enter on their own message. The argument is stronger here, not
 *  weaker, because rewording forty lines of a chapter is a larger act than
 *  fixing one error, and because the second half of the instruction is
 *  usually the part that matters: reword this, *and keep the citation*.
 *
 *  Deliberately not five verbs. There is no "Improve", which says nothing
 *  about what will change and produces the diff nobody can review, and no
 *  "Cite", because section 17's rule is that a citation is never composed
 *  and a verb that looks like it produces one is a promise this app does not
 *  make.
 */

type Verb = { label: string; prompt: string; hint: string };

/** The prompts are sentences rather than command words, so the writer can
 *  amend them in the box: the seeded text is a first draft of the question,
 *  not the question. */
const VERBS: Verb[] = [
  {
    label: "Reword",
    prompt: "Reword this, keeping the meaning, the terminology and any citations:",
    hint: "Say it differently, without changing what it says",
  },
  {
    label: "Shorten",
    prompt: "Tighten this without losing any claim or number it makes:",
    hint: "Fewer words, same content",
  },
  {
    label: "Expand",
    prompt: "Expand this, staying in the surrounding voice and citation density:",
    hint: "Develop the idea further",
  },
  {
    label: "Ask",
    prompt: "About this:",
    hint: "Ask something about it rather than changing it",
  },
];

export default function SelectionActions({
  lines,
  at,
  onPick,
  onDismiss,
}: {
  /** Which lines are selected, for the label. Inclusive and 1-based. */
  lines: { from: number; to: number };
  /** Where to draw it, in pixels within the editor pane. */
  at: { left: number; top: number };
  onPick: (prompt: string) => void;
  onDismiss: () => void;
}) {
  const span =
    lines.from === lines.to
      ? `Line ${lines.from}`
      : `Lines ${lines.from} to ${lines.to}`;
  return (
    <div
      role="group"
      aria-label={`${span} selected`}
      data-testid="selection-actions"
      // 5px radius, because this is a card rather than a row, and the one
      // shadow the design allows a floating surface. Painted on
      // `--surface-2` rather than `--surface`, since section 23 records
      // what happens when a floating thing takes the colour of the page it
      // floats over.
      className="nx-arrive absolute z-20 flex items-center gap-[2px] rounded-[5px] border border-line bg-surface-2 p-1 shadow-float"
      style={{ left: at.left, top: at.top }}
      onMouseDown={(event) => {
        // The selection is the whole point of this control, and a press
        // inside it would collapse it before the click landed.
        event.preventDefault();
      }}
    >
      <span className="t-micro px-1 tabular-nums text-ink-3">{span}</span>
      <span className="mx-[2px] h-[14px] w-px bg-line" />
      {VERBS.map((verb) => (
        <button
          key={verb.label}
          className="quiet h-[22px] rounded-[3px] px-2 t-micro hover:bg-surface-3"
          data-testid={`selection-${verb.label.toLowerCase()}`}
          title={verb.hint}
          onClick={() => onPick(verb.prompt)}
        >
          {verb.label}
        </button>
      ))}
      <button
        className="quiet flex h-[22px] w-[22px] items-center justify-center rounded-[3px] hover:bg-surface-3"
        aria-label="Put this away"
        title="Put this away"
        data-testid="selection-dismiss"
        onClick={onDismiss}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
          <path
            d="M1 1 L8 8 M8 1 L1 8"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
