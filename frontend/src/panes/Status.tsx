import { useEffect, useState } from "react";
import { useStore } from "../store";

/** A spinner shown at 0ms on a one-second task is what tells the user the
 *  task is slow.  The hairline only appears once a build crosses this. */
const HAIRLINE_AFTER = 400;

export default function Status({
  onToggleDrawer,
  onRebuild,
  words,
  wordScope,
  onToggleWordScope,
}: {
  onToggleDrawer: () => void;
  onRebuild: () => void;
  words: number | null;
  wordScope: "file" | "document";
  onToggleWordScope: () => void;
}) {
  const compiling = useStore((s) => s.compiling);
  const result = useStore((s) => s.compile);
  const diagnostics = useStore((s) => s.diagnostics);
  const activePath = useStore((s) => s.activePath);
  const cursor = useStore((s) => s.cursor);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!compiling) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), HAIRLINE_AFTER);
    return () => window.clearTimeout(timer);
  }, [compiling]);

  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;

  let dot = "border border-ink-3";
  let label = "Ready";
  let clickable = false;
  if (compiling) {
    dot = "bg-pen";
    label = "Compiling";
  } else if (errors) {
    dot = "bg-error";
    label = `${errors} ${errors === 1 ? "error" : "errors"}`;
    clickable = true;
  } else if (warnings) {
    dot = "bg-warn";
    label = `${warnings} ${warnings === 1 ? "warning" : "warnings"}`;
    clickable = true;
  } else if (result) {
    dot = "bg-ink-3";
    label = `Built ${(result.durationMs / 1000).toFixed(2)}s`;
  }

  return (
    <div
      className={`group relative flex h-[26px] shrink-0 items-center border-t border-line bg-surface-2 px-[10px] ${
        slow ? "hairline overflow-hidden" : ""
      }`}
    >
      <button
        className="flex items-center gap-2"
        onClick={() => clickable && onToggleDrawer()}
      >
        <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
        <span className="t-micro text-ink-2">{label}</span>
      </button>
      <span className="mx-3 h-[10px] w-px bg-line" />
      <span className="t-code-sm truncate text-ink-3">{activePath ?? "—"}</span>
      <span className="mx-3 h-[10px] w-px bg-line" />
      <span className="t-micro tnum min-w-[104px] text-ink-2">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <span className="flex-1" />
      {/* Which document the PDF beside this strip is actually showing.  A
          fast build typesets one chapter, and a reader who does not know
          that will think pages have gone missing. */}
      <button
        className="t-micro text-ink-3 hover:text-ink"
        title="The preview shows this much of the document. Rebuild to see all of it."
        onClick={onRebuild}
      >
        {result && result.scope !== "full" ? "This chapter" : "Whole document"}
      </button>
      <span className="mx-3 h-[10px] w-px bg-line" />
      <button
        className="t-micro tnum min-w-[92px] text-right text-ink-2 hover:text-ink"
        title="Click to count this file or the whole document"
        onClick={onToggleWordScope}
      >
        {words === null
          ? "— words"
          : `${words.toLocaleString()} ${wordScope === "document" ? "words" : "in file"}`}
      </button>
      <button
        className="t-micro ml-3 hidden text-ink-2 hover:text-ink group-hover:block"
        onClick={onRebuild}
      >
        Rebuild
      </button>
    </div>
  );
}
