import { useEffect, useState } from "react";
import api from "../api";
import { get, refreshTrash, set, useStore } from "../store";
import { Chevron } from "../App";

/** What has been deleted, and how to get it back.
 *
 *  Nothing here is ever cleaned up on a timer: a trash that empties itself
 *  is a trash that loses the thing you went looking for. */
export default function TrashPanel({ onRefresh }: { onRefresh: () => void }) {
  const entries = useStore((s) => s.trash);
  const projectId = useStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (projectId) refreshTrash(projectId);
  }, [projectId]);

  if (!entries.length) return null;

  const act = async (what: "restore" | "purge" | "empty", id = "") => {
    if (!projectId) return;
    setBusy(id || what);
    try {
      if (what === "restore") {
        const result = await api.restoreTrash(projectId, id);
        if (result.renamed) {
          set({
            error:
              `Something was already at that path, so it came back as ` +
              `${result.renamed}.`,
          });
        }
      } else if (what === "purge") {
        await api.purgeTrash(projectId, id);
      } else {
        await api.emptyTrash(projectId);
      }
      await refreshTrash(projectId);
      onRefresh();
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      setBusy("");
      setConfirming(null);
    }
  };

  return (
    <div className="shrink-0 border-t border-line">
      <button
        className="flex h-[26px] w-full items-center justify-between px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="t-micro text-ink-2">Trash ({entries.length})</span>
        <span className={`text-ink-3 ${open ? "rotate-180" : ""}`}>
          <Chevron direction="down" />
        </span>
      </button>
      {open ? (
        <div className="max-h-[220px] overflow-auto px-[10px] pb-2">
          {entries.map((entry) => (
            <div key={entry.id} className="group py-1">
              <div className="flex items-baseline gap-2">
                <span className="t-code-sm min-w-0 flex-1 truncate text-ink">
                  {entry.name}
                </span>
                <span className="t-micro shrink-0 text-ink-3">{when(entry.at)}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="t-micro min-w-0 flex-1 truncate text-ink-3">
                  {entry.path}
                  {entry.kind === "dir" ? ` · ${entry.count} files` : ""}
                </span>
                {confirming === entry.id ? (
                  <>
                    <button
                      className="t-micro shrink-0 text-error"
                      onClick={() => act("purge", entry.id)}
                    >
                      Delete forever
                    </button>
                    <button
                      className="quiet t-micro shrink-0"
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="quiet t-micro shrink-0 opacity-0 focus:opacity-100 group-hover:opacity-100"
                      disabled={busy === entry.id}
                      onClick={() => act("restore", entry.id)}
                    >
                      {busy === entry.id ? "Restoring" : "Restore"}
                    </button>
                    <button
                      className="quiet t-micro shrink-0 opacity-0 hover:text-error focus:opacity-100 group-hover:opacity-100"
                      onClick={() => setConfirming(entry.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {confirming === "all" ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="t-micro flex-1 text-ink-2">
                Delete all {entries.length} for good, with their history?
              </span>
              <button className="t-micro text-error" onClick={() => act("empty")}>
                Empty
              </button>
              <button className="quiet t-micro" onClick={() => setConfirming(null)}>
                Keep
              </button>
            </div>
          ) : (
            <button
              className="quiet t-micro mt-2"
              onClick={() => setConfirming("all")}
            >
              Empty the trash
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
}
