import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates }
  from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { yCollab, ySyncAnnotation, yUndoManagerKeymap } from "y-codemirror.next";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/** The browser's half of the shared documents.
 *
 *  Loaded on demand, never at boot.  Yjs and its bindings are about fifty
 *  kilobytes, `bundle.initial_kb` counts only the entry script, and the first
 *  screen of a session is the project list -- so this arrives when a file is
 *  opened and not before.
 *
 *  Two kinds of connection, doing two jobs.
 *
 *  **The manifest** is opened once per project and stays open.  It lists the
 *  files, which is how a path becomes the id its document is keyed by, and it
 *  carries *presence*: who is in this project, which file they have open, and
 *  where their cursor is.  Presence lives here rather than on each file so
 *  that the collaborator strip can show somebody working in chapter four
 *  without this browser having chapter four open.
 *
 *  **A file** is opened when the editor opens it.  Its awareness carries the
 *  precise selection `y-codemirror.next` draws remote carets from, which has
 *  to be per document: a relative position only decodes against the document
 *  it was made in.
 *
 *  Both speak the y-protocols framing, which is what the server speaks
 *  through pycrdt.  Nothing here is NextTex's own invention.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Backoff between attempts to get back on. A collaborator's laptop shutting
// its lid is the common case, so the first few retries are quick and then it
// settles down rather than hammering a server that is not there.
const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

export type Presence = {
  /** Stable per connection, and the key everything is grouped by. */
  clientId: number;
  name: string;
  colour: string;
  /** The file they have open, project-relative. */
  path: string;
  line: number;
  /** Whether they have typed recently, rather than merely being connected. */
  active: boolean;
};

export type Connection = "live" | "connecting" | "offline";

/** Someone is "working" if they have typed within this long. Presence that
 *  never decays turns into a list of everyone who left their tab open. */
const ACTIVE_MS = 45_000;

/** A palette for collaborators, derived rather than assigned.
 *
 *  Picked by hashing the name, so two people see each other in the same
 *  colour without negotiating one.
 *
 *  Every hue the interface already means something with is excluded, which
 *  is most of them: violet is the agent, amber is "the preview is behind",
 *  red is an error, green is a good build, and teal is live interactive
 *  state. A collaborator drawn in any of those is a collaborator who looks
 *  like a warning -- the first version of this used amber and put it in the
 *  tab bar, a few degrees from the stale-preview dot and in the same place.
 *
 *  So they live in the blue-to-magenta arc, which nothing else in the app
 *  claims. All of them are light enough to carry dark ink, because the
 *  caret's name label is set on them at ten pixels.
 */
const COLOURS = [
  "#7FA8F5",  // blue
  "#E289C4",  // magenta
  "#9C9BF0",  // periwinkle
  "#5FB8E8",  // sky
  "#D992D9",  // orchid
  "#8FBEEA",  // pale blue
  "#C79BE0",  // lilac
];

/** How a change made by the binding is told apart from a keystroke.
 *
 *  Exported so the editor can ask, without the editor's own module having to
 *  import Yjs -- which would pull the whole hundred kilobytes into the entry
 *  bundle and undo the lazy split. */
export const remoteMarker = ySyncAnnotation;

export function colourFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return COLOURS[hash % COLOURS.length];
}

/** One WebSocket onto one document, with the reconnecting it needs.
 *
 *  Small on purpose. `y-websocket` would do this and rather more -- rooms,
 *  its own auth, a broadcast channel between tabs -- none of which fits an
 *  app where the document name is a path and the cookie is already the
 *  credential.
 */
class DocSocket {
  /** What this one connection is doing, so the project can report the worst
   *  of them rather than only the first. */
  state: Connection = "connecting";
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closing = false;
  private timer: number | null = null;
  constructor(
    private url: string,
    readonly doc: Y.Doc,
    readonly awareness: Awareness,
    private onState: (state: Connection) => void,
  ) {
    doc.on("update", this.documentChanged);
    awareness.on("update", this.awarenessChanged);
    this.connect();
  }

