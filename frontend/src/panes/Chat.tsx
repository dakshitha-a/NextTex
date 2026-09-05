import { useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import Prose from "./prose";
import { WELCOME } from "../welcome";
import api from "../api";
import {
  get,
  markLive,
  markReverted,
  pushChat,
  resolvePermission,
  set,
  useStore,
  nextId,
  type ChatItem,
} from "../store";

export type ChatHandle = { seed(text: string): void };

export default function Chat({
  onShowEdit,
  onHoverEdit,
  onFold,
  handleRef,
}: {
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
  onFold?: () => void;
  handleRef: (handle: ChatHandle) => void;
}) {
  const chat = useStore((s) => s.chat);
  const thinking = useStore((s) => s.thinking);
  const blocked = useStore((s) => s.awaitingPermission);
  const claude = useStore((s) => s.claude);
  const [draft, setDraft] = useState("");
  const stream = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const pinned = useRef(true);
  const projectId = useStore((s) => s.projectId);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [showUsage, setShowUsage] = useState(false);

  // The tally follows the end of a turn, which is when it changes.
  useEffect(() => {
    if (!projectId || thinking) return;
    api.usage(projectId).then(setUsage).catch(() => undefined);
  }, [projectId, thinking]);

  useEffect(() => {
    handleRef({
      seed: (text: string) => {
        setDraft(text);
        composer.current?.focus();
      },
    });
  }, [handleRef]);

  // Follow the stream only while the reader is already at the bottom.
  useEffect(() => {
    const element = stream.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [chat]);

  const send = async () => {
    const text = draft.trim();
    const projectId = get().projectId;
    if (!text || !projectId || blocked) return;
    setDraft("");
    pushChat({ kind: "user", id: nextId(), text, at: Date.now() });
    pinned.current = true;
    try {
      await api.ask(projectId, text);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-line px-[10px]">
        <span className="t-ui-lg">Claude</span>
        <span className="flex-1" />
        {thinking ? (
          <button
            className="nx-hover t-micro text-hint hover:text-ink"
            onClick={() => {
              const projectId = get().projectId;
              if (projectId) api.interrupt(projectId).catch(() => undefined);
            }}
          >
            Stop
          </button>
        ) : null}
        <select
          className="nx-hover t-micro cursor-pointer rounded-[3px] border border-line bg-surface-2 px-1 py-[1px] text-ink-2 hover:text-ink"
          value={usage?.model ?? ""}
          title="Which model answers here"
          onChange={async (event) => {
            const chosen = event.target.value;
            if (!projectId) return;
            try {
              await api.setModel(projectId, chosen);
              setUsage(await api.usage(projectId));
            } catch (error: any) {
              set({ error: error.message });
            }
          }}
        >
          {(usage?.models ?? [{ id: "", name: "Default", note: "" }]).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          className="nx-hover t-micro tabular-nums text-ink-3 hover:text-ink"
          title="What this project has used"
          onClick={() => setShowUsage(!showUsage)}
        >
          {usage && usage.usage.turns > 0
            ? `${usage.usage.turns} ${usage.usage.turns === 1 ? "turn" : "turns"}`
            : "Usage"}
        </button>
        {onFold ? (
          <button
            className="nx-hover t-micro text-ink-3 hover:text-ink"
            title="Fold this panel away"
            aria-label="Fold this panel away"
            onClick={onFold}
          >
            ›
          </button>
        ) : null}
      </div>

      {showUsage && usage ? (
        <div className="nx-arrive shrink-0 border-b border-line bg-surface-2 px-[10px] py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <Stat label="Turns" value={usage.usage.turns.toLocaleString()} />
            <Stat
              label="Cost"
              value={
                usage.usage.costUsd
                  ? `$${usage.usage.costUsd.toFixed(usage.usage.costUsd < 1 ? 3 : 2)}`
                  : "—"
              }
            />
            <Stat label="Sent" value={compact(usage.usage.inputTokens)} />
            <Stat label="Written" value={compact(usage.usage.outputTokens)} />
            <Stat label="From cache" value={compact(usage.usage.cacheReadTokens)} />
            <Stat
              label="Model time"
              value={
                usage.usage.durationMs
                  ? `${Math.round(usage.usage.durationMs / 1000)}s`
                  : "—"
              }
            />
          </div>
          <p className="t-micro mt-2 text-ink-3">
            Counted in this project since it was first opened. Cost is what the
            API would charge; on a Claude subscription it is an estimate, not a
            bill.
          </p>
        </div>
      ) : null}

      <div
        ref={stream}
        className="min-h-0 flex-1 overflow-auto px-[10px] py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? (
          <div className="nx-arrive flex">
            <span className="w-[3px] shrink-0 bg-pen" />
            <div className="ml-3 min-w-0 flex-1">
              <div className="t-micro mb-1 text-pen">Claude</div>
              <div className="t-prose text-ink">
                <Prose text={WELCOME} />
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-5">
          {chat.map((item) => (
            <Item
              key={item.id}
              item={item}
              onShowEdit={onShowEdit}
              onHoverEdit={onHoverEdit}
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-[8px]">
        <textarea
          ref={composer}
          rows={3}
          value={draft}
          disabled={blocked}
          placeholder={blocked ? "Waiting on your approval" : "Ask Claude"}
          className="t-ui w-full resize-none rounded-[3px] border border-line bg-surface-2 px-2 py-[6px] outline-none placeholder:text-ink-3 disabled:text-ink-3"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-[6px] flex items-center justify-between">
          <span className="t-micro text-ink-3">
            {thinking ? "Working" : "Enter to send, Shift-Enter for a new line"}
          </span>
          <button
            className={
              draft.trim() && !blocked
                ? "pen-button h-[28px] px-3 t-ui"
                : "h-[28px] rounded-[3px] border border-line px-3 t-ui text-ink-3"
            }
            disabled={blocked || !draft.trim()}
            onClick={send}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="t-micro text-ink-3">{label}</span>
      <span className="t-micro tabular-nums text-ink">{value}</span>
    </div>
  );
}

function compact(value: number): string {
  if (!value) return "—";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function Item({
  item,
  onShowEdit,
  onHoverEdit,
}: {
  item: ChatItem;
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
}) {
  if (item.kind === "user") {
    return (
      <div className="flex">
        <span className="w-[3px] shrink-0 bg-line" />
        <div className="ml-3 min-w-0 flex-1">
          <div className="t-ui whitespace-pre-wrap rounded-[3px] bg-surface-2 p-2 text-ink-2">
            {item.text}
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "claude") {
    return <ClaudeMessage item={item} />;
  }

  if (item.kind === "tool") {
    return (
      <div className="flex items-baseline gap-2 stream-indent">
        <span className="t-micro text-ink-3">{item.name}</span>
        <span className="t-code-sm truncate text-ink-3">{item.summary}</span>
      </div>
    );
  }

  if (item.kind === "notice") {
    return (
      <div className={`t-meta stream-indent ${item.tone === "error" ? "text-error" : "text-ink-3"}`}>
        {item.text}
      </div>
    );
  }

  if (item.kind === "edit") {
    return <EditChip item={item} onShowEdit={onShowEdit} onHoverEdit={onHoverEdit} />;
  }

  return <Permission item={item} />;
}

function ClaudeMessage({ item }: { item: Extract<ChatItem, { kind: "claude" }> }) {
  // The caret is solid while tokens are arriving and blinks once they stop,
  // so a paused generation looks different from a finished one.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!item.streaming) return;
    setPaused(false);
    const timer = window.setTimeout(() => setPaused(true), 900);
    return () => window.clearTimeout(timer);
  }, [item.text, item.streaming]);

  const [hover, setHover] = useState(false);

  return (
    <div
      className="flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="w-[3px] shrink-0 bg-pen" />
      <div className="ml-3 min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="t-micro text-pen">Claude</span>
          {hover ? (
            <span className="t-micro tnum text-ink-3">
              {new Date(item.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </div>
        <div className="t-prose text-ink">
          <Prose text={item.text} />
          {item.streaming ? (
            <span
              className={`ml-[1px] inline-block h-[1.1em] w-[2px] translate-y-[2px] bg-pen ${
                paused ? "caret-paused" : ""
              }`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EditChip({
  item,
  onShowEdit,
  onHoverEdit,
}: {
  item: Extract<ChatItem, { kind: "edit" }>;
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [undoable, setUndoable] = useState(true);
  const name = item.path.split("/").pop() ?? item.path;

  const patch = useMemo(
    () =>
      open
        ? createTwoFilesPatch(name, name, item.before, item.after, "", "", {
            context: 2,
          })
        : "",
    [open, item.before, item.after, name],
  );

  const firstChangedLine = useMemo(() => {
    const before = item.before.split("\n");
    const after = item.after.split("\n");
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      if (before[index] !== after[index]) return index + 1;
    }
    return 1;
  }, [item.before, item.after]);

  if (item.state === "reverted") {
    return <Reverted item={item} name={name} />;
  }

  return (
    <div className="stream-indent">
      <div
        className="group flex h-[24px] w-fit max-w-full items-center gap-2 rounded-[3px] bg-pen-wash px-2"
        onMouseEnter={() => onHoverEdit(item.path, [firstChangedLine, firstChangedLine + 2])}
        onMouseLeave={() => onHoverEdit(item.path, null)}
      >
        <button className="t-code-sm truncate text-ink" onClick={() => setOpen(!open)}>
          {name}
        </button>
        <span className="t-micro tnum shrink-0">
          <span className="text-ok">+{item.added}</span>{" "}
          <span className="text-error">−{item.removed}</span>
        </span>
        <span className="hidden shrink-0 gap-2 group-hover:flex">
          <button
            className="t-micro text-ink-2 hover:text-ink"
            onClick={() => onShowEdit(item.path, firstChangedLine)}
          >
            Show
          </button>
          {undoable ? (
            <button
              className="t-micro text-ink-2 hover:text-ink"
              onClick={async () => {
                const projectId = get().projectId;
                if (!projectId) return;
                const result = await api.undo(
                  projectId,
                  item.path,
                  item.before,
                  item.after,
                );
                if (result.ok) markReverted(item.id);
                else setUndoable(false);
              }}
            >
              Undo
            </button>
          ) : (
            <span className="t-micro text-ink-3" title="Changed since — can't undo cleanly">
              Changed since
            </span>
          )}
        </span>
      </div>
      {open ? (
        <pre className="t-code-sm mt-1 max-h-[220px] overflow-auto whitespace-pre rounded-[3px] border-l border-line bg-surface-2 p-2">
          {patch
            .split("\n")
            .slice(4)
            .map((line, index) => (
              <div
                key={index}
                className={
                  line.startsWith("+")
                    ? "bg-[color-mix(in_oklab,var(--ok)_10%,transparent)]"
                    : line.startsWith("-")
                      ? "bg-[color-mix(in_oklab,var(--error)_10%,transparent)]"
                      : ""
                }
              >
                {line}
              </div>
            ))}
        </pre>
      ) : null}
    </div>
  );
}

function Reverted({
  item,
  name,
}: {
  item: Extract<ChatItem, { kind: "edit" }>;
  name: string;
}) {
  // Redo stays live for ten seconds.  After that the reverted line remains
  // in the transcript for good: the chat is the record of what was done to
  // the document, and nothing in it disappears.
  const [canRedo, setCanRedo] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setCanRedo(false), 10000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-[20px] items-center gap-3 stream-indent">
      <span className="t-micro text-ink-3 line-through">Reverted — {name}</span>
      {canRedo ? (
        <button
          className="t-micro text-ink-2 hover:text-ink"
          onClick={async () => {
            const projectId = get().projectId;
            if (!projectId) return;
            const result = await api.undo(
              projectId, item.path, item.after, item.before,
            );
            if (result.ok) markLive(item.id);
            else setCanRedo(false);
          }}
        >
          Redo
        </button>
      ) : null}
    </div>
  );
}

function Permission({ item }: { item: Extract<ChatItem, { kind: "permission" }> }) {
  const [armed, setArmed] = useState(false);

  // 350ms input shield: a card that appears under a cursor already moving
  // toward the composer must not be approvable on the way past.
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 350);
    return () => window.clearTimeout(timer);
  }, []);

  const decide = async (decision: "allow" | "always" | "deny") => {
    if (!armed) return;
    const projectId = get().projectId;
    if (!projectId) return;
    resolvePermission(item.id, decision);
    try {
      await api.respond(projectId, item.id, decision);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  // The hotkeys belong to the card, not the window.  CodeMirror's content is
  // a contenteditable div, so a window-level handler that only excludes
  // inputs would let ordinary typing in the editor answer the card.
  const card = useRef<HTMLDivElement | null>(null);
  const [scope, setScope] = useState(false);
  useEffect(() => {
    if (item.decision) return;
    const timer = window.setTimeout(() => {
      // Only take focus if nothing is being typed into.  Pulling the caret
      // out of the editor mid-sentence would make the writer's next "a" or
      // "d" answer a card they have not read -- which is the exact thing
      // the 350 ms shield exists to prevent.
      const active = document.activeElement as HTMLElement | null;
      const typing =
        active?.closest(".cm-editor") ||
        active?.tagName === "TEXTAREA" ||
        active?.tagName === "INPUT";
      if (!typing) card.current?.focus();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [item.decision]);

  if (item.decision) {
    const label =
      item.decision === "deny" ? "Denied" : "Allowed";
    return (
      <div className="flex h-[26px] items-center gap-2 stream-indent">
        <span
          className={`h-[6px] w-[6px] rounded-full ${
            item.decision === "deny" ? "bg-ink-3" : "bg-ok"
          }`}
        />
        <span className="t-micro truncate text-ink-3">
          {label} — {item.detail || item.headline}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={card}
      tabIndex={0}
      role="group"
      aria-label={item.headline}
      // No focus ring: the global one is --pen, and a violet perimeter on a
      // card whose whole point is a --warn gate says "Claude is talking" at
      // the moment it should say "this needs an answer".
      className="stream-indent no-focus-ring flex rounded-[5px] border border-line bg-surface-2"
      style={{ animation: "permission-in 90ms var(--ease)" }}
      onKeyDown={(event) => {
        if (event.key === "a" && !event.shiftKey) decide("allow");
        if (event.key === "A" && event.shiftKey) decide("always");
        if (event.key === "d") decide("deny");
      }}
    >
      <span className="w-[3px] shrink-0 rounded-l-[5px] bg-warn" />
      <div className="min-w-0 flex-1 p-3">
        <div className="t-ui text-ink">{item.headline}</div>
        {item.detail ? (
          <pre className="t-code-sm mt-2 max-h-[108px] overflow-auto whitespace-pre-wrap rounded-[3px] bg-surface p-2">
            {item.detail}
          </pre>
        ) : null}
        {item.consequence ? (
          <div className="t-meta mt-2 text-ink-2">{item.consequence}</div>
        ) : null}
        {scope && item.rule ? (
          <div className="t-micro mt-2 text-ink-3">Remembers: {item.rule}</div>
        ) : null}
        <div className="mt-3 flex gap-[6px]">
          <button
            className="h-[28px] pen-button px-3 t-ui"
            onClick={() => decide("allow")}
          >
            Allow <span className="t-micro opacity-70">A</span>
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui"
            onMouseEnter={() => setScope(true)}
            onMouseLeave={() => setScope(false)}
            onFocus={() => setScope(true)}
            onBlur={() => setScope(false)}
            onClick={() => decide("always")}
          >
            Allow always <span className="t-micro text-ink-3">⇧A</span>
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui text-ink-2 hover:border-error hover:text-error"
            onClick={() => decide("deny")}
          >
            Deny <span className="t-micro text-ink-3">D</span>
          </button>
        </div>
      </div>
    </div>
  );
}
