/** Whether the other end of a share is there, which nothing was drawing.
 *
 *  The word this app shows for "connected" describes the wrong connection.
 *  `connection` in `collab.ts` is the state of this browser's WebSocket to
 *  its own server: `new WebSocket(\`${scheme}://${location.host}...\`)`.
 *  The peer link, the iroh leg that actually carries a collaborator's
 *  edits, is not in it at all. So a laptop that loses its internet while
 *  its browser still reaches localhost shows nothing: no badge, an entirely
 *  live-looking interface, and the other person's edits silently stop
 *  arriving while both of them keep typing.
 *
 *  The server has modelled this the whole time. `PeerNetwork.state()`
 *  answers `connected` per member and `GET /projects/{id}/collab` serves it;
 *  one sheet polled it and threw the array away everywhere else.
 *
 *  And because `Collaborators` returned null whenever nobody was rendered,
 *  three different situations were the same empty space in the tab strip: a
 *  peer arriving, a peer present but not drawn, and a peer gone for good.
 *  The Windows laptop watched a share shut down and sampled its own screen
 *  once a second across the window: every sample was identical. A writer
 *  whose only collaborator has permanently gone sees exactly what they saw
 *  while the collaboration was live.
 */

export type Member = { peer: string; name: string; connected: boolean; removed?: boolean };
export type Share = { shared: boolean; me: string; members: Member[] } | null;

/** Where a share has got to, from the tab strip's point of view. */
export type Standing =
  /** Not shared, or shared with nobody yet. Draws nothing: an empty strip
   *  labelled "collaborators" on a project with no collaborators is a
   *  permanent reminder of a feature you are not using. */
  | "none"
  /** Shared, somebody has joined, and none of them is connected. This is
   *  the one that was missing, and it covers a peer who has not arrived
   *  yet as well as one who has gone. */
  | "away"
  /** At least one other member's link is up. */
  | "present";

/** The members of a share other than this install, ignoring anybody who
 *  has been removed from it. */
export function others(share: Share): Member[] {
  if (!share?.shared) return [];
  return share.members.filter((m) => m.peer !== share.me && !m.removed);
}

export function peerStanding(share: Share): Standing {
  const rest = others(share);
  if (!rest.length) return "none";
  return rest.some((m) => m.connected) ? "present" : "away";
}

/** What to say when nobody is connected. Named, because "not connected" on
 *  its own is the sentence the browser socket already uses for something
 *  else, and the two must not be read as one thing. */
export function awayWords(share: Share): string {
  const rest = others(share).filter((m) => !m.connected);
  const names = rest.map((m) => m.name.trim()).filter(Boolean);
  if (!names.length) return "Sharing, nobody connected";
  if (names.length === 1) return `Sharing with ${names[0]}, not connected`;
  if (names.length === 2) return `Sharing with ${names[0]} and ${names[1]}, neither connected`;
  return `Sharing with ${names.length} people, none connected`;
}
