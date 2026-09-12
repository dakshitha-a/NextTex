/** Whether the character about to be typed at `pos` is escaped.
 *
 *  A dollar is in the editor's closing-bracket set so that opening maths
 *  gives the writer the closer, and `closeBrackets` decides by what
 *  follows the caret: at the end of a line there is nothing there, so it
 *  pairs. `\$` is the opposite of maths, and a price typed at the end of a
 *  sentence came out as `\$100 in all.$`.
 *
 *  Counting the run rather than looking at one character, because `\\$`
 *  is a line break followed by real maths and must still pair: an odd
 *  number of backslashes escapes, an even number is that many literal
 *  backslashes and escapes nothing.
 */
export function isEscaped(text: string, pos: number): boolean {
  let slashes = 0;
  while (pos - slashes > 0 && text[pos - slashes - 1] === "\\") slashes += 1;
  return slashes % 2 === 1;
}
