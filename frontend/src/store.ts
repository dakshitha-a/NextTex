// A single mutable store with a subscribe/notify pair, read through
// useSyncExternalStore.  A context-and-reducer tree would re-render the
// editor on every streamed token; this keeps the streaming path cheap and
// lets components subscribe to exactly the slice they draw.

import { useSyncExternalStore } from "react";
import api, {
  clientId,
  type CompileResult,
  type ContextDocument,
  type Diagnostic,
  type ProjectSummary,
  type TrashEntry,
  type TreeNode,
  type Version,
} from "./api";

export type ChatItem =
  | { kind: "user"; id: string; text: string; at: number }
  | { kind: "claude"; id: string; text: string; at: number; streaming: boolean }
  | {
      kind: "edit";
      id: string;
      path: string;
      before: string;
      after: string;
      added: number;
      removed: number;
      state: "live" | "reverted";
    }
  | {
      kind: "permission";
      id: string;
      tool: string;
      rule: string;
      headline: string;
      detail: string;
      consequence: string;
      at: number;
      decision?: "allow" | "always" | "deny" | "auto";
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      /** Consecutive identical calls are shown once, with a count. */
      repeats?: number;
    }
  | { kind: "notice"; id: string; text: string; tone: "error" | "plain" };

export type Tab = { path: string; dirty: boolean };

export type State = {
  ready: boolean;
  projects: ProjectSummary[];
  projectId: string | null;
  projectName: string;
  tree: TreeNode | null;
  tabs: Tab[];
  activePath: string | null;
  // What the editor should show, and where to put the caret.  Routing this
  // through state rather than a method call means opening a file works
  // whether or not the editor has finished mounting -- which it has not,
  // the first time a project opens.
  pendingOpen: { path: string; line?: number; nonce: number } | null;
  // Set while the editor is showing an old version of a file, read-only.
  viewing: { path: string; sha: string; version: Version } | null;
  history: Version[];
  trash: TrashEntry[];
  compiling: boolean;
  /** Whether the preview is older than the source: something has been
   *  edited since the last build started.  It is a resting state, not a
   *  transient -- with `compile as you type` off, a document sits here
   *  until the writer asks for a build. */
  stale: boolean;
  compile: CompileResult | null;
  diagnostics: Diagnostic[];
  lint: Diagnostic[];
  pdfStamp: number;
  chat: ChatItem[];
  thinking: boolean;
  awaitingPermission: boolean;
  /** Whether the agent approves without asking. */
  auto: boolean;
  git: {
    repository: boolean;
    branch: string;
    ahead: number;
    behind: number;
    remote: string;
    changes: { state: string; path: string }[];
    gh: boolean;
    ghReason: string;
  } | null;
  contextDocs: ContextDocument[];
  contextStale: string[];
  /** The three per-project switches from the settings card. */
  settings: { autocompile: boolean; markErrors: boolean; markWarnings: boolean };
  /** Which agent this instance uses, and whether it is ready.  Named
   *  `agent` rather than `claude` since there are three answers now, one
   *  of which is that there is deliberately no agent at all. */
  /** A folder-read in flight, or the one that just finished. */
  library: import("./api").LibraryProgress | null;
  /** Set only on an install started with `--instance`: a second NextTex
   *  on the same machine, which has to be tellable from the first. */
  instance: string;
  agent: {
    provider: "claude" | "openai" | "none";
    ready: boolean;
    model?: string;
    keyTail?: string;
    email?: string;
    plan?: string;
  } | null;
  cursor: { line: number; column: number };
  words: number | null;
  // Set when a save was refused because the file changed underneath this
  // tab.  Nothing is written and nothing is thrown away until the writer
  // says which copy they want.
  conflict: { path: string; theirs: string; tag: string } | null;
  error: string | null;
};

const state: State = {
  ready: false,
  projects: [],
  projectId: null,
  projectName: "",
  tree: null,
  tabs: [],
  activePath: null,
  pendingOpen: null,
  viewing: null,
  history: [],
  trash: [],
  compiling: false,
  stale: false,
  compile: null,
  diagnostics: [],
  lint: [],
  pdfStamp: 0,
  chat: [],
  thinking: false,
  awaitingPermission: false,
  auto: false,
  git: null,
  instance: "",
  contextDocs: [],
  contextStale: [],
  settings: { autocompile: true, markErrors: true, markWarnings: false },
  agent: null,
  library: null,
  cursor: { line: 1, column: 1 },
  conflict: null,
  words: null,
  error: null,
};

