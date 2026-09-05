import { useMemo, useRef, useState } from "react";
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
}: {
  onOpen: (path: string) => void;
  onRefresh: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const activePath = useStore((s) => s.activePath);
  const tabs = useStore((s) => s.tabs);
  const diagnostics = useStore((s) => s.diagnostics);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [creating, setCreating] =
    useState<{ parent: string; directory: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);
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
        // Confirmed in place, in this typeface.  A native confirm() dialog
        // is the one thing that would undo the composing-room premise
        // faster than any colour choice.
        setConfirming(node.path);
      } else if (action === "rename") {
        setRenaming(node.path);
      } else if (action === "newfile" || action === "newfolder") {
        const parent = isDir(node) ? node.path : dirname(node.path);
        setCreating({ parent, directory: action === "newfolder" });
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

  const rows: React.ReactNode[] = [];
  const walk = (node: TreeNode, depth: number) => {
    const isDirectory = node.type === "dir";
    const isOpen = !collapsed.has(node.path);
    const [stem, extension] = splitName(node.name);
    const errors = errorsByFile.get(node.path) ?? 0;
    const active = node.path === activePath;

    rows.push(
      <div
        key={node.path}
        role="treeitem"
        tabIndex={0}
        aria-selected={active}
        className={[
          "group relative flex h-[26px] shrink-0 cursor-default items-center rounded-[3px] pr-1",
          active ? "bg-surface-2" : "hover:bg-surface-2",
          dropTarget === node.path ? "bg-pen-wash border-b border-pen" : "",
        ].join(" ")}
        style={{ paddingLeft: 10 + depth * INDENT }}
        onClick={() => (isDirectory ? toggle(node.path) : onOpen(node.path))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            isDirectory ? toggle(node.path) : onOpen(node.path);
          }
          if (event.key === "F2") act("rename", node);
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
        <span className="flex w-4 shrink-0 items-center justify-end">
          {errors > 0 ? (
            <span className="t-micro text-error group-hover:hidden">{errors}</span>
          ) : dirty.has(node.path) ? (
            <span className="h-[5px] w-[5px] rounded-full bg-ink-2 group-hover:hidden" />
          ) : null}
          <button
            className="hidden text-ink-3 hover:text-ink group-hover:block"
            aria-label={`Actions for ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setMenu(menu === node.path ? null : node.path);
            }}
          >
            ⋯
          </button>
        </span>
        {menu === node.path ? (
          <div
            className="absolute right-1 top-[24px] z-20 w-[168px] rounded-[5px] border border-line bg-surface py-1"
            onClick={(event) => event.stopPropagation()}
          >
            {[
              ["rename", "Rename"],
              ["download", isDirectory ? "Download as zip" : "Download"],
              ["upload", "Upload here"],
              ["newfile", "New file here"],
              ["newfolder", "New folder here"],
              ["delete", "Delete"],
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

    if (confirming === node.path) {
      rows.push(
        <div
          key={`${node.path}-confirm`}
          className="flex h-[26px] items-center gap-2 bg-surface-2"
          style={{ paddingLeft: 10 + depth * INDENT }}
        >
          <span className="t-micro flex-1 truncate text-ink-2">
            Delete {node.name}?
          </span>
          <button
            className="t-micro px-2 text-error"
            onClick={async () => {
              const projectId = get().projectId;
              setConfirming(null);
              if (!projectId) return;
              try {
                await api.deleteFile(projectId, node.path);
                onRefresh();
              } catch (error: any) {
                set({ error: error.message });
              }
            }}
          >
            Delete
          </button>
          <button
            className="t-micro px-2 text-ink-3 hover:text-ink"
            onClick={() => setConfirming(null)}
          >
            Keep
          </button>
        </div>,
      );
    }

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
