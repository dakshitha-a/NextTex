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
  // The duration is already in the label when a build succeeded; it earns a
  // segment of its own only when the label is saying something else.
  const showDuration = Boolean(result) && !compiling && !label.startsWith("Built");

  return (
    // A container query, not a viewport one: this strip is as wide as the
    // editor pane, which the user drags.  Segments drop out in order of how
    // little they are missed -- the path first, since the tab above says it.
    <div
      className={`@container group relative flex h-[26px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line bg-surface-2 px-[10px] ${
        slow ? "hairline" : ""
      }`}
    >
      <button
        className="flex shrink-0 items-center gap-2"
        onClick={() => clickable && onToggleDrawer()}
      >
        <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${dot}`} />
        <span className="t-micro text-ink-2">{label}</span>
      </button>
      {showDuration ? (
        <span className="hidden shrink-0 items-center gap-3 @[380px]:flex">
          <Rule />
          <span className="t-micro tnum text-ink-3">
            {((result?.durationMs ?? 0) / 1000).toFixed(2)}s
          </span>
        </span>
      ) : null}
      <span className="hidden min-w-0 flex-1 items-center gap-3 @[760px]:flex">
        <Rule />
        <span className="nx-mono-11 min-w-0 flex-1 truncate text-ink-3">
          {activePath ?? "—"}
        </span>
      </span>
      <span className="flex-1 @[760px]:hidden" />
      <Rule />
      <span className="t-micro tnum w-[96px] shrink-0 text-right text-ink-2">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      {/* Which document the PDF beside this strip is actually showing.  A
          fast build typesets one chapter, and a reader who does not know
          that will think pages have gone missing. */}
      <span className="hidden shrink-0 items-center gap-3 @[500px]:flex">
        <Rule />
        <button
          className="t-micro text-ink-3 hover:text-ink"
          title="How much of the document the preview shows. Click to typeset all of it."
          onClick={onRebuild}
        >
          {result && result.scope !== "full" ? "This chapter" : "Whole document"}
        </button>
      </span>
      <Rule />
      <span className="hidden shrink-0 items-center gap-3 group-hover:flex @[420px]:group-hover:flex">
        <Rule />
        <button className="t-micro text-ink-2 hover:text-ink" onClick={onRebuild}>
          Rebuild
        </button>
      </span>
      <Rule />
      <button
        className="t-micro tnum w-[92px] shrink-0 text-right text-ink-2 hover:text-ink"
        title="Click to count this file or the whole document"
        onClick={onToggleWordScope}
      >
        {words === null
          ? "\u2014 words"
          : `${words.toLocaleString()} ${wordScope === "document" ? "words" : "in file"}`}
      </button>
    </div>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
}
