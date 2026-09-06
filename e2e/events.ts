import type { Instance } from "./server";

/** What the server told the browsers, as it told them.
 *
 *  Some things a spec needs to assert are not visible in the page at all.
 *  A build that starts and finishes in 130ms leaves the status dot showing
 *  "compiling" for less time than a poll can reliably catch, so a spec that
 *  watched the dot would pass whether or not the build happened -- which is
 *  what the first version of the debounce spec did.  This subscribes to the
 *  same event stream the app does and keeps the list.
 */
export type Watch = {
  types: string[];
  count(type: string): number;
  stop(): void;
};

export async function watchEvents(
  app: Instance,
  projectId: string,
): Promise<Watch> {
  const control = new AbortController();
  const types: string[] = [];
  const response = await fetch(
    `${app.base}/api/projects/${projectId}/events`,
    { headers: { "x-nexttex-token": app.token }, signal: control.signal },
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              types.push(JSON.parse(line.slice(5).trim()).type);
            } catch {
              /* a keep-alive, or a frame split across reads */
            }
          }
        }
      }
    } catch {
      /* the abort below */
    }
  })();

  return {
    types,
    count: (type: string) => types.filter((seen) => seen === type).length,
    stop: () => control.abort(),
  };
}
