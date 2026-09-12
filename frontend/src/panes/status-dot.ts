/** What the dot beside the preview says, as a function of what is known.
 *
 *  Split out of the component so it can be reasoned about and tested
 *  without a browser: nine states, evaluated in order, first match wins.
 *
 *  The dot answers one question -- **does the picture match the text** --
 *  and the label beside it answers the other, which is what the last build
 *  had to say.  That split is what makes the ordinary writing loop quiet.
 *  Compiling and out-of-date are the same yellow, and the breathe waits
 *  400ms, so a normal keystroke-to-build cycle is
 *
 *      green -> (keystroke) yellow -> (build) green
 *
 *  Two colour changes and no animation at all.  The dot only ever moves
 *  when a build is genuinely slow, which is the same argument the sweeping
 *  hairline was making before it -- said in a dot instead of across the
 *  full width of the strip, in the corner of the eye, for as long as the
 *  build took.
 *
 *  It also means yellow no longer means "there are warnings".  Warnings are
 *  a fact about the source and they have three other places to say so; the
 *  preview being behind is a fact about the preview, which is what the dot
 *  beside the preview should be describing.  A document with chktex noise
 *  and a current build therefore shows a green dot reading `2 warnings`,
 *  which is true on both counts.
 */

export type Outcome = "ok" | "errors" | "cancelled" | "timeout" | "failed" | "no_engine";

export type StatusInput = {
  compiling: boolean;
  /** Whether the build has been running long enough to be worth animating. */
  slow: boolean;
  /** Whether anything has been edited since the last build started. */
  stale: boolean;
  /** The last build that said anything, or null if there has not been one. */
  result: { durationMs: number; outcome?: Outcome } | null;
  errors: number;
  warnings: number;
  /** Only used to say how to get a build when none is coming by itself. */
  autocompile: boolean;
};

export type StatusDot = {
  /** Read by tests and by the e2e suite; the colour classes are not. */
  state: "compiling" | "stale" | "timeout" | "failed" | "errors" | "built" | "ready";
  dot: string;
  label: string;
  clickable: boolean;
  hint: string;
};

/** What the strip says when it is not saying anything about a build in
 *  flight: errors first, then warnings, then how long the last one took. */
function restingLabel(input: StatusInput): string {
  if (input.errors) {
    return `${input.errors} ${input.errors === 1 ? "error" : "errors"}`;
  }
  if (input.warnings) {
    return `${input.warnings} ${input.warnings === 1 ? "warning" : "warnings"}`;
  }
  if (input.result) return `Built ${(input.result.durationMs / 1000).toFixed(2)}s`;
  return "Not built yet";
}

export function statusFor(input: StatusInput): StatusDot {
  const findings = input.errors > 0 || input.warnings > 0;
  const outcome = input.result?.outcome;

  if (input.compiling) {
    return {
      state: "compiling",
      dot: input.slow ? "nx-breathe" : "bg-warn",
      label: "Compiling",
      clickable: false,
      hint: "Building",
    };
  }

  if (input.stale) {
    // The label carries over from the last build unchanged, so it does not
    // churn on every keystroke -- the strip is not supposed to reflow while
    // somebody is typing beside it.
    return {
      state: "stale",
      dot: "bg-warn",
      label: restingLabel(input),
      clickable: findings,
      hint: input.autocompile
        ? "The preview is older than the source"
        : "The preview is older than the source. ⌘S to compile",
    };
  }

  if (outcome === "timeout") {
    return {
      state: "timeout",
      dot: "bg-error",
      label: "Build timed out",
      clickable: findings,
      hint: "latexmk did not finish",
    };
  }

  if (outcome === "failed" || outcome === "no_engine") {
    return {
      state: "failed",
      dot: "bg-error",
      label: "Build failed",
      clickable: findings,
      hint: "The build did not run",
    };
  }

  if (input.errors) {
    return {
      state: "errors",
      dot: "bg-error",
      label: restingLabel(input),
      clickable: true,
      hint: "The preview is from the last build that worked",
    };
  }

  if (outcome === "errors") {
    // LaTeX stopped, and the log gave nothing that could be pinned to a
    // line.  Showing this as a clean green build would be the worst lie
    // available: the writer would go on typing against a preview of a
    // document that no longer compiles.
    return {
      state: "failed",
      dot: "bg-error",
      label: "Build failed",
      clickable: false,
      hint: "LaTeX stopped and the log gave no line",
    };
  }

  if (input.result) {
    return {
      state: "built",
      dot: "bg-ok",
      label: restingLabel(input),
      clickable: input.warnings > 0,
      hint: "The preview matches the source",
    };
  }

  return {
    state: "ready",
    dot: "border border-ink-3",
    label: "Ready",
    clickable: false,
    hint: "",
  };
}

/** Whether the page a writer is looking at still has `??` in it.
 *
 *  A fast build is one pdflatex pass, which is what makes typing feel
 *  immediate, and one pass cannot resolve a reference or a citation. So the
 *  preview shows `??` where a number should be, and until now the only
 *  thing on any screen about it was a warning count in a strip a pane away,
 *  with `mark_warnings` off by default and the drawer never opening itself.
 *  The writer sees `??` on the page and nothing telling them it is the
 *  build rather than their document.
 *
 *  Both halves are needed. A full pass that still has undefined references
 *  means a label really is missing, which is the writer's problem and a
 *  different sentence; a fast pass with no `??` has nothing to say.
 */
export function referencesPending(
  result: { enginePass?: string } | null,
  diagnostics: { message?: string }[],
): boolean {
  if (!result || result.enginePass !== "fast") return false;
  return diagnostics.some((item) =>
    /undefined|Citation .*undefined|Reference .*undefined/i.test(item.message ?? ""),
  );
}
