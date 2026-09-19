import type { KeyboardEvent } from "react";

/** Every kind of item a menu can hold, enabled. */
const ITEMS =
  "[role=menuitem]:not([disabled]), [role=menuitemradio]:not([disabled]), " +
  "[role=menuitemcheckbox]:not([disabled])";

/** What `role="menu"` promises, in one handler.
 *
 *  The spelling menu grew this first: focus goes into the menu when it
 *  opens, ArrowUp and ArrowDown walk the items and wrap, Home and End go to
 *  the ends, and Escape closes it and gives focus back.  Every menu in the
 *  app that claims the role shares it now: both tab strips' menus and
 *  their hidden-tabs lists, the document chooser, the downloads menu and
 *  the agent panel's mode menu, which is the one made of radio items.
 *
 *  Returns true when the key was taken, so a caller can layer its own
 *  keys on top without the two disagreeing.
 */
export function walkMenu(
  event: KeyboardEvent<HTMLElement>,
  onClose: () => void,
): boolean {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
    return true;
  }
  if (event.key === "Home") {
    event.preventDefault();
    items[0]?.focus();
    return true;
  }
  if (event.key === "End") {
    event.preventDefault();
    items[items.length - 1]?.focus();
    return true;
  }
  return false;
}

/** The same promise for a menu whose rows hold several items each.
 *
 *  The download menu is one: a row per document, a chip per format.  A
 *  linear walk would take ArrowDown from a document's `.pdf` to its own
 *  `.docx`, which reads as a column of four rows where the eye sees one.
 *  So a row is an element marked `data-menu-row`, Left and Right move
 *  along it and stop at its ends, Up and Down move to the item at the
 *  same position in the next row, or its last item when that row is
 *  shorter, and wrap at the ends; Home and End are the first and last
 *  row.  Escape closes.  Returns true when the key was taken.
 */
export function walkGrid(
  event: KeyboardEvent<HTMLElement>,
  onClose: () => void,
): boolean {
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-menu-row]"),
  ).map((row) => Array.from(row.querySelectorAll<HTMLElement>(ITEMS)))
    .filter((row) => row.length > 0);
  const active = document.activeElement as HTMLElement;
  const atRow = rows.findIndex((row) => row.includes(active));
  const atCol = atRow < 0 ? 0 : rows[atRow].indexOf(active);
  const into = (row: HTMLElement[], col: number) =>
    row[Math.min(col, row.length - 1)]?.focus();
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return true;
  }
  if (!rows.length) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const from = atRow < 0 ? (step > 0 ? -1 : 0) : atRow;
    into(rows[(from + step + rows.length) % rows.length], atCol);
    return true;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const row = rows[Math.max(atRow, 0)];
    const step = event.key === "ArrowRight" ? 1 : -1;
    into(row, Math.max(0, atCol + step));
    return true;
  }
  if (event.key === "Home") {
    event.preventDefault();
    into(rows[0], 0);
    return true;
  }
  if (event.key === "End") {
    event.preventDefault();
    into(rows[rows.length - 1], 0);
    return true;
  }
  return false;
}

/** Focus the first item of a menu the moment it mounts.  A ref callback,
 *  to be handed a stable function: an inline arrow is a new function on
 *  every render, and React calls a new ref with the node again, which put
 *  focus back on the first row a beat after an arrow key had moved it. */
export function focusFirst(node: HTMLElement | null): void {
  node?.querySelector<HTMLElement>(ITEMS)?.focus();
}
