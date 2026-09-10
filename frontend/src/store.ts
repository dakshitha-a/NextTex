// A single mutable store with a subscribe/notify pair, read through
// useSyncExternalStore.  A context-and-reducer tree would re-render the
// editor on every streamed token; this keeps the streaming path cheap and
// lets components subscribe to exactly the slice they draw.

import { useSyncExternalStore } from "react";
import type { Heading } from "./outline";
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
      /** Which rule put this card up, when the answer is not simply "this
       *  app asks".  Empty unless auto mode is on and something held the
       *  call back anyway, which is the case that reads as the switch not
       *  working. */
      reason: string;
      at: number;
      decision?: "allow" | "always" | "conversation" | "deny" | "auto";
      /** Consecutive identical records are shown once, with a count. Only
       *  ever set on a card that has been decided: two questions are not
       *  one question. */
      repeats?: number;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      /** Consecutive identical calls are shown once, with a count. */
      repeats?: number;
      /** How long the call took, once it has come back.  Undefined while
       *  it is still running, and after a reload of a turn whose start
       *  this install never saw. */
      ms?: number;
      /** False for a call that failed.  A tool that gave up used to look
       *  exactly like one that was still working. */
      ok?: boolean;
    }
  /** The model's own plan for the turn, replaced in place as it revises it.
   *
   *  Not a transcript entry: it is the turn's progress and it goes when the
   *  turn does.  `TodoWrite` was in the hidden-tools set as plumbing, so
   *  the one thing the agent writes to say what it intends to do next was
   *  arriving on the wire and being thrown away. */
  | {
      kind: "plan";
      id: string;
      items: { text: string; state: "pending" | "active" | "done" }[];
    }
  | { kind: "notice"; id: string; text: string; tone: "error" | "plain" };

/** An open file.
 *
 *  There is no `dirty` here any more.  It meant "typed but not yet written",
 *  which was a real state while a save was a debounced HTTP request; a
 *  keystroke now goes into the shared document as it is made, so the flag
 *  was false at every moment anyone could have looked at it, and the dot it
 *  drew could never appear. */
export type Tab = { path: string };

/** What is true of one previewed document while it builds. */
export type DocBuild = {
  compiling: boolean;
  stale: boolean;
  result: CompileResult | null;
  pdfStamp: number;
};

const NO_BUILD: DocBuild = {
  compiling: false, stale: false, result: null, pdfStamp: 0,
};

/** One other person in this project.  Mirrors `Presence` in collab.ts,
 *  declared here so the store does not drag Yjs into the entry bundle just
 *  to name a type. */
