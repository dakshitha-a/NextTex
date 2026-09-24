import { Button, IconButton } from "../ui/Button";
import { shellTheme } from "../ui/FloatingCard";
import { CloseIcon, CommentIcon } from "../ui/icons";
import { useLayoutEffect, useRef } from "react";

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
  onMeasure,
  verbs = true,
  onComment,
}: {
  /** Which lines are selected, for the label. Inclusive and 1-based. */
  lines: { from: number; to: number };
  /** Where to draw it, in pixels within the editor pane. */
  at: { left: number; top: number };
  onPick: (prompt: string) => void;
  onDismiss: () => void;
  /** The row's real size once it is drawn, so the pane can place it
   *  clear of the text rather than by a guess. */
  onMeasure?: (size: { width: number; height: number }) => void;
  /** Whether the agent's four verbs are offered: not for a selection too
   *  short to ask anything about, which still gets Comment. */
  verbs?: boolean;
  /** Start a comment on the selection. After a rule, apart from the
   *  verbs, because it does not talk to the agent. */
  onComment?: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !onMeasure) return;
    onMeasure({ width: element.offsetWidth, height: element.offsetHeight });
  }, [onMeasure, lines.from, lines.to]);
  const span =
    lines.from === lines.to
      ? `Line ${lines.from}`
      : `Lines ${lines.from} to ${lines.to}`;
  return (
    <div
      ref={box}
      role="group"
      aria-label={`${span} selected`}
      data-testid="selection-actions"
      // 5px radius, because this is a card rather than a row, and the one
      // shadow the design allows a floating surface. Furniture, like the
      // spelling menu beside it: the two things that float over the page
      // used to follow the page, and on a white page that made them a
      // pale card one step from the paper. See section 32.
      // The kit's card, in the shell's palette: the two things that float
      // over the page used to follow the page, and on a white page that
      // made them a pale card one step from the paper.  See section 32.
      className={`nx-card nx-arrive absolute z-20 flex items-center gap-[2px] !px-[6px] !py-[4px] ${shellTheme()}`}
      style={{ left: at.left, top: at.top }}
      onMouseDown={(event) => {
        // The selection is the whole point of this control, and a press
        // inside it would collapse it before the click landed.
        event.preventDefault();
      }}
    >
      <span className="t-meta px-1 pr-2 tabular-nums text-ink-3">{span}</span>
      {(verbs ? VERBS : []).map((verb) => (
        <Button
          key={verb.label}
          size="inline"
          className="!text-ink"
          data-testid={`selection-${verb.label.toLowerCase()}`}
          title={verb.hint}
          onClick={() => onPick(verb.prompt)}
        >
          {verb.label}
        </Button>
      ))}
      {onComment ? (
        <>
          {verbs ? <span className="nx-selection-rule" aria-hidden="true" /> : null}
          <Button
            size="inline"
            className="!text-ink"
            icon={<CommentIcon size={13} />}
            data-testid="selection-comment"
            title="Leave a comment on this (Ctrl Alt M)"
            onClick={onComment}
          >
            Comment
          </Button>
        </>
      ) : null}
      <IconButton
        label="Put this away"
        data-testid="selection-dismiss"
        className="!h-6 !w-6"
        onClick={onDismiss}
      >
        <CloseIcon size={12} />
      </IconButton>
    </div>
  );
}