  private documentChanged = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private awarenessChanged = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === "remote") return;
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder, encodeAwarenessUpdate(this.awareness, changed),
    );
    this.send(encoding.toUint8Array(encoder));
  };

  private connect() {
    if (this.closing) return;
    this.state = this.attempt === 0 ? "connecting" : "offline";
    this.onState(this.state);

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}${this.url}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.state = "live";
      this.onState(this.state);
      // Both ends open with a state vector. Ours asks what the server has;
      // its answer is the file.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));

      // And say who we are, so a tab that was already open sees us arrive.
      const local = this.awareness.getLocalState();
      if (local) {
        const announce = encoding.createEncoder();
        encoding.writeVarUint(announce, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          announce,
          encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        this.send(encoding.toUint8Array(announce));
      }
    };

    socket.onmessage = (event) => {
      const message = new Uint8Array(event.data as ArrayBuffer);
      if (!message.length) return;
      const decoder = decoding.createDecoder(message);
      const kind = decoding.readVarUint(decoder);
      if (kind === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // `this` is the transaction origin, which is what stops the update
        // this produces being sent straight back where it came from: the
        // document listener returns early when it sees its own origin.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
      } else if (kind === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(
          this.awareness, decoding.readVarUint8Array(decoder), "remote",
        );
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.closing) return;
      // Everyone else's cursor goes with the connection. A caret left
      // behind by a socket that dropped is worse than no caret: it says
      // somebody is there.
      removeAwarenessStates(
        this.awareness,
        [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID),
        "remote",
      );
      this.state = "offline";
      this.onState(this.state);
      const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
      this.attempt += 1;
      this.timer = window.setTimeout(() => this.connect(), wait);
    };

    socket.onerror = () => socket.close();
  }

  private send(message: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(message);
    }
  }

  close() {
    this.closing = true;
    this.state = "offline";
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.doc.off("update", this.documentChanged);
    this.awareness.off("update", this.awarenessChanged);
    this.socket?.close();
  }
}

type OpenFile = {
  doc: Y.Doc;
  text: Y.Text;
  socket: DocSocket;
  awareness: Awareness;
  undo: Y.UndoManager;
  users: number;
  /** The id it is filed under, so releasing it does not have to look the
   *  path up again -- which fails for a file that has since been renamed. */
  fileId: string;
};

/** Everything this browser shares, for one project. */
export class ProjectCollab {
  readonly manifest = new Y.Doc();
  readonly presence: Awareness;
  private manifestSocket: DocSocket;
  private files = new Map<string, OpenFile>();
  /** Opens in flight, by file id. `open` awaits the manifest before it looks
   *  in `files`, so two overlapping calls for one path -- a double click, a
   *  re-fired `pendingOpen` -- both found nothing and both built a socket,
   *  and the loser was orphaned with no way to close it. */
  private opening = new Map<string, Promise<OpenFile>>();
  /** Which file each open buffer is bound to, so `release` can find it by
   *  path even after a rename. */
  private byPath = new Map<string, string>();
  private listeners = new Set<() => void>();
  private state: Connection = "connecting";

  constructor(
    readonly projectId: string,
    readonly me: { name: string; colour: string },
  ) {
    this.presence = new Awareness(this.manifest);
    this.presence.setLocalStateField("user", { name: me.name, colour: me.colour });
    this.presence.setLocalStateField("at", { path: "", line: 1, typedAt: 0 });
    this.manifestSocket = new DocSocket(
      `/api/projects/${projectId}/sync/manifest`,
      this.manifest,
      this.presence,
      (state) => this.noteConnection(state),
    );
    this.manifest.on("update", this.announce);
    this.presence.on("change", this.announce);
  }

  private announce = () => {
    for (const listener of this.listeners) listener();
  };

  /** The worst state any of this project's sockets is in.
   *
   *  Reporting only the manifest's meant a writer whose *file* socket had
   *  dropped -- an expired session, a proxy closing one connection, the
   *  server closing a connection that stopped draining -- was shown as
   *  connected while nothing they typed reached anybody. That is the one
   *  thing they must not find out later.
   */
  private noteConnection(_state: Connection) {
    const states: Connection[] = [
      this.manifestSocket?.state ?? "connecting",
      ...[...this.files.values()].map((file) => file.socket.state),
    ];
    this.state = states.includes("offline")
      ? "offline"
      : states.includes("connecting")
      ? "connecting"
      : "live";
    this.announce();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get connection(): Connection {
    return this.state;
  }

  /** Who else is in this project, and where.
   *
   *  Ourselves excluded: the strip is for the people you cannot see, and a
   *  row for the person reading it is a row that never tells them anything.
   */
  collaborators(): Presence[] {
    const now = Date.now();
    const out: Presence[] = [];
    for (const [clientId, state] of this.presence.getStates()) {
      if (clientId === this.manifest.clientID) continue;
      const user = (state as any)?.user;
      const at = (state as any)?.at;
      if (!user) continue;
      out.push({
        clientId,
        name: user.name || "Someone",
        colour: user.colour || colourFor(String(clientId)),
        path: at?.path || "",
        line: at?.line || 1,
        active: Boolean(at?.typedAt) && now - at.typedAt < ACTIVE_MS,
      });
    }
    // Stable order, so a strip of avatars does not reshuffle every time
    // somebody moves their cursor.
    out.sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId);
    return out;
  }

  /** Say where this browser is looking. Cheap, and called on every move. */
  here(path: string, line: number, typed: boolean) {
    const at = this.presence.getLocalState()?.at as any;
    const typedAt = typed ? Date.now() : at?.typedAt || 0;
    if (at && at.path === path && at.line === line && at.typedAt === typedAt) return;
    this.presence.setLocalStateField("at", { path, line, typedAt });
  }