export type Collaborator = {
  clientId: number;
  name: string;
  colour: string;
  path: string;
  line: number;
  active: boolean;
};

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
  pendingOpen: {
    path: string;
    line?: number;
    /** From a double-click on the typeset page: the word that was under
     *  the pointer, used to place the cursor exactly. */
    word?: string;
    /** False when the agent is saying where it is about to write, rather
     *  than the writer asking to be taken somewhere. The pane scrolls and
     *  the range flashes; the caret stays where they put it. */
    steal?: boolean;
    nonce: number;
  } | null;
  /** What is highlighted in the editor right now. Read when a question is
   *  sent, so the agent is told what "this paragraph" means without having
   *  to ask -- and kept here rather than in the editor because the composer
   *  is in a different pane. Null when nothing is selected. */
  selected: {
    path: string;
    text: string;
    fromLine: number;
    toLine: number;
  } | null;
  // Set while the editor is showing an old version of a file, read-only.
  viewing: { path: string; sha: string; version: Version } | null;
  history: Version[];
  trash: TrashEntry[];
  /** Which documents are previewed, in tab order, main first. */
  previews: string[];
  /** The tab in front.  It builds first and waits the shorter debounce. */
  activePreview: string;
  /** Documents that could be previewed and are not yet. */
  candidates: string[];
  /** Which documents read a given file, so a keystroke can mark the right
   *  previews stale without waiting for the server to say so. */
  owners: Record<string, string[]>;
  /** Per document build state.  Replaced wholesale rather than mutated, so
   *  a component selecting one document's entry is not re-rendered when
   *  another document builds. */
  builds: Record<string, DocBuild>;
  /** Diagnostics kept per document and merged into `diagnostics`.  Keeping
   *  one list would have each build erase the other document's errors twice
   *  per debounce. */
  diagnosticsByDoc: Record<string, Diagnostic[]>;
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
  /** What the agent is doing at this moment, and since when.
   *
   *  Set from the events rather than guessed at: the panel used to walk the
   *  whole transcript backwards on every render to work this out, which is
   *  twenty walks a second while an answer streams, and it could not tell a
   *  finished call from a running one because nothing said a call had
   *  finished.  `since` is a browser clock and is only ever used to
   *  subtract, so a difference between the two machines does not matter. */
  activity: {
    kind: "tool" | "thinking" | "writing";
    /** The tool call this belongs to, so its completion can clear it. */
    id: string;
    name: string;
    label: string;
    since: number;
  } | null;
  awaitingPermission: boolean;
  /** Where the permission control is, of its three positions.
   *
   *  `ask` cards every shell call, every network call and every write that
   *  leaves the writing, and is the only complete fence. `project` runs the
   *  work silently, including the piped and chained commands that used to
   *  card, and still asks about what the fence can see leaving the writing
   *  or leaving the machine. `all` asks about nothing. */
  mode: "ask" | "project" | "all";
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
  /** A folder-read in flight, or the one that just finished. */
  library: import("./api").LibraryProgress | null;
  /** Set only on an install started with `--instance`: a second NextTex
   *  on the same machine, which has to be tellable from the first. */
  instance: string;
  /** Which agent this instance uses, and whether it is ready.  Named
   *  `agent` rather than `claude` since there are three answers now, one
   *  of which is that there is deliberately no agent at all. */
  agent: {
    provider: "claude" | "openai" | "none";
    ready: boolean;
    model?: string;
    keyTail?: string;
    email?: string;
    plan?: string;
  } | null;
  cursor: { line: number; column: number };
  /** The section list of whatever the editor is showing, parsed from the
   *  buffer on the same debounce as the save.  Empty with no file open. */
  outline: Heading[];
  words: number | null;
  /** Who else is in this project, and where they are looking. */
  collaborators: Collaborator[];
  /** Whether this browser is joined to the shared documents. */
  connection: "live" | "connecting" | "offline";
  /** This install's peer id, so a version can tell whose it is. Empty until
   *  a project has been shared, which is when it starts mattering. */
  peerId: string;
  error: string | null;
  notices: Notice[];
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
  selected: null,
  viewing: null,
  history: [],
  trash: [],
  previews: [],
  activePreview: "",
  candidates: [],
  owners: {},
  builds: {},
  diagnosticsByDoc: {},
  compiling: false,
  stale: false,
  compile: null,
  diagnostics: [],
  lint: [],
  pdfStamp: 0,
  chat: [],
  thinking: false,
  activity: null,
  awaitingPermission: false,
  mode: "ask",
  git: null,
  instance: "",
  contextDocs: [],
  contextStale: [],
  settings: { autocompile: true, markErrors: true, markWarnings: false },
  agent: null,
  library: null,
  cursor: { line: 1, column: 1 },
  outline: [],
  collaborators: [],
  connection: "connecting",
  peerId: "",
  words: null,
  error: null,
  notices: [],
};

const listeners = new Set<() => void>();
let snapshot: State = { ...state };

function commit() {
  snapshot = { ...state };
  for (const listener of listeners) listener();
}

/** One thing that went wrong, with an identity of its own. */
export type Notice = { id: number; text: string };

let noticeCounter = 0;

export function set(patch: Partial<State>) {
  // `error` is a single string and thirty call sites write to it, so a
  // second failure used to erase the first without a word: two uploads
  // refused, one message. Keeping the write API and turning it into a queue
  // here is what lets all thirty stay as they are.
  if (typeof patch.error === "string" && patch.error && patch.notices === undefined) {
    noticeCounter += 1;
    const notice = { id: noticeCounter, text: patch.error };
    // The same message twice in a row is one event to a reader, not two.
    const already = state.notices[state.notices.length - 1];
    if (!already || already.text !== notice.text) {
      patch = { ...patch, notices: [...state.notices, notice] };
    }
  } else if (patch.error === null && patch.notices === undefined) {
    patch = { ...patch, notices: [] };
  }
  Object.assign(state, patch);
  commit();
}

