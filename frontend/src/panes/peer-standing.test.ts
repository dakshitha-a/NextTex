/** A peer arriving, present, and gone must not be the same empty space.
 *
 *  R-105, R-121 and R-126, which are one fault at three points of one
 *  lifetime. The interface had no representation of the peer link at all:
 *  the badge it does have watches this browser's socket to its own server,
 *  and `Collaborators` drew nothing whenever it had nobody to draw. The
 *  Windows laptop sampled its screen once a second across the window in
 *  which the share it was joined to was shut down, and every sample was
 *  identical.
 */
import { describe, expect, test } from "vitest";
import { awayWords, others, peerStanding } from "./peer-standing";

const me = "aaaa";
const share = (members: Array<Record<string, unknown>>, shared = true) =>
  ({ shared, me, members } as never);

describe("where a share has got to", () => {
  test("a project nobody shares draws nothing", () => {
    expect(peerStanding(null)).toBe("none");
    expect(peerStanding(share([], false))).toBe("none");
  });

  test("a share nobody has joined draws nothing", () => {
    expect(peerStanding(share([{ peer: me, name: "Me", connected: true }])))
      .toBe("none");
  });

  test("a peer who is here is present", () => {
    expect(peerStanding(share([
      { peer: me, name: "Me", connected: true },
      { peer: "bbbb", name: "Bob", connected: true },
    ]))).toBe("present");
  });

  test("a peer who has joined and is not connected is away, not nothing", () => {
    // The case that was invisible. It covers a peer who has not arrived
    // yet and one who has gone for good, and both of those are things the
    // writer needs to know, because their typing is not reaching anybody.
    expect(peerStanding(share([
      { peer: me, name: "Me", connected: true },
      { peer: "bbbb", name: "Bob", connected: false },
    ]))).toBe("away");
  });

  test("somebody removed from the share is not somebody who is away", () => {
    expect(peerStanding(share([
      { peer: me, name: "Me", connected: true },
      { peer: "bbbb", name: "Bob", connected: false, removed: true },
    ]))).toBe("none");
  });

  test("one connected peer is present even when another is not", () => {
    expect(peerStanding(share([
      { peer: "bbbb", name: "Bob", connected: false },
      { peer: "cccc", name: "Cara", connected: true },
    ]))).toBe("present");
  });
});

describe("what it says when nobody is connected", () => {
  test("names the one person, and does not reuse the socket's wording", () => {
    const words = awayWords(share([
      { peer: me, name: "Me", connected: true },
      { peer: "bbbb", name: "Bob", connected: false },
    ]));
    expect(words).toBe("Sharing with Bob, not connected");
  });

  test("names two", () => {
    expect(awayWords(share([
      { peer: "bbbb", name: "Bob", connected: false },
      { peer: "cccc", name: "Cara", connected: false },
    ]))).toBe("Sharing with Bob and Cara, neither connected");
  });

  test("counts more than two", () => {
    expect(awayWords(share([
      { peer: "b", name: "Bob", connected: false },
      { peer: "c", name: "Cara", connected: false },
      { peer: "d", name: "Dev", connected: false },
    ]))).toBe("Sharing with 3 people, none connected");
  });

  test("says something even for a member with no name", () => {
    expect(awayWords(share([{ peer: "bbbb", name: "", connected: false }])))
      .toBe("Sharing, nobody connected");
  });
});

describe("who counts as somebody else", () => {
  test("this install is never one of them", () => {
    expect(others(share([{ peer: me, name: "Me", connected: true }]))).toEqual([]);
  });
});
