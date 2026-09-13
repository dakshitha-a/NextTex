/** The lines of a unified diff worth drawing.
 *
 *  Everything from the first `@@` on. The agent's edit chip dropped the
 *  first four lines instead, which is exactly the header `jsdiff` writes
 *  and not the one git writes: git puts `diff --git` and `index` in front,
 *  and `new file mode` when there is one, so a fixed count either cuts a
 *  hunk line or leaves a header line in.
 *
 *  A patch with no `@@` at all comes back whole, because "Binary files a/x
 *  and b/x differ" is one line with no hunk and it should be read rather
 *  than vanish.
 */
export function hunksOf(patch: string): string[] {
  const lines = patch.replace(/\n$/, "").split("\n");
  const first = lines.findIndex((line) => line.startsWith("@@"));
  return first === -1 ? lines : lines.slice(first);
}
