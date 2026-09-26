/** The three cards a comment thread floats in over the editor: the
 *  composer a new comment is written in, the preview a resting pointer
 *  brings up, and the thread a click opens.
 *
 *  All three are the kit's `FloatingCard`, placed by the editor with
 *  `placeClear` above or below the commented lines, never over them. The
 *  preview has no controls, so reading a comment never commits the writer
 *  to anything; the thread's one primary action is Resolve, and Delete is
 *  last in its menu and asks once, because it removes other people's
 *  replies too. Drawn on the direction page's Comments section. */

import { useEffect, useRef, useState } from "react";
import type { CommentThread } from "../api";
import { colourFor } from "../collab";
import { Button, IconButton } from "../ui/Button";
import { TextArea } from "../ui/controls";
import { FloatingCard } from "../ui/FloatingCard";
import { MoreIcon } from "../ui/icons";
import { Menu, MenuItem } from "../ui/Menu";

export type At = { left: number; top: number };

/** When, the way the history and the trash say it: the clock today, the
 *  weekday this week, the date before that. */
export function whenSaid(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (now - at < 6 * 24 * 3600 * 1000) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "2 replies", in words, never a badge. */
export function repliesSaid(thread: CommentThread): string {
  const replies = thread.messages.length - 1;
  return replies <= 0 ? "" : replies === 1 ? "1 reply" : `${replies} replies`;
}

function Who({ name, mine, agent }: { name: string; mine?: boolean; agent?: boolean }) {
  // The agent's reply is under its own name in the pen's ink, the colour
  // the chat already gives it, rather than a collaborator's colour.
  if (agent) {
    return <b className="font-semibold text-pen" data-agent="true">{name}</b>;
  }
  return (
    <b
      className="font-semibold"
      style={mine ? undefined : { color: colourFor(name) }}
    >
      {mine ? "You" : name}
    </b>
  );
}

function measure(onMeasure?: (size: { width: number; height: number }) => void) {
  return (element: HTMLDivElement | null) => {
    if (element && onMeasure) onMeasure({ width: element.offsetWidth, height: element.offsetHeight });
  };
}

export function CommentComposer({
  at, quote, onPost, onCancel, onMeasure,
}: {
  at: At;
  quote: string;
  onPost: (body: string, suggestion?: string) => Promise<void>;
  onCancel: () => void;
  onMeasure?: (size: { width: number; height: number }) => void;
}) {
  const [body, setBody] = useState("");
  /** The words proposed in place of the quote, while "Suggest a change"
   *  is on; null while it is off (Q-046). */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => field.current?.focus(), []);
  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setFailed("");
    try {
      await onPost(body, suggestion !== null && suggestion !== quote ? suggestion : "");
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The comment could not be posted.");
      setBusy(false);
    }
  };
  return (
    <FloatingCard
      ref={measure(onMeasure)}
      testid="comment-composer"
      className="nx-comment-card absolute z-20"
      style={{ left: at.left, top: at.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="nx-comment-quote t-meta">{quote}</div>
      <TextArea
        ref={field}
        className="nx-comment-field t-ui"
        aria-label="Comment"
        placeholder="Comment"
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void post();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {/* The middle way between editing a co-author's sentence and only
          remarking on it: the words proposed, which the other person takes
          with one press or not (Q-046). */}
      <div>
        <Button
          size="inline"
          aria-pressed={suggestion !== null}
          data-testid="comment-suggest"
          className={suggestion !== null ? "bg-wash text-ink" : undefined}
          onClick={() => setSuggestion((now) => (now === null ? quote : null))}
        >
          Suggest a change
        </Button>
      </div>
      {suggestion !== null ? (
        <TextArea
          className="nx-comment-field t-code-sm"
          aria-label="Suggested text"
          data-testid="comment-suggestion"
          rows={2}
          value={suggestion}
          onChange={(event) => setSuggestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void post();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      ) : null}
      {failed ? <div className="t-meta text-error">{failed}</div> : null}
      <div className="nx-comment-foot">
        <span className="t-meta text-ink-3">Ctrl Enter posts</span>
        <span className="flex-1" />
        <Button size="inline" onClick={onCancel}>Cancel</Button>
        <Button size="inline" variant="ghost" disabled={!body.trim() || busy} onClick={() => void post()}
          data-testid="comment-post">
          {busy ? "Posting" : "Post"}
        </Button>
      </div>
    </FloatingCard>
  );
}

export function CommentPreview({
  at, threads, onMeasure,
}: {
  at: At;
  threads: CommentThread[];
  onMeasure?: (size: { width: number; height: number }) => void;
}) {
  return (
    <FloatingCard
      ref={measure(onMeasure)}
      testid="comment-preview"
      className="nx-comment-card pointer-events-none absolute z-20"
      style={{ left: at.left, top: at.top }}
      role="tooltip"
    >
      {threads.map((thread) => {
        const first = thread.messages[0];
        return (
          <div key={thread.id} className="nx-comment-stack">
            {first ? (
              <>
                <div className="nx-comment-who t-meta">
                  <Who name={first.name} mine={first.mine} agent={first.agent} />
                  <span className="flex-1" />
                  <span className="tabular-nums text-ink-3">{whenSaid(first.at)}</span>
                </div>
                <div className="nx-comment-body">{first.body}</div>
              </>
            ) : null}
            {repliesSaid(thread) ? <div className="t-meta text-ink-3">{repliesSaid(thread)}</div> : null}
          </div>
        );
      })}
    </FloatingCard>
  );
}

/** The control a thread was opened from, when opening it moved focus on
 *  the way: the drawer's row jumps the editor to the line before the card
 *  mounts, so the card's own "where focus was" is the editor, and Escape
 *  left a keyboard user in the manuscript rather than on the row. */
let opener: HTMLElement | null = null;
export function openedFrom(element: HTMLElement | null) {
  opener = element;
}

export function CommentThreadCard({
  at, thread, onReply, onResolve, onAccept, onDelete, onClose, onMeasure,
}: {
  at: At;
  thread: CommentThread;
  onReply: (body: string) => Promise<void>;
  onResolve: () => void;
  /** Take the thread's suggestion; Resolve's place on a thread that has
   *  one, since accepting it resolves it (Q-046). */
  onAccept?: () => void;
  onDelete: () => void;
  onClose: () => void;
  onMeasure?: (size: { width: number; height: number }) => void;
}) {
  const [reply, setReply] = useState("");
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const more = useRef<HTMLButtonElement | null>(null);
  // Focus moves into the card when it opens and goes back where it was
  // when it closes (Q-051). It used to stay where it was, so a keyboard
  // user was not told a card had appeared or how to reach Reply. The card
  // itself takes it rather than the reply field, since a thread opened
  // from a click in the text is read far more often than answered, and a
  // keystroke meant for the manuscript must not land in a reply.
  const card = useRef<HTMLDivElement | null>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const measured = measure(onMeasure);
  useEffect(() => {
    const before = (opener?.isConnected ? opener : document.activeElement) as HTMLElement | null;
    opener = null;
    cameFrom.current = before;
    const node = card.current;
    node?.focus({ preventScroll: true });
    return () => {
      // By the time this runs the card may be gone and focus with it, to
      // the body; either way it goes back to where the writer was.
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || node?.contains(now))) {
        before.focus({ preventScroll: true });
      }
    };
  }, [thread.id]);
  const send = async () => {
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await onReply(reply);
      setReply("");
    } finally {
      setBusy(false);
    }
  };
  const count = thread.messages.length;
  return (
    <FloatingCard
      ref={(element) => {
        card.current = element;
        measured(element);
      }}
      testid="comment-thread"
      data-thread={thread.id}
      role="dialog"
      aria-label={`Comment thread on ${thread.quote}`}
      tabIndex={-1}
      className="nx-comment-card nx-comment-thread absolute z-20"
      style={{ left: at.left, top: at.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !menu) {
          event.preventDefault();
          onClose();
          // After the close, which puts the caret back in the editor for
          // a thread opened there; one opened from the drawer goes back to
          // its row.
          const back = cameFrom.current;
          if (back?.isConnected) back.focus({ preventScroll: true });
        }
      }}
    >
      <div className="nx-comment-messages">
        {thread.messages.map((message) => (
          <div key={message.id} className="nx-comment-message" data-testid="comment-message">
            <div className="nx-comment-who t-meta">
              <Who name={message.name} mine={message.mine} agent={message.agent} />
              <span className="flex-1" />
              <span className="tabular-nums text-ink-3">{whenSaid(message.at)}</span>
            </div>
            <div className="nx-comment-body">{message.body}</div>
          </div>
        ))}
      </div>
      {thread.suggestion ? (
        <div className="nx-comment-suggestion" data-testid="comment-suggestion-shown">
          <del>{thread.quote}</del> <ins>{thread.suggestion}</ins>
        </div>
      ) : null}
      {asking ? (
        <div className="nx-comment-ask" data-testid="comment-delete-ask">
          <div className="text-ink">Delete this thread?</div>
          <div className="t-meta text-ink-2">
            {count === 1 ? "Its message goes" : `Its ${count} messages go`} for everyone in the project.
          </div>
          <div className="nx-comment-foot">
            <Button size="inline" variant="danger" onClick={onDelete} data-testid="comment-delete-confirm">
              Delete
            </Button>
            <Button size="inline" onClick={() => setAsking(false)}>Keep</Button>
          </div>
        </div>
      ) : (
        <>
          <TextArea
            className="nx-comment-field t-ui"
            aria-label="Reply"
            placeholder="Reply"
            rows={1}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="nx-comment-foot">
            {reply.trim() ? (
              <Button size="inline" variant="ghost" disabled={busy} onClick={() => void send()}
                data-testid="comment-reply">
                Reply
              </Button>
            ) : (
              thread.suggestion && onAccept ? (
                <Button size="inline" variant="ghost" onClick={onAccept} data-testid="comment-accept">
                  Accept
                </Button>
              ) : (
                <Button size="inline" variant="ghost" onClick={onResolve} data-testid="comment-resolve">
                  Resolve
                </Button>
              )
            )}
            <span className="flex-1" />
            <IconButton
              ref={more}
              label="More"
              data-testid="comment-more"
              className="!h-6 !w-6"
              onClick={() => {
                const box = more.current?.getBoundingClientRect();
                setMenu(box ? { left: box.left, top: box.bottom + 4 } : null);
              }}
            >
              <MoreIcon size={14} />
            </IconButton>
          </div>
        </>
      )}
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        wanted={menu}
        anchor={more}
        testid="comment-menu"
        width={200}
      >
        <MenuItem
          danger
          onClick={() => {
            setMenu(null);
            setAsking(true);
          }}
        >
          Delete this thread
        </MenuItem>
      </Menu>
    </FloatingCard>
  );
}
