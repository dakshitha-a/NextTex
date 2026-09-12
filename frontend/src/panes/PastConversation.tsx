import { useEffect, useState } from "react";
import api, { type Archive } from "../api";
import { chatFromTranscript, useStore, type ChatItem } from "../store";
import Prose from "./prose";
import { decisionWords } from "./Chat";

/** The conversations "New conversation" filed away, and one of them open.
 *
 *  Read-only, and drawn with its own renderers rather than the live
 *  panel's. That is not a shortcut: an edit chip in the live panel has an
 *  Undo that writes to a file, and a permission card has Allow and Deny
 *  that answer an id the agent is waiting on. A conversation from last
 *  week has neither an agent waiting nor a file in the state it was, so
 *  every control on it would be a promise the app cannot keep. What is
 *  shown is what was said and what was done, as a record.
 *
 *  It never touches the store's `chat`: the live conversation stays where
 *  it was, and Back returns to it untouched.
 */
export default function PastConversation({ onBack }: { onBack: () => void }) {
  const projectId = useStore((s) => s.projectId);
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState<{ name: string; items: ChatItem[] } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .archives(projectId)
      .then((answer) => !cancelled && setArchives(answer.archives))
      .catch((error: any) => !cancelled && setFailed(error.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const read = async (entry: Archive) => {
    if (!projectId) return;
    try {
      const answer = await api.archive(projectId, entry.name);
      setOpen({ name: entry.name, items: chatFromTranscript(answer.items) });
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="past-conversations">
      <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-line px-3">
        <button
          className="quiet t-micro"
          data-testid="past-back"
          onClick={() => (open ? setOpen(null) : onBack())}
        >
          ‹ {open ? "All past conversations" : "Back"}
        </button>
        <span className="t-micro min-w-0 flex-1 truncate text-ink-2">
          {open
            ? archives?.find((entry) => entry.name === open.name)?.stamp ?? open.name
            : "Past conversations"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {failed ? <p className="t-meta text-error">{failed}</p> : null}
        {!open && archives === null && !failed ? (
          <p className="t-meta text-ink-3">Reading</p>
        ) : null}
        {!open && archives && archives.length === 0 ? (
          <p className="t-meta text-ink-3">
            Nothing filed away yet. Starting a new conversation keeps the old
            one here.
          </p>
        ) : null}
        {!open && archives && archives.length ? (
          <div className="flex flex-col">
            {archives.map((entry) => (
              <button
                key={entry.name}
                className="flex flex-col items-start gap-[2px] rounded-[3px] px-2 py-[6px] text-left hover:bg-surface-2"
                data-testid="past-conversation"
                onClick={() => read(entry)}
              >
                <span className="t-ui text-ink">
                  {entry.title || "A conversation with no question in it"}
                </span>
                <span className="t-micro tnum text-ink-3">{entry.stamp}</span>
              </button>
            ))}
          </div>
        ) : null}
        {open ? (
          <div className="flex flex-col gap-3" data-testid="past-items">
            {open.items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One row of a past conversation, as a record rather than a control. */
function Row({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="t-prose whitespace-pre-wrap rounded-[3px] bg-surface-2 px-3 py-2 text-ink">
        {item.text}
      </div>
    );
  }
  if (item.kind === "claude") return <Prose text={item.text} />;
  if (item.kind === "tool") {
    return (
      <p className="t-micro text-ink-3">
        {item.summary || item.name}
        {typeof item.ms === "number" ? ` (${Math.round(item.ms / 100) / 10}s)` : ""}
      </p>
    );
  }
  if (item.kind === "edit") {
    return (
      <p className="t-micro text-ink-2">
        {item.state === "reverted" ? "Edited and then undone" : "Edited"}{" "}
        <span className="t-code-sm">{item.path}</span>{" "}
        <span className="text-ok">+{item.added}</span>{" "}
        <span className="text-error">−{item.removed}</span>
      </p>
    );
  }
  if (item.kind === "permission") {
    // The live panel's own words for a decision, so a tool that ran
    // without asking reads "Allowed automatically" here as it does there,
    // rather than falling into a refused-by-default branch.
    return (
      <p className="t-micro text-ink-2">
        {item.headline || item.tool}: {decisionWords(item.decision)}
      </p>
    );
  }
  if (item.kind === "notice") {
    return (
      <p className={`t-micro ${item.tone === "error" ? "text-error" : "text-ink-3"}`}>
        {item.text}
      </p>
    );
  }
  return null;
}
