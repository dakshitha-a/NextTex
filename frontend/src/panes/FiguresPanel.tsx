import { useEffect, useState } from "react";
import api, { type FigureEntry } from "../api";
import { useStore } from "../store";
import { Empty, Pressable } from "../ui/controls";

/** Under this a picture is drawn at screen resolution, as the submission
 *  check counts it. */
const LOW_PPI = 150;

/** Every figure and table the document in front reaches, in the order a
 *  reader meets them: "Figure 3" and its page from the last build, the
 *  caption's start under it, and at the end how often the text refers to
 *  it, in the warning ink when never. A press opens the source there. */
export default function FiguresPanel({ onOpen }: { onOpen: (file: string, line: number) => void }) {
  const projectId = useStore((s) => s.projectId);
  const document = useStore((s) => s.activePreview);
  const builtAt = useStore((s) => s.pdfStamp);
  const tree = useStore((s) => s.tree);
  const [entries, setEntries] = useState<FigureEntry[] | null>(null);

  // Asked when the drawer shows it, after each build, and when the files
  // change, which is when a figure can come or go.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.figures(projectId, document ?? "")
      .then((answer) => !cancelled && setEntries(answer.entries))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, document, builtAt, tree]);

  if (entries === null) return null;
  if (!entries.length) {
    return <Empty>No figures or tables in this document yet.</Empty>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-1" data-testid="figures-list">
      {entries.map((entry) => {
        const name = entry.kind === "table" ? "Table" : "Figure";
        const low = entry.ppi !== null && entry.ppi < LOW_PPI;
        return (
          <Pressable
            key={`${entry.file}:${entry.line}`}
            data-testid="figure-row"
            data-kind={entry.kind}
            data-referenced={entry.refs > 0 || undefined}
            className="nx-row nx-figure-row shrink-0"
            data-note
            title={`${entry.file}, line ${entry.line}`}
            onClick={() => onOpen(entry.file, entry.line)}
          >
            <span className="nx-row-label">
              <span className="text-ink">{entry.number ? `${name} ${entry.number}` : name}</span>
              {entry.page !== null ? <span className="nx-figure-page">p. {entry.page}</span> : null}
            </span>
            <span className={`nx-figure-refs${entry.refs ? "" : " nx-figure-unreferenced"}`}>
              {entry.refs === 0 ? "not referenced" : entry.refs === 1 ? "1 ref" : `${entry.refs} refs`}
            </span>
            <span className="nx-row-note t-meta nx-figure-caption">
              {low ? <span className="text-warn">{entry.ppi} ppi. </span> : null}
              {entry.caption || (entry.graphics[0] ?? "No caption")}
            </span>
          </Pressable>
        );
      })}
    </div>
  );
}
