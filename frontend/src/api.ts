// One place that knows how to talk to the server.  Every call goes through
// `request`, so the token, the error shape and the JSON handling are decided
// once rather than at each call site.

import { record, type Recorded } from "./errors";

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
  /** The style, class or definition file a "not found" names, when a
   *  package manager could supply it; the drawer's Install button. */
  missingFile?: string;
  /** Which previewed document's build produced this. Added by the store
   *  when it flattens the per-document lists into one; the server answers
   *  per document and does not need to say so. */
  document?: string;
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

/** The three engines a document may ask for; "" on a setting means the
 *  default, pdflatex. */
export type Engine = "pdflatex" | "xelatex" | "lualatex";
export const ENGINES: readonly Engine[] = ["pdflatex", "xelatex", "lualatex"];

/** A setting read off the wire: one of the three engines or "" for the
 *  default.  Anything else, from an older server or a hand-edited toml,
 *  is the default rather than a value the card cannot draw. */
export function engineOf(raw: unknown): Engine | "" {
  return (ENGINES as readonly string[]).includes(raw as string) ? (raw as Engine) : "";
}

/** Where a project's request for `-shell-escape` stands on this machine:
 *  "off" when the project does not ask, "asked" when it does and nobody
 *  has answered, "on" when the build gets the flag. */
export type ShellEscape = "off" | "asked" | "on";
export function shellEscapeOf(raw: unknown): ShellEscape {
  return raw === "asked" || raw === "on" ? raw : "off";
}

/** A page limit off the wire: a whole number, or 0 for none. */
export function countOf(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

export type CompileResult = {
  outcome: "ok" | "errors" | "cancelled" | "timeout" | "failed" | "no_engine";
  scope: string;
  enginePass: "fast" | "full";
  /** Which engine ran, or was asked for and not found. */
  engine?: Engine;
  shellEscape?: ShellEscape;
  /** The engine's own first line for `--version`. */
  engineVersion?: string;
  durationMs: number;
  diagnostics: Diagnostic[];
  summary?: BuildSummary | null;
  pdf?: string | null;
  /** How many pages the run wrote, from the log's "Output written" line. */
  pages?: number | null;
  /** The build wrote no PDF, and the one served is the last good build's. */
  pdfKept?: boolean;
  /** Warnings the server left out of `diagnostics` past its cap. */
  omittedWarnings?: number;
};

/** One row of the submission check: the drawer's row shape with a kind
 *  to group by, and a page where the finding came off the PDF rather than
 *  the source. */
export type SubmitFinding = {
  kind: string;
  severity: "error" | "warning" | "note";
  message: string;
  file: string | null;
  line: number | null;
  page: number | null;
  source: "submit";
  explain: Explanation | null;
};

export type SubmitReport = {
  document: string;
  pages: number | null;
  /** When the PDF was written, as a Unix time in seconds, or null. */
  built: number | null;
  engine: string;
  findings: SubmitFinding[];
  counts: Record<string, number>;
};

/** Which optional tools the machine running NextTex has. */
export type Tools = Record<string, boolean>;

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
  /** Where each label is, and, after a build, what it says: the number
   *  and page from the `.aux` file and the kind hyperref's anchor names
   *  (`figure`, `section`, `equation`); absent before the first build. */
  labels: {
    name: string; file: string; line: number; number?: string; page?: string; kind?: string;
    /** The figure, table or maths environment the label sits in, with
     *  what a reference card can draw: a figure's first graphic and its
     *  caption, a table's caption and its tabular, a maths environment's
     *  inner text; `bodyCut` when the body was cut at the scan's limit. */
    env?: string; graphic?: string; caption?: string; body?: string; bodyCut?: boolean;
  }[];
  citations: { key: string; type: string; title: string; author: string; year: string; authors?: string; venue?: string; doi?: string }[];
  images: string[];
  texfiles: string[];
  commands: { name: string; args: number; file: string; definition?: string }[];
  environments: string[];
  /** Which English each document's preamble declares, by file, when it
   *  declares one: "british" or "american". */
  english?: Record<string, "british" | "american">;
  /** The main language a document's preamble declares, when it is one of
   *  the four the spelling lists cover, with the line that said so. */
  languages?: Record<string, { code: string; line: string }>;
  /** The bibliography styles this TeX has, for `\bibliographystyle{}`. */
  styles?: string[];
};

