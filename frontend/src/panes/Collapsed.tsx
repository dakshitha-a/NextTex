import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";

/** A collapsed pane leaves a strip behind, so it is obvious that something
 *  is folded away and obvious how to get it back.  The chevron sits at the
 *  top, level with the pane headers, where the eye already is. */
export default function Collapsed({
  label,
  side,
  onExpand,
  mark,
  shows = label.toLowerCase(),
  furniture = false,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
  /** What the tooltip and the accessible name say the strip shows.  The
   *  label lowercased is right for "source" and "preview" and wrong for a
   *  name, so the Claude strip passes its own. */
  shows?: string;
  /** Something the folded pane still has to say, drawn between the
   *  chevron and the label: the Claude strip carries the agent's state dot
   *  here, so "waiting for you" is not lost by folding the column. */
  mark?: ReactNode;
  /** Whether this strip stands in for furniture or for a page.
   *
   *  Three mount points, two answers.  The folded file rail is furniture
   *  and stays dark in the light theme, because the column it replaces is
   *  dark and a strip that flips colour on being folded reads as a
   *  different object.  The folded Source and Preview strips stand in for
   *  the two light panes and stay light for exactly the same reason.  A
   *  prop rather than a class inside the component: the component cannot
   *  tell which of the three it is. */
  furniture?: boolean;
}) {
  return (
    <button
      // A strip on the second surface with no hairline, the kit's plane;
      // the chevron points at the pane it would bring back.
      className={`${furniture ? "nx-furniture " : ""}group flex w-[28px] shrink-0 flex-col items-center gap-2 bg-surface-2 pt-[10px] transition-colors duration-[90ms] hover:bg-surface-3`}
      onClick={onExpand}
      data-testid={`collapsed-${label.toLowerCase()}`}
      title={`Show ${shows}`}
      aria-label={`Show ${shows}`}
    >
      <span className="text-ink-3 group-hover:text-ink">
        {side === "left" ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </span>
      {mark}
      <span
        className="t-meta whitespace-nowrap text-ink-3 group-hover:text-ink"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}
