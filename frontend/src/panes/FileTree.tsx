import { useCallback, useMemo, useRef, useState } from "react";
import { useDismiss } from "../useDismiss";
import api, { startDownload, type TreeNode } from "../api";
import { get, set, useStore } from "../store";

/** 13px is the width of a Source Sans lowercase n at 13px, so indentation
 *  reads as a typographic quad rather than an arbitrary gap. */
const INDENT = 13;

function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

export default function FileTree({
  onOpen,
  onRefresh,
  onHistory,
  mainFile,
}: {
  onOpen: (path: string) => void;
  onRefresh: () => void;
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
  const [creating, setCreating] =
    useState<{ parent: string; directory: boolean } | null>(null);
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
        setCreating({ parent, directory: action === "newfolder" });
      } else if (action === "main") {
        await api.setMain(projectId, node.path);
        onRefresh();
      } else if (action === "history") {
        onOpen(node.path);
        onHistory?.();
      } else if (action === "upload") {
        uploadTo.current = isDir(node) ? node.path : dirname(node.path);
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
    try {
      await api.renameFile(projectId, node.path, parent ? `${parent}/${value}` : value);
      onRefresh();
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  const drop = async (event: React.DragEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const projectId = get().projectId;
    const files = Array.from(event.dataTransfer.files);
    if (!projectId || !files.length) return;
    const directory = isDir(node) ? node.path : dirname(node.path);
    try {
      await api.uploadFiles(projectId, directory, files);
      onRefresh();
    } catch (error: any) {
      set({ error: error.message });
    }
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
            className="t-micro mr-1 shrink-0 rounded-[3px] bg-surface-3 px-1 text-ink-3"
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
              const box = (event.target as HTMLElement).getBoundingClientRect();
              setMenuAt({
                x: Math.min(box.right - 184, window.innerWidth - 192),
                y: Math.min(box.bottom + 4, window.innerHeight - 220),
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
            // Fixed, not absolute: an absolute menu is clipped by the
            // tree's own scroll box, so the last row's menu was cut in half.
            className="fixed z-40 w-[184px] rounded-[5px] border border-line bg-surface py-1 shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
            style={menuAt ? { left: menuAt.x, top: menuAt.y } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {[
              ["rename", "Rename"],
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

    if (creating && creating.parent === (isDirectory ? node.path : "")) {
      rows.push(
        <NewName
          key={`${node.path}-new`}
          depth={depth + 1}
          directory={creating.directory}
          onCancel={() => setCreating(null)}
          onCommit={async (name) => {
            const projectId = get().projectId;
            setCreating(null);
            if (!projectId || !name) return;
            try {
              await api.newFile(
                projectId,
                creating.parent ? `${creating.parent}/${name}` : name,
                creating.directory,
              );
              onRefresh();
            } catch (error: any) {
              set({ error: error.message });
            }
          }}
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
        onCommit={async (name) => {
          const projectId = get().projectId;
          setCreating(null);
          if (!projectId || !name) return;
          try {
            await api.newFile(projectId, name, creating.directory);
            onRefresh();
          } catch (error: any) {
            set({ error: error.message });
          }
        }}
      />,
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-[6px]" role="tree">
      {rows}
      <input
        ref={uploadInput}
        type="file"
        multiple
        className="hidden"
        onChange={async (event) => {
          const projectId = get().projectId;
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!projectId || !files.length) return;
          try {
            await api.uploadFiles(projectId, uploadTo.current, files);
            onRefresh();
          } catch (error: any) {
            set({ error: error.message });
          }
        }}
      />
    </div>
  );
}

function NewName({
  depth,
  directory,
  onCommit,
  onCancel,
}: {
  depth: number;
  directory: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex h-[26px] items-center bg-surface-2"
      style={{ paddingLeft: 10 + depth * INDENT }}
    >
      <input
        autoFocus
        placeholder={directory ? "new folder" : "new-file.tex"}
        className="t-ui min-w-0 flex-1 border-b border-pen outline-none placeholder:text-ink-3"
        onBlur={(event) => onCommit(event.target.value.trim())}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(event.currentTarget.value.trim());
          if (event.key === "Escape") onCancel();
        }}
      />
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
