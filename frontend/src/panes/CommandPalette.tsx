import { useEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, type Action } from "../actions";
import { applyAppearance, storedAppearance } from "../appearance";
import { shortcut } from "../keys";
import { fileItems, settingItems, type SettingItem } from "../palette-items";
import { rank } from "../palette-rank";
import { Sheet } from "../ui/Sheet";
import { Field } from "../ui/controls";
import { SearchIcon } from "../ui/icons";
import { useStore } from "../store";

/** One box that finds every action, setting and file by typing.
 *
 *  The chords in `actions.ts`, the settings sheet's controls and the file
 *  tree are three lists a writer had to remember the way to; this is the
 *  fourth way to any of them, and the one that needs no remembering.
 *  Opened on Mod-K and fetched then, like the share sheet: most sessions
 *  never open it.  The list is one column with a group name beside each
 *  row, the chord on the right where the action has one, and the row
 *  that is the current value of a setting marked; arrow keys move, Enter
 *  chooses, Escape and a click outside put it away.
 */

type Row =
  | { kind: "action"; id: string; label: string; group: string; chord?: string }
  | { kind: "setting"; id: string; label: string; current: boolean; item: SettingItem }
  | { kind: "file"; id: string; label: string; path: string };

const PER_GROUP = 8;

export default function CommandPalette({
  onClose,
  onRun,
  onOpenFile,
}: {
  onClose: () => void;
  onRun: (id: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const tree = useStore((s) => s.tree);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const box = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const look = storedAppearance();
    const actions: Row[] = ACTIONS.filter((action: Action) => action.id !== "palette").map(
      (action) => ({ kind: "action", id: `action:${action.id}`, label: action.label, group: action.group, chord: action.chord }),
    );
    const settings: Row[] = settingItems().map((item) => ({
      kind: "setting", id: `setting:${item.id}`, label: item.label, current: item.current(look), item,
    }));
    const files: Row[] = fileItems(tree).map((path) => ({ kind: "file", id: `file:${path}`, label: path, path }));
    // With nothing typed, the actions and a few files; typing reaches all
    // of it.  Ranked within each kind, so a setting is never buried under
    // forty chapters whose names share a letter with it.
    const trimmed = query.trim();
    const shown = (kind: Row[]) => (trimmed ? rank(trimmed, kind, (row) => row.label) : kind);
    const settingRows = trimmed ? shown(settings) : [];
    return [
      ...shown(actions).slice(0, trimmed ? PER_GROUP * 2 : actions.length),
      ...settingRows.slice(0, PER_GROUP),
      ...shown(files).slice(0, PER_GROUP),
    ];
  }, [query, tree]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === "action") onRun(row.id.slice("action:".length));
    else if (row.kind === "setting") applyAppearance(row.item.apply(storedAppearance()));
    else onOpenFile(row.path);
  };

  return (
    <Sheet open onClose={onClose} label="Command palette" testid="palette" width={420} align="top" list>
        <Field
          ref={box}
          leading={<SearchIcon />}
          value={query}
          placeholder="An action, a setting or a file"
          aria-label="What to find"
          data-testid="palette-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((at) => Math.min(rows.length - 1, at + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((at) => Math.max(0, at - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(rows[selected]);
            }
          }}
        />
        <ul ref={list} role="listbox" aria-label="Matches">
          {rows.length === 0 ? (
            <li className="nx-menu-header">Nothing matches.</li>
          ) : null}
          {rows.map((row, index) => (
            <li
              key={row.id}
              role="option"
              aria-selected={index === selected}
              data-index={index}
              data-testid="palette-row"
              data-kind={row.kind}
              className="nx-menu-item cursor-pointer"
              onPointerMove={() => setSelected(index)}
              onClick={() => choose(row)}
            >
              <span className="nx-menu-kind">
                {row.kind === "action" ? row.group : row.kind === "setting" ? "Setting" : "File"}
              </span>
              <span className={`nx-menu-label ${row.kind === "file" ? "t-code-sm" : ""}`}>
                {row.label}
                {row.kind === "setting" && row.current ? (
                  <span className="t-micro ml-2 text-ink-3">current</span>
                ) : null}
              </span>
              {row.kind === "action" && row.chord ? (
                <span className="nx-menu-hint">{shortcut(row.chord).both}</span>
              ) : null}
            </li>
          ))}
        </ul>
    </Sheet>
  );
}