export type Version = {
  at: number;
  sha: string;
  bytes: number;
  /** The role: the person, or their agent. Now relative to `peer`. */
  /** "outside" is a change made to the file on disk, not in NextTex. */
  by: "you" | "claude" | "outside";
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
  /** In the whole-project list only: the versions one watcher tick
   *  recorded, a `git pull` touching forty files, are folded into one
   *  row, the newest of them, carrying every file the tick touched and
   *  how many. Absent on a row that is one version. */
  paths?: string[];
  count?: number;
  /** Which window, or which watcher tick, a version came from; never
   *  shown, and on a folded row it is the tick's stamp, which is what
   *  the row is keyed on while it is unfolded. */
  source?: string;
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
  /** Set when the writer did not ask for this: "peer" for a
   *  collaborator's deletion followed here, "rejoin" for a file replaced
   *  while rejoining a share. Absent on every entry written before. */
  source?: string;
  why?: string;
};

/** One message in a comment thread. */
export type CommentMessage = {
  id: string;
  name: string;
  peer: string;
  at: number;
  body: string;
  /** Written from this install, so the card says "You". */
  mine?: boolean;
};

/** A comment thread, where it is now as the server reads it. The anchors
 *  are Yjs relative positions, base64, made by the browser that started
 *  the thread from the file's shared text. */
export type CommentThread = {
  id: string;
  file_id: string;
  path: string;
  start: string;
  end: string;
  quote: string;
  line: number;
  detached: boolean;
  created: number;
  resolved: { name?: string; peer?: string; at?: number; mine?: boolean };
  messages: CommentMessage[];
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
  /** For files only: when it last changed, as the server's clock has it. */
  mtime?: number;
  children?: TreeNode[];
};

/** What a word count is counting. */
export type WordScope = "file" | "document" | "selection" | "section";

/** A conversation filed away by "New conversation". */
export type Archive = {
  name: string;
  /** The first thing the writer asked, so the list can be read. */
  title: string;
  size: number;
  /** When it was filed, as text. */
  stamp: string;
};

/** One match. The line and the column are 1-based, because they are what
 *  the editor is told to jump to and what a LaTeX error names. */
export type SearchHit = {
  path: string;
  line: number;
  column: number;
  /** How much of the line matched. Sent rather than derived, because with
   *  a pattern the panel cannot work it out from the query. */
  length: number;
  text: string;
  /** From the references route only: the hit sits after a `%`, and a
   *  rename leaves it alone unless asked. */
  commented?: boolean;
};

/** What a rename can be about. */
export type SymbolKind = "label" | "cite" | "macro";

/** The bug report and where to take it.  `text` is already redacted;
 *  `newIssue` is the form on GitHub with the short facts filled in. */
export type Report = {
  text: string;
  newIssue: string;
  slug: string;
};

export type Instance = {
  instance: string;
  /** The version in `nexttex/version.py` at the commit this process
   *  loaded. Absent from a server older than the number. */
  version?: string;
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
  /** The version this install is on and the one upstream carries; the
   *  second is empty when the upstream commit predates the number. */
  version?: string;
  upstream_version?: string;
  behind: number;
  changing: number;
  commits: { sha: string; subject: string; touches: "app" | "interface" | "neither" }[];
  dirty: string[];
  rebuild: boolean;
  build_ok: boolean;
  build_reason: string;
  can_update: boolean;
  reason: string;
  /** What GitHub's checks said about the commit an update would move to:
   *  "passed", "pending", "failed", or "unknown" when they could not be
   *  asked, which does not hold an update back. */
  ci?: "passed" | "pending" | "failed" | "unknown";
  /** The commit an update would move to is the one the last update went
   *  back from, because it did not start here. */
  avoided?: boolean;
  /** The last update that did not start, and where NextTex went back to. */
  rolledBack?: { from: string; to: string; fromVersion?: string; toVersion?: string } | null;
  restart: "auto" | "manual";
  error: string;
  updating: boolean;
  phase: string;
};

