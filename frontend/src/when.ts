/** "4 min ago", roughly.
 *
 *  Rough is the point.  The rows that carry this exist so someone can
 *  recognise a machine or a project, and a timestamp to the second invites
 *  reading it as a security log, which none of them are.  Shared between
 *  the access card's browsers and the projects screen's rows so two lists
 *  answering "when" do not answer it two different ways.
 *
 *  `at` is Unix seconds, which is what the server sends.  A zero is a time
 *  that never happened, and the caller has the words for that; this
 *  answers with nothing rather than "56 years ago". */
export function ago(at: number, now: number = Date.now()): string {
  if (!at) return "";
  const seconds = Math.max(0, (now - at * 1000) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
