import { ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";

/** A collapsed pane leaves a strip behind, so it is obvious that something
 *  is folded away and obvious how to get it back.  The chevron sits at the
 *  top, level with the pane headers, where the eye already is. */
export default function Collapsed({
  label,
  side,
  onExpand,
  furniture = false,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
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
      title={`Show ${label.toLowerCase()}`}
      aria-label={`Show ${label.toLowerCase()}`}
    >
      <span className="text-ink-3 group-hover:text-ink">
        {side === "left" ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </span>
      <span
        className="t-meta whitespace-nowrap text-ink-3 group-hover:text-ink"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}
