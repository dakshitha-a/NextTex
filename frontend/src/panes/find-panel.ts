import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";

/** The editor's find and replace, on the kit, as the direction page draws
 *  it: one field with Aa, .* and whole-word toggles inside it, a "2 of
 *  12" count, previous and next, a Replace control that adds the second
 *  field, and a close. It replaces CodeMirror's own panel markup and
 *  nothing else: the keys and the `search()` commands are the library's,
 *  reached through `runScopeHandlers` for the `search-panel` scope, so
 *  Enter finds the next match, Shift-Enter the previous, and Escape
 *  closes, exactly as before.
 *
 *  Plain DOM rather than React, because a CodeMirror panel is a DOM node
 *  the editor mounts, and mounting a React root inside the editor for
 *  four controls would be a second renderer for one strip. The count is
 *  computed by walking the query's cursor over the document, capped so a
 *  common letter in a book does not stall the keystroke. */

const CAP = 10_000;

const ICONS = {
  search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l5-5 5 5"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function iconButton(label: string, icon: keyof typeof ICONS, name: string): HTMLButtonElement {
  const button = el("button", "nx-find-button", { type: "button", "aria-label": label, title: label, name });
  button.innerHTML = ICONS[icon];
  return button;
}

/** "2 of 12": how many matches there are and which one the selection is on. */
function countMatches(view: EditorView, query: SearchQuery): { total: number; at: number; capped: boolean } {
  if (!query.valid || !query.search) return { total: 0, at: 0, capped: false };
  const { from, to } = view.state.selection.main;
  const cursor = query.getCursor(view.state) as Iterator<{ from: number; to: number }>;
  let total = 0;
  let at = 0;
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    total += 1;
    if (step.value.from === from && step.value.to === to) at = total;
    if (total >= CAP) return { total, at, capped: true };
  }
  return { total, at, capped: false };
}

export function createFindPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state);
  let replacing = Boolean(query.replace);

  const dom = el("div", "cm-search nx-find-panel", { role: "search", "aria-label": "Find and replace" });

  // The field: the icon, the box, and the three toggles inside it.
  const row = el("div", "nx-find-row");
  const field = el("div", "nx-field nx-find-field");
  field.innerHTML = ICONS.search;
  const input = el("input", "nx-find-input", {
    name: "search", placeholder: "Find", "aria-label": "Find", autocomplete: "off", spellcheck: "false",
  });
  input.value = query.search;
  field.append(input);
  const toggles = el("span", "nx-find-toggles");
  const toggle = (label: string, text: string, key: "caseSensitive" | "regexp" | "wholeWord") => {
    const button = el("button", "nx-find-toggle", { type: "button", "aria-label": label, title: label, "aria-pressed": String(query[key]) });
    button.textContent = text;
    button.addEventListener("click", () => {
      commit({ [key]: !query[key] });
      button.setAttribute("aria-pressed", String(query[key]));
      input.focus();
    });
    toggles.append(button);
    return button;
  };
  toggle("Match case", "Aa", "caseSensitive");
  toggle("Regular expression", ".*", "regexp");
  toggle("Whole word", "ab", "wholeWord");
  field.append(toggles);
  row.append(field);

  const count = el("span", "nx-find-count", { "aria-live": "polite" });
  row.append(count);
  const previous = iconButton("Previous match", "up", "prev");
  previous.addEventListener("click", () => findPrevious(view));
  const next = iconButton("Next match", "down", "next");
  next.addEventListener("click", () => findNext(view));
  row.append(previous, next);
  const replaceToggle = el("button", "nx-find-quiet", { type: "button", name: "toggle-replace", "aria-expanded": String(replacing) });
  replaceToggle.textContent = "Replace";
  row.append(replaceToggle);
  const close = iconButton("Close find", "close", "close");
  close.addEventListener("click", () => closeSearchPanel(view));
  row.append(close);
  dom.append(row);

  // The second row, only while replacing.
  const replaceRow = el("div", "nx-find-row nx-find-replace");
  const replaceField = el("div", "nx-field nx-find-field");
  const replaceInput = el("input", "nx-find-input", {
    name: "replace", placeholder: "Replace with", "aria-label": "Replace with", autocomplete: "off", spellcheck: "false",
  });
  replaceInput.value = query.replace;
  replaceField.append(replaceInput);
  replaceRow.append(replaceField);
  const replaceOne = el("button", "nx-find-quiet", { type: "button", name: "replace" });
  replaceOne.textContent = "Replace";
  replaceOne.addEventListener("click", () => replaceNext(view));
  const replaceEvery = el("button", "nx-find-quiet", { type: "button", name: "replaceAll" });
  replaceEvery.textContent = "All";
  replaceEvery.addEventListener("click", () => replaceAll(view));
  replaceRow.append(replaceOne, replaceEvery);

  const showReplace = (on: boolean) => {
    replacing = on;
    replaceToggle.setAttribute("aria-expanded", String(on));
    replaceToggle.classList.toggle("nx-find-quiet-on", on);
    if (on && !replaceRow.isConnected) dom.append(replaceRow);
    if (!on && replaceRow.isConnected) replaceRow.remove();
  };
  replaceToggle.addEventListener("click", () => {
    showReplace(!replacing);
    (replacing ? replaceInput : input).focus();
  });
  if (replacing) showReplace(true);

  const commit = (patch: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>) => {
    query = new SearchQuery({
      search: query.search,
      replace: query.replace,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
      ...patch,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    say();
  };
  input.addEventListener("input", () => commit({ search: input.value }));
  replaceInput.addEventListener("input", () => commit({ replace: replaceInput.value }));

  // Enter in the find field is the next match and Shift-Enter the
  // previous; Enter in the replace field replaces one. The library's own
  // panel binds these on the fields rather than in `searchKeymap`, and so
  // does this one; everything else (Escape, Mod-f, F3) is the keymap's
  // `search-panel` scope.
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
      return;
    }
    if (event.key === "Enter" && event.target === replaceInput) {
      event.preventDefault();
      replaceNext(view);
      return;
    }
    if (runScopeHandlers(view, event, "search-panel")) event.preventDefault();
  });

  const say = () => {
    const { total, at, capped } = countMatches(view, query);
    if (!query.search) {
      count.textContent = "";
      count.hidden = true;
      return;
    }
    count.hidden = false;
    count.textContent = total === 0
      ? "No matches"
      : `${at || "…"} of ${capped ? `${total}+` : total}`;
    count.classList.toggle("nx-find-count-none", total === 0);
  };
  say();

  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
    },
    update(update: ViewUpdate) {
      const changed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)));
      if (changed) {
        query = getSearchQuery(update.state);
        if (input.value !== query.search) input.value = query.search;
        if (replaceInput.value !== query.replace) replaceInput.value = query.replace;
      }
      if (changed || update.docChanged || update.selectionSet) say();
    },
  };
}