/** What can be previewed in a project, and which document reads what. */
/** What one run of a script did.  `stopped` is a run the writer ended or
 *  a later run replaced; `missing` names the package a bad import wanted,
 *  when it did. */
/** What a run in flight has printed so far. */
export type ScriptLive = { run: number; out: string; err: string };

export type ScriptResult = {
  script: string;
  run: number;
  by: "writer" | "agent";
  ok: boolean;
  code: number;
  out: string;
  err: string;
  clipped?: boolean;
  missing?: string;
  timeout?: boolean;
  stopped?: boolean;
  /** Not started, because this many scripts were already running. */
  busy?: number;
  duration_ms?: number;
  figures: string[];
  saved: string[];
  started?: number;
};

export type DocumentsPayload = {
  previews: string[];
  candidates: string[];
  owners: Record<string, string[]>;
  /** The document in front on the server's side of things. */
  visible: string;
};

/** One folder's worth of the machine's disk, from `/api/browse`. */
export type Listing = {
  path: string;
  parent: string | null;
  home: string;
  folders: { name: string; path: string; pdfs: number }[];
  pdfsHere: number;
  deep: { pdfs: number; unreadable: number; capped: boolean } | null;
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
  /** Whether this install is in a share for this project, known from the
   *  card in the state directory, so it is known even when the folder is
   *  missing. */
  shared: boolean;
  shareId: string;
  /** This install was removed from that share. */
  removed: boolean;
  /** How many others are in the share, for "shared with two people". */
  people: number;
  /** Active, archived (kept, out of the way) or trashed (on the way out).
   *  A registry from before the states carries none, which reads as
   *  active. */
  state?: ProjectState;
  /** When the state was last set; 0 for a project that was never moved. */
  stateAt?: number;
};

export type ProjectState = "active" | "archived" | "trashed";

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
  /** What accepting does to this file. "new from peers" for every file
   *  of a join into an empty folder; the others only for a folder that
   *  already had files, reconciled against the shared project. */
  outcome:
    | "same" | "differs" | "new here" | "new from peers" | "deleted elsewhere"
    | "behind" | "merged";
};

export type JoinOffer = {
  ok: true;
  token: string;
  path: string;
  /** The folder already had files, so `files` carries outcomes. */
  existing: boolean;
  files: OfferedFile[];
};

/** A join or rejoin into a folder that already held this share's own
 *  records: opened as it is, nothing to offer. */
export type JoinOpened = { ok: true; opened: true; project: { id: string; path: string } };

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
  /** Somebody removed this install from the project. Told from the
   *  tombstone in its own member record, which only an actual removal
   *  writes, never from a refusal at another peer's door. */
  removed: boolean;
  /** Who did, by name where their record carries one. */
  removedBy: string;
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
  | "too-big"
  | "failed";

