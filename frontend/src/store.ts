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
  type TreeNode,
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
  | { kind: "tool"; id: string; name: string; summary: string }
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
  compiling: boolean;
  compile: CompileResult | null;
  diagnostics: Diagnostic[];
  lint: Diagnostic[];
  pdfStamp: number;
  chat: ChatItem[];
  thinking: boolean;
  awaitingPermission: boolean;
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
  compiling: false,
  compile: null,
  diagnostics: [],
  lint: [],
  pdfStamp: 0,
  chat: [],
  thinking: false,
  awaitingPermission: false,
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
  onFilesChanged?: (paths: string[]) => void;
  onCompileDone?: (result: CompileResult) => void;
  onAgentEdit?: (path: string) => void;
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
    case "context_changed":
      if (state.projectId) refreshContext(state.projectId);
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
        id: nextId(),
        path: event.path,
        before: event.before ?? "",
        after: event.after ?? "",
        added,
        removed,
        state: "live",
      });
      handlers.onAgentEdit?.(event.path);
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

export async function refreshContext(projectId: string) {
  try {
    const result = await api.context(projectId);
    set({ contextDocs: result.documents, contextStale: result.stale });
  } catch {
    /* the panel simply stays as it was */
  }
}

export { nextId };
