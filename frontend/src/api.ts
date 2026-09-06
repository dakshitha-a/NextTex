// One place that knows how to talk to the server.  Every call goes through
// `request`, so the token, the error shape and the JSON handling are decided
// once rather than at each call site.

export type Diagnostic = {
  severity: "error" | "warning";
  message: string;
  file: string | null;
  line: number | null;
  endLine?: number | null;
  context?: string;
  package?: string | null;
};

export type CompileResult = {
  outcome: "ok" | "errors" | "cancelled" | "timeout" | "failed";
  scope: string;
  enginePass: "fast" | "full";
  durationMs: number;
  diagnostics: Diagnostic[];
  pdf?: string | null;
};

export type Symbols = {
  labels: { name: string; file: string; line: number }[];
  citations: { key: string; type: string; title: string; author: string; year: string }[];
  images: string[];
  texfiles: string[];
  commands: { name: string; args: number; file: string; definition?: string }[];
  environments: string[];
};

export type Version = {
  at: number;
  sha: string;
  bytes: number;
  by: "you" | "claude";
  why: string;
  op: "edit" | "create" | "delete" | "restore" | "undo";
  label: string | null;
};

export type TrashEntry = {
  id: string;
  at: number;
  by: string;
  path: string;
  name: string;
  kind: "file" | "dir";
  count: number;
  bytes: number;
};

export type SyncPosition = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  /** For files only: how NextTex can show it. */
  kind?: "text" | "image" | "binary";
  size?: number;
  children?: TreeNode[];
};

export type ProjectSummary = {
  id: string | null;
  name: string;
  path: string;
  lastOpened: number;
  missing: boolean;
};

export type ContextDocument = {
  id: string;
  kind: "style" | "voice" | "source";
  filename: string;
  note: string;
  pages: number | null;
  added: number;
};

/** The token arrives in the URL once and the server turns it into an
 *  HttpOnly cookie on that first request.  All this does is take it back out
 *  of the address bar, so the credential is not sitting in the history, in a
 *  bookmark, or in whatever the next screenshot catches. */
export function captureToken(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
}

/** This tab, for the lifetime of the page.
 *
 *  A save is broadcast to every tab watching the project so a second window
 *  cannot sit on a stale buffer and later write it over the first one's
 *  work.  The tab that saved has the text already, so it names itself here
 *  and ignores its own echo. */
