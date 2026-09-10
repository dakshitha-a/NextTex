/** Two ways to stop doing work more often than it can be seen.
 *
 *  Nine hand-rolled versions of this had grown across the interface, each
 *  slightly different and three of them missing entirely, so a resize read
 *  computed style and re-rendered the root once per event, a pane drag set
 *  state once per pointer move, and a tab strip measured every tab on every
 *  scroll event. A browser fires those far faster than it paints.
 *
 *  Neither of these is a timer for its own sake. `onFrame` is for work whose
 *  result is drawn, because more than one call per frame cannot be seen.
 *  `afterQuiet` is for work that only matters once the person has stopped.
 */

type Cancellable<A extends unknown[]> = ((...args: A) => void) & {
  cancel(): void;
};

/**
 * Run at most once per animation frame, with the most recent arguments.
 *
 * The last call before the frame wins rather than the first, because these
 * are positions and sizes: the newest is the true one and an earlier one is
 * a place the pointer has already left.
 */
export function onFrame<A extends unknown[]>(
  work: (...args: A) => void,
): Cancellable<A> {
  let queued: number | null = null;
  let latest: A | null = null;

  const run = (...args: A) => {
    latest = args;
    if (queued !== null) return;
    queued = requestAnimationFrame(() => {
      queued = null;
      const call = latest;
      latest = null;
      if (call) work(...call);
    });
  };

  run.cancel = () => {
    if (queued !== null) cancelAnimationFrame(queued);
    queued = null;
    latest = null;
  };
  return run;
}

/** Run once, `wait` milliseconds after the last call. */
export function afterQuiet<A extends unknown[]>(
  work: (...args: A) => void,
  wait: number,
): Cancellable<A> {
  let timer: number | null = null;

  const run = (...args: A) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      work(...args);
    }, wait);
  };

  run.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return run;
}

/** When this person last typed into the document, and whether that was
 *  recently enough that nothing should move under them.
 *
 *  Lives here rather than in the store because it is read imperatively by
 *  whoever is about to move the view, and it must not cause a render: it
 *  changes on every keystroke.
 *
 *  It exists because the agent now says where it is about to write, and the
 *  editor goes to look. That is welcome when the writer is reading and
 *  unwelcome when they are mid-sentence, and "mid-sentence" is not a state
 *  a focus check can answer on its own: the caret sits in the editor for the
 *  whole time somebody is reading their own paragraph.
 */
let typedAt = 0;

/** Only ever called for a change this keyboard made. A collaborator's edit
 *  arriving over the socket is not this person typing. */
export function noteTyping(now = Date.now()): void {
  typedAt = now;
}

/** Three seconds, which is a pause in typing rather than a pause in
 *  thinking: long enough that finishing a word is not interrupted, short
 *  enough that a writer who has stopped to read gets taken to the edit. */
export const TYPING_GRACE = 3000;

export function busyTyping(now = Date.now()): boolean {
  return typedAt > 0 && now - typedAt < TYPING_GRACE;
}

/** For tests, and for a document being closed. */
export function forgetTyping(): void {
  typedAt = 0;
}
