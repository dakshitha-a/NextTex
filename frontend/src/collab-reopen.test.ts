import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ProjectCollab } from "./collab";

/** A file opened, closed and opened again gets a document of its own.
 *
 *  `build` cleared its entry in `opening` before making it, so a resolved
 *  promise for the first document stayed there, and the second open was
 *  handed that document after `release` had destroyed it and closed its
 *  socket. The tab showed old text, took no outside edit and sent nothing
 *  typed. */

class RecordingSocket {
  static made: RecordingSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    RecordingSocket.made.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
}

describe("reopening a closed file", () => {
  beforeEach(() => {
    RecordingSocket.made = [];
    vi.stubGlobal("WebSocket", RecordingSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a fresh document and socket rather than the destroyed one", async () => {
    const collab = new ProjectCollab("p1", { name: "Writer", colour: "#000" });
    const record = new Y.Map<unknown>();
    collab.manifest.getMap("files").set("f1", record);
    record.set("path", "checklist.md");

    const first = await collab.open("checklist.md");
    const sockets = () => RecordingSocket.made.filter((s) => s.url.endsWith("/sync/text/f1"));
    expect(sockets()).toHaveLength(1);

    collab.release("checklist.md");
    expect(sockets()[0].closed).toBe(true);

    const second = await collab.open("checklist.md");
    expect(second!.text).not.toBe(first!.text);
    expect(sockets()).toHaveLength(2);
    expect(sockets()[1].closed).toBe(false);
    collab.close();
  });
});

/** Two opens of a file the manifest has not heard of yet share one document.
 *
 *  The agent announces where it is about to write and then that it wrote,
 *  and the editor opens the file for each. For a new file both opens wait
 *  for the manifest, both woke on the same update, and an `await` on an
 *  empty `opening` let each find nothing and build a document of its own.
 *  The first open, overtaken, released the path, which destroyed the
 *  second's document and closed its socket; eight seconds later the editor
 *  showed that destroyed document, empty, until the page was reloaded. */
describe("two opens of a file that is still arriving", () => {
  beforeEach(() => {
    RecordingSocket.made = [];
    vi.stubGlobal("WebSocket", RecordingSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get one document, which the first release leaves open", async () => {
    const collab = new ProjectCollab("p1", { name: "Writer", colour: "#000" });
    const announced = collab.open("jobs/letter.tex");
    const written = collab.open("jobs/letter.tex");

    const record = new Y.Map<unknown>();
    collab.manifest.getMap("files").set("f9", record);
    record.set("path", "jobs/letter.tex");

    const [first, second] = await Promise.all([announced, written]);
    expect(second!.text).toBe(first!.text);
    const sockets = RecordingSocket.made.filter((s) => s.url.endsWith("/sync/text/f9"));
    expect(sockets).toHaveLength(1);

    collab.release("jobs/letter.tex");
    expect(sockets[0].closed).toBe(false);
    collab.release("jobs/letter.tex");
    expect(sockets[0].closed).toBe(true);
    collab.close();
  });
});