  fileId(path: string): string | null {
    const files = this.manifest.getMap("files");
    for (const [id, record] of files.entries()) {
      const entry = record as Y.Map<any>;
      if (entry.get("path") === path && !entry.get("trashed")) return id;
    }
    return null;
  }

  /** Wait until the manifest has arrived and knows this path.
   *
   *  Opening a file is the first thing that happens in a session, often
   *  before the manifest's first round trip has finished, so this is the
   *  ordinary path rather than an edge case.
   */
  async waitForFile(path: string, timeoutMs = 8000): Promise<string | null> {
    const found = this.fileId(path);
    if (found) return found;
    return new Promise((resolve) => {
      const done = (value: string | null) => {
        this.manifest.off("update", check);
        window.clearTimeout(timer);
        resolve(value);
      };
      const check = () => {
        const id = this.fileId(path);
        if (id) done(id);
      };
      const timer = window.setTimeout(() => done(null), timeoutMs);
      this.manifest.on("update", check);
      check();
    });
  }

  /** Open a file's shared document, and the CodeMirror extension for it. */
  async open(path: string): Promise<
    { text: Y.Text; extension: Extension; undo: Y.UndoManager } | null
  > {
    const fileId = await this.waitForFile(path);
    if (!fileId) return null;

    const already = this.files.get(fileId) ?? (await this.opening.get(fileId));
    const file = already ?? (await this.build(fileId));
    file.users += 1;
    this.byPath.set(path, fileId);
    return {
      text: file.text,
      undo: file.undo,
      // The keymap is the half that was missing. `yCollab` installs the
      // undo manager and a `beforeinput` handler for it, and binds no
      // keys, so Ctrl+Z went to CodeMirror's own history, which had the
      // socket's first sync on its stack: six presses emptied the file on
      // disk, for everyone. `editor-setup.ts` no longer gives a live
      // editor that history, and this is what answers instead.
      extension: [
        yCollab(file.text, file.awareness, { undoManager: file.undo }),
        keymap.of(yUndoManagerKeymap),
      ],
    };
  }

  /** Build one file's document and its socket, once.
   *
   *  The promise is shared while it is in flight, so overlapping opens get
   *  the same document rather than two of them. */
  private build(fileId: string): Promise<OpenFile> {
    const pending = (async () => {
      const doc = new Y.Doc();
      const text = doc.getText("text");
      const awareness = new Awareness(doc);
      awareness.setLocalStateField("user", {
        name: this.me.name, color: this.me.colour, colorLight: `${this.me.colour}33`,
      });
      const undo = new Y.UndoManager(text, {
        // Scoped to this browser's own edits. Without it, undo would walk
        // back through a collaborator's typing, which is the single most
        // alarming thing a shared editor can do.
        trackedOrigins: new Set([null, undefined]),
      });
      const socket = new DocSocket(
        `/api/projects/${this.projectId}/sync/text/${fileId}`,
        doc, awareness, (state) => this.noteConnection(state),
      );
      const made: OpenFile = {
        doc, text, socket, awareness, undo, users: 0, fileId,
      };
      this.files.set(fileId, made);
      this.opening.delete(fileId);
      return made;
    })();
    this.opening.set(fileId, pending);
    return pending;
  }

  /** The editor has closed a tab.
   *
   *  The document really is closed when the last reader lets go: a socket,
   *  a `Y.Doc`, an `Awareness` and an `UndoManager` each, and a
   *  forty-file thesis is forty of them. The first version only decremented
   *  a counter and kept everything for the life of the project -- and looked
   *  the file up by path, which returns nothing for one that has since been
   *  renamed, so even the counter was wrong.
   */
  release(path: string) {
    const fileId = this.byPath.get(path) ?? this.fileId(path);
    this.byPath.delete(path);
    const file = fileId ? this.files.get(fileId) : null;
    if (!file) return;
    file.users = Math.max(0, file.users - 1);
    if (file.users > 0) return;
    this.files.delete(file.fileId);
    file.socket.close();
    file.undo.destroy();
    file.awareness.destroy();
    file.doc.destroy();
  }

  close() {
    this.manifest.off("update", this.announce);
    this.presence.off("change", this.announce);
    this.manifestSocket.close();
    for (const file of this.files.values()) {
      file.socket.close();
      file.undo.destroy();
      file.awareness.destroy();
      file.doc.destroy();
    }
    this.files.clear();
    this.opening.clear();
    this.byPath.clear();
    this.listeners.clear();
    this.presence.destroy();
    this.manifest.destroy();
  }
}

let current: ProjectCollab | null = null;

/** The collaboration for the project on screen, made if there is not one. */
export function collabFor(
  projectId: string,
  me: { name: string; colour: string },
): ProjectCollab {
  if (current && current.projectId === projectId) return current;
  current?.close();
  current = new ProjectCollab(projectId, me);
  return current;
}

export function currentCollab(): ProjectCollab | null {
  return current;
}

export function closeCollab() {
  current?.close();
  current = null;
}
