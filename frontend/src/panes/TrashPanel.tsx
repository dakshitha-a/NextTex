import { useEffect, useState } from "react";
import api from "../api";
import { refreshTrash, set, useStore } from "../store";
import { Chevron } from "../chrome";

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
        <span className="t-micro text-ink-2">
          {entries.length} deleted
        </span>
        <span className={`text-ink-3 ${open ? "rotate-180" : ""}`}>
          <Chevron direction="down" />
        </span>
      </button>
      {open ? (
        <div className="max-h-[220px] overflow-auto pb-2">
          {entries.map((entry) => {
            const [stem, extension] = splitName(entry.name);
            return (
              <div
                key={entry.id}
                data-testid="trash-entry"
                data-path={entry.path}
                className="group flex h-[26px] items-center gap-2 rounded-[3px] pl-[10px] pr-1 hover:bg-surface-2"
                title={entry.path}
              >
                <span className="t-ui min-w-0 flex-1 truncate">
                  <span className="text-ink">{stem}</span>
                  <span className="text-ink-3">{extension}</span>
                </span>
                {confirming === entry.id ? (
                  <>
                    <span className="t-micro shrink-0 text-ink-2">For good?</span>
                    <button
                      className="quiet t-micro shrink-0"
                      data-tone="danger"
                      onClick={() => act("purge", entry.id)}
                    >
                      Delete
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
                    <span className="t-micro shrink-0 text-ink-3 group-hover:hidden">
                      {when(entry.at)}
                    </span>
                    <button
                      className="quiet t-micro hidden shrink-0 group-hover:block"
                      disabled={busy === entry.id}
                      onClick={() => act("restore", entry.id)}
                    >
                      {busy === entry.id ? "Restoring" : "Restore"}
                    </button>
                    <button
                      className="quiet t-micro hidden shrink-0 group-hover:block"
                      data-tone="danger"
                      onClick={() => setConfirming(entry.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {confirming === "all" ? (
            <div className="mt-2 flex items-center gap-2 px-[10px]">
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
              className="quiet t-micro mt-2 px-[10px]"
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

/** The same clock the history panel uses: two panels answering "when did
 *  this happen to this file" should not answer it two different ways. */
function when(at: number): string {
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}