export const clientId = `tab-${Math.random().toString(36).slice(2, 10)}`;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.detail || body.error || message;
    } catch {
      /* a non-JSON error body is still an error */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const api = {
  projects: () =>
    request<{ projects: ProjectSummary[]; open: string[] }>("/projects"),
  addProject: (path: string) => request<any>("/projects", json({ path })),
  createProject: (path: string, name: string) =>
    request<any>("/projects/create", json({ path, name })),
  forgetProject: (id: string) =>
    request<any>(`/projects/${id}`, { method: "DELETE" }),
  open: (id: string) =>
    request<any>(`/projects/${id}/open`, { method: "POST" }),
  tree: (id: string) => request<TreeNode>(`/projects/${id}/tree`),

  readFile: (id: string, path: string) =>
    request<{ path: string; text: string; mtime: number; tag: string }>(
      `/projects/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  /** Save one file.
   *
   *  `base` is the tag this tab was given when it last agreed with the file.
   *  The server refuses rather than overwrite when the file has moved on
   *  since, and hands back what is on disk instead. */
  writeFile: (
    id: string,
    path: string,
    text: string,
    compile = true,
    base = "",
    create = false,
  ) =>
    request<{ ok: boolean; tag: string; conflict?: true; text?: string }>(
      `/projects/${id}/file`,
      {
        ...json({ path, text, compile, base, create, origin: clientId }),
        method: "PUT",
      },
    ),
  newFile: (id: string, path: string, directory = false) =>
    request<any>(`/projects/${id}/file/new`, json({ path, directory })),
  renameFile: (id: string, path: string, to: string) =>
    request<any>(`/projects/${id}/file/rename`, json({ path, to })),
  deleteFile: (id: string, path: string) =>
    request<any>(
      `/projects/${id}/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),

  compile: (id: string, full = false) =>
    request<CompileResult>(`/projects/${id}/compile`, json({ full })),
  setFocus: (
    id: string,
    file: string,
    line?: number,
    column?: number,
    selection?: string,
  ) =>
    request<any>(
      `/projects/${id}/editor`,
      json({ file, line, column, selection }),
    ),
  symbols: (id: string) => request<Symbols>(`/projects/${id}/symbols`),

  history: (id: string, path: string) =>
    request<{ path: string; versions: Version[] }>(
      `/projects/${id}/history?path=${encodeURIComponent(path)}`,
    ),
  historyVersion: (id: string, path: string, sha: string) =>
    request<{ text: string }>(
      `/projects/${id}/history/blob?path=${encodeURIComponent(path)}&sha=${sha}`,
    ),
  restoreVersion: (id: string, path: string, sha: string) =>
    request<{ ok: boolean }>(`/projects/${id}/history/restore`, json({ path, sha })),
  labelVersion: (id: string, path: string, sha: string, label: string) =>
    request<{ ok: boolean }>(
      `/projects/${id}/history/label`,
      json({ path, sha, label }),
    ),

  trash: (id: string) =>
    request<{ entries: TrashEntry[] }>(`/projects/${id}/trash`),
  restoreTrash: (id: string, entryId: string) =>
    request<{ ok: boolean; renamed: string; path: string }>(
      `/projects/${id}/trash/${entryId}/restore`,
      { method: "POST" },
    ),
  purgeTrash: (id: string, entryId: string) =>
    request<{ ok: boolean }>(`/projects/${id}/trash/${entryId}`, { method: "DELETE" }),
  emptyTrash: (id: string) =>
    request<{ ok: boolean; removed: number }>(`/projects/${id}/trash`, {
      method: "DELETE",
    }),

  loadTemplate: (id: string, name = "basic") =>
    request<{ ok: boolean; written: string[] }>(
      `/projects/${id}/template`,
      json({ name }),
    ),
  setMain: (id: string, path: string) =>
    request<{ ok: boolean; main: string }>(`/projects/${id}/main`, json({ path })),

  words: (id: string, path: string, scope: "file" | "document") =>
    request<{ words: number | null; scope: string }>(
      `/projects/${id}/words?scope=${scope}&path=${encodeURIComponent(path)}`,
    ),
  lint: (id: string, path: string) =>
    request<{ diagnostics: Diagnostic[] }>(
      `/projects/${id}/lint?path=${encodeURIComponent(path)}`,
    ),
  inverse: (id: string, page: number, x: number, y: number) =>
    request<{ found: boolean; file?: string; line?: number }>(
      `/projects/${id}/synctex/inverse?page=${page}&x=${x}&y=${y}`,
    ),
  forward: (id: string, path: string, line: number) =>
    request<{ positions: SyncPosition[] }>(
      `/projects/${id}/synctex/forward?path=${encodeURIComponent(path)}&line=${line}`,
    ),

  ask: (id: string, prompt: string) =>
    request<any>(`/projects/${id}/agent/ask`, json({ prompt })),
  respond: (id: string, requestId: string, decision: string) =>
    request<any>(
      `/projects/${id}/agent/permission`,
      json({ id: requestId, decision }),
    ),
  interrupt: (id: string) =>
    request<any>(`/projects/${id}/agent/interrupt`, { method: "POST" }),
  undo: (
    id: string,
    path: string,
    before: string,
    after: string,
    editId = "",
    state: "reverted" | "live" = "reverted",
  ) =>
    request<{ ok: boolean; reason?: string }>(
      `/projects/${id}/agent/undo`,
      json({ path, before, after, edit_id: editId, state }),
    ),

  context: (id: string) =>
    request<{ documents: ContextDocument[]; stale: string[] }>(
      `/projects/${id}/context`,
    ),
  removeContext: (id: string, documentId: string) =>
    request<any>(`/projects/${id}/context/${documentId}`, { method: "DELETE" }),
  distill: (id: string, kind: string) =>
    request<any>(`/projects/${id}/context/distill`, json({ kind })),

  usage: (id: string) =>
    request<{
      usage: {
        turns: number;
        costUsd: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        durationMs: number;
      };
      model: string;
      models: { id: string; name: string; note: string }[];
    }>(`/projects/${id}/agent/usage`),
  setModel: (id: string, model: string) =>
    request<{ ok: boolean; model: string }>(
      `/projects/${id}/agent/model`,
      json({ model }),
    ),

  git: (id: string) =>
    request<{
      repository: boolean;
      branch: string;
      ahead: number;
      behind: number;
      remote: string;
      changes: { state: string; path: string }[];
      detail: string;
      gh: boolean;
      ghReason: string;
    }>(`/projects/${id}/git`),
  gitAction: (id: string, action: string, message = "") =>
    request<{ ok: boolean; output?: string }>(
      `/projects/${id}/git/${action}`,
      json({ message }),
    ),
  gitBackup: (
    id: string,
    payload: { name?: string; url?: string; token?: string; private?: boolean },
  ) =>
    request<{ ok: boolean; remote: string }>(
      `/projects/${id}/git/backup/github`,
      json(payload),
    ),

  claudeStatus: () =>
    request<{ loggedIn: boolean; email?: string; plan?: string; method?: string }>(
      "/claude/status",
    ),
  /** `console` picks the API-console flow; false is the Claude.ai one.
   *  The name has to be this: the route reads a `console` boolean, and a
   *  `{mode}` body sent instead was simply ignored, so both buttons ran the
   *  same flow. */
  startLogin: (console: boolean) =>
    request<any>("/claude/login/start", json({ console })),
  loginInput: (text: string) => request<any>("/claude/login/input", json({ text })),
  cancelLogin: () => request<any>("/claude/login/cancel", { method: "POST" }),
  logout: () => request<any>("/claude/logout", { method: "POST" }),

  uploadFiles: async (
    id: string,
    directory: string,
    files: File[],
    /** What to do about each name already taken: replace, keep-both or
     *  skip.  Decided in the browser from the tree it already holds, so an
     *  upload with nothing to ask about costs no extra round trip -- and
     *  sent with the request, because that tree can be stale. */
    policy?: Record<string, string>,
  ) => {
    const form = new FormData();
    form.append("directory", directory);
    if (policy) form.append("policy", JSON.stringify(policy));
    for (const file of files) form.append("files", file);
    const response = await fetch(`/api/projects/${id}/upload`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.status, "upload failed");
    return response.json() as Promise<{
      written: string[];
      results: {
        name: string;
        path: string;
        outcome: "written" | "replaced" | "renamed" | "skipped";
        renamedTo?: string;
      }[];
    }>;
  },
  uploadContext: async (
    id: string,
    kind: string,
    note: string,
    files: File[],
  ) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("note", note);
    for (const file of files) form.append("files", file);
    const response = await fetch(`/api/projects/${id}/context`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.status, "upload failed");
    return response.json();
  },

  downloadUrl: (id: string, options: { path?: string; format?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.path) params.set("path", options.path);
    if (options.format) params.set("format", options.format);
    const query = params.toString();
    return `/api/projects/${id}/download${query ? `?${query}` : ""}`;
  },
  pdfUrl: (id: string, stamp: number) => `/api/projects/${id}/pdf?v=${stamp}`,
};

export default api;

/** Start a download without navigating away from the app. */
/** Hand a blob to the browser as a download.
 *
 *  The anchor has to be in the document and the object URL has to outlive
 *  the click: revoking on the same tick cancels the download in Firefox and
 *  Safari, and an anchor that was never appended does nothing at all in
 *  some of them. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function startDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
