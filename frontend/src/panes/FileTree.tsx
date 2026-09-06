import { useCallback, useMemo, useRef, useState } from "react";
import { toShell, viewportHeight, viewportWidth } from "../viewport";
import { useDismiss } from "../useDismiss";
import api, { startDownload, type TreeNode } from "../api";
import { get, set, useStore } from "../store";
import { ancestorsOf, collisions } from "../tree";
import UploadStaging, { type Staging } from "./UploadStaging";
import FolderChooser from "./FolderChooser";
import PapersChooser from "./PapersChooser";

/** 13px is the width of a Source Sans lowercase n at 13px, so indentation
 *  reads as a typographic quad rather than an arbitrary gap. */
const INDENT = 13;

/** The drop target that is not a row.  The project root has no node of its
 *  own, which is also why nothing could be created there until now. */
const ROOT_DROP = "\u0000root";

function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

export default function FileTree({
  onOpen,
  onRefresh,
  onRename,
  onHistory,
  mainFile,
}: {
  onOpen: (path: string) => void;
  onRefresh: () => void;
  /** A file has a new name: whatever holds it open needs to know. */
  onRename?: (from: string, to: string) => void;
  onHistory?: () => void;
  mainFile?: string;
}) {
  const tree = useStore((s) => s.tree);
  const activePath = useStore((s) => s.activePath);
  const tabs = useStore((s) => s.tabs);
  const diagnostics = useStore((s) => s.diagnostics);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState<
    { parent: string; directory: boolean; fromBar?: boolean } | null
  >(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // A roving tabindex: the tree is one stop, and the arrow keys move
  // inside it.  Forty files should not be forty tab presses.
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const order = useRef<{ path: string; directory: boolean; open: boolean }[]>([]);
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRef, menu !== null, closeMenu);
  const uploadTo = useRef<string>("");
  // Where the picker was started from, so focus can go back there when the
  // chooser closes, and whether that gesture named a folder of its own.
  const uploadFrom = useRef<HTMLElement | null>(null);
  const uploadAsked = useRef(false);
  const [staging, setStaging] = useState<Staging | null>(null);
  // Moving a file is a rename with a folder in it.  Over months a
  // dissertation does get reorganised, and the only route before this was
  // to rename a file to a path and hope that worked.
  const [papersFor, setPapersFor] =
    useState<{ name: string; at: { x: number; y: number } } | null>(null);
  const [moving, setMoving] =
    useState<{ path: string; to: string; at: { x: number; y: number } } | null>(null);
  // Typing in the tree jumps to a file, which is why there is no filter
  // box taking up a third of a bar that is 240px wide.
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const errorsByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of diagnostics) {
      if (item.severity !== "error" || !item.file) continue;
      counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
    }
    return counts;
  }, [diagnostics]);

  const dirty = useMemo(
    () => new Set(tabs.filter((tab) => tab.dirty).map((tab) => tab.path)),
    [tabs],
  );

  /** Show a file that has just been written.
   *
   *  A file that lands inside a collapsed folder has, from where the
   *  writer is sitting, not landed at all. */
  const reveal = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setCollapsed((current) => {
      const next = new Set(current);
      for (const path of paths) for (const parent of ancestorsOf(path)) next.delete(parent);
      return next;
    });
    setFocusPath(paths[0]);
    window.requestAnimationFrame(() => {
      for (const path of paths) {
        const row = document.querySelector<HTMLElement>(
          `[data-path="${CSS.escape(path)}"]`,
        );
        if (!row) continue;
        row.classList.remove("nx-row-flash");
        void row.offsetWidth;            // restart it if it is already on
        row.classList.add("nx-row-flash");
        window.setTimeout(() => row.classList.remove("nx-row-flash"), 950);
      }
      document
        .querySelector<HTMLElement>(`[data-path="${CSS.escape(paths[0])}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  /** Start an upload.  The chooser opens only when there is something to
   *  ask: which folder, or what to do about a name already taken. */
  const stage = useCallback(
    (files: File[], directory: string, ask: boolean, at: { x: number; y: number },
     from: HTMLElement | null) => {
      const projectId = get().projectId;
      if (!projectId || !files.length) return;
      const clash = collisions(get().tree, directory, files.map((f) => f.name));
      if (!ask && !clash.length) {
        api
          .uploadFiles(projectId, directory, files)
          .then((answer) => {
            onRefresh();
            reveal(answer.written ?? []);
          })
          .catch((error: any) => set({ error: error.message }));
        return;
      }
      setStaging({ files, directory, askDestination: ask, at, returnTo: from });
    },
    [onRefresh, reveal],
  );

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const act = async (action: string, node: TreeNode) => {
    const projectId = get().projectId;
    if (!projectId) return;
    setMenu(null);
    try {
      if (action === "download") {
        startDownload(
          api.downloadUrl(projectId, {
            path: node.path,
            format: isDir(node) ? "zip" : undefined,
          }),
        );
      } else if (action === "delete") {
        // No confirmation: deleting now moves the file to the trash with
        // its history, and asking twice about something that is one click
        // from coming back is friction for nothing.
        await api.deleteFile(projectId, node.path);
        onRefresh();
      } else if (action === "rename") {
        setRenaming(node.path);
      } else if (action === "newfile" || action === "newfolder") {
        const parent = isDir(node) ? node.path : dirname(node.path);
        if (parent) setCollapsed((current) => {
          const next = new Set(current);
          next.delete(parent);
          return next;
        });
        setCreating({ parent, directory: action === "newfolder" });
      } else if (action === "main") {
        await api.setMain(projectId, node.path);
        onRefresh();
      } else if (action === "history") {
        onOpen(node.path);
        onHistory?.();
      } else if (action === "papers") {
        const box = menuRef.current?.getBoundingClientRect();
        setPapersFor({
          name: node.name,
          at: { x: box ? toShell(box.left) : 120, y: box ? toShell(box.top) : 120 },
        });
      } else if (action === "move") {
        const box = menuRef.current?.getBoundingClientRect();
        setMoving({
          path: node.path,
          to: dirname(node.path),
          at: { x: box ? toShell(box.left) : 120, y: box ? toShell(box.top) : 120 },
        });
      } else if (action === "upload") {
        uploadTo.current = isDir(node) ? node.path : dirname(node.path);
        uploadAsked.current = false;
        uploadFrom.current = document.querySelector<HTMLElement>(
          `[data-path="${CSS.escape(node.path)}"] [aria-label^="Actions for"]`,
        );
        uploadInput.current?.click();
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  const commitRename = async (node: TreeNode, value: string) => {
    setRenaming(null);
    const projectId = get().projectId;
    if (!projectId || !value || value === node.name) return;
    const parent = dirname(node.path);
    const to = parent ? `${parent}/${value}` : value;
    try {
      await api.renameFile(projectId, node.path, to);
      onRename?.(node.path, to);
      onRefresh();
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  const drop = (event: React.DragEvent, node: TreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    // A file dropped on a folder has named its destination by being
    // dropped there, so nothing is asked unless a name collides.
    const directory = node ? (isDir(node) ? node.path : dirname(node.path)) : "";
    stage(files, directory, false,
          { x: event.clientX, y: event.clientY }, null);
  };

  const moveFocus = (path: string) => {
    setFocusPath(path);
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      );
      element?.focus();
    });
  };

  const rows: React.ReactNode[] = [];
  order.current = [];
  const walk = (node: TreeNode, depth: number) => {
    const isDirectory = node.type === "dir";
    const isOpen = !collapsed.has(node.path);
    const [stem, extension] = splitName(node.name);
    const errors = errorsByFile.get(node.path) ?? 0;
    const active = node.path === activePath;

    order.current.push({ path: node.path, directory: isDirectory, open: isOpen });
    rows.push(
      <div
        key={node.path}
        data-path={node.path}
        role="treeitem"
        tabIndex={
          (focusPath ?? activePath ?? tree?.children?.[0]?.path) === node.path ? 0 : -1
        }
        aria-selected={active}
        className={[
          "group relative flex h-[26px] shrink-0 cursor-pointer items-center rounded-[3px] pr-1",
          active ? "bg-surface-2" : "hover:bg-surface-2",
          dropTarget === node.path ? "bg-pen-wash border-b border-pen" : "",
        ].join(" ")}
        style={{ paddingLeft: 10 + depth * INDENT }}
        onClick={() => (isDirectory ? toggle(node.path) : onOpen(node.path))}
        onFocus={() => setFocusPath(node.path)}
        onKeyDown={(event) => {
          // Only keys aimed at the row itself.  The rename box is a child
          // of it, so without this a space in a new name was swallowed and
          // the arrow keys moved the tree's focus instead of the caret --
          // a file could not be renamed to anything with a space in it.
          if (event.target !== event.currentTarget) return;
          const rows = order.current;
          const at = rows.findIndex((row) => row.path === node.path);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            isDirectory ? toggle(node.path) : onOpen(node.path);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
            if (next) moveFocus(next.path);
          } else if (event.key === "ArrowRight") {
            if (isDirectory && !isOpen) toggle(node.path);
            else if (rows[at + 1]) moveFocus(rows[at + 1].path);
          } else if (event.key === "ArrowLeft") {
            if (isDirectory && isOpen) toggle(node.path);
            else {
              const parent = dirname(node.path);
              if (parent) moveFocus(parent);
            }
          } else if (event.key === "F2") {
            act("rename", node);
          } else if (event.key === "Delete") {
            act("delete", node);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDropTarget(isDirectory ? node.path : dirname(node.path) || node.path);
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => drop(event, node)}
      >
        {active ? (
          <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
        ) : null}
        <span className="flex w-4 shrink-0 items-center justify-center text-ink-3">
          {isDirectory ? (
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
              <path
                d={isOpen ? "M0 2 L4 6 L8 2" : "M2 0 L6 4 L2 8"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          ) : null}
        </span>
        {renaming === node.path ? (
          <input
            autoFocus
            defaultValue={node.name}
            className="t-ui min-w-0 flex-1 border-b border-pen outline-none"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => commitRename(node, event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename(node, event.currentTarget.value.trim());
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <span className="t-ui min-w-0 flex-1 truncate">
            <span className="text-ink">{stem}</span>
            <span className="text-ink-3">{extension}</span>
          </span>
        )}
        {node.path === mainFile ? (
          <span
            className="t-micro mr-2 shrink-0 text-ink-2"
            title="This is the document that gets typeset"
          >
            main
          </span>
        ) : null}
        <span className="flex w-4 shrink-0 items-center justify-end">
          {errors > 0 ? (
            <span className="t-micro text-error group-hover:hidden">{errors}</span>
          ) : dirty.has(node.path) ? (
            <span className="h-[5px] w-[5px] rounded-full bg-ink-2 group-hover:hidden" />
          ) : null}
          <button
            className="quiet opacity-0 focus:opacity-100 group-hover:opacity-100"
            aria-label={`Actions for ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              // `getBoundingClientRect` answers in viewport pixels even
              // inside the zoomed shell, and everything downstream -- the
              // widths below, the `style.left` this ends up in -- is in the
              // shell's own pixels.  Convert here, once, so nothing further
              // down has to know.
              const box = (event.target as HTMLElement).getBoundingClientRect();
              setMenuAt({
                x: Math.min(toShell(box.right) - 184, viewportWidth() - 192),
                y: Math.min(toShell(box.bottom) + 4, viewportHeight() - 220),
              });
              setMenu(menu === node.path ? null : node.path);
            }}
          >
            ⋯
          </button>
        </span>
        {menu === node.path ? (
          <div
            ref={menuRef}
            data-testid="file-menu"
            // Fixed, not absolute: an absolute menu is clipped by the
            // tree's own scroll box, so the last row's menu was cut in half.
            className="fixed z-40 w-[184px] rounded-[5px] border border-line bg-surface py-1 shadow-float"
            style={menuAt ? { left: menuAt.x, top: menuAt.y } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {[
              ["rename", "Rename"],
              ["move", "Move to…"],
              // A .bib file's reason to have a menu opened on it at all is
              // its contents, which is why this sits with "set as main
              // document" rather than at the bottom with the file
              // operations every row has.
              ...(!isDirectory && /\.bib$/i.test(node.name)
                ? [["papers", "Add papers from a folder…"]]
                : []),
              ...(!isDirectory && /\.(tex|ltx)$/i.test(node.name) &&
              node.path !== mainFile
                ? [["main", "Set as main document"]]
                : []),
              ...(!isDirectory ? [["history", "History"]] : []),
              ["download", isDirectory ? "Download as zip" : "Download"],
              ["upload", "Upload here"],
              ["newfile", "New file here"],
              ["newfolder", "New folder here"],
              ["delete", isDirectory ? "Move folder to trash" : "Move to trash"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={[
                  "block w-full px-3 py-[3px] text-left t-ui hover:bg-surface-2",
                  key === "delete" ? "hover:text-error" : "",
                ].join(" ")}
                onClick={() => act(key, node)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>,
    );

    // Only a folder hosts the row for what is being created inside it.
    // This compared a file row's parent to "", so creating anything at the
    // root put an input under every file in the project -- each one
    // stealing the focus from the last, and the blur cancelling it.
    if (creating && isDirectory && creating.parent === node.path) {
      rows.push(
        <NewName
          key={`${node.path}-new`}
          depth={depth + 1}
          directory={creating.directory}
          prefix={creating.fromBar ? creating.parent : ""}
          onCancel={() => setCreating(null)}
          onCommit={(name) => createEntry(name, creating.parent, creating.directory)}
        />,
      );
    }

    if (isDirectory && isOpen) {
      for (const child of node.children ?? []) walk(child, depth + 1);
    }
  };

  if (tree) for (const child of tree.children ?? []) walk(child, 0);
  if (creating && creating.parent === "") {
    rows.unshift(
      <NewName
        key="new-at-root"
        depth={0}
        directory={creating.directory}
        onCancel={() => setCreating(null)}
        onCommit={(name) => createEntry(name, "", creating.directory)}
      />,
    );
  }

  /** Make it, show it, and open it if it is a file worth typing into. */
  const createEntry = async (
    name: string,
    parent: string,
    directory: boolean,
  ): Promise<string> => {
    const projectId = get().projectId;
    if (!projectId) return "";
    const path = parent ? `${parent}/${name}` : name;
    try {
      await api.newFile(projectId, path, directory);
    } catch (error: any) {
      if (error.status === 409) {
        return `There is already a ${name} here.`;
      }
      return error.message;
    }
    setCreating(null);
    onRefresh();
    if (directory) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      reveal([`${path}/`]);
      setFocusPath(path);
    } else {
      // A new .tex file exists to be typed into.  Leaving it closed makes
      // the writer click the thing they have just made.
      reveal([path]);
      onOpen(path);
    }
    return "";
  };

  const startCreate = (directory: boolean) => {
    // Wherever the writer is looking, or the root.  "New file here" on a
    // row means beside that file; from the bar it means the folder the
    // tree is focused on, and the row that appears says which.
    const anchor = focusPath ?? activePath ?? "";
    const known = order.current.find((row) => row.path === anchor);
    const parent = !anchor
      ? ""
      : known?.directory
        ? anchor
        : dirname(anchor);
    if (parent) setCollapsed((current) => {
      const next = new Set(current);
      next.delete(parent);
      return next;
    });
    setCreating({ parent, directory, fromBar: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilesBar
        onNewFile={() => startCreate(false)}
        onNewFolder={() => startCreate(true)}
        dropping={dropTarget === ROOT_DROP}
        onUpload={(event) => {
          uploadTo.current = rememberedUpload();
          uploadAsked.current = true;
          uploadFrom.current = event.currentTarget;
          uploadInput.current?.click();
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDropTarget(ROOT_DROP);
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => drop(event, null)}
      />
      <div
        className="min-h-0 flex-1 overflow-auto py-[6px]"
        role="tree"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDropTarget(ROOT_DROP);
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => drop(event, null)}
        onPaste={(event) => {
          // Screenshot to figure, which in chemistry writing is a loop
          // somebody runs all afternoon.  The clipboard has no filename,
          // so it gets a dated one and goes through the same chooser as
          // everything else rather than landing somewhere by surprise.
          const items = Array.from(event.clipboardData?.files ?? []);
          const images = items.filter((file) => file.type.startsWith("image/"));
          if (!images.length) return;
          event.preventDefault();
          const day = new Date().toISOString().slice(0, 10);
          const named = images.map((file, index) => {
            const extension = file.type.split("/")[1]?.split("+")[0] ?? "png";
            return new File(
              [file],
              `pasted-${day}${images.length > 1 ? `-${index + 1}` : ""}.${extension}`,
              { type: file.type },
            );
          });
          stage(named, rememberedUpload(), true, { x: 120, y: 120 }, null);
        }}
        onKeyDown={(event) => {
          // Type-ahead: the reason there is no filter box.  A printable
          // character jumps to the next visible row that starts with what
          // has been typed, and the buffer clears after a pause.
          if (event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
          if ((event.target as HTMLElement).tagName === "INPUT") return;
          const now = Date.now();
          const buffer =
            now - typed.current.at < 700 ? typed.current.text + event.key : event.key;
          typed.current = { text: buffer, at: now };
          const rows = order.current;
          const from = rows.findIndex((row) => row.path === focusPath);
          const search = buffer.toLowerCase();
          const hit =
            rows.slice(from + 1).find((row) => nameOf(row.path).startsWith(search)) ??
            rows.find((row) => nameOf(row.path).startsWith(search));
          if (hit) moveFocus(hit.path);
        }}
      >
        {rows}
      </div>
      <input
        ref={uploadInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset, or picking the same file twice fires no change event.
          event.target.value = "";
          const box = uploadFrom.current?.getBoundingClientRect();
          stage(
            files,
            uploadTo.current,
            uploadAsked.current,
            { x: box ? toShell(box.left) : 120, y: box ? toShell(box.bottom) + 4 : 120 },
            uploadFrom.current,
          );
        }}
      />
      {papersFor ? (
        <PapersChooser
          bibName={papersFor.name}
          at={papersFor.at}
          onClose={() => setPapersFor(null)}
          onStarted={() => setPapersFor(null)}
        />
      ) : null}
      {moving ? (
        <MoveTo
          moving={moving}
          onChange={(to) => setMoving((current) => current && { ...current, to })}
          onCancel={() => setMoving(null)}
          onMove={async () => {
            const projectId = get().projectId;
            const name = moving.path.split("/").pop()!;
            const to = moving.to ? `${moving.to}/${name}` : name;
            setMoving(null);
            if (!projectId || to === moving.path) return;
            try {
              await api.renameFile(projectId, moving.path, to);
              onRename?.(moving.path, to);
              onRefresh();
              reveal([to]);
            } catch (error: any) {
              set({
                error:
                  error.status === 409
                    ? `There is already a ${name} in that folder.`
                    : error.message,
              });
            }
          }}
        />
      ) : null}
      {staging ? (
        <UploadStaging
          staging={staging}
          onClose={() => setStaging(null)}
          onDone={(written) => {
            setStaging(null);
            onRefresh();
            reveal(written);
          }}
        />
      ) : null}
    </div>
  );
}

/** Where the last upload in this project went.  A thesis writer uploads
 *  to `figures/` two hundred times and anywhere else five. */
function rememberedUpload(): string {
  const projectId = get().projectId;
  if (!projectId) return "";
  try {
    return window.localStorage.getItem(`nexttex.upload.${projectId}`) ?? "";
  } catch {
    return "";
  }
}

function nameOf(path: string): string {
  return (path.split("/").pop() ?? "").toLowerCase();
}

/** The bar under the project name.
 *
 *  Every file operation used to hang off a row's menu, which means there
 *  had to *be* a row: a new project holds one empty document, so its first
 *  folder could only be made by opening the menu on `main.tex` and knowing
 *  that "New folder here" resolves to the folder holding it.  That is a
 *  reachability hole rather than a convenience gap, and it is worth 26px
 *  of a rail -- one tree row -- to close.
 *
 *  The project root has no row of its own, so a drop aimed at it has
 *  nowhere to show a highlight.  This bar stands in as that row. */
function FilesBar({
  onNewFile,
  onNewFolder,
  onUpload,
  dropping,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: (event: React.MouseEvent<HTMLButtonElement>) => void;
  dropping: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  const button = "quiet t-micro h-[26px] rounded-[3px] px-2 hover:bg-surface-3";
  return (
    <div
      className={`@container flex h-[26px] shrink-0 items-center border-b border-line px-[10px] ${
        dropping ? "bg-pen-wash" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        className={button}
        aria-label="New file"
        title="Create a new file in the project"
        data-testid="new-file"
        onClick={onNewFile}
      >
        {/* The short forms are substrings of the accessible name, so a
            voice command matching what is on screen still works. */}
        <span className="hidden @[208px]:inline">New file</span>
        <span className="@[208px]:hidden">File</span>
      </button>
      <button
        className={button}
        aria-label="New folder"
        title="Create a new folder in the project"
        data-testid="new-folder"
        onClick={onNewFolder}
      >
        <span className="hidden @[208px]:inline">New folder</span>
        <span className="@[208px]:hidden">Folder</span>
      </button>
      <button
        className={`${button} ${dropping ? "border-b border-pen text-hint" : ""}`}
        title="Upload files into the project"
        data-testid="upload"
        onClick={onUpload}
      >
        Upload
      </button>
      <span className="flex-1" />
    </div>
  );
}

/** A file without an extension is almost always a .tex file somebody was
 *  in a hurry about.  A folder called `v1.2` is not. */
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

export function finishedName(typed: string, directory: boolean): string {
  const name = typed.trim();
  if (directory || !name || HAS_EXTENSION.test(name)) return name;
  return `${name}.tex`;
}

export function nameProblem(typed: string): string {
  const name = typed.trim();
  if (!name) return "";
  if (name.includes("/") || name.includes("\\")) {
    return "A name cannot contain a slash.";
  }
  if (name.startsWith(".")) return "A name cannot start with a dot.";
  if (name === "." || name === "..") return "A name cannot be just dots.";
  return "";
}

function NewName({
  depth,
  directory,
  prefix,
  onCommit,
  onCancel,
}: {
  depth: number;
  directory: boolean;
  /** Shown when the row was started from the bar rather than from a row,
   *  where an indent alone does not say which folder it landed in --
   *  especially if that folder is scrolled out of sight. */
  prefix?: string;
  /** Returns a message to show in place, or "" when it worked.  A
   *  collision belongs at the point of the mistake rather than in a strip
   *  at the other end of the app. */
  onCommit: (name: string) => Promise<string>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const commit = async (typed: string) => {
    const trouble = nameProblem(typed);
    if (trouble) {
      setProblem(trouble);
      return;
    }
    const name = finishedName(typed, directory);
    if (!name) {
      onCancel();
      return;
    }
    setBusy(true);
    const failed = await onCommit(name);
    setBusy(false);
    if (failed) setProblem(failed);
  };

  const adding = !directory && value.trim() && !HAS_EXTENSION.test(value.trim());

  return (
    <div
      className={`flex flex-col justify-center bg-surface-2 ${
        problem ? "h-[44px]" : "h-[26px]"
      }`}
      style={{ paddingLeft: 10 + depth * INDENT, paddingRight: 10 }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {prefix ? (
          <span className="t-ui shrink-0 truncate text-ink-3">{prefix}/</span>
        ) : null}
        <input
          autoFocus
          disabled={busy}
          value={value}
          placeholder={directory ? "figures" : "new-file.tex"}
          className={`t-ui min-w-0 flex-1 border-b bg-transparent outline-none placeholder:text-ink-3 ${
            problem ? "border-error" : "border-pen"
          }`}
          onChange={(event) => {
            setValue(event.target.value);
            if (problem) setProblem("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit(event.currentTarget.value);
            if (event.key === "Escape") onCancel();
          }}
          // No commit on blur: a name that fails validation would vanish
          // along with what was typed the moment the message was read.
          onBlur={() => {
              if (!value.trim() && !problem) onCancel();
          }}
        />
        {adding ? (
          <span aria-hidden className="t-micro shrink-0 text-ink-3">
            adds .tex
          </span>
        ) : null}
      </div>
      {problem ? <p className="t-micro truncate text-error">{problem}</p> : null}
    </div>
  );
}

function isDir(node: TreeNode): boolean {
  return node.type === "dir";
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** Where this file should live instead. */
function MoveTo({
  moving,
  onChange,
  onCancel,
  onMove,
}: {
  moving: { path: string; to: string; at: { x: number; y: number } };
  onChange: (to: string) => void;
  onCancel: () => void;
  onMove: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const [open, setOpen] = useState(true);
  const card = useRef<HTMLDivElement | null>(null);
  useDismiss(card, true, onCancel);
  const name = moving.path.split("/").pop() ?? moving.path;

  return (
    <div
      ref={card}
      role="dialog"
      aria-labelledby="move-heading"
      data-testid="move-to"
      className="nx-arrive fixed z-40 w-[264px] rounded-[5px] border border-line bg-surface shadow-float"
      style={{
        left: Math.min(moving.at.x, viewportWidth() - 272),
        top: Math.min(moving.at.y, viewportHeight() - 260),
      }}
    >
      <div id="move-heading" className="t-ui truncate px-[10px] pt-2 text-ink">
        Move {name}
      </div>
      <FolderChooser
        tree={tree}
        directory={moving.to}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        onSelect={(path, confirm) => {
          onChange(path);
          if (confirm) setOpen(false);
        }}
      />
      <div className="flex h-[32px] items-center justify-end gap-2 border-t border-line px-[10px]">
        <button className="ghost-button h-[28px] px-3 t-ui" onClick={onMove}>
          Move
        </button>
        <button className="quiet h-[28px] px-2 t-ui" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
