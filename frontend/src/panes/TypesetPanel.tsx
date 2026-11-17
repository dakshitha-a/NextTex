import { useEffect, useMemo, useState } from "react";
import api, { type HeadingEntry } from "../api";
import { useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty, Pressable } from "../ui/controls";

/** Sixteen pixels a level, as the Sections list beside it. */
const INDENT = 16;

/** The last list each project's document gave, by project and document.
 *  The drawer mounts this panel afresh every time it opens, and the list
 *  sat empty until the server answered again; now the last one shows at
 *  once and the answer replaces it when it lands. */
const kept = new Map<string, HeadingEntry[]>();

/** The whole document in the preview, as its headings: every heading it
 *  reaches through every `\input` and `\include`, in the order a reader
 *  meets them, with its number and page from the last build.  A press
 *  shows the place on the page; Source, under the pointer, opens it in the
 *  editor.  Before a build a press opens the source, since there is no
 *  page to show. */
export default function TypesetPanel({
  onShow,
  onOpen,
}: {
  onShow: (file: string, line: number, kind: string) => void;
  onOpen: (file: string, line: number) => void;
}) {
  const projectId = useStore((s) => s.projectId);
  const document = useStore((s) => s.activePreview);
  const builtAt = useStore((s) => s.pdfStamp);
  const tree = useStore((s) => s.tree);
  const key = `${projectId}\n${document ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; entries: HeadingEntry[] } | null>(null);
  const entries = answer?.key === key ? answer.entries : kept.get(key) ?? null;

  // Asked when the drawer shows it, after each build, and when the files
  // change, which is when a chapter can come or go.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.headings(projectId, document ?? "")
      .then((reply) => {
        kept.set(key, reply.entries);
        if (!cancelled) setAnswer({ key, entries: reply.entries });
      })
      // A failed ask leaves the list it had rather than emptying it.
      .catch(() => !cancelled && !kept.has(key) && setAnswer({ key, entries: [] }));
    return () => {
      cancelled = true;
    };
  }, [projectId, document, key, builtAt, tree]);

  const base = useMemo(
    () => (entries?.length ? Math.min(...entries.map((entry) => entry.level)) : 0),
    [entries],
  );

  if (entries === null) return null;
  if (!entries.length) return <Empty>No headings in this document yet.</Empty>;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-1" data-testid="typeset-list">
      {entries.map((entry) => {
        // Shown on the page whenever there is a page, the forward search
        // finding it: a starred heading has no contents line to give its
        // page, and a press on one opened the source instead.
        const built = Boolean(builtAt);
        return (
          <div
            key={`${entry.file}:${entry.line}`}
            className="nx-row nx-typeset-row shrink-0"
            style={{ paddingLeft: 8 + (entry.level - base) * INDENT }}
          >
            <Pressable
              data-testid="typeset-row"
              data-file={entry.file}
              data-line={entry.line}
              className="nx-section-jump"
              title={`${entry.title}, ${entry.file} line ${entry.line}${entry.page !== null ? `, page ${entry.page}` : ""}`}
              onClick={() => (built ? onShow(entry.file, entry.line, entry.kind) : onOpen(entry.file, entry.line))}
            >
              {entry.number ? <span className="nx-typeset-number">{entry.number}</span> : null}
              <span className="nx-row-label">{entry.title}</span>
              {entry.page !== null ? <span className="nx-typeset-page">p. {entry.page}</span> : null}
            </Pressable>
            <span className="nx-row-trailing">
              <Button size="inline" data-testid="typeset-source" title={`Open ${entry.file} at line ${entry.line}`} onClick={() => onOpen(entry.file, entry.line)}>
                Source
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