const listeners = new Set<() => void>();
let snapshot: State = { ...state };

function commit() {
  snapshot = { ...state };
  for (const listener of listeners) listener();
}

export function set(patch: Partial<State>) {
  Object.assign(state, patch);
  commit();
}

export function get(): State {
  return state;
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(snapshot),
  );
}

// ---------------------------------------------------------------------------
// Chat

let counter = 0;
const nextId = () => `item-${Date.now().toString(36)}-${counter++}`;

/** Rebuild the panel from what the server kept.
 *
 *  The model resumes its own memory of the conversation from disk, so the
 *  window has to as well -- otherwise the agent refers to work the writer
 *  cannot see.  The chips and permission records are also the audit trail
 *  of what an assistant did to the document, which is not session state. */
export function replayTranscript(items: any[]) {
  const chat: ChatItem[] = [];
  for (const item of items) {
    const at = item.at ?? Date.now();
    if (item.kind === "user") {
      chat.push({ kind: "user", id: nextId(), text: item.text ?? "", at });
    } else if (item.kind === "claude") {
      chat.push({
        kind: "claude", id: nextId(), text: item.text ?? "", at,
        streaming: false,
      });
    } else if (item.kind === "tool") {
      chat.push({
        kind: "tool", id: item.id || nextId(), name: item.name ?? "",
        summary: summariseTool(item.name ?? "", item.input),
      });
    } else if (item.kind === "edit") {
      const { added, removed } = countDiff(item.before ?? "", item.after ?? "");
      chat.push({
        kind: "edit", id: item.id || nextId(), path: item.path ?? "",
        before: item.before ?? "", after: item.after ?? "", added, removed,
        state: item.state === "reverted" ? "reverted" : "live",
      });
    } else if (item.kind === "permission") {
      chat.push({
        kind: "permission", id: item.id || nextId(), tool: item.tool ?? "",
        rule: item.rule ?? "", headline: item.headline ?? "",
        detail: item.detail ?? "", consequence: item.consequence ?? "", at,
        decision: item.decision,
      });
    } else if (item.kind === "notice") {
      chat.push({ kind: "notice", id: nextId(), text: item.text ?? "", tone: "error" });
    }
  }
  // A permission still unanswered when the window closed can never be
  // answered now: the turn waiting on it is gone.
  for (const item of chat) {
    if (item.kind === "permission" && !item.decision) item.decision = "deny";
  }
  // A question with no answer after it, and no notice explaining why.  This
  // is what a turn looks like when the server stopped underneath it --
  // which NextTex can now do to itself, since it installs its own updates
  // and restarts.  Without this the update feature and the agent feature
  // are quietly at odds: the transcript would reopen mid-sentence with
  // nothing saying so.
  if (danglingTurn(chat)) {
    chat.push({
      kind: "notice",
      id: nextId(),
      text: "That answer was interrupted when NextTex restarted.",
      tone: "error",
    });
  }
  set({ chat, awaitingPermission: false });
}

/** Whether a transcript stops in the middle of a turn.
 *
 *  The last item, and only the last: a turn that reached an end finishes
 *  with prose or with a notice saying why it did not.  The incident this
 *  exists for ended `[user, claude, tool]` -- a sentence, a file read, and
 *  then nothing -- so looking for the nearest `claude` going backwards
 *  would find the sentence and conclude the turn was fine.
 */
function danglingTurn(chat: ChatItem[]): boolean {
  const last = chat[chat.length - 1];
  if (!last) return false;
  return last.kind === "user" || last.kind === "tool" || last.kind === "edit";
}

export function pushChat(item: ChatItem) {
  state.chat = [...state.chat, item];
  commit();
}

function updateChat(id: string, patch: Partial<ChatItem>) {
  state.chat = state.chat.map((item) =>
    item.id === id ? ({ ...item, ...patch } as ChatItem) : item,
  );
  commit();
}

