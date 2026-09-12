// One place that knows how to talk to the server.  Every call goes through
// `request`, so the token, the error shape and the JSON handling are decided
// once rather than at each call site.

/** What one LaTeX message means, from the server's own rule table.  No
 *  model is involved: NextTex is a LaTeX editor before it is an AI tool,
 *  and somebody running it with no agent still gets told what went wrong. */
export type Explanation = {
  title: string;
  detail: string;
  fix: string;
};

export type Diagnostic = {
  severity: "error" | "warning";
  message: string;
  file: string | null;
  line: number | null;
  /** 1-based, where the tool that found it knew.  chktex usually does; the
   *  LaTeX log never does.  It is what lets a mark point at the token that
   *  is wrong instead of underlining the whole line. */
  column?: number | null;
  endLine?: number | null;
  context?: string;
  package?: string | null;
  explain?: Explanation;
};

/** Where to start reading, and why the rest can wait: TeX reports
 *  everything after a mistake as a mistake too. */
export type BuildSummary = Explanation & {
  headline: string;
  message: string;
  file: string | null;
  line: number | null;
  others: number;
  note: string;
};

export type CompileResult = {
  outcome: "ok" | "errors" | "cancelled" | "timeout" | "failed";
  scope: string;
  enginePass: "fast" | "full";
  durationMs: number;
  diagnostics: Diagnostic[];
  summary?: BuildSummary | null;
  pdf?: string | null;
};

