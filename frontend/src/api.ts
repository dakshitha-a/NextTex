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

/** The token arrives in the URL once, then lives in a cookie. */
export function captureToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return;
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
  document.cookie = `nexttex=${token}; path=/; SameSite=Lax; max-age=31536000`;
}

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
  forgetProject: (id: string) =>
    request<any>(`/projects/${id}`, { method: "DELETE" }),
  open: (id: string) =>
    request<any>(`/projects/${id}/open`, { method: "POST" }),
  tree: (id: string) => request<TreeNode>(`/projects/${id}/tree`),

  readFile: (id: string, path: string) =>
    request<{ path: string; text: string; mtime: number }>(
      `/projects/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (id: string, path: string, text: string, compile = true) =>
    request<{ ok: true; mtime: number }>(
      `/projects/${id}/file`,
      { ...json({ path, text, compile }), method: "PUT" },
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
  setFocus: (id: string, file: string, line?: number, column?: number) =>
    request<any>(`/projects/${id}/editor`, json({ file, line, column })),
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
  undo: (id: string, path: string, before: string, after: string) =>
    request<{ ok: boolean; reason?: string }>(
      `/projects/${id}/agent/undo`,
      json({ path, before, after }),
    ),

  context: (id: string) =>
    request<{ documents: ContextDocument[]; stale: string[] }>(
      `/projects/${id}/context`,
    ),
  removeContext: (id: string, documentId: string) =>
    request<any>(`/projects/${id}/context/${documentId}`, { method: "DELETE" }),
  distill: (id: string, kind: string) =>
    request<any>(`/projects/${id}/context/distill`, json({ kind })),

  claudeStatus: () =>
    request<{ loggedIn: boolean; email?: string; plan?: string; method?: string }>(
      "/claude/status",
    ),
  startLogin: (mode: string) => request<any>("/claude/login/start", json({ mode })),
  loginInput: (text: string) => request<any>("/claude/login/input", json({ text })),
  cancelLogin: () => request<any>("/claude/login/cancel", { method: "POST" }),
  logout: () => request<any>("/claude/logout", { method: "POST" }),

  uploadFiles: async (id: string, directory: string, files: File[]) => {
    const form = new FormData();
    form.append("directory", directory);
    for (const file of files) form.append("files", file);
    const response = await fetch(`/api/projects/${id}/upload`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.status, "upload failed");
    return response.json();
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
export function startDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