/** Streamed text is appended to the open Claude message, or starts one. */
let streamingId: string | null = null;
let streamBuffer = "";
let streamTimer: number | null = null;

function flushStream() {
  if (!streamingId || !streamBuffer) return;
  const id = streamingId;
  const chunk = streamBuffer;
  streamBuffer = "";
  // The message being streamed into is the last one in the list -- anything
  // else arriving ends the text first.  Searching from the end and copying
  // the array is a memcpy of pointers; the map this replaced ran a closure
  // and a comparison over every item in the transcript, twenty times a
  // second, for the whole of a long answer.
  let index = state.chat.length - 1;
  while (index >= 0 && state.chat[index].id !== id) index -= 1;
  const item = index >= 0 ? state.chat[index] : null;
  if (!item || item.kind !== "claude") return;
  const next = state.chat.slice();
  next[index] = { ...item, text: item.text + chunk };
  state.chat = next;
  commit();
}

function appendText(text: string) {
  if (!streamingId) {
    streamingId = nextId();
    pushChat({
      kind: "claude",
      id: streamingId,
      text: "",
      at: Date.now(),
      streaming: true,
    });
  }
  streamBuffer += text;
  // ~50ms batches: the spec asks for text landing in visible chunks rather
  // than a per-token repaint, and this is also what keeps the editor from
  // re-rendering sixty times a second during a long answer.
  if (streamTimer === null) {
    streamTimer = window.setTimeout(() => {
      streamTimer = null;
      flushStream();
    }, 50);
  }
}

function endText() {
  if (streamTimer !== null) {
    window.clearTimeout(streamTimer);
    streamTimer = null;
  }
  flushStream();
  if (streamingId) updateChat(streamingId, { streaming: false } as any);
  streamingId = null;
}

/** The first line where two versions of a file diverge.
 *
 *  Not a real diff: it is where to put the caret so the writer is looking
 *  at what changed, which is the first difference either way. */
export function firstChangedLine(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return index + 1;
  }
  return 1;
}

export function countDiff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const seen = new Map<string, number>();
  for (const line of a) seen.set(line, (seen.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of b) {
    const count = seen.get(line) ?? 0;
    if (count > 0) seen.set(line, count - 1);
    else added += 1;
  }
  let removed = 0;
  for (const count of seen.values()) removed += count;
  return { added, removed };
}

// ---------------------------------------------------------------------------
// The event stream

let source: EventSource | null = null;

/** The most recent build the server has told us about.  A cancelled build's
 *  result arrives after its replacement has already started, so the id is
 *  what tells a result about the current build from a result about one that
 *  has been superseded. */
let build = 0;

/** The preview is behind the source.  Called from the editor on every
 *  document change as well as from the event stream, because the writer
 *  sees their own keystroke long before the server hears about it. */
export function markStale() {
  if (!state.stale) set({ stale: true });
}

function setStale() {
  markStale();
}

export type EventHandlers = {
  onReveal?: (path: string, line: number) => void;
  onProjectChanged?: (main?: string) => void;
  onFilesChanged?: (paths: string[], structural?: boolean) => void;
  onCompileDone?: (result: CompileResult) => void;
  onAgentEdit?: (path: string, line: number) => void | Promise<void>;
  onRenamed?: (from: string, to: string) => void;
};
export const handlers: EventHandlers = {};

export function connect(projectId: string) {
  source?.close();
  source = new EventSource(`/api/projects/${projectId}/events`);
  startReconcile();
  // Fires on the first connection and on every automatic reconnection, so
  // a turn that ended while the stream was down is noticed at the moment
  // the stream comes back rather than at the next timer tick.
  source.onopen = () => {
    if (state.thinking) void reconcile();
  };
  source.onmessage = (event) => {
    let payload: any;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    receive(payload);
  };
}

export function disconnect() {
  source?.close();
  source = null;
  stopReconcile();
}

// ---------------------------------------------------------------------------
// Telling the browser it is wrong
//
// Everything the chat panel does after a question is keyed on `done`
// arriving.  The server now guarantees one, but a browser that missed it --
// the tab was asleep, the stream dropped, NextTex restarted underneath a
// running turn -- would sit on `thinking` for ever with no way to find out.
// So it asks.  Not on a timer alone: the moments that matter are when the
// tab comes back and when the stream reconnects, because those are exactly
// when an event could have been missed.

