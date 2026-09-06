import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "../useDismiss";
import { createTwoFilesPatch } from "diff";
import Prose from "./prose";
import { WELCOME, WELCOME_ACTIONS } from "../welcome";
import { Chevron } from "../App";
import api from "../api";
import {
  firstChangedLine,
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

/** Two kinds of noise the raw stream produces, removed before rendering:
 *  an `Edited main.tex` row immediately followed by the chip that says the
 *  same thing with a diff, and the same read repeated back to back. */
function tidy(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const item of items) {
    if (item.kind === "tool" && HIDDEN_TOOLS.has(item.name)) continue;
    const previous = out[out.length - 1];
    if (
      item.kind === "edit" &&
      previous?.kind === "tool" &&
      ["Edit", "MultiEdit", "Write"].includes(previous.name) &&
      previous.summary.endsWith(item.path)
    ) {
      out.pop();
    } else if (
      item.kind === "tool" &&
      previous?.kind === "tool" &&
      previous.name === item.name &&
      previous.summary === item.summary
    ) {
      out[out.length - 1] = {
        ...previous,
        repeats: (previous.repeats ?? 1) + 1,
      };
      continue;
    }
    out.push(item);
  }
  return out;
}

export default function Chat({
  onShowEdit,
  onHoverEdit,
  onFold,
  onAddContext,
  handleRef,
}: {
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
  onFold?: () => void;
  onAddContext?: (kind: "style" | "voice" | "template") => void;
  handleRef: (handle: ChatHandle) => void;
}) {
  const chat = useStore((s) => s.chat);
  // Collapsing repeated tool rows walks the whole transcript.  Streaming a
  // long answer re-renders this panel twenty times a second, and without
  // this it did that walk every time.
  const shown = useMemo(() => tidy(chat), [chat]);
  const thinking = useStore((s) => s.thinking);
  const blocked = useStore((s) => s.awaitingPermission);
  const claude = useStore((s) => s.claude);
  const [draft, setDraft] = useState("");
  const stream = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const pinned = useRef(true);
  const queued = useRef<string[]>([]);
  const projectId = useStore((s) => s.projectId);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const usageRef = useRef<HTMLDivElement | null>(null);
  useDismiss(usageRef, showUsage, useCallback(() => setShowUsage(false), []));
  const [focusedComposer, setFocusedComposer] = useState(false);

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
    if (thinking) {
      // A follow-up thought arrives while Claude is still answering the
      // last one.  Hold it and send it when the turn ends, rather than
      // refusing it and making the writer remember to ask again.
      queued.current.push(text);
      return;
    }
    try {
      await api.ask(projectId, text);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  // Whatever was said while Claude was talking goes now.
  useEffect(() => {
    if (thinking || !projectId || !queued.current.length) return;
    const next = queued.current.shift();
    if (next) api.ask(projectId, next).catch(() => undefined);
  }, [thinking, projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className={`flex h-[32px] shrink-0 items-center gap-2 border-b border-line px-[10px] ${
          onFold ? "cursor-pointer transition-colors duration-[90ms] hover:bg-surface-2" : ""
        }`}
        title={onFold ? "Fold this panel away" : undefined}
        onClick={(event) => {
          if (!onFold) return;
          if ((event.target as HTMLElement).closest("button, select, input")) return;
          onFold();
        }}
      >
        <span className="t-ui-lg font-serif">Claude</span>
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
        <label className="t-micro text-ink-3" htmlFor="nx-model">
          Model
        </label>
        <select
          id="nx-model"
          className="t-micro cursor-pointer rounded-[3px] border border-line bg-surface-2 px-1 py-[2px] text-ink-2 hover:border-hint hover:text-ink"
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
          className="quiet t-micro flex h-[26px] items-center gap-1 rounded-[3px] px-2 hover:bg-surface-3"
          title="What this project has used"
          aria-expanded={showUsage}
          onClick={() => setShowUsage(!showUsage)}
        >
          Usage
          <span className={showUsage ? "rotate-180" : ""}>
            <Chevron direction="down" />
          </span>
        </button>
        {onFold ? (
          <button
            className="quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px] hover:bg-surface-3"
            title="Fold this panel away"
            aria-label="Fold this panel away"
            onClick={onFold}
          >
            <Chevron direction="right" />
          </button>
        ) : null}
      </div>

      {showUsage && usage ? (
        <div
          ref={usageRef}
          className="nx-arrive shrink-0 border-b border-line bg-surface-2 px-[10px] py-3"
        >
          <div className="flex items-baseline gap-2">
            <span className="t-ui-lg tabular-nums text-ink">
              {usage.usage.costUsd
                ? `$${usage.usage.costUsd.toFixed(usage.usage.costUsd < 1 ? 3 : 2)}`
                : "$0.000"}
            </span>
            <span className="t-micro text-ink-3">estimated, this project</span>
          </div>
          <div className="t-micro mt-1 text-ink-2">
            {usage.usage.turns} {usage.usage.turns === 1 ? "turn" : "turns"} ·{" "}
            {Math.round(usage.usage.durationMs / 1000)}s of model time
          </div>
          <div className="t-micro text-ink-2">
            {compact(usage.usage.inputTokens)} tokens in
            {usage.usage.cacheReadTokens
              ? ` (${compact(usage.usage.cacheReadTokens)} from cache)`
              : ""}{" "}
            · {compact(usage.usage.outputTokens)} out
          </div>
          <p className="t-micro mt-2 text-ink-3">
            On a Claude subscription this is what the same work would have
            cost through the API, not a bill.
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
              <div className="mt-3 flex flex-col gap-2">
                {WELCOME_ACTIONS.map((action) => (
                  <button
                    key={action.kind}
                    className="ghost-button nx-press px-3 py-2 text-left"
                    onClick={() => onAddContext?.(action.kind)}
                  >
                    <span className="t-ui block">{action.label}</span>
                    <span className="t-meta block text-ink-2">{action.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-5">
          {shown.map((item) => (
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
          onFocus={() => setFocusedComposer(true)}
          onBlur={() => setFocusedComposer(false)}
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
            {blocked
              ? ""
              : thinking
                ? queued.current.length
                  ? "Claude is writing · yours will go next"
                  : "Claude is writing"
                : focusedComposer
                ? "Enter to send, Shift-Enter for a new line"
                : ""}
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

/** What the tool did, in the words a writer would use.
 *
 *  `mcp__nexttex__insert_at_cursor` is how the protocol names it; nobody
 *  writing a thesis should have to read that. */
const VERBS: Record<string, string> = {
  Read: "Read",
  Edit: "Edited",
  MultiEdit: "Edited",
  Write: "Wrote",
  Bash: "Ran",
  Glob: "Searched",
  Grep: "Searched",
  mcp__nexttex__editor_state: "Checked where you are",
  mcp__nexttex__compile_diagnostics: "Read the errors",
  mcp__nexttex__compile: "Rebuilt the document",
  mcp__nexttex__insert_at_cursor: "Inserted at your cursor",
  mcp__nexttex__insert_figure: "Inserted a figure",
  mcp__nexttex__insert_table: "Inserted a table",
  mcp__nexttex__goto: "Moved your editor",
  mcp__nexttex__find_papers: "Searched the literature",
  mcp__nexttex__add_reference: "Added a reference",
  mcp__nexttex__check_references: "Checked the bibliography",
};

/** Tools that are plumbing rather than work: showing them is noise. */
const HIDDEN_TOOLS = new Set(["ToolSearch", "TodoWrite"]);

function verb(name: string): string {
  return VERBS[name] ?? name.replace(/^mcp__[a-z]+__/, "").replace(/_/g, " ");
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
  if (!value) return "0";
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
        <span className="t-micro text-ink-2">{verb(item.name)}</span>
        <span className="t-code-sm truncate text-ink-3">{item.summary}</span>
        {item.repeats && item.repeats > 1 ? (
          <span className="t-micro tabular-nums text-ink-3">×{item.repeats}</span>
        ) : null}
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
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
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

  const changedLine = useMemo(
    () => firstChangedLine(item.before, item.after),
    [item.before, item.after],
  );

  if (item.state === "reverted") {
    return <Reverted item={item} name={name} />;
  }

  return (
    <div className="stream-indent">
      <div
        className="flex h-[24px] w-fit max-w-full items-center gap-2 rounded-[3px] bg-pen-wash px-2"
        onMouseEnter={() => onHoverEdit(item.path, [changedLine, changedLine + 2])}
        onMouseLeave={() => onHoverEdit(item.path, null)}
      >
        <button
          className="flex min-w-0 items-center gap-1 text-ink"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={open ? "rotate-180" : ""}>
            <Chevron direction="down" />
          </span>
          <span className="t-code-sm truncate">{name}</span>
        </button>
        <span className="t-micro tnum shrink-0">
          <span className="text-ok">+{item.added}</span>{" "}
          <span className="text-error">−{item.removed}</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            className="quiet t-micro"
            onClick={() => onShowEdit(item.path, changedLine)}
          >
            Show
          </button>
          {undoable ? (
            <button
              className="quiet t-micro"
              onClick={async () => {
                const projectId = get().projectId;
                if (!projectId) return;
                const result = await api.undo(
                  projectId,
                  item.path,
                  item.before,
                  item.after,
                  item.id,
                );
                if (result.ok) markReverted(item.id);
                else setUndoable(false);
              }}
            >
              Undo
            </button>
          ) : (
            <span className="t-micro text-ink-3">Can't undo — you edited this</span>
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
              projectId, item.path, item.after, item.before, item.id, "live",
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
  const [focused, setFocused] = useState(false);
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
      className="stream-indent permission-card flex rounded-[5px] border border-line bg-surface-2"
      style={{ animation: "permission-in 90ms var(--ease)" }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setFocused(false);
        }
      }}
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
            Allow{focused ? <span className="t-micro opacity-70"> A</span> : null}
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui"
            onMouseEnter={() => setScope(true)}
            onMouseLeave={() => setScope(false)}
            onFocus={() => setScope(true)}
            onBlur={() => setScope(false)}
            onClick={() => decide("always")}
          >
            Allow always
            {focused ? <span className="t-micro text-ink-3"> ⇧A</span> : null}
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui text-ink-2 hover:border-error hover:text-error"
            onClick={() => decide("deny")}
          >
            Deny{focused ? <span className="t-micro text-ink-3"> D</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
