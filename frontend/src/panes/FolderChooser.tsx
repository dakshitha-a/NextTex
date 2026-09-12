import { useMemo, useRef, useState } from "react";
import { Chevron } from "../chrome";
import api from "../api";
import { get } from "../store";
import { foldersIn } from "../tree";

/** Pick a folder in this project, and make one if the right one is not
 *  there yet.
 *
 *  Shared by the upload chooser and by moving a file, because they are the
 *  same question asked at different moments, and because the indentation,
 *  the keyboard contract and the "New folder here" wording have to match
 *  the file tree next door exactly or the app stops feeling like one
 *  thing. */
export default function FolderChooser({
  tree,
  directory,
  open,
  onToggle,
  onSelect,
}: {
  tree: any;
  directory: string;
  open: boolean;
  onToggle: () => void;
  /** Selecting and confirming are separate on purpose.  The arrow keys
   *  move the selection with the list still open -- selection follows
   *  focus, which is allowed for a single-select list and is one keystroke
   *  to reverse -- and Enter, Space or a click is what collapses it. */
  onSelect: (path: string, confirm: boolean) => void;
}) {
  const folders = useMemo(() => foldersIn(tree), [tree]);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const here = folders.find((folder) => folder.path === directory) ?? folders[0];

  const move = (delta: number) => {
    const at = folders.findIndex((folder) => folder.path === directory);
    const next = folders[Math.min(Math.max(at + delta, 0), folders.length - 1)];
    if (next) onSelect(next.path, false);
  };

  return (
    <>
      <button
        data-destination
        aria-expanded={open}
        aria-controls="upload-folders"
        className="flex h-[26px] w-full items-center gap-2 px-[10px] text-left hover:bg-surface-2"
        onClick={onToggle}
      >
        <span className="t-micro shrink-0 text-ink-3">Into</span>
        <span className="t-ui min-w-0 flex-1 truncate text-ink">{here.name}</span>
        <span className={`shrink-0 text-ink-3 ${open ? "rotate-180" : ""}`}>
          <Chevron direction="down" />
        </span>
      </button>

      {open ? (
        <div className="border-t border-line">
          <div
            id="upload-folders"
            ref={listRef}
            role="listbox"
            aria-label="Where the files go"
            tabIndex={0}
            className="max-h-[156px] overflow-auto outline-none"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
              else if (event.key === "Home") {
                event.preventDefault();
                onSelect(folders[0].path, false);
              } else if (event.key === "End") {
                event.preventDefault();
                onSelect(folders[folders.length - 1].path, false);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }}
          >
            {folders.map((folder) => (
              <div
                key={folder.path || "root"}
                role="option"
                aria-selected={folder.path === directory}
                data-folder={folder.path}
                className={`relative flex h-[26px] cursor-pointer items-center pr-[10px] ${
                  folder.path === directory ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
                style={{ paddingLeft: 10 + folder.depth * 13 }}
                onClick={() => onSelect(folder.path, true)}
              >
                {folder.path === directory ? (
                  <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
                ) : null}
                <span className="t-ui truncate text-ink">{folder.name}</span>
              </div>
            ))}
          </div>

          {making ? (
            <div className="border-t border-line px-[10px] py-1">
              <input
                autoFocus
                placeholder="figures"
                className={`t-ui w-full border-b bg-transparent outline-none placeholder:text-ink-3 ${
                  problem ? "border-error" : "border-pen"
                }`}
                // Cleared as they type, which is what the rename box in
                // the file tree already does. It was cleared only on
                // Escape and on success, so "There is already a figures
                // folder here" stayed under the field while the writer
                // typed a different name, and stayed red while they did.
                onChange={() => setProblem("")}
                onKeyDown={async (event) => {
                  if (event.key === "Escape") { setMaking(false); setProblem(""); return; }
                  if (event.key !== "Enter") return;
                  const name = event.currentTarget.value.trim();
                  const projectId = get().projectId;
                  if (!name || !projectId) return;
                  const path = directory ? `${directory}/${name}` : name;
                  try {
                    await api.newFile(projectId, path, true);
                    setMaking(false);
                    setProblem("");
                    onSelect(path, true);
                  } catch (error: any) {
                    setProblem(
                      error.status === 409
                        ? `There is already a ${name} folder here.`
                        : error.message,
                    );
                  }
                }}
              />
              {problem ? (
                <p className="t-micro mt-1 text-error">{problem}</p>
              ) : null}
            </div>
          ) : (
            <button
              className="block w-full border-t border-line px-[10px] py-[3px] text-left t-ui text-ink-2 hover:text-hint"
              onClick={() => setMaking(true)}
            >
              New folder here
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