let reconcileTimer: number | undefined;
let reconcileWatching = false;

async function reconcile() {
  const id = state.projectId;
  if (!id || !state.thinking) return;
  let report: { busy?: boolean };
  try {
    report = await api.usage(id);
  } catch {
    return; // the server is unreachable; saying so is the stream's job
  }
  if (report.busy || !state.thinking) return;
  endText();
  pushChat({
    kind: "notice",
    id: nextId(),
    text: "That answer was interrupted, and NextTex did not hear how it ended.",
    tone: "error",
  });
  set({ thinking: false, awaitingPermission: false });
}

function onWake() {
  if (document.visibilityState === "visible") void reconcile();
}

function startReconcile() {
  if (reconcileWatching) return;
  reconcileWatching = true;
  document.addEventListener("visibilitychange", onWake);
  reconcileTimer = window.setInterval(() => {
    if (state.thinking) void reconcile();
  }, 60_000);
}

function stopReconcile() {
  if (!reconcileWatching) return;
  reconcileWatching = false;
  document.removeEventListener("visibilitychange", onWake);
  window.clearInterval(reconcileTimer);
}

function receive(event: any) {
  switch (event.type) {
    case "library_scan":
      set({ library: event as any });
      break;
    case "compile_scheduled":
      // A build is coming but has not started, so the preview is already
      // behind what is on screen.  With autocompile off no build is coming
      // at all and this is where the document rests.
      set({ stale: true });
      break;
    case "compile_start":
      // Cleared here rather than when the build finishes: a keystroke made
      // *during* a build leaves the preview behind again the moment the
      // build lands, and clearing at the end would wipe that.
      build = event.build ?? build;
      set({ compiling: true, stale: false });
      break;
    case "compile_done": {
      if (event.outcome === "cancelled") {
        // A superseded build says nothing about the document; leave the
        // diagnostics and the PDF exactly as they were.  Its result also
        // arrives *after* its replacement has started, so clearing
        // `compiling` here would clear it for a build still running --
        // which under the status dot is a dot that breathes for ever.
        // Only the build nothing has superseded may end the compiling
        // state.
        if (event.build != null && event.build === build) set({ compiling: false });
        break;
      }
      set({
        compiling: false,
        // Deliberately not `stale: false` here.  Staleness is cleared when
        // a build *starts*, because a keystroke made while one was running
        // leaves the preview behind again the moment that build lands --
        // and clearing it here would wipe exactly that keystroke.
        compile: event as CompileResult,
        diagnostics: event.diagnostics ?? [],
        pdfStamp: Date.now(),
      });
      handlers.onCompileDone?.(event as CompileResult);
      break;
    }
    case "files_changed":
      // Someone else changed a file -- the agent, another tab, an editor
      // outside NextTex -- so the preview is behind whatever is on disk.
      setStale();
      // Our own save, coming back around.  The buffer already holds it, and
      // reloading would fight a caret that has moved on since.
      if (event.origin && event.origin === clientId) break;
      handlers.onFilesChanged?.(event.paths ?? [], event.structural !== false);
      break;
    case "conversation_reset":
      // Another tab started a new conversation.  This one is holding a
      // transcript the server has filed away and will not answer for.
      clearChat();
      break;
    case "agent_settings":
      set({ auto: !!event.auto });
      break;
    case "renamed":
      // A move in another tab.  The tree refresh that follows would show the
      // file in its new place while this tab's open tab still pointed at the
      // old one, and the next autosave would write it back there.
      handlers.onRenamed?.(event.from, event.to);
      break;
    case "reveal":
      handlers.onReveal?.(event.path, event.line);
      break;
    case "context_changed":
      if (state.projectId) refreshContext(state.projectId);
      break;
    case "trash_changed":
      if (state.projectId) refreshTrash(state.projectId);
      break;
    case "project_changed":
      // Changing the main document invalidates the preview, and the three
      // switches ride on the same event so that nothing has to re-read the
      // whole project to learn one boolean.
      setStale();
      if (typeof event.autocompile === "boolean") {
        set({
          settings: {
            autocompile: event.autocompile,
            markErrors: event.markErrors,
            markWarnings: event.markWarnings,
          },
        });
      }
      handlers.onProjectChanged?.(event.main);
      break;
    case "turn_start":
      set({ thinking: true });
      break;
    case "text":
      appendText(event.text ?? "");
      break;
    case "text_end":
      endText();
      break;
    case "tool_use":
      endText();
      pushChat({
        kind: "tool",
        id: event.id ?? nextId(),
        name: event.name,
        summary: summariseTool(event.name, event.input),
      });
      break;
    case "permission": {
      endText();
      // A card that arrives already answered -- a rule the writer set
      // earlier, or automatic approval -- is a record, not a question.
      // Marking the composer as waiting for an answer to it would disable
      // it until a card nobody will ever see is resolved.
      const decided = event.decision ?? "";
      if (!decided) set({ awaitingPermission: true });
      pushChat({
        kind: "permission",
        id: event.id,
        tool: event.tool,
        rule: event.rule ?? "",
        headline: event.headline ?? `Use ${event.tool}`,
        detail: event.detail ?? "",
        consequence: event.consequence ?? "",
        decision: decided || undefined,
        at: Date.now(),
      });
      break;
    }
    case "edit": {
      const { added, removed } = countDiff(event.before ?? "", event.after ?? "");
      pushChat({
        kind: "edit",
        // The server assigns this so an undo can be recorded against it.
        id: event.id || nextId(),
        path: event.path,
        before: event.before ?? "",
        after: event.after ?? "",
        added,
        removed,
        state: "live",
      });
      handlers.onAgentEdit?.(event.path, firstChangedLine(event.before ?? "", event.after ?? ""));
      break;
    }
    case "error":
      endText();
      pushChat({
        kind: "notice",
        id: nextId(),
        text: event.message ?? "Something went wrong.",
        tone: "error",
      });
      break;
    case "done":
      endText();
      // Including `awaitingPermission`: interrupting a turn with a card open
      // cancels the pending answer server-side, so the card is gone but
      // nothing was ever going to clear the flag -- and the composer stayed
      // disabled saying it was waiting on an approval that no longer exists.
      set({ thinking: false, awaitingPermission: false });
      break;
  }
}

