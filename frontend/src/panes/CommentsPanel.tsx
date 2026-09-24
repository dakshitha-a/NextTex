import { useEffect, useState } from "react";
import api, { type CommentThread } from "../api";
import { refreshComments, set, useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty } from "../ui/controls";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons";
import { colourFor } from "../collab";
import { repliesSaid, whenSaid } from "./CommentCards";

/** The Comments drawer: every thread in the project.
 *
 *  Open threads first, grouped by file in document order, each with the
 *  text it is on, its first message and how many replies, in words. A
 *  thread whose text was deleted stays, struck through, saying where it
 *  last was. Resolved threads are the archive below, folded by default,
 *  where one can be reopened. Any thread, open or resolved, can be
 *  deleted, and the row asks once, because a thread holds other people's
 *  words. A click opens the file at the thread and opens its card. Drawn
 *  on the direction page's Comments section. */
export default function CommentsPanel({
  onOpen,
}: {
  /** Open a file at a line, the way a search hit does. */
  onOpen: (path: string, line: number) => void;
}) {
  const threads = useStore((s) => s.comments);
  const projectId = useStore((s) => s.projectId);
  const [showResolved, setShowResolved] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) void refreshComments(projectId);
  }, [projectId]);

  const open = threads.filter((thread) => !thread.resolved?.at);
  const resolved = threads.filter((thread) => thread.resolved?.at);

  const act = async (what: "resolve" | "reopen" | "delete", thread: CommentThread) => {
    if (!projectId) return;
    try {
      if (what === "delete") await api.deleteComment(projectId, thread.id);
      else await api.resolveComment(projectId, thread.id, what === "resolve");
      await refreshComments(projectId);
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      setAsking(null);
    }
  };

  const row = (thread: CommentThread) => {
    const first = thread.messages[0];
    const done = Boolean(thread.resolved?.at);
    return (
      <div
        key={thread.id}
        role="button"
        tabIndex={0}
        className="nx-comment-row"
        data-testid="comment-row"
        data-thread={thread.id}
        data-detached={thread.detached || undefined}
        onClick={() => {
          onOpen(thread.path, thread.line);
          if (!thread.detached && !done) set({ openThread: thread.id });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.currentTarget as HTMLElement).click();
        }}
      >
        <div className="nx-comment-row-quote t-meta">{thread.quote}</div>
        {first ? <div className="nx-comment-row-body">{first.body}</div> : null}
        <div className="nx-comment-row-meta t-meta">
          {first ? (
            <span style={first.mine ? undefined : { color: colourFor(first.name) }}>
              {first.mine ? "You" : first.name}
            </span>
          ) : null}
          {done ? (
            <span>
              Resolved by {thread.resolved.mine ? "you" : thread.resolved.name || "a collaborator"}, {whenSaid(thread.resolved.at ?? 0)}
            </span>
          ) : thread.detached ? (
            <span className="text-ink-2">Its text was deleted, last at line {thread.line}</span>
          ) : (
            <>
              {repliesSaid(thread) ? <span>{repliesSaid(thread)}</span> : null}
              <span className="tabular-nums">{whenSaid(thread.created)}</span>
            </>
          )}
          <span className="flex-1" />
          <span
            className="nx-row-actions flex items-center gap-[2px]"
            data-always={asking === thread.id || undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {asking === thread.id ? (
              <>
                <span className="pr-1 text-ink-2">For everyone?</span>
                <Button size="inline" variant="danger" onClick={() => void act("delete", thread)}
                  data-testid="comment-row-delete-confirm">
                  Delete
                </Button>
                <Button size="inline" onClick={() => setAsking(null)}>Keep</Button>
              </>
            ) : (
              <>
                <Button size="inline" variant="ghost" onClick={() => void act(done ? "reopen" : "resolve", thread)}
                  data-testid={done ? "comment-row-reopen" : "comment-row-resolve"}>
                  {done ? "Reopen" : "Resolve"}
                </Button>
                <Button size="inline" variant="danger" onClick={() => setAsking(thread.id)}
                  data-testid="comment-row-delete">
                  Delete
                </Button>
              </>
            )}
          </span>
        </div>
      </div>
    );
  };

  const byFile = new Map<string, CommentThread[]>();
  for (const thread of open) byFile.set(thread.path, [...(byFile.get(thread.path) ?? []), thread]);

  if (!threads.length) {
    return (
      <Empty data-testid="comments-empty">
        Select text and choose Comment to leave a note on it. Everyone in the
        project sees it and can reply.
      </Empty>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="comments-panel">
      {[...byFile].map(([path, list]) => (
        <section key={path}>
          <div className="nx-comment-file t-code-sm">{path}</div>
          {list.map(row)}
        </section>
      ))}
      {resolved.length ? (
        <section>
          <button
            type="button"
            className="nx-comment-fold"
            aria-expanded={showResolved}
            data-testid="comments-resolved"
            onClick={() => setShowResolved((shown) => !shown)}
          >
            {showResolved ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            <span>Resolved</span>
            <span className="flex-1" />
            <span className="t-meta tabular-nums text-ink-3">{resolved.length}</span>
          </button>
          {showResolved ? resolved.map(row) : null}
        </section>
      ) : null}
    </div>
  );
}
