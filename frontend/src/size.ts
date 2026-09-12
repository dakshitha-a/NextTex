/** A number of bytes, in the words somebody deciding something would use.
 *
 *  Extracted from the history panel, which had the only copy, because the
 *  file tree now says what emptying a history freed and the settings for
 *  what one is holding say the same thing in the same units. Two
 *  formatters would eventually round the same number two ways in two
 *  places on one screen.
 */
export function sizeOf(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
