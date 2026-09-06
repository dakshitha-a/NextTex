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
  onHistory,
  historyOpen,
  git,
}: {
  onToggleDrawer: () => void;
  onRebuild: () => void;
  words: number | null;
  wordScope: "file" | "document";
  onToggleWordScope: () => void;
  onHistory: () => void;
  historyOpen: boolean;
  git: {
    branch: string;
    ahead: number;
    changes: { state: string; path: string }[];
  } | null;
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

  // `state` says the same thing as the dot's colour, in a form a test can
  // read.  Asserting on the colour class would pass on a dot that is the
  // right shade of nothing; asserting on the label would break the moment
  // the wording changes.
  let state = "ready";
  let dot = "border border-ink-3";
  let label = "Ready";
  let clickable = false;
  if (compiling) {
    state = "compiling";
    dot = "bg-pen";
    label = "Compiling";
  } else if (errors) {
    state = "errors";
    dot = "bg-error";
    label = `${errors} ${errors === 1 ? "error" : "errors"}`;
    clickable = true;
  } else if (warnings) {
    state = "warnings";
    dot = "bg-warn";
    label = `${warnings} ${warnings === 1 ? "warning" : "warnings"}`;
    clickable = true;
  } else if (result) {
    state = "built";
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
        data-testid="status"
        data-state={state}
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
      {git ? (
        <span className="hidden shrink-0 items-center gap-3 @[560px]:flex">
          <Rule />
          <span className="nx-mono-11 text-ink-2">
            {git.branch}
            {git.changes.length ? ` +${git.changes.length}` : ""}
            {git.ahead ? ` ↑${git.ahead}` : ""}
          </span>
        </span>
      ) : null}
      <span className="hidden shrink-0 items-center gap-3 @[300px]:flex">
        <Rule />
        <span className="t-micro tnum w-[96px] text-right text-ink-2">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      </span>
      {/* Which document the PDF beside this strip is actually showing.  A
          fast build typesets one chapter, and a reader who does not know
          that will think pages have gone missing. */}
      <span className="hidden shrink-0 items-center gap-3 @[500px]:flex">
        <Rule />
        {/* A state, not a control: the action beside it is Rebuild. */}
        <span className="t-micro text-ink-3">
          {result && result.scope !== "full" ? "This chapter" : "Whole document"}
        </span>
      </span>
      {/* Permanent, not hover-only: it is one word, it is the answer when
          the preview looks stale, and a strip that gains a segment on hover
          is a strip that jitters. */}
      <span className="hidden shrink-0 items-center gap-3 @[420px]:flex">
        <Rule />
        <button className="quiet t-micro" onClick={onRebuild}>
          Rebuild
        </button>
      </span>
      <Rule />
      <button
        className="quiet t-micro shrink-0"
        data-tone={historyOpen ? "on" : undefined}
        title="What this file used to say"
        onClick={onHistory}
      >
        History
      </button>
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
