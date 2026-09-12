import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { referencesPending, statusFor } from "./status-dot";

/** A spinner shown at 0ms on a one-second task is what tells the user the
 *  task is slow.  The dot only starts breathing once a build crosses this;
 *  below it, a build comes and goes without anything moving. */
const BREATHE_AFTER = 400;

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
  onRebuild: (full: boolean) => void;
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
  const stale = useStore((s) => s.stale);
  const result = useStore((s) => s.compile);
  const diagnostics = useStore((s) => s.diagnostics);
  const activePath = useStore((s) => s.activePath);
  const cursor = useStore((s) => s.cursor);
  const autocompile = useStore((s) => s.settings.autocompile);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!compiling) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), BREATHE_AFTER);
    return () => window.clearTimeout(timer);
  }, [compiling]);

  // Counted once per build rather than twice per render. The strip
  // re-renders on the cursor moving, which is every keystroke.
  const [errors, warnings] = useMemo(() => {
    let bad = 0;
    let iffy = 0;
    for (const item of diagnostics) {
      if (item.severity === "error") bad += 1;
      else if (item.severity === "warning") iffy += 1;
    }
    return [bad, iffy];
  }, [diagnostics]);

  // `state` says the same thing as the dot's colour, in a form a test can
  // read.  Asserting on the colour class would pass on a dot that is the
  // right shade of nothing; asserting on the label would break the moment
  // the wording changes.
  const { state, dot, label, clickable, hint } = statusFor({
    compiling, slow, stale, result, errors, warnings, autocompile,
  });
  // The duration is already in the label when a build succeeded; it earns a
  // segment of its own only when the label is saying something else.
  const showDuration = Boolean(result) && !compiling && !label.startsWith("Built");

  return (
    // A container query, not a viewport one: this strip is as wide as the
    // editor pane, which the user drags.  Segments drop out in order of how
    // little they are missed -- the path first, since the tab above says it.
    <div
      className="nx-furniture @container group flex h-[26px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line bg-surface-2 px-[10px]"
    >
      {/* In four of the seven states this opens nothing, and it was a
          focusable button either way: somebody tabbing through the editor
          stopped on it, pressed it, and got no answer and no reason. A
          control that cannot be used says so. */}
      <button
        data-testid="status"
        data-state={state}
        title={hint || undefined}
        className="flex shrink-0 items-center gap-2 disabled:cursor-default"
        disabled={!clickable}
        aria-disabled={!clickable}
        tabIndex={clickable ? 0 : -1}
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
          {activePath ?? "–"}
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
        <span
          className="t-micro tnum w-[96px] text-right text-ink-2"
          data-testid="caret"
        >
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
          {/* And whether the page still has `??` on it. A fast build is one
              pdflatex pass, which is what makes typing feel immediate and
              is also what cannot resolve a reference. Until this line, the
              only thing anywhere about that was a warning count in this
              strip, a pane away from the page showing the `??`, with the
              drawer never opening itself. */}
          {referencesPending(result, diagnostics) ? (
            <span className="text-warn"> · references pending</span>
          ) : null}
        </span>
      </span>
      {/* Permanent, not hover-only: it is one word, it is the answer when
          the preview looks stale, and a strip that gains a segment on hover
          is a strip that jitters.

          One control, not two.  With compile-as-you-type off this is the
          only way to build anything, so it says Compile and it stops being
          droppable at narrow widths -- a `Compile` button beside a
          `Rebuild` button would only ask the writer which of two words for
          the same thing they meant.  Shift-click still forces a full
          build either way. */}
      <span
        className={
          autocompile
            ? "hidden shrink-0 items-center gap-3 @[420px]:flex"
            : "flex shrink-0 items-center gap-3"
        }
      >
        <Rule />
        <button
          className="quiet t-micro"
          title="Shift-click to rebuild everything"
          onClick={(event) => onRebuild(event.shiftKey)}
        >
          {autocompile ? "Rebuild" : "Compile"}
        </button>
        {/* A press rather than a modifier, when there is a reason to press
            it. Shift-click stays and was the only way to ask for a full
            build, written down in a `title` attribute: undiscoverable, and
            no use at all on a tablet. */}
        {referencesPending(result, diagnostics) ? (
          <button
            className="quiet t-micro"
            data-testid="rebuild-everything"
            onClick={() => onRebuild(true)}
          >
            Rebuild everything
          </button>
        ) : null}
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
      {/* Dropped like every other segment when the pane is narrow, rather
          than clipped.  This one had no container query, so on a 1300px
          window it rendered "148 word" with the s cut off at the pane
          border -- and at 1000 the count vanished but its separator rule
          stayed, pointing at nothing.  The strip never reflows; it drops. */}
      <span className="hidden shrink-0 items-center gap-3 @[640px]:flex">
      <Rule />
      <button
        className="t-micro tnum w-[92px] shrink-0 text-right text-ink-2 hover:text-ink"
        title="Click to count this file or the whole document"
        onClick={onToggleWordScope}
      >
        {/* An en dash, matching the one the file name falls back to a few
            rows up. It was an em dash written as an escape, which is the
            one punctuation mark this repository bans without exception;
            the escape is why the guard that reads every source file for
            the character never saw it. A dash standing for "no value yet"
            in a field of numbers is not punctuation between clauses, so
            the rule is met by using the narrower dash rather than by
            arguing the case. */}
        {words === null
          ? "\u2013 words"
          : `${words.toLocaleString()} ${wordScope === "document" ? "words" : "in file"}`}
      </button>
      </span>
    </div>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
}
