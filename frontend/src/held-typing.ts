/** Typing held for a text box that is not on screen yet.
 *
 *  A chord that opens a box whose code is still being fetched left the
 *  caret where it was, so the first letters went into the document: the
 *  probe's first search word landed as a line of `main.tex` (Q-067). While
 *  the box is on its way, this takes the keyboard off the page, keeps the
 *  letters, and hands them to the box when it arrives. */

export type Held = {
  /** Stop holding, and give back what was typed. */
  stop(): string;
};

export function holdTyping(target: Window = window): Held {
  let text = "";
  const active = target.document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1) text += event.key;
    else if (event.key === "Backspace") text = text.slice(0, -1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener("keydown", onKey, true);
  return {
    stop() {
      target.removeEventListener("keydown", onKey, true);
      return text;
    },
  };
}
