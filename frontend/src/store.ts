// A single mutable store with a subscribe/notify pair, read through
// useSyncExternalStore.  A context-and-reducer tree would re-render the
// editor on every streamed token; this keeps the streaming path cheap and
// lets components subscribe to exactly the slice they draw.

import { useSyncExternalStore } from "react";
import api, {
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
      decision?: "allow" | "always" | "deny";
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
  compile: CompileResult | null;
  diagnostics: Diagnostic[];
  lint: Diagnostic[];
  pdfStamp: number;
  chat: ChatItem[];
  thinking: boolean;
  awaitingPermission: boolean;
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
  claude: { loggedIn: boolean; email?: string; plan?: string } | null;
  cursor: { line: number; column: number };
  words: number | null;
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
  compile: null,
  diagnostics: [],
  lint: [],
  pdfStamp: 0,
  chat: [],
  thinking: false,
  awaitingPermission: false,
  git: null,
  contextDocs: [],
  contextStale: [],
  claude: null,
  cursor: { line: 1, column: 1 },
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
  set({ chat, awaitingPermission: false });
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
  state.chat = state.chat.map((item) =>
    item.id === id && item.kind === "claude"
      ? { ...item, text: item.text + chunk }
      : item,
  );
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

function countDiff(before: string, after: string) {
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
export type EventHandlers = {
  onReveal?: (path: string, line: number) => void;
  onProjectChanged?: () => void;
  onFilesChanged?: (paths: string[]) => void;
  onCompileDone?: (result: CompileResult) => void;
  onAgentEdit?: (path: string, line: number) => void;
};
export const handlers: EventHandlers = {};

export function connect(projectId: string) {
  source?.close();
  source = new EventSource(`/api/projects/${projectId}/events`);
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
}

function receive(event: any) {
  switch (event.type) {
    case "compile_start":
      set({ compiling: true });
      break;
    case "compile_done": {
      if (event.outcome === "cancelled") {
        // A superseded build says nothing about the document; leave the
        // diagnostics and the PDF exactly as they were.
        break;
      }
      set({
        compiling: false,
        compile: event as CompileResult,
        diagnostics: event.diagnostics ?? [],
        pdfStamp: Date.now(),
      });
      handlers.onCompileDone?.(event as CompileResult);
      break;
    }
    case "files_changed":
      handlers.onFilesChanged?.(event.paths ?? []);
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
      handlers.onProjectChanged?.();
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
    case "permission":
      endText();
      set({ awaitingPermission: true });
      pushChat({
        kind: "permission",
        id: event.id,
        tool: event.tool,
        rule: event.rule ?? "",
        headline: event.headline ?? `Use ${event.tool}`,
        detail: event.detail ?? "",
        consequence: event.consequence ?? "",
        at: Date.now(),
      });
      break;
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
      set({ thinking: false });
      break;
  }
}

function summariseTool(name: string, input: any): string {
  if (!input) return name;
  if (name === "Bash") return String(input.command ?? "");
  const path = input.file_path ?? input.path ?? input.pattern ?? "";
  return String(path);
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