/** Take one notice off the stack, leaving the others. */
export function dismissNotice(id: number) {
  const left = state.notices.filter((notice) => notice.id !== id);
  set({ notices: left, error: left.length ? state.error : null });
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
        ms: typeof item.ms === "number" ? item.ms : undefined,
        ok: item.ok !== false,
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
        detail: item.detail ?? "", consequence: item.consequence ?? "",
        reason: item.reason ?? "", at,
        decision: item.decision,
      });
    } else if (item.kind === "notice") {
      // The tone travels now.  Every notice written before the transcript
      // recorded one came from an `error` event, so an absent tone is red.
      chat.push({
        kind: "notice", id: nextId(), text: item.text ?? "",
        tone: item.tone === "plain" ? "plain" : "error",
      });
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

/** The most recent build the server has told us about, per document.  A
 *  cancelled build's result arrives after its replacement has already
 *  started, so the id is what tells a result about the current build from a
 *  result about one that has been superseded.
 *
 *  Per document, because a shared counter would let a build of the
 *  supplementary information invalidate the main document's pending result,
 *  and main's status dot would breathe for ever. */
const builds = new Map<string, number>();

/** Copy the visible document's build state onto the top-level fields.
 *
 *  Those fields are read by the status strip, the diagnostics drawer, the
 *  file view and the history panel, none of which has any business knowing
 *  a project can have several documents. One writer keeps them honest, and
 *  it is the reason none of those four files had to change. */
function syncVisible(patch: Partial<State> = {}) {
  const showing = (patch.activePreview ?? state.activePreview) || "";
  const source = { ...state.builds, ...(patch.builds ?? {}) };
  const current = source[showing] ?? NO_BUILD;
  const byDoc = { ...state.diagnosticsByDoc, ...(patch.diagnosticsByDoc ?? {}) };
  // Flattened here rather than in a selector: `useStore` compares what the
  // selector returns by identity, and one that built a fresh array every
  // call would re-render for ever.
  const merged: Diagnostic[] = [];
  for (const name of patch.previews ?? state.previews) {
    for (const item of byDoc[name] ?? []) merged.push(item);
  }
  set({
    ...patch,
    compiling: current.compiling,
    stale: current.stale,
    compile: current.result,
    pdfStamp: current.pdfStamp,
    diagnostics: merged,
  });
}

/** The preview is behind the source.  Called from the editor on every
 *  document change as well as from the event stream, because the writer
 *  sees their own keystroke long before the server hears about it.
 *
 *  Routed by path.  Without that, editing the supplementary information
 *  would mark the main document stale, no build of main would ever be
 *  scheduled, and nothing would arrive to clear it -- a preview stuck
 *  behind for the rest of the session. When the path is unknown, mark
 *  nothing and let the server's `compile_scheduled` say so a moment later:
 *  late is better than stuck. */
export function markStale(path?: string) {
  const targets = path ? state.owners[path] : undefined;
  const names = targets && targets.length ? targets : [];
  if (!names.length) return;
  const next: Record<string, DocBuild> = { ...state.builds };
  let changed = false;
  for (const name of names) {
    const current = next[name] ?? NO_BUILD;
    if (current.stale) continue;
    next[name] = { ...current, stale: true };
    changed = true;
  }
  if (changed) syncVisible({ builds: next });
}

function setStale() {
  const next: Record<string, DocBuild> = { ...state.builds };
  for (const name of state.previews) {
    next[name] = { ...(next[name] ?? NO_BUILD), stale: true };
  }
  syncVisible({ builds: next });
}

export type EventHandlers = {
  onReveal?: (path: string, line: number) => void;
  onProjectChanged?: (main?: string) => void;
  onFilesChanged?: (paths: string[], structural?: boolean) => void;
  onCompileDone?: (result: CompileResult) => void;
  onPreviewsChanged?: (previews: string[]) => void;
  onAgentEdit?: (path: string, line: number) => void | Promise<void>;
  onAgentFocus?: (path: string, line: number) => void;
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

export async function reconcile() {
  const id = state.projectId;
  if (!id) return;
  let report: Awaited<ReturnType<typeof api.usage>>;
  try {
    report = await api.usage(id);
  } catch {
    return; // the server is unreachable; saying so is the stream's job
  }
  if (state.projectId !== id) return; // they moved on while we asked

  // A card outlives the page that showed it.  `replayTranscript` marks an
  // unanswered card as denied, on the reasoning that the turn waiting for it
  // is gone -- which is right after a crash and wrong after a reload, where
  // the turn is still there and still waiting.  So the ones the server says
  // are open come back, answerable, matched by the id the transcript already
  // carries so a revived card replaces its own record rather than sitting
  // beside it.
  const open = report.pending ?? [];
  if (open.length) {
    const known = new Set(state.chat.map((item) => item.id));
    const chat = state.chat.map((item) =>
      item.kind === "permission" && open.some((card) => card.id === item.id)
        ? { ...item, decision: undefined }
        : item,
    );
    for (const card of open) {
      if (known.has(card.id)) continue;
      chat.push({
        kind: "permission",
        id: card.id,
        tool: card.tool,
        rule: card.rule ?? "",
        headline: card.headline ?? `Use ${card.tool}`,
        detail: card.detail ?? "",
        consequence: card.consequence ?? "",
        reason: card.reason ?? "",
        at: Date.now(),
      });
    }
    set({ chat, awaitingPermission: true, thinking: true });
    return;
  }

  if (report.busy || !state.thinking) return;
  endText();
  pushChat({
    kind: "notice",
    id: nextId(),
    text: "That answer was interrupted, and NextTex did not hear how it ended.",
    tone: "error",
  });
  set({ thinking: false, awaitingPermission: false, activity: null });
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

/** The event reducer, exposed for tests.  Driving it directly is the only
 *  way to check the multi-document merge without a server and an SSE
 *  connection in the middle of it. */
export function __receive(event: any) {
  receive(event);
}

function receive(event: any) {
  switch (event.type) {
    case "library_scan":
      set({ library: event as any });
      break;
    case "previews_changed":
      syncVisible({
        previews: event.previews ?? state.previews,
        candidates: event.candidates ?? [],
        owners: event.owners ?? {},
        activePreview: (event.previews ?? []).includes(state.activePreview)
          ? state.activePreview
          : event.main ?? state.activePreview,
      });
      handlers.onPreviewsChanged?.(event.previews ?? []);
      break;
    case "compile_scheduled": {
      // A build is coming but has not started, so those previews are
      // already behind what is on screen.  With autocompile off no build is
      // coming at all and this is where the document rests.
      const named: string[] = event.documents ?? [];
      const next = { ...state.builds };
      for (const name of named.length ? named : state.previews) {
        next[name] = { ...(next[name] ?? NO_BUILD), stale: true };
      }
      syncVisible({ builds: next });
      break;
    }
    case "compile_start": {
      // Cleared here rather than when the build finishes: a keystroke made
      // *during* a build leaves the preview behind again the moment the
      // build lands, and clearing at the end would wipe that.
      const name = event.document ?? state.activePreview;
      if (event.build != null) builds.set(name, event.build);
      syncVisible({
        builds: {
          ...state.builds,
          [name]: { ...(state.builds[name] ?? NO_BUILD), compiling: true, stale: false },
        },
      });
      break;
    }
    case "compile_done": {
      const name = event.document ?? state.activePreview;
      const current = state.builds[name] ?? NO_BUILD;
      if (event.outcome === "cancelled") {
        // A superseded build says nothing about the document; leave the
        // diagnostics and the PDF exactly as they were.  Its result also
        // arrives *after* its replacement has started, so clearing
        // `compiling` here would clear it for a build still running --
        // which under the status dot is a dot that breathes for ever.
        // Only the build nothing has superseded may end the compiling
        // state.
        if (event.build != null && event.build === builds.get(name)) {
          syncVisible({
            builds: { ...state.builds, [name]: { ...current, compiling: false } },
          });
        }
        break;
      }
      syncVisible({
        builds: {
          ...state.builds,
          [name]: {
            ...current,
            compiling: false,
            // Deliberately not `stale: false` here.  Staleness is cleared
            // when a build *starts*, because a keystroke made while one was
            // running leaves the preview behind again the moment that build
            // lands -- and clearing it here would wipe exactly that
            // keystroke.
            result: event as CompileResult,
            pdfStamp: Date.now(),
          },
        },
        // Replaced for this document only.  One shared list meant each
        // build wiped the other document's errors.
        diagnosticsByDoc: {
          ...state.diagnosticsByDoc,
          [name]: event.diagnostics ?? [],
        },
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
      // `mode` where a current server sends one, and the old boolean where
      // it does not, so a browser talking to an install that has not been
      // updated still shows something true.
      set({
        mode:
          event.mode === "project" || event.mode === "all" || event.mode === "ask"
            ? event.mode
            : event.auto
              ? "project"
              : "ask",
      });
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
    // Where the agent is *about* to write, emitted the moment the fence
    // approves the call rather than after the edit has landed. The editor
    // already followed an edit once it existed; this is the half that makes
    // it feel like watching somebody work rather than reading a report.
    case "focus":
      handlers.onAgentFocus?.(event.path, event.line);
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
      // A new turn has no plan and no activity yet.  The plan is the
      // turn's own, so it does not survive into the next one.
      set({
        thinking: true,
        activity: null,
        chat: state.chat.filter((item) => item.kind !== "plan"),
      });
      break;
    case "text":
      if (!state.activity || state.activity.kind !== "writing") {
        set({
          activity: {
            kind: "writing", id: "", name: "", label: "Writing",
            since: Date.now(),
          },
        });
      }
      appendText(event.text ?? "");
      break;
    case "text_end":
      endText();
      if (state.activity?.kind === "writing") set({ activity: null });
      break;
    // The model's own plan for the turn.  Handled here rather than being
    // pushed as a tool row, and replaced in place rather than appended, so
    // a turn that revises its list four times shows one list and not four.
    case "tool_use":
      endText();
      if (event.name === "TodoWrite") {
        setPlan(event.input);
        break;
      }
      pushChat({
        kind: "tool",
        id: event.id ?? nextId(),
        name: event.name,
        summary: summariseTool(event.name, event.input),
      });
      set({
        activity: {
          kind: "tool",
          id: event.id ?? "",
          name: event.name ?? "",
          label: summariseTool(event.name, event.input),
          since: Date.now(),
        },
      });
      break;
    case "tool_done": {
      // Matched on the id, and on the name when the id does not line up.
      // The id here is the CLI's and the row's is the assistant message's;
      // they are believed to be the same and a mismatch must cost a
      // duration rather than an activity line that never clears.
      if (event.id && event.ms != null) {
        const target = state.chat.find(
          (item) => item.kind === "tool" && item.id === event.id,
        );
        if (target) {
          updateChat(event.id, { ms: event.ms, ok: event.ok !== false } as any);
        }
      }
      const running = state.activity;
      if (
        running &&
        running.kind === "tool" &&
        (running.id === event.id || running.name === event.name)
      ) {
        set({ activity: null });
      }
      break;
    }
    // The fact of it, never the text.  The panel is 380px wide beside a
    // manuscript, and a column of reasoning would bury the answer and the
    // edits under something nobody reads twice.
    case "thinking":
      set({
        activity: {
          kind: "thinking", id: "", name: "", label: "Thinking",
          since: Date.now(),
        },
      });
      break;
    case "thinking_end":
      if (state.activity?.kind === "thinking") set({ activity: null });
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
        reason: event.reason ?? "",
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
    // News rather than a failure, and it reached nothing at all before
    // this.  The agent emits one when a permission card has gone ten
    // minutes without an answer and it has said no on the writer's behalf,
    // which is precisely the moment they need telling: the card is gone,
    // the turn moved on, and nothing said why.
    case "notice":
      endText();
      pushChat({
        kind: "notice",
        id: nextId(),
        text: event.message ?? "",
        tone: "plain",
      });
      break;
    case "done":
      endText();
      // Including `awaitingPermission`: interrupting a turn with a card open
      // cancels the pending answer server-side, so the card is gone but
      // nothing was ever going to clear the flag -- and the composer stayed
      // disabled saying it was waiting on an approval that no longer exists.
      set({ thinking: false, awaitingPermission: false, activity: null });
      break;
  }
}

/** The model's plan for this turn, from a `TodoWrite` call's arguments.
 *
 *  The shape is the CLI's: a list of items each with a content string and a
 *  status.  Anything unrecognised is dropped rather than rendered as a
 *  blank row, because a plan with an empty line in it reads as a bug in the
 *  panel rather than as a model that phrased something oddly. */
function setPlan(input: any): void {
  const raw = Array.isArray(input?.todos) ? input.todos : [];
  const items = raw
    .map((entry: any) => ({
      text: String(entry?.content ?? entry?.activeForm ?? "").trim(),
      state:
        entry?.status === "completed"
          ? ("done" as const)
          : entry?.status === "in_progress"
            ? ("active" as const)
            : ("pending" as const),
    }))
    .filter((entry: { text: string }) => entry.text);
  if (!items.length) return;
  const existing = state.chat.find((item) => item.kind === "plan");
  if (existing) {
    updateChat(existing.id, { items } as any);
    return;
  }
  pushChat({ kind: "plan", id: nextId(), items });
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
  set({ chat: [], thinking: false, awaitingPermission: false, activity: null });
}

export function resolvePermission(
  id: string,
  decision: "allow" | "always" | "conversation" | "deny",
) {
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
