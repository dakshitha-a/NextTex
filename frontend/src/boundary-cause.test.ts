/** A stopped server is not a moved deployment.
 *
 *  The boundary reloads the tab once when a pane's dynamic import fails,
 *  because after a deploy the only cure is to load the new build. The
 *  pattern that decided this included a bare `Failed to fetch`, which is
 *  what a browser says for any request it could not make, so a stopped
 *  NextTex reloaded the tab onto the browser's own error page and took the
 *  editor with it. That is R-040, and R-123 is what makes it worse: four
 *  minutes earlier the app had promised that what you type is kept here
 *  until it reconnects.
 */
import { describe, expect, test } from "vitest";
import { chunkUrlIn, worthReloading } from "./boundary-cause";

const MOVED = new Error(
  "Failed to fetch dynamically imported module: http://127.0.0.1:8450/assets/Chat-9f2b.js",
);
const FIREFOX = new Error("error loading dynamically imported module");
const SAFARI = new Error("Importing a module script failed.");
const ANY_REQUEST = new TypeError("Failed to fetch");
const ORDINARY = new Error("Cannot read properties of undefined (reading 'map')");

describe("whether reloading can help", () => {
  test("a module the server no longer has is worth a reload", () => {
    expect(worthReloading(MOVED, "live")).toBe(true);
    expect(worthReloading(FIREFOX, "live")).toBe(true);
    expect(worthReloading(SAFARI, "live")).toBe(true);
  });

  test("a bare failed fetch is not a moved deployment", () => {
    // This is the one that cost the editor. Every request to a server that
    // has stopped says exactly this, and none of them is a chunk.
    expect(worthReloading(ANY_REQUEST, "live")).toBe(false);
    expect(worthReloading(ANY_REQUEST, "offline")).toBe(false);
  });

  test("not while the socket already says the server is not answering", () => {
    expect(worthReloading(MOVED, "offline")).toBe(false);
  });

  test("still worth it while the socket is only reconnecting", () => {
    expect(worthReloading(MOVED, "connecting")).toBe(true);
  });

  test("an ordinary programming mistake is never reloaded away", () => {
    expect(worthReloading(ORDINARY, "live")).toBe(false);
  });
});

describe("the module a message names", () => {
  test("is found where the browser puts it", () => {
    expect(chunkUrlIn(MOVED.message)).toBe(
      "http://127.0.0.1:8450/assets/Chat-9f2b.js",
    );
  });

  test("is empty when the message names none", () => {
    expect(chunkUrlIn(ANY_REQUEST.message)).toBe("");
    expect(chunkUrlIn(SAFARI.message)).toBe("");
  });

  test("does not swallow the punctuation after it", () => {
    expect(chunkUrlIn("failed (http://x/a.js).")).toBe("http://x/a.js");
  });
});