export type UploadResult = {
  name: string;
  path: string;
  outcome: UploadOutcome;
  renamedTo?: string;
  /** Why a file that failed did not arrive. */
  reason?: string;
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
    // A 500 carries the reference the server logged under, and the report
    // quotes both halves; nothing below the server's own fault is worth
    // remembering here, since a 4xx is the page being told something.
    if (response.status >= 500) record("api", `${response.status} ${path}: ${message}`);
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type GitCommit = {
  sha: string;
  short: string;
  subject: string;
  author: string;
  /** The author is this machine's git identity: drawn as "You". */
  mine: boolean;
  /** Unix seconds. */
  when: number;
};

export type GitBlame =
  | { uncommitted: true; line: number }
  | ({ uncommitted: false; line: number } & GitCommit);

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const api = {
  projects: () =>
    request<{ projects: ProjectSummary[]; open: string[]; watched: string[]; home: string }>("/projects"),
  /** Who this server is.  Answered while it is shutting down, and its
   *  `boot` nonce changes when the process does -- which is how a page
   *  waiting out a restart knows the wait is over. */
  instance: () => request<Instance>("/instance"),
  /** What the footer's Report a problem asks for.  What the browser saw
   *  goes with it, so the server can redact it with the rest. */
  report: (errors: Recorded[], browser: string) =>
    request<Report>("/report", json({ errors, browser })),
  updateCheck: (force = false) =>
    request<UpdateReport>(`/update${force ? "?force=true" : ""}`),
  startUpdate: () => request<{ started: boolean }>("/update", json({})),
  /** Leave, so the supervisor starts a new process on the commit the
   *  files hold.  Refused with 409 where nothing would bring NextTex
   *  back, which is why the footer only offers it when `supervised`. */
  restart: () => request<{ restarting: boolean }>("/update/restart", json({})),
  addProject: (path: string) => request<any>("/projects", json({ path })),
  /** `template` is what `loadTemplate` will be asked for next, so the
   *  folder is made in its shape. */
  createProject: (path: string, name: string, template = "basic") =>
    request<any>("/projects/create", json({ path, name, template })),
  /** A project from somewhere else into a new folder: a zip, an arXiv id
   *  or a git URL.  Multipart because the zip is a file; the answer is the
   *  project, with the archive entries that were left out by name. */
  arrive: async (path: string, source: string, file: File | null) => {
    const form = new FormData();
    form.append("path", path);
    form.append("source", source);
    if (file) form.append("file", file);
    const response = await fetch("/api/projects/arrive", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = await response.json();
        message = body.detail || body.error || message;
      } catch {
        /* the status line will do */
      }
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<{ id: string; name: string; skipped: string[] }>;
  },
  forgetProject: (id: string) =>
    request<any>(`/projects/${id}`, { method: "DELETE" }),
  /** Archive a project, put it in the trash, or make it active again.
   *  Nothing on disk moves. */
  setProjectState: (id: string, state: ProjectState) =>
    request<{ ok: boolean; state: ProjectState }>(`/projects/${id}/state`, json({ state })),
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
    request<JoinOffer | JoinOpened>("/collab/join", json({ invite, path })),
  /** Back into a share this install is a member of, from the note it
   *  keeps outside the project, with no invite. The answer is an offer,
   *  as for a join. */
  rejoinShare: (share: string, path: string) =>
    request<JoinOffer | JoinOpened>("/collab/rejoin", json({ share, path })),
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
  /** Take this install out of the share. The folder stays as a project of
   *  its own unless `del` is set, in which case the session is closed, the
   *  entry forgotten and the folder removed. */
  leaveShare: (id: string, del = false) =>
    request<{ ok: true; deleted: boolean } & Partial<CollabState>>(
      `/projects/${id}/collab/leave`, json({ delete: del }),
    ),

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
  /** Preview the document a `.tex` file belongs to: itself when it is a
   *  root, the document that reads it when it is a part.  `document` is
   *  what ended up in front.  404 for a fragment nothing reads; 409 when
   *  the root would share a jobname with a document already on the strip. */
  addPreview: (id: string, path: string) =>
    request<DocumentsPayload & { document: string }>(
      `/projects/${id}/previews`, json({ path }),
    ),
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

  /** Run a script from the source pane.  The answer is the same shape the
   *  `script_done` event carries, so a window that asked and one that
   *  only listened hold the same thing. */
  runScript: (id: string, path: string) =>
    request<ScriptResult>(`/projects/${id}/scripts/run`, json({ path })),
  stopScript: (id: string, path: string) =>
    request<{ ok: true; stopped: boolean }>(`/projects/${id}/scripts/stop`, json({ path })),
  /** What the script did the last time it ran here; 404 when it never has. */
  lastScriptRun: (id: string, path: string) =>
    // Partial: a script running for the first time has a name and a
    // `running` flag and nothing else yet, plus `live`, what it has
    // printed so far, while it runs.
    request<Partial<ScriptResult> & { script: string; running: boolean; live?: ScriptLive }>(
      `/projects/${id}/scripts/last?path=${encodeURIComponent(path)}`,
    ),
  /** One figure the last run drew.  Stamped with the run so a rerun that
   *  writes the same name is fetched again. */
  scriptFigureUrl: (id: string, path: string, name: string, run: number) =>
    `/api/projects/${id}/scripts/figure?path=${encodeURIComponent(path)}` +
    `&name=${encodeURIComponent(name)}&run=${run}`,
  /** Install the package a failed run said was missing.  Reaches PyPI,
   *  which is why the pane asks first. */
  installForScript: (id: string, name: string) =>
    request<{ ok: boolean; err: string }>(`/projects/${id}/scripts/install`, json({ name })),

  /** Which TeX package provides a file a build said was missing, from
   *  tlmgr's own file search.  An empty package means nothing provides
   *  it; an empty manager means this TeX has no package manager. */
  texPackage: (id: string, file: string) =>
    request<{ file: string; package: string; manager: string }>(
      `/projects/${id}/tex/package?file=${encodeURIComponent(file)}`,
    ),
  /** Install that package with tlmgr, then build again.  Reaches a CTAN
   *  mirror, which is why the row asks first. */
  texInstalling: () => request<{ package: string }>("/tex/installing"),
  texInstall: (id: string, pkg: string) =>
    request<{ ok: boolean; err: string }>(`/projects/${id}/tex/install`, json({ package: pkg })),

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
  comments: (id: string) =>
    request<{ threads: CommentThread[] }>(`/projects/${id}/comments`),
  comment: (
    id: string,
    body: { path: string; start: string; end: string; quote: string; line: number; body: string },
  ) =>
    request<{ id: string }>(`/projects/${id}/comments`, json(body)),
  replyComment: (id: string, thread: string, body: string) =>
    request<{ ok: boolean }>(`/projects/${id}/comments/${thread}/reply`, json({ body })),
  resolveComment: (id: string, thread: string, resolved: boolean) =>
    request<{ ok: boolean }>(`/projects/${id}/comments/${thread}/resolve`, json({ resolved })),
  deleteComment: (id: string, thread: string) =>
    request<{ ok: boolean }>(`/projects/${id}/comments/${thread}`, { method: "DELETE" }),
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
  /** One or more of the three per-project switches, or the engine. */
  setProjectSettings: (
    id: string,
    patch: Partial<{
      autocompile: boolean;
      markErrors: boolean;
      markWarnings: boolean;
      engine: Engine | "";
      pageLimit: number;
      blind: boolean;
      pdfa: boolean;
      language: string;
    }>,
  ) =>
    request<{
      previews: string[];
      visible: string;
      autocompile: boolean;
      markErrors: boolean;
      markWarnings: boolean;
      engine: Engine | "";
      shellEscape: ShellEscape;
      pageLimit: number;
      blind: boolean;
      pdfa: boolean;
      language: string;
    }>(`/projects/${id}/settings`, json(patch)),
  /** This machine's answer to a project that asks for shell escape. The
   *  project asks in its own toml; the answer is kept per project on the
   *  install, where a project cannot bring it along. */
  allowShellEscape: (id: string, allow: boolean) =>
    request<{ shellEscape: ShellEscape }>(
      `/projects/${id}/shell-escape`, json({ allow }),
    ),

  /** `first` and `last` are 1-based inclusive lines, and they are how a
   *  selection and a section are counted. The same counter answers all
   *  four scopes, because two counters disagreeing by a few percent on
   *  the same prose leave the writer with no way to tell which number is
   *  the one their supervisor will get. */
  words: (
    id: string,
    path: string,
    scope: WordScope,
    range?: { first: number; last: number },
  ) =>
    request<{ words: number | null; scope: string }>(
      `/projects/${id}/words?scope=${scope}&path=${encodeURIComponent(path)}` +
        (range ? `&first=${range.first}&last=${range.last}` : ""),
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
  /** The grammar findings this project ignores, one key per finding:
   *  the rule and the words it found. */
  grammarIgnored: (id: string) =>
    request<{ keys: string[] }>(`/projects/${id}/grammar-ignored`),
  ignoreGrammar: (id: string, key: string) =>
    request<{ keys: string[] }>(`/projects/${id}/grammar-ignored`, json({ key })),
  forgetWord: (id: string, word: string) =>
    request<{ words: string[] }>(
      `/projects/${id}/dictionary?word=${encodeURIComponent(word)}`,
      { method: "DELETE" },
    ),
  /** Every place a string appears in the project. `regex` off means the
   *  query is taken literally, which is what a writer typing `eq.flux`
   *  means; `case` on means the search is case sensitive, which is how
   *  the editor's own find panel labels the same switch. */
  search: (
    id: string,
    query: string,
    options: { regex?: boolean; case?: boolean } = {},
  ) =>
    request<{
      hits: SearchHit[];
      capped: boolean;
      files: number;
      searched: number;
    }>(
      `/projects/${id}/search?q=${encodeURIComponent(query)}` +
        `&regex=${options.regex ? "true" : "false"}` +
        `&case=${options.case ? "true" : "false"}`,
    ),
  /** Rewrite every match. Each file that changes keeps a version in its
   *  history, which is the only undo a replace across a project has. */
  /** Papers matching a query, from a publisher's own record; the DOI on
   *  each goes through `addByDoi`. */
  searchLiterature: (id: string, q: string, source: string) =>
    request<{
      source: string;
      results: {
        doi: string; title: string; first: string; authors: number; year: string; journal: string;
        /** The full author list and the abstract, where the record has them. */
        names: string[]; abstract: string;
      }[];
    }>(`/projects/${id}/library/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}`),
  /** Every use of a label, a citation key or a macro, by the syntax. */
  references: (id: string, kind: SymbolKind, name: string) =>
    request<{ kind: SymbolKind; name: string; hits: SearchHit[]; commented: number }>(
      `/projects/${id}/references?kind=${kind}&name=${encodeURIComponent(name)}`,
    ),
  /** Rename it everywhere, through the ordinary save, one version per file. */
  renameSymbol: (id: string, kind: SymbolKind, name: string, to: string, comments: boolean) =>
    request<{ files: number; paths: string[] }>(
      `/projects/${id}/rename`, json({ kind, name, to, comments }),
    ),
  replaceInProject: (
    id: string,
    query: string,
    replacement: string,
    options: { regex?: boolean; case?: boolean; paths?: string[] } = {},
  ) =>
    request<{
      files: number;
      replaced: number;
      paths: string[];
      /** Files the replace could not save, and why; the rest were saved. */
      failed?: { path: string; reason: string }[];
    }>(
      `/projects/${id}/search/replace`,
      json({
        q: query,
        with: replacement,
        regex: Boolean(options.regex),
        case: Boolean(options.case),
        paths: options.paths ?? null,
      }),
    ),
  /** The conversations "New conversation" filed away, newest first. */
  archives: (id: string) =>
    request<{ archives: Archive[] }>(`/projects/${id}/agent/archives`),
  /** One of them, as transcript rows, read-only. */
  archive: (id: string, name: string) =>
    request<{ name: string; items: any[] }>(
      `/projects/${id}/agent/archives/${encodeURIComponent(name)}`,
    ),
  /** The engine's own log for one document. `build/` is out of the file
   *  tree, so this is the only way the drawer can show it. */
  buildLog: (id: string, document = "") =>
    request<{ document: string; text: string; engine: string; engineVersion: string }>(
      `/projects/${id}/log?document=${encodeURIComponent(document)}`,
    ),
  lint: (id: string, path: string) =>
    request<{ diagnostics: Diagnostic[] }>(
      `/projects/${id}/lint?path=${encodeURIComponent(path)}`,
    ),
  /** What a venue would send back, for one document, off its last build. */
  submitCheck: (id: string, document = "") =>
    request<SubmitReport>(
      `/projects/${id}/submit?document=${encodeURIComponent(document)}`,
    ),
  /** Which optional tools this machine has: pandoc for the export rows,
   *  pdffonts and pdfimages for the submission check. */
  tools: () => request<Tools>("/tools"),
  /** `column` is what the server sends and synctex never fills: `-1` on
   *  every engine, which arrives as null.  Named here so the shape is the
   *  route's rather than a subset of it. */
  inverse: (id: string, page: number, x: number, y: number, document = "") =>
    request<{ found: boolean; file?: string; line?: number; column?: number | null }>(
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
  /** The reusable prompts a `/` in the composer can name: the built-ins
   *  and the project's own under `prompts/`. */
  prompts: (id: string) =>
    request<{ prompts: import("./panes/slash-prompts").PromptEntry[] }>(`/projects/${id}/prompts`),
  /** Put a built-in prompt into the project as a file the group can edit. */
  copyPrompt: (id: string, name: string) =>
    request<{ path: string }>(`/projects/${id}/prompts/copy`, json({ name })),
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

  /** The patch for one changed file, against the last commit. Empty when
   *  there is no repository or nothing changed. */
  gitDiff: (id: string, path: string) =>
    request<{ path: string; patch: string }>(
      `/projects/${id}/git/diff?path=${encodeURIComponent(path)}`,
    ),
  /** The newest commits, for the Git drawer's History. */
  gitLog: (id: string) => request<{ commits: GitCommit[] }>(`/projects/${id}/git/log`),
  /** One commit's patch, without its header. */
  gitCommit: (id: string, sha: string) =>
    request<{ sha: string; patch: string }>(`/projects/${id}/git/log/${encodeURIComponent(sha)}`),
  /** Which commit last touched one line, blamed on the editor's text. */
  gitBlame: (id: string, path: string, line: number) =>
    request<{ path: string; blame: GitBlame | null }>(
      `/projects/${id}/git/blame?path=${encodeURIComponent(path)}&line=${line}`,
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
      /** A merge started in a terminal and not finished, and the paths it
       *  left in conflict. */
      merging?: boolean;
      conflicts?: string[];
      /** The commit a detached head is at, or "". */
      detached?: string;
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
  chooseProvider: (provider: string, key = "", model = "", baseUrl?: string) =>
    request<any>("/agent/provider", json({ provider, key, model, ...(baseUrl === undefined ? {} : { baseUrl }) })),

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
  startLogin: (console: boolean, restart = false) =>
    request<any>("/claude/login/start", json({ console, restart })),
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

  /** Folders on the machine running NextTex, for picking one: to read
   *  papers out of, or to put a project in.  Not project-scoped, because
   *  it is not about one.  `pdfs` false skips counting each folder's
   *  PDFs, which the project picker has no use for and which costs a
   *  read of every child of home. */
  browse: (path: string, count = false, pdfs = true) =>
    request<Listing>(
      `/browse?path=${encodeURIComponent(path)}&count=${count ? 1 : 0}&pdfs=${pdfs ? 1 : 0}`,
    ),

  library: (id: string) =>
    request<{
      count: number;
      entries: number;
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

  downloadUrl: (
    id: string,
    options: { path?: string; format?: string; document?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.path) params.set("path", options.path);
    if (options.format) params.set("format", options.format);
    // Which document's PDF, by project-relative path; empty is the one on
    // screen, which is what every caller written before there were several
    // sent.
    if (options.document) params.set("document", options.document);
    const query = params.toString();
    return `/api/projects/${id}/download${query ? `?${query}` : ""}`;
  },
  /** One route, several documents.  `document` is empty for the one on
   *  screen, which is what every caller written before this sent. */
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
