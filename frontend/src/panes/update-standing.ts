/** What the update footer should say, before it says anything about the
 *  repository.
 *
 *  The instance route used to answer one field, `head`, by running
 *  `git rev-parse HEAD` when it was asked. That reads the working tree,
 *  which is the code on disk, and the question the footer is asking is
 *  what the running process loaded. An update moves the first without
 *  touching the second, and a Windows laptop was found serving day-old
 *  code while three separate places on screen agreed it was current: the
 *  instance banner, the commit under it, and the footer, all reporting the
 *  same disk commit and comparing it to a remote it matched.
 *
 *  So there are two commits now, and the interesting case is when they
 *  disagree, which means the files have moved forward and nothing has
 *  restarted to run them. It is worth saying before any claim about the
 *  repository, because "up to date" is true of the disk and false of the
 *  process, and it is the process the writer is using.
 */

export type Standing = "" | "restart";

export function standingOf(self: { head?: string; diskHead?: string } | null): Standing {
  if (!self) return "";
  const { head, diskHead } = self;
  // Both have to be known. An install that is not a git checkout answers
  // empty for both, and a git that failed answers empty for one, and
  // neither is evidence that anything moved.
  if (!head || !diskHead) return "";
  return head === diskHead ? "" : "restart";
}
