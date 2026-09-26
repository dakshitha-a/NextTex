import { useEffect, useState } from "react";
import api from "../api";
import { refreshTrash, set, useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty, Row } from "../ui/controls";
import { FileIcon, ImageIcon } from "../ui/icons";
import { kindOf } from "./file-kinds";

/** What has been deleted, and how to get it back.
 *
 *  Nothing here is ever cleaned up on a timer: a trash that empties itself
 *  is a trash that loses the thing you went looking for.  It is the
 *  activity bar's Deleted drawer, and it never hides itself: empty, it is
 *  one sentence, as the direction page draws it. */
export default function TrashPanel({ onRefresh }: { onRefresh: () => void }) {
  const entries = useStore((s) => s.trash);
  const failed = useStore((s) => s.trashFailed);
  const projectId = useStore((s) => s.projectId);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  // The store's list starts empty and is filled by the first answer;
  // until it has come, an empty list means nothing is known yet, not that
  // nothing is deleted, so no empty state is drawn before it.
  const [known, setKnown] = useState(false);

  useEffect(() => {
    if (projectId) void refreshTrash(projectId).then(() => setKnown(true));
  }, [projectId]);

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
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-1" data-testid="trash-panel">
      {!entries.length && !known ? null : !entries.length && failed ? (
        <Empty data-testid="trash-unavailable">Could not read the trash.</Empty>
      ) : !entries.length ? (
        <Empty>
          Nothing deleted. A file you move to the trash waits here, with its
          history, until you empty it.
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {entries.map((entry) => {
            const [stem, extension] = splitName(entry.name);
            const image = kindOf(entry.name) === "image";
            return (
              // The kit's row: the file's mark, the name with its extension
              // in the third ink, and at the right the time at rest,
              // giving way to Restore and Delete under the pointer; the
              // "for good" question takes the row's tail when asked.
              <Row
                key={entry.id}
                data-testid="trash-entry"
                data-path={entry.path}
                title={entry.path}
                leading={image ? <ImageIcon /> : <FileIcon />}
                note={entry.source ? whyItWent(entry.why) : undefined}
                trailingAlways
                trailing={
                  <span className="nx-row-tail">
                    <span className="nx-row-when tabular-nums">{when(entry.at)}</span>
                    <span className="nx-row-actions flex items-center gap-0.5" data-always={confirming === entry.id || undefined}>
                      {confirming === entry.id ? (
                        <>
                          <span className="pr-1 text-ink-2">For good?</span>
                          <Button size="inline" variant="danger" onClick={() => act("purge", entry.id)}>
                            Delete
                          </Button>
                          <Button size="inline" onClick={() => setConfirming(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="inline"
                            disabled={busy === entry.id}
                            onClick={() => act("restore", entry.id)}
                          >
                            {busy === entry.id ? "Restoring" : "Restore"}
                          </Button>
                          <Button size="inline" variant="danger" onClick={() => setConfirming(entry.id)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </span>
                  </span>
                }
              >
                <span className="text-ink">{stem}</span>
                <span className="text-ink-3">{extension}</span>
              </Row>
            );
          })}
        </div>
      )}
      {entries.length ? (
        <div className="nx-panel-foot">
          {confirming === "all" ? (
            <>
              <span className="t-meta flex-1 text-ink-2">
                Delete all {entries.length} for good, with their history?
              </span>
              <Button size="inline" variant="danger" onClick={() => act("empty")}>
                Empty
              </Button>
              <Button size="inline" onClick={() => setConfirming(null)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="inline" onClick={() => setConfirming("all")}>
              Empty the trash
            </Button>
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

/** What put a file here, when it was not the writer: the entry's own
 *  sentence with a capital. The sync that carries a collaborator's
 *  deletion does not say which collaborator, so the sentence does not
 *  name one. */
export function whyItWent(why: string | undefined): string {
  const said = (why ?? "").trim() || "Not deleted by you";
  return said.charAt(0).toUpperCase() + said.slice(1);
}
