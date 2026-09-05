/** A collapsed pane leaves a strip behind, so it is obvious that something
 *  is folded away and obvious how to get it back.  A pane that vanishes
 *  entirely is a pane the user has to remember exists. */
export default function Collapsed({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}) {
  return (
    <button
      className="nx-hover group flex w-[26px] shrink-0 items-center justify-center border-line bg-surface-2 hover:bg-surface-3"
      style={{ borderRightWidth: side === "left" ? 1 : 0, borderLeftWidth: side === "right" ? 1 : 0 }}
      onClick={onExpand}
      title={`Show ${label.toLowerCase()}`}
      aria-label={`Show ${label.toLowerCase()}`}
    >
      <span
        className="t-micro whitespace-nowrap text-ink-3 group-hover:text-ink"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {label}
      </span>
    </button>
  );
}
