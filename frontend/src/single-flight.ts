/** One call at a time, with at most one more queued behind it.
 *
 *  For a refresh whose answer is the current state of something, such as
 *  the project's file tree: asked ten times while one is running, the
 *  nine extra answers would all say the same thing as the last. On 29
 *  October 2026 a calculation writing scratch files inside a project
 *  folder had the browser ask for the tree after every watcher tick, up to
 *  ten requests at once, each taking up to 21 s while they competed for
 *  the server.
 *
 *  A call made while one runs is folded into a single trailing call that
 *  starts when the running one ends, so the last state asked for is always
 *  fetched. Every caller's promise settles when the call that covers its
 *  request has finished.
 */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const now = (async () => {
      try {
        await run();
      } finally {
        running = null;
      }
    })();
    running = now;
    return now;
  };

  return () => {
    if (!running) return start();
    if (!queued) {
      queued = running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return start();
        });
    }
    return queued;
  };
}