/** A folder-read in flight, as it reports itself on the event stream. */
export type LibraryProgress = {
  phase: "walking" | "reading" | "done" | "stopped" | "failed";
  done: number;
  total: number;
  name: string;
  added: number;
  duplicate: number;
  unidentified: number;
  message: string;
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
  /** The role: the person, or their agent. Now relative to `peer`. */
  by: "you" | "claude";
  why: string;
  op: "edit" | "create" | "delete" | "restore" | "undo" | "replace" | "import";
  label: string | null;
  /** Which install wrote it. Empty means this one, which is what every
   *  version made before a project was shared says. */
  peer?: string;
  /** The name that peer went by at the time. */
  who?: string;
  /** Whether this version's contents are on this machine.
   *
   *  A collaborator's version arrives as a line and its contents come when
   *  somebody asks for them, so a version can be listed and not openable.
   *  If its author has since thinned that record away and swept the
   *  contents, it never will be, and the panel should say so rather than
   *  offer a restore that cannot work. */
  here?: boolean;
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

export type Instance = {
  instance: string;
  /** The commit this process loaded, read once when it started. */
  head: string;
  /** The commit the files say now. An update moves this and leaves `head`
   *  where it was, and the two disagreeing is the whole reason both are
   *  here: it means the install has been updated and not restarted. */
  diskHead: string;
  boot: string;
  supervised: boolean;
  root: string;
};

/** What updating this install would do.  `changing` counts only the
 *  commits that reach the running program: most commits to a project like
 *  this one are documentation, and saying "three new commits" about three
 *  README edits is a nag rather than a service. */
export type UpdateReport = {
  checkout: boolean;
  /** Whether the fetch behind every number below actually happened. A
   *  count cannot say "I could not ask", and `behind` was left at zero when
   *  it failed. */
  checked: boolean;
  head: string;
  behind: number;
  changing: number;
  commits: { sha: string; subject: string; touches: "app" | "interface" | "neither" }[];
  dirty: string[];
  rebuild: boolean;
  build_ok: boolean;
  build_reason: string;
  can_update: boolean;
  reason: string;
  restart: "auto" | "manual";
  error: string;
  updating: boolean;
  phase: string;
};

/** What can be previewed in a project, and which document reads what. */
export type DocumentsPayload = {
  previews: string[];
  candidates: string[];
  owners: Record<string, string[]>;
  main: string;
};

export type ProjectSummary = {
  /** Always present.  A registry entry is a path, and it has an identity
   *  whether or not anything is still at the end of it -- `missing` is what
   *  says whether the folder is there, and the two are separate questions. */
  id: string;
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

/** One signed-in browser, as the access card lists them.  `id` is a short
 *  prefix of the session's fingerprint: enough to tell two rows apart and
 *  useless as a credential. */
export type BrowserSession = {
  id: string;
  created: number;
  lastSeen: number;
  label: string;
  current: boolean;
};

/** One install this project is shared with. */
export type Member = {
  peer: string;
  name: string;
  connected: boolean;
  removed: boolean;
};

/** One file the other end has offered, before any of it is written. */
export type OfferedFile = {
  path: string;
  kind: string;
  size: number;
  /** Offered and will not be written: a file the build would run. Shown
   *  rather than omitted, because what was offered is the more interesting
   *  fact of the two. */
  refused: boolean;
};

export type JoinOffer = {
  ok: true;
  token: string;
  path: string;
  files: OfferedFile[];
};

export type CollabState = {
  shared: boolean;
  shareId: string;
  me: string;
  address: string;
  /** False where iroh publishes no wheel -- an Intel Mac, today. */
  available: boolean;
  /** Whether this install is in the share it is holding the record of.
   *  False on a machine the project folder was copied to: the share record
   *  travels inside the project and the identity does not. */
  member: boolean;
  members: Member[];
  error: string;
};

export type AuthState = {
  hasPassword: boolean;
  displayName: string;
  sessions: BrowserSession[];
};

/**
 * What became of one file in an upload.
 *
 * This listed four outcomes and the server had been answering with six.
 * `refused` arrived with the rule against uploading a file the build would
 * run, and `too-big` with the size limits, and both were dropped on the
 * floor: the writer dropped five files, four appeared, and nothing anywhere
 * said what happened to the fifth.
 */
export type UploadOutcome =
  | "written"
  | "replaced"
  | "renamed"
  | "skipped"
  | "refused"
  | "too-big";

export type UploadResult = {
  name: string;
  path: string;
  outcome: UploadOutcome;
  renamedTo?: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Where a failure on the first load should send the writer.
 *
 * Only the two statuses that mean "we do not know who you are" lead to the
 * sign-in screen.  A 500 means the server is broken, and asking somebody for
 * a password because a machine has a bug is a question they cannot answer:
 * the same mistake as sending them there when the server was not listening,
 * one level further in.  A failure carrying no status never reached the
 * server at all.
 */
export function landingAfter(problem: unknown): "signin" | "offline" {
  const status = (problem as { status?: number } | null | undefined)?.status;
  return status === 401 || status === 403 ? "signin" : "offline";
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
  /** Who this server is.  Answered while it is shutting down, and its
   *  `boot` nonce changes when the process does -- which is how a page
   *  waiting out a restart knows the wait is over. */
  instance: () => request<Instance>("/instance"),
  updateCheck: (force = false) =>
    request<UpdateReport>(`/update${force ? "?force=true" : ""}`),
  startUpdate: () => request<{ started: boolean }>("/update", json({})),
  /** Leave, so the supervisor starts a new process on the commit the
   *  files hold.  Refused with 409 where nothing would bring NextTex
   *  back, which is why the footer only offers it when `supervised`. */
  restart: () => request<{ restarting: boolean }>("/update/restart", json({})),
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
  /** Save one file, whole.
   *
   *  Not how the editor writes any more -- a keystroke goes into the shared
   *  document and the server projects that onto disk.  This is for
   *  everything else: an upload, a template, a script. */
  writeFile: (
    id: string,
    path: string,
    text: string,
    compile = true,
    base = "",
    create = false,
  ) =>
    request<{ ok: boolean; tag: string }>(
      `/projects/${id}/file`,
      {
        ...json({ path, text, compile, base, create, origin: clientId }),
        method: "PUT",
      },
    ),
  /** Whether this project is shared with other installs, and with whom. */
  collab: (id: string) => request<CollabState>(`/projects/${id}/collab`),
  startSharing: (id: string, name = "") =>
    request<CollabState>(`/projects/${id}/collab/share`, json({ name })),
  makeInvite: (id: string) =>
    request<{ invite: string }>(`/projects/${id}/collab/invite`, json({})),
  /** Accept an invite as far as *looking* at it. Nothing is written to
   *  disk: the documents are held open on the server until the answer. */
  joinShare: (invite: string, path: string) =>
    request<JoinOffer>("/collab/join", json({ invite, path })),
  acceptJoin: (token: string) =>
    request<{ ok: true; project: { id: string; path: string } }>(
      "/collab/join/accept", json({ token }),
    ),
  discardJoin: (token: string) =>
    request<{ ok: true }>("/collab/join/discard", json({ token })),
  removeMember: (id: string, peer: string) =>
    request<CollabState>(`/projects/${id}/collab/member/${peer}`, {
      method: "DELETE",
    }),

  /** Write the shared documents out now rather than on their debounce.
   *
   *  What replaced the closing-tab beacon.  A tab closing has nothing left
   *  to rescue -- the server has had every keystroke as it was made -- but
   *  a manual build still wants the file on disk to be current. */
  flushDocuments: (id: string) =>
    request<{ ok: true }>(`/projects/${id}/flush`, { method: "POST" }),
  newFile: (id: string, path: string, directory = false) =>
    request<any>(`/projects/${id}/file/new`, json({ path, directory })),
  renameFile: (id: string, path: string, to: string) =>
    request<any>(`/projects/${id}/file/rename`, json({ path, to })),
  /** Copy a file beside itself.  The server picks the name and says what it
   *  chose, because the rule for it lives there and a second implementation
   *  here would be free to drift from it. */
  duplicateFile: (id: string, path: string) =>
    request<{ ok: true; path: string }>(
      `/projects/${id}/file/duplicate`, json({ path }),
    ),
  deleteFile: (id: string, path: string) =>
    request<any>(
      `/projects/${id}/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),

  compile: (id: string, full = false, document = "") =>
    request<CompileResult>(`/projects/${id}/compile`, json({ full, document })),
  /** Which documents are previewed, which could be, and who reads what. */
  documents: (id: string) =>
    request<DocumentsPayload>(`/projects/${id}/documents`),
  addPreview: (id: string, path: string) =>
    request<DocumentsPayload>(`/projects/${id}/previews`, json({ path })),
  removePreview: (id: string, path: string) =>
    request<DocumentsPayload>(
      `/projects/${id}/previews?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  setFocus: (
    id: string,
    file: string,
    line?: number,
    column?: number,
    selection?: string,
    /** Which preview tab is in front.  It builds first and waits the
     *  shorter debounce, so the server has to be told when it changes. */
    preview?: string,
  ) =>
    request<any>(
      `/projects/${id}/editor`,
      json({ file, line, column, selection, preview }),
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
  /** Throw away every stored version of one file.  The file is untouched;
   *  what comes back says how many versions went and roughly how much disk
   *  the collector will release.  "Roughly", because a blob written in the
   *  last hour is inside the collector's grace window and goes on the next
   *  pass -- which is why the interface says "within the hour". */
  purgeHistory: (id: string, path: string) =>
    request<{ ok: boolean; removed: number; freed: number }>(
      `/projects/${id}/history?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  historySize: (id: string) =>
    request<{ bytes: number }>(`/projects/${id}/history/size`),
  /** Every file's versions, newest first. The per-file list answers "what
   *  did this file used to say"; this answers "what did I change this
   *  afternoon", which was previously a question you could only ask by
   *  opening every file in turn. */
  timeline: (id: string, limit = 80) =>
    request<{ versions: (Version & { path: string })[] }>(
      `/projects/${id}/history/timeline?limit=${limit}`,
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

  /** What a blank project can be filled with. The route has always been
   *  here and nothing fetched it, so every new project was an article. */
  templates: () => request<{ templates: string[] }>("/templates"),
  /** One reference from a DOI, with no paper behind it. The resolve route
   *  needs an unidentified PDF from a folder scan to hang the DOI on. */
  addByDoi: (id: string, doi: string) =>
    request<{
      added: boolean;
      reason?: string;
      key?: string;
      title?: string;
      author?: string;
      year?: string;
    }>(`/projects/${id}/library/add`, json({ doi })),
  /** Every entry against the record it claims to come from. Reports; it
   *  writes nothing. */
  verifyLibrary: (id: string) =>
    request<{
      checked: number;
      problems: { key: string; issues: string[] }[];
      report: string;
    }>(`/projects/${id}/library/verify`, json({})),
  loadTemplate: (id: string, name = "basic") =>
    request<{ ok: boolean; written: string[] }>(
      `/projects/${id}/template`,
      json({ name }),
    ),
  setMain: (id: string, path: string) =>
    request<{ ok: boolean; main: string }>(`/projects/${id}/main`, json({ path })),

  /** One or more of the three per-project switches. */
  setProjectSettings: (
    id: string,
    patch: Partial<{
      autocompile: boolean;
      markErrors: boolean;
      markWarnings: boolean;
    }>,
  ) =>
    request<{
      main: string;
      autocompile: boolean;
      markErrors: boolean;
      markWarnings: boolean;
    }>(`/projects/${id}/settings`, json(patch)),

  words: (id: string, path: string, scope: "file" | "document") =>
    request<{ words: number | null; scope: string }>(
      `/projects/${id}/words?scope=${scope}&path=${encodeURIComponent(path)}`,
    ),
  // The writer's own spellings, per project: the vocabulary of one
  // document says nothing about the next.
  /** Say where a project's folder went.  The project keeps its place in
   *  the list, but not its id: a project is identified by where it is. */
  relocateProject: (id: string, path: string) =>
    request<ProjectSummary & { id: string }>(
      `/projects/${id}/relocate`,
      json({ path }),
    ),
  dictionary: (id: string) =>
    request<{ words: string[] }>(`/projects/${id}/dictionary`),
  addWord: (id: string, word: string) =>
    request<{ words: string[] }>(`/projects/${id}/dictionary`, json({ word })),
  forgetWord: (id: string, word: string) =>
    request<{ words: string[] }>(
      `/projects/${id}/dictionary?word=${encodeURIComponent(word)}`,
      { method: "DELETE" },
    ),
  lint: (id: string, path: string) =>
    request<{ diagnostics: Diagnostic[] }>(
      `/projects/${id}/lint?path=${encodeURIComponent(path)}`,
    ),
  inverse: (id: string, page: number, x: number, y: number, document = "") =>
    request<{ found: boolean; file?: string; line?: number }>(
      `/projects/${id}/synctex/inverse?page=${page}&x=${x}&y=${y}` +
        `&document=${encodeURIComponent(document)}`,
    ),
  forward: (id: string, path: string, line: number, document = "") =>
    request<{ positions: SyncPosition[] }>(
      `/projects/${id}/synctex/forward?path=${encodeURIComponent(path)}` +
        `&line=${line}&document=${encodeURIComponent(document)}`,
    ),

  /** One image the writer pasted, dropped or picked.
   *
   *  Not through `json()`: this is multipart, like the upload path, because
   *  base64 in a JSON body would be a third larger for no reason. */
  attach: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ path: string; name: string; bytes: number }>(
      `/projects/${id}/agent/attachment`,
      { method: "POST", body: form },
    );
  },

  ask: (
    id: string,
    prompt: string,
    /** What the writer had highlighted when they pressed Send. Sent with
     *  the question rather than fetched by the agent afterwards, so that
     *  "make this shorter" has a `this` from the start. */
    selection?: {
      path: string;
      text: string;
      fromLine: number;
      toLine: number;
    } | null,
    /** Images already on disk, by the path `attach` handed back. Named
     *  above the question for the model; the panel shows chips instead, so
     *  the conversation reads as what was typed. */
    attached?: string[],
  ) =>
    request<any>(
      `/projects/${id}/agent/ask`,
      json({
        prompt,
        selection: selection
          ? {
              file: selection.path,
              text: selection.text,
              fromLine: selection.fromLine,
              toLine: selection.toLine,
            }
          : null,
        attached: attached ?? [],
      }),
    ),
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
  memory: (id: string) =>
    request<{ text: string; notes: string[]; limit: number }>(
      `/projects/${id}/context/memory`,
    ),
  setMemory: (id: string, text: string) =>
    request<{ text: string; notes: string[]; limit: number }>(
      `/projects/${id}/context/memory`,
      {
        ...json({ text }),
        method: "PUT",
      },
    ),

  resetChat: (id: string) =>
    request<{ ok: boolean; archived: string | null }>(
      `/projects/${id}/agent/reset`,
      { method: "POST" },
    ),
  setMode: (id: string, mode: "ask" | "project" | "all") =>
    request<{ mode: string; auto: boolean }>(
      `/projects/${id}/agent/mode`,
      json({ mode }),
    ),

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
      /** Whether a turn is really running.  A browser that thinks one is
       *  has no other way to find out that it is wrong. */
      busy: boolean;
      /** Where the permission control is, and whether this agent is the
       *  kind that ever asks. A reload has no other way to know either.
       *  `auto` travels alongside for one version, for a browser talking
       *  to an install that has not been updated. */
      mode: "ask" | "project" | "all";
      auto: boolean;
      asks: boolean;
      /** Cards still waiting on an answer.  A reload loses the card and not
       *  the turn, so a browser coming back asks for these rather than
       *  leaving the turn to wait out its timeout. */
      pending: {
        id: string;
        tool: string;
        /** The tool call this card is about, so a card that comes back
         *  after a reload still pairs with its row. */
        toolId?: string;
        rule: string;
        headline: string;
        detail: string;
        consequence: string;
        reason: string;
      }[];
    }>(`/projects/${id}/agent/usage`),
  setModel: (id: string, model: string) =>
    request<{ ok: boolean; model: string; deferred: boolean }>(
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

  /** Which agent this instance uses, and whether it can be used yet.  One
   *  route for all three providers, because the sign-in screen has one
   *  question to answer -- can the writer get to work -- and for "no
   *  agent" the answer is yes, immediately. */
  agentStatus: () =>
    request<{
      provider: "claude" | "openai" | "none";
      ready: boolean;
      model?: string;
      keyTail?: string;
      installed?: boolean;
      loggedIn?: boolean;
      email?: string;
      plan?: string;
      reason?: string;
    }>("/agent/status"),
  chooseProvider: (provider: string, key = "", model = "") =>
    request<any>("/agent/provider", json({ provider, key, model })),

  claudeStatus: () =>
    request<{
      installed: boolean;
      loggedIn: boolean;
      email?: string;
      plan?: string;
      method?: string;
      reason?: string;
    }>("/claude/status"),
  /** Install the CLI on this machine, for somebody who chose no agent at
   *  install time and has changed their mind. Streams like the sign-in
   *  does; a refusal arrives on the stream, not as a failed request. */
  installClaude: () => request<any>("/claude/install", { method: "POST" }),
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
      results: UploadResult[];
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

  /** Folders on the machine running NextTex, for picking one to read
   *  papers out of.  Not project-scoped, because it is not about one. */
  browse: (path: string, count = false) =>
    request<{
      path: string;
      parent: string | null;
      home: string;
      folders: { name: string; path: string; pdfs: number }[];
      pdfsHere: number;
      deep: { pdfs: number; unreadable: number; capped: boolean } | null;
    }>(`/browse?path=${encodeURIComponent(path)}&count=${count ? 1 : 0}`),

  library: (id: string) =>
    request<{
      count: number;
      sources: string[];
      lastRun: { at?: number; added?: number; duplicate?: number;
                 unidentified?: number; stopped?: boolean };
      running: LibraryProgress | null;
      unidentified: { sha: string; name: string; reason: string; path: string }[];
      haveReader: boolean;
    }>(`/projects/${id}/library`),
  scanPapers: (id: string, path: string) =>
    request<any>(`/projects/${id}/library/scan`, json({ path })),
  stopPapers: (id: string) =>
    request<any>(`/projects/${id}/library/stop`, { method: "POST" }),
  resolvePaper: (id: string, sha: string, doi: string) =>
    request<{ added: boolean; key?: string; reason?: string; warning?: string }>(
      `/projects/${id}/library/resolve`, json({ sha, doi }),
    ),
  forgetUnidentified: (id: string) =>
    request<any>(`/projects/${id}/library/unidentified`, { method: "DELETE" }),

  /** Who may drive this install from a browser.
   *
   *  Separate from the peer membership that decides which *installs* may
   *  sync with this one: a password is about this machine's front door. */
  auth: () => request<AuthState>("/auth"),
  setPassword: (password: string, current = "", displayName?: string) =>
    request<{ ok: true; displayName: string }>(
      "/auth/password",
      json({ password, current, display_name: displayName }),
    ),
  setDisplayName: (displayName: string) =>
    request<{ ok: true; displayName: string }>(
      "/auth/name", json({ display_name: displayName }),
    ),
  signOutOthers: () =>
    request<{ ok: true; sessions: BrowserSession[] }>(
      "/auth/sessions", { method: "DELETE" },
    ),
  signOut: () => request<{ ok: true }>("/logout", { method: "POST" }),

  downloadUrl: (id: string, options: { path?: string; format?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.path) params.set("path", options.path);
    if (options.format) params.set("format", options.format);
    const query = params.toString();
    return `/api/projects/${id}/download${query ? `?${query}` : ""}`;
  },
  /** One route, several documents.  `document` is empty for the main one,
   *  which is what every caller written before this sent. */
  pdfUrl: (id: string, document: string, stamp: number) =>
    `/api/projects/${id}/pdf?document=${encodeURIComponent(document)}&v=${stamp}`,
  /** One version's bytes.  No cache-busting stamp, and deliberately: the
   *  response is keyed by sha and is immutable, so the browser holding on
   *  to it is the behaviour that is wanted rather than the one to defeat.
   *  Two panes ask for this now -- the list draws its thumbnails from it
   *  and the viewer is pointed at it -- and it was written out by hand in
   *  one of them. */
  historyBlobUrl: (id: string, path: string, sha: string, download = false) =>
    `/api/projects/${id}/history/blob?path=${encodeURIComponent(path)}` +
    `&sha=${encodeURIComponent(sha)}&${download ? "download=1" : "raw=1"}`,
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
