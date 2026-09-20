import { useEffect, useState } from "react";
import api, { type Archive } from "../api";
import { chatFromTranscript, useStore, type ChatItem } from "../store";
import Prose from "./prose";
import { decisionWords } from "./Chat";
import { usageNote } from "../agent-name";
import { ColumnHeader } from "./column-header";

type Usage = Awaited<ReturnType<typeof api.usage>>;

/** A token count a person reads: 120k rather than 120000. */
function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

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
export default function PastConversation({
  onBack,
  onFold,
  usage,
  provider,
}: {
  onBack: () => void;
  onFold?: () => void;
  /** What the project has cost, for the sentence at the list's foot: the
   *  one place it is read, since a cleared conversation does not clear it. */
  usage: Usage | null;
  provider?: string;
}) {
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
      <ColumnHeader
        title={
          open
            ? archives?.find((entry) => entry.name === open.name)?.stamp ?? open.name
            : "Past conversations"
        }
        onBack={() => (open ? setOpen(null) : onBack())}
        backLabel={open ? "All past conversations" : "Back"}
        backTestid="past-back"
        onFold={onFold}
      >
        <span className="min-w-0 flex-1" />
      </ColumnHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-2">
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
                className="nx-past-row"
                data-testid="past-conversation"
                onClick={() => read(entry)}
              >
                <span>{entry.title || "A conversation with no question in it"}</span>
                <small>{whenFiled(entry.stamp)}</small>
              </button>
            ))}
          </div>
        ) : null}
        {/* What this project has cost, once, at the foot of the list: the
            sum over every conversation, which is why it is here and not in
            any one of them. */}
        {!open && usage ? (
          <p className="nx-past-usage" data-testid="usage-line">
            This project:{" "}
            <b>
              {usage.usage.costUsd
                ? `$${usage.usage.costUsd.toFixed(usage.usage.costUsd < 1 ? 3 : 2)}`
                : "$0.000"}
            </b>{" "}
            estimated, <b>{usage.usage.turns}</b> {usage.usage.turns === 1 ? "turn" : "turns"},{" "}
            <b>{duration(usage.usage.durationMs)}</b> of model time,{" "}
            <b>{compact(usage.usage.inputTokens)}</b> tokens in
            {usage.usage.cacheReadTokens ? (
              <>
                {" "}(<b>{compact(usage.usage.cacheReadTokens)}</b> from cache)
              </>
            ) : null}
            , <b>{compact(usage.usage.outputTokens)}</b> out.
            {usageNote(provider as any) ? ` ${usageNote(provider as any)}` : ""}
          </p>
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

/** Model time a person reads: "2m 10s", or "45s". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** When a conversation was filed, as the page has it: "Today, 14:20",
 *  "Yesterday, 17:48", "Tuesday 16 September" within the week, and the
 *  date past that. The server's stamp is local time, "2026-09-20 14:20:00";
 *  a stamp that does not parse is shown as it came. */
export function whenFiled(stamp: string, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const [, y, mo, d, h, mi] = match;
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const time = `${h}:${mi}`;
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  // Day before month, as the page writes it, whatever the locale.
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[at.getDay()]} ${date}`;
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
