import { useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import api from "../api";
import {
  get,
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
  handleRef,
}: {
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
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
      <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-line px-[10px]">
        <span className="t-ui-lg">Claude</span>
        {thinking ? (
          <button
            className="t-micro text-ink-3 hover:text-ink"
            onClick={() => {
              const projectId = get().projectId;
              if (projectId) api.interrupt(projectId).catch(() => undefined);
            }}
          >
            Stop
          </button>
        ) : claude?.email ? (
          <span className="t-micro text-ink-3 truncate max-w-[180px]">
            {claude.email}
          </span>
        ) : null}
      </div>

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
          <p className="t-meta text-ink-3 mt-6">
            Ask for a paragraph, a table, a figure, or a fix. Edits inside this
            project are made directly; anything else asks first.
          </p>
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
            className="h-[28px] rounded-[3px] bg-pen px-3 t-ui font-medium text-white disabled:opacity-40"
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
    return (
      <div className="flex">
        <span className="w-[3px] shrink-0 bg-pen" />
        <div className="ml-3 min-w-0 flex-1">
          <div className="t-micro mb-1 text-pen">Claude</div>
          <div className="t-prose whitespace-pre-wrap text-ink">
            {item.text}
            {item.streaming ? (
              <span className="ml-[1px] inline-block h-[1.1em] w-[2px] translate-y-[2px] bg-pen" />
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div className="flex items-baseline gap-2 pl-[15px]">
        <span className="t-micro text-ink-3">{item.name}</span>
        <span className="t-code-sm truncate text-ink-3">{item.summary}</span>
      </div>
    );
  }

  if (item.kind === "notice") {
    return (
      <div className={`t-meta pl-[15px] ${item.tone === "error" ? "text-error" : "text-ink-3"}`}>
        {item.text}
      </div>
    );
  }

  if (item.kind === "edit") {
    return <EditChip item={item} onShowEdit={onShowEdit} onHoverEdit={onHoverEdit} />;
  }

  return <Permission item={item} />;
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
    return (
      <div className="t-micro pl-[15px] text-ink-3 line-through">
        Reverted — {name}
      </div>
    );
  }

  return (
    <div className="pl-[15px]">
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

  useEffect(() => {
    if (item.decision) return;
    const onKey = (event: KeyboardEvent) => {
      if (!armed) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if (event.key === "a" && !event.shiftKey) decide("allow");
      if (event.key === "A" && event.shiftKey) decide("always");
      if (event.key === "d") decide("deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (item.decision) {
    const label =
      item.decision === "deny" ? "Denied" : "Allowed";
    return (
      <div className="flex h-[26px] items-center gap-2 pl-[15px]">
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
      className="flex rounded-[5px] border border-line bg-surface-2"
      style={{ animation: "permission-in 90ms var(--ease)" }}
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
        <div className="mt-3 flex gap-[6px]">
          <button
            className="h-[28px] rounded-[3px] bg-pen px-3 t-ui font-medium text-white"
            onClick={() => decide("allow")}
          >
            Allow <span className="t-micro opacity-70">A</span>
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui"
            title={item.rule ? `Remembers: ${item.rule}` : undefined}
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
