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

/** Focus the first item of a menu the moment it mounts.  A ref callback,
 *  to be handed a stable function: an inline arrow is a new function on
 *  every render, and React calls a new ref with the node again, which put
 *  focus back on the first row a beat after an arrow key had moved it. */
export function focusFirst(node: HTMLElement | null): void {
  node?.querySelector<HTMLElement>(ITEMS)?.focus();
}
