import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDismiss } from "../useDismiss";
import { createTwoFilesPatch } from "diff";
import Prose from "./prose";
import { welcome, WELCOME_ACTIONS } from "../welcome";
import { agentName, usageNote } from "../agent-name";
import { Chevron } from "../App";
import api from "../api";
import {
  clearChat,
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
export function tidy(items: ChatItem[]): ChatItem[] {
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
  // What the agent is doing at this moment.  Until now the only sign of
  // life was a line under the composer that said "is writing" whether it
  // was writing or reading a file for twenty seconds, so a turn spent in
  // tools looked like a turn that had stopped.
  const activity = useMemo(() => {
    if (blocked) return "Waiting";
    if (!thinking) return "";
    for (let index = shown.length - 1; index >= 0; index -= 1) {
      const item = shown[index];
      if (item.kind === "claude" && item.streaming) return "Writing";
      if (item.kind === "tool") {
        const what = item.summary ? ` ${shorten(item.summary)}` : "";
        return `${verb(item.name)}${what}`;
      }
      if (item.kind === "edit") return `Editing ${shorten(item.path)}`;
      if (item.kind === "user") break;
    }
    return "Thinking";
  }, [shown, thinking, blocked]);
  const agent = useStore((s) => s.agent);
  const provider = agent?.provider;
  const name = agentName(provider);
  const [draft, setDraft] = useState("");
  const stream = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const pinned = useRef(true);
  const queued = useRef<string[]>([]);
  // A ref does not re-render, so the "yours will go next" line read a count
  // that only changed when something else happened to redraw the panel.
  const [queuedCount, setQueuedCount] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const projectId = useStore((s) => s.projectId);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const usageRef = useRef<HTMLDivElement | null>(null);
  const usageButton = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    menuRef,
    menuOpen,
    useCallback(() => {
      setMenuOpen(false);
      setConfirmClear(false);
    }, []),
    menuButton,
  );
  const auto = useStore((s) => s.auto);
  // Only the Claude agent ever puts a card up, so only it is offered the
  // switch: a toggle on the others would promise a change that does not
  // happen.
  const [asks, setAsks] = useState(false);
  const setAuto = async (on: boolean) => {
    if (!projectId) return;
    try {
      await api.setAuto(projectId, on);
      set({ auto: on });
    } catch (error: any) {
      set({ error: error.message });
    }
  };
  useDismiss(
    usageRef,
    showUsage,
    useCallback(() => setShowUsage(false), []),
    usageButton,
  );
  const [focusedComposer, setFocusedComposer] = useState(false);

  // The tally follows the end of a turn, which is when it changes.
  useEffect(() => {
    if (!projectId || thinking) return;
    api
      .usage(projectId)
      .then((answer) => {
        setUsage(answer);
        // A reload has no other way to learn either of these.
        setAsks(!!answer.asks);
        set({ auto: !!answer.auto });
      })
      .catch(() => undefined);
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
    // Read from the store, not from this render's closure.  Pressing Enter
    // in the gap between the server's `done` and React re-rendering queued
    // the message -- into a ref, so nothing re-rendered, so the effect that
    // drains the queue never fired again and it sat there for good, looking
    // sent.
    if (get().thinking) {
      // A follow-up thought arrives while Claude is still answering the
      // last one.  Hold it and send it when the turn ends, rather than
      // refusing it and making the writer remember to ask again.
      queued.current.push(text);
      setQueuedCount(queued.current.length);
      return;
    }
    try {
      await api.ask(projectId, text);
    } catch (error: any) {
      // Put it back in the box rather than losing what they typed.
      setDraft(text);
      set({ error: error.message });
    }
  };

  // Whatever was said while Claude was talking goes now.
  useEffect(() => {
    if (thinking || !projectId || !queued.current.length) return;
    const next = queued.current.shift();
    setQueuedCount(queued.current.length);
    if (next) {
      api.ask(projectId, next).catch((error: any) => {
        set({ error: error.message });
      });
    }
  }, [thinking, projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="chat">
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
        <span className="t-ui-lg shrink-0 font-serif">{name}</span>
        {thinking || blocked ? (
          <span
            className="flex min-w-0 flex-1 items-center gap-[6px]"
            data-testid="working"
            aria-live="polite"
          >
            <span
              className={`nx-working h-[6px] w-[6px] shrink-0 rounded-full ${
                blocked ? "bg-warn" : "bg-pen"
              }`}
            />
            <span className="t-micro truncate text-ink-2" title={activity}>
              {activity}
            </span>
          </span>
        ) : null}
        {auto ? (
          <button
            className="t-micro shrink-0 rounded-[3px] border border-warn px-1 text-warn"
            data-testid="auto-chip"
            title="Every action is approved without asking. Click to turn it off."
            onClick={() => setAuto(false)}
          >
            Auto
          </button>
        ) : null}
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
        <button
          ref={usageButton}
          className={`quiet t-micro flex h-[26px] items-center gap-1 rounded-[3px] px-2 hover:bg-surface-3 ${
            showUsage ? "bg-surface-3 text-ink" : ""
          }`}
          title="What this project has used"
          aria-expanded={showUsage}
          onClick={() => setShowUsage(!showUsage)}
        >
          Usage
          <span className={showUsage ? "rotate-180" : ""}>
            <Chevron direction="down" />
          </span>
        </button>
        <button
          ref={menuButton}
          className={`quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px] hover:bg-surface-3 ${
            menuOpen ? "bg-surface-3 text-ink" : ""
          }`}
          aria-label="More"
          aria-expanded={menuOpen}
          data-testid="chat-menu-open"
          onClick={() => {
            setMenuOpen(!menuOpen);
            setConfirmClear(false);
          }}
        >
          ⋯
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

      {menuOpen ? (
        <div
          ref={menuRef}
          className="nx-arrive shrink-0 border-b border-line bg-surface-2 px-[10px] py-2"
          data-testid="chat-menu"
        >
          {confirmClear ? (
            <div>
              <p className="t-meta text-ink-2">
                Start a new conversation? The record of this one is kept on
                disk.
              </p>
              <div className="mt-2 flex gap-[6px]">
                <button
                  className="ghost-button h-[26px] px-3 t-ui"
                  data-testid="clear-confirm"
                  onClick={async () => {
                    if (!projectId) return;
                    try {
                      await api.resetChat(projectId);
                      clearChat();
                      queued.current = [];
                      setQueuedCount(0);
                      setMenuOpen(false);
                      setConfirmClear(false);
                    } catch (error: any) {
                      set({ error: error.message });
                    }
                  }}
                >
                  Start new
                </button>
                <button
                  className="quiet t-ui h-[26px] rounded-[3px] border border-line px-3"
                  onClick={() => setConfirmClear(false)}
                >
                  Keep this one
                </button>
              </div>
            </div>
          ) : (
            <button
              className="t-ui flex h-[26px] w-full items-center rounded-[3px] px-1 text-left text-ink hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent"
              data-testid="clear-chat"
              disabled={thinking}
              title={thinking ? "Wait for this answer to finish" : undefined}
              onClick={() => setConfirmClear(true)}
            >
              New conversation
            </button>
          )}
          <label className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span className="t-ui shrink-0 text-ink">Model</span>
            <select
                  id="nx-model"
                  aria-label="Which model answers here"
                  className="t-micro cursor-pointer rounded-[3px] border border-line bg-surface-2 px-1 py-[2px] text-ink-2 hover:border-hint hover:text-ink"
                  value={usage?.model ?? ""}
                  title="Which model answers here"
                  onChange={async (event) => {
                const chosen = event.target.value;
                if (!projectId) return;
                try {
                  const answer = await api.setModel(projectId, chosen);
                  setUsage(await api.usage(projectId));
                  // The client carries the model it was started with, so a
                  // change made mid-answer is held back rather than applied --
                  // applying it used to close the transport the running turn
                  // was reading from, and that turn then ended without ever
                  // saying so.  A dropdown that appears to do nothing is worse
                  // than one that explains itself.
                  if (answer.deferred) {
                    pushChat({
                      kind: "notice",
                      id: `model-${Date.now()}`,
                      text: "The model changes for your next question — this answer finishes on the one it started with.",
                      tone: "plain",
                    });
                  }
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
          </label>
          {asks ? (
            <button
              className="mt-3 block w-full border-t border-line pt-3 text-left"
              role="switch"
              aria-checked={auto}
              data-testid="auto-toggle"
              onClick={() => setAuto(!auto)}
            >
              <span className="t-ui flex items-center gap-2 text-ink">
                <span
                  className={`inline-block h-[10px] w-[10px] shrink-0 rounded-[2px] border ${
                    auto ? "border-warn bg-warn" : "border-line"
                  }`}
                />
                Approve everything automatically
              </span>
              <span className="t-meta ml-[18px] block text-ink-2">
                Still recorded in the conversation. A write outside the
                project is asked about either way.
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

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
          <p className="t-micro mt-2 text-ink-3">{usageNote(provider)}</p>
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
              <div className="t-micro mb-1 text-pen">{name}</div>
              <div className="t-prose text-ink">
                <Prose text={welcome(name, provider !== "openai")} />
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
        {/* The two things that most improve the help, kept reachable.  They
            used to live only in the welcome message, which disappears the
            moment anything is asked -- so after the first question there
            was no way back to them at all. */}
        {setupOpen ? (
          <div className="mb-2 flex flex-col gap-2 rounded-[3px] border border-line bg-surface-2 p-2">
            {WELCOME_ACTIONS.map((action) => (
              <button
                key={action.kind}
                className="ghost-button nx-press px-3 py-2 text-left"
                onClick={() => {
                  setSetupOpen(false);
                  onAddContext?.(action.kind);
                }}
              >
                <span className="t-ui block">{action.label}</span>
                <span className="t-meta block text-ink-2">{action.detail}</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={composer}
          rows={3}
          value={draft}
          disabled={blocked}
          placeholder={blocked ? "Waiting on your approval" : `Ask ${name}`}
          className="t-ui w-full resize-none rounded-[3px] border border-line bg-surface-2 px-2 py-[6px] outline-none transition-colors duration-[90ms] placeholder:text-ink-3 disabled:border-warn disabled:bg-surface disabled:text-ink-3"
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
                ? queuedCount
                  ? `${name} is working · yours will go next`
                  : ""
                : focusedComposer
                ? "Enter to send, Shift-Enter for a new line"
                : ""}
          </span>
          <div className="flex items-center gap-2">
          <button
            className="quiet t-micro nx-hover"
            aria-expanded={setupOpen}
            onClick={() => setSetupOpen((open) => !open)}
          >
            {setupOpen ? "Hide setup" : "Template & voice"}
          </button>
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
  mcp__nexttex__search_library: "Searched your papers",
  mcp__nexttex__remember: "Remembered",
};

/** A path or a command, cut to something that fits a 32px header beside
 *  the agent's name.  The tail of a path is the part that identifies it. */
function shorten(text: string, limit = 28): string {
  const line = text.split("\n")[0].trim();
  if (line.length <= limit) return line;
  const tail = line.slice(-(limit - 1));
  return line.includes("/") ? `…${tail}` : `${line.slice(0, limit - 1)}…`;
}

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

/** One row of the transcript.
 *
 *  Memoised, because the store replaces `chat` on every streamed delta --
 *  twenty times a second -- and without this every row in the conversation
 *  re-rendered on each one.  The items are immutable and keyed by a stable
 *  id, so reference equality is exactly the right test; the two handlers
 *  come from App, which is not re-rendering while a turn streams. */
const Item = memo(function Item({
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
    return <AgentMessage item={item} />;
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
})

function AgentMessage({ item }: { item: Extract<ChatItem, { kind: "claude" }> }) {
  const name = agentName(useStore((s) => s.agent?.provider));
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
          <span className="t-micro text-pen">{name}</span>
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
  // toward the composer must not be approvable on the way past.  The
  // buttons are really disabled for that moment rather than silently
  // ignoring the click -- a control that looks live and does nothing reads
  // as a broken app, and this one guards the fence.
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
      // `preventScroll`, because the panel has its own idea of where it
      // should be: the pin-to-bottom effect runs on every change, and a
      // focus that also scrolls means two authorities moving the same
      // container in one frame, which the reader sees as a jump.
      if (!typing) card.current?.focus({ preventScroll: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [item.decision]);

  if (item.decision) {
    // Three states, not two.  An action nobody was asked about is not the
    // same as one the writer allowed, and the record should not read as
    // though they had.  The dot is --warn, the permission card's own
    // colour, so the association is already built.
    const label =
      item.decision === "deny"
        ? "Denied"
        : item.decision === "auto"
          ? "Allowed automatically"
          : "Allowed";
    const dot =
      item.decision === "deny"
        ? "bg-ink-3"
        : item.decision === "auto"
          ? "bg-warn"
          : "bg-ok";
    return (
      <div
        className="flex h-[26px] items-center gap-2 stream-indent"
        data-testid={`decided-${item.decision}`}
      >
        <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
        <span className="t-micro min-w-0 truncate text-ink-3">
          {label} —{" "}
          {item.detail ? (
            <span className="t-code-sm">{item.detail}</span>
          ) : (
            item.headline
          )}
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
        if (event.key === "A" && event.shiftKey && item.rule) decide("always");
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
        {item.rule ? (
          // Always in the layout, only sometimes visible.  Adding this line
          // on hover grew the card and moved the buttons out from under the
          // cursor that was reaching for them -- and moving away shrank it
          // again, so the pointer oscillated between the two.
          <div
            className={`t-micro mt-2 text-ink-3 transition-opacity duration-[90ms] ${
              scope ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={!scope}
          >
            Remembers: {item.rule}
          </div>
        ) : null}
        <div className="mt-3 flex gap-[6px]">
          <button
            className="h-[28px] pen-button px-3 t-ui"
            data-testid="allow"
            disabled={!armed}
            onClick={() => decide("allow")}
          >
            Allow
            <span className={`t-micro ${focused ? "opacity-70" : "opacity-0"}`}>
              {" "}
              A
            </span>
          </button>
          {/* A command carrying shell syntax gets no rule, because a rule
              scoped to its first word would not mean what it says.  Offering
              to remember one anyway would be a promise the fence cannot
              keep, so the button is not there. */}
          {item.rule ? (
            <button
              className="h-[28px] rounded-[3px] border border-line px-3 t-ui disabled:opacity-40"
              data-testid="always"
              disabled={!armed}
              onMouseEnter={() => setScope(true)}
              onMouseLeave={() => setScope(false)}
              onFocus={() => setScope(true)}
              onBlur={() => setScope(false)}
              onClick={() => decide("always")}
            >
              Allow always
              <span className={`t-micro ${focused ? "text-ink-3" : "opacity-0"}`}>
                {" "}
                ⇧A
              </span>
            </button>
          ) : (
            <span className="t-micro self-center text-ink-3">
              This one is asked every time: it runs more than one command.
            </span>
          )}
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui text-ink-2 hover:border-error hover:text-error disabled:opacity-40"
            data-testid="deny"
            disabled={!armed}
            onClick={() => decide("deny")}
          >
            Deny
            <span className={`t-micro ${focused ? "text-ink-3" : "opacity-0"}`}>
              {" "}
              D
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