function summariseTool(name: string, input: any): string {
  if (!input) return name;
  if (name === "Bash") return String(input.command ?? "");
  // The note is the whole point of this one; a path lookup finds nothing
  // and the row would read as a verb with no object.
  if (name === "mcp__nexttex__remember") return String(input.note ?? "");
  const path = input.file_path ?? input.path ?? input.pattern ?? "";
  return String(path);
}

/** Empty the conversation panel.
 *
 *  Not `usage`, which is what this project has cost rather than what was
 *  said, and not the composer draft, which is the writer's own typing. */
export function clearChat(): void {
  set({ chat: [], thinking: false, awaitingPermission: false });
}

export function resolvePermission(id: string, decision: "allow" | "always" | "deny") {
  updateChat(id, { decision } as any);
  const outstanding = state.chat.some(
    (item) => item.kind === "permission" && !item.decision && item.id !== id,
  );
  set({ awaitingPermission: outstanding });
}

export function markReverted(id: string) {
  updateChat(id, { state: "reverted" } as any);
}

export function markLive(id: string) {
  updateChat(id, { state: "live" } as any);
}

export async function refreshHistory(projectId: string, path: string) {
  try {
    set({ history: (await api.history(projectId, path)).versions });
  } catch {
    set({ history: [] });
  }
}

export async function refreshTrash(projectId: string) {
  try {
    set({ trash: (await api.trash(projectId)).entries });
  } catch {
    set({ trash: [] });
  }
}

export async function refreshGit(projectId: string) {
  try {
    set({ git: await api.git(projectId) });
  } catch {
    set({ git: null });
  }
}

export async function refreshContext(projectId: string) {
  try {
    const result = await api.context(projectId);
    set({ contextDocs: result.documents, contextStale: result.stale });
  } catch {
    /* the panel simply stays as it was */
  }
}

export { nextId };
