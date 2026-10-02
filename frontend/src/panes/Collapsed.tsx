import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";
import { Pressable } from "../ui/controls";
import { foldTransition, type Fold } from "../motion";

/** Where a folded pane's strip sits in the row, sized by the pane's fold.
 *
 *  It widens from nothing to the strip's 28 px over the same frames the
 *  pane slides off in, and narrows back over the frames it slides in, so
 *  the neighbour's width moves once and stops.  The strip used to arrive
 *  only when the slide had ended: the neighbour grew 28 px past where it
 *  settles and then snapped back, and on the way in it jumped 28 px wider
 *  before the slide began (e2e/specs/motion.spec.ts). */
export function StripSlot({ fold, name, children }: { fold: Fold; name: string; children: ReactNode }) {
  const wide = fold === "closing" || fold === "closed" || fold === "entering";
  return (
    <div
      data-testid={`strip-slot-${name}`}
      className={`flex shrink-0 overflow-hidden ${wide ? "w-7" : "w-0"}`}
      style={{ transition: foldTransition(fold, "width") }}
      inert={fold !== "closed"}
      aria-hidden={fold !== "closed" || undefined}
    >
      {fold === "open" ? null : children}
    </div>
  );
}

/** A collapsed pane leaves a strip behind, so it is obvious that something
 *  is folded away and obvious how to get it back.  The chevron sits at the
 *  top, level with the pane headers, where the eye already is. */
export default function Collapsed({
  label,
  side,
  onExpand,
  mark,
  shows = label.toLowerCase(),
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
}) {
  return (
    <Pressable
      // A strip on the second surface with no hairline, the kit's plane;
      // the chevron points at the pane it would bring back.
      className={`nx-arrive group flex w-7 shrink-0 flex-col items-center gap-2 bg-surface-2 pt-2.5 transition-colors duration-[var(--dur-quick)] hover:bg-surface-3`}
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
    </Pressable>
  );
}
