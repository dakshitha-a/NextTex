import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { referencesPending, statusFor } from "./status-dot";
import { labelFor } from "../words";
import { type WordScope } from "../api";

/** A spinner shown at 0ms on a one-second task is what tells the user the
 *  task is slow.  The dot only starts breathing once a build crosses this;
 *  below it, a build comes and goes without anything moving. */
const BREATHE_AFTER = 400;

export default function Status({
  onOpenBuild,
  onRebuild,
  words,
  wordScope,
  wordScopes,
  onToggleWordScope,
}: {
  /** Show the Build drawer. Never folds it: the count is a way in. */
  onOpenBuild: () => void;
  onRebuild: (full: boolean) => void;
  words: number | null;
  wordScope: WordScope;
  /** The scopes the control cycles, which is three or four depending on
   *  whether anything is selected: a scope that counts nothing is a stop
   *  on the cycle that reads as the control being broken. */
  wordScopes: string[];
  onToggleWordScope: () => void;
}) {
  const compiling = useStore((s) => s.compiling);
  const stale = useStore((s) => s.stale);
  const result = useStore((s) => s.compile);
  const diagnostics = useStore((s) => s.diagnostics);
  const cursor = useStore((s) => s.cursor);
  const spellingNote = useStore((s) => s.spellingNote);
  const autocompile = useStore((s) => s.settings.autocompile);
  // A project asking for shell escape that this machine has not answered.
  // The question is drawn in the Build drawer, and the strip says so.
  const askShell = useStore((s) => s.settings.shellEscape) === "asked";
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
    // The server sends at most a few hundred rows and counts the rest.
    return [bad, iffy + (result?.omittedWarnings ?? 0)];
  }, [diagnostics, result]);

  // `state` says the same thing as the dot's colour, in a form a test can
  // read.  Asserting on the colour class would pass on a dot that is the
  // right shade of nothing; asserting on the label would break the moment
  // the wording changes.
  const found = statusFor({
    compiling, slow, stale, result, errors, warnings, autocompile,
  });
  const { state, dot, label } = found;
  const hint = askShell && !found.clickable ? "This project asks for shell escape" : found.hint;
  // The duration is already in the label when a build succeeded; it earns a
  // segment of its own only when the label is saying something else.
  const showDuration = Boolean(result) && !compiling && !label.startsWith("Built");

  // The label carries weight only when it is news: an error count is set
  // at 500 in the second ink, a clean build sits in the third like the
  // rest of the strip.
  const loud = state === "errors" || state === "failed" || state === "timeout";

  return (
    // A container query, not a viewport one: this strip is as wide as the
    // editor pane, which the user drags.  Segments drop out in order of how
    // little they are missed.  The path, the git line and History left the
    // strip in the overhaul: the tab names the file, the Git drawer holds
    // the branch, and History is a drawer of its own.  28 px on the second
    // surface with no rule above it, as the direction page draws it.
    <div
      data-testid="status-strip"
      className="nx-foot @container t-meta flex h-[28px] shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap bg-surround px-3 text-ink-2"
    >
      {/* The state words open the Build drawer in every state: it always
          has something to say, the build's state and the way to build
          again, so the control is never a dead stop on the way through. */}
      <button
        data-testid="status"
        data-state={state}
        title={hint || undefined}
        className="flex shrink-0 items-center gap-[6px] hover:text-ink"
        onClick={onOpenBuild}
      >
        <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${dot}`} />
        <span className={loud ? "font-medium text-ink" : "text-ink-2"}>{label}</span>
        {askShell ? (
          <span className="text-warn" data-testid="status-shell-escape">
            shell escape?
          </span>
        ) : null}
      </button>
      {showDuration ? (
        <span className="tnum hidden shrink-0 @[380px]:inline">
          {((result?.durationMs ?? 0) / 1000).toFixed(2)} s
        </span>
      ) : null}
      <span className="tnum hidden shrink-0 @[300px]:inline" data-testid="caret">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      {spellingNote ? (
        <span className="hidden shrink-0 @[420px]:inline" data-testid="spelling-note">
          {spellingNote}
        </span>
      ) : null}
      {/* Which document the PDF beside this strip is actually showing, and
          only when it is not the whole one: a fast build typesets one
          chapter, and a reader who does not know that will think pages
          have gone missing.  A state, not a control: the action is Rebuild. */}
      {result && result.scope !== "full" ? (
        <span className="hidden shrink-0 @[500px]:inline">
          This chapter
          {/* And whether the page still has `??` on it. A fast build is one
              pdflatex pass, which is what makes typing feel immediate and
              is also what cannot resolve a reference. */}
          {referencesPending(result, diagnostics) ? (
            <span className="text-warn"> · references pending</span>
          ) : null}
        </span>
      ) : null}
      <span className="min-w-0 flex-1" />
      {/* Permanent, not hover-only: it is one word, it is the answer when
          the preview looks stale, and a strip that gains a segment on hover
          is a strip that jitters.

          One control, not two.  With compile-as-you-type off this is the
          only way to build anything, so it says Compile and it stops being
          droppable at narrow widths.  Shift-click still forces a full
          build either way. */}
      <span
        className={
          autocompile
            ? "hidden shrink-0 items-center gap-4 @[420px]:flex"
            : "flex shrink-0 items-center gap-4"
        }
      >
        <button
          className="hover:text-ink"
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
            className="hover:text-ink"
            data-testid="rebuild-everything"
            onClick={() => onRebuild(true)}
          >
            Rebuild everything
          </button>
        ) : null}
      </span>
      {/* Dropped like every other segment when the pane is narrow, rather
          than clipped: the strip never reflows; it drops. */}
      <button
        className="tnum hidden shrink-0 hover:text-ink @[640px]:inline"
        data-testid="word-count"
        title={`Counting ${wordScope}. Click for the next of ${wordScopes.join(", ")}.`}
        onClick={onToggleWordScope}
      >
        {/* An en dash, matching the one the file name falls back to. A dash
            standing for "no value yet" in a field of numbers is not
            punctuation between clauses. */}
        {words === null ? "\u2013 words" : labelFor(wordScope, words)}
      </button>
    </div>
  );
}
