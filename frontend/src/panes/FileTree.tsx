import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { toShell, viewportHeight, viewportWidth } from "../viewport";
import { useDismiss } from "../useDismiss";
import { FileIcon, FolderIcon } from "./FileIcon";
import { iconFor, isBib, isData, isTeX } from "./file-kinds";
import api, { startDownload, type TreeNode } from "../api";
import { get, set, useStore } from "../store";
import { sizeOf } from "../size";
import {
  ancestorsOf,
  collisions,
  isInside,
  search as searchTree,
  tabStopFor,
} from "../tree";
import { type Staging } from "./UploadStaging";
// Both open on a deliberate action and neither is on the first paint,
// so a first visit does not download either.
const UploadStaging = lazy(() => import("./UploadStaging"));
import { whatDidNotLand } from "../upload-report";
import FolderChooser from "./FolderChooser";
const PapersChooser = lazy(() => import("./PapersChooser"));

/** 13px is the width of a Source Sans lowercase n at 13px, so indentation
 *  reads as a typographic quad rather than an arbitrary gap. */
const INDENT = 13;

/** The drop target that is not a row.  The project root has no node of its
 *  own, which is also why nothing could be created there until now. */
/** Marks a drag that started in this tree, so a row being moved is not
 *  mistaken for a file being dragged in from the desktop.  The two drops
 *  land on the same handlers and mean opposite things.
 *
 *  Chromium will not let `getData` be read during `dragover` -- only the
 *  type list is visible there -- so whether a move is legal is decided from
 *  `dragging`, and the authoritative path is read from the event at drop.
 *  A drag from another window has no `dragging` and simply does nothing. */
const NX_PATH = "application/x-nexttex-path";

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
  onPreview,
  onUnpreview,
  onAskAbout,
  mainFile,
}: {
  onOpen: (path: string) => void;
  onRefresh: () => void;
  /** A file has a new name: whatever holds it open needs to know. */
  onRename?: (from: string, to: string) => void;
  onHistory?: () => void;
  /** Hand a question about a file to the agent, seeded into the composer.
   *  Used by "Plot this", which is how a writer points at a dataset. */
  onAskAbout?: (prompt: string) => void;
  /** Put a document on the preview strip, or take it off.  Owned by the
   *  shell rather than here, because adding one also brings its tab
   *  forward and opens its source. */
  onPreview?: (path: string) => Promise<void> | void;
  onUnpreview?: (path: string) => Promise<void> | void;
  mainFile?: string;
}) {
  const tree = useStore((s) => s.tree);
  const activePath = useStore((s) => s.activePath);
  const diagnostics = useStore((s) => s.diagnostics);
  /** Empty until a project has been shared, which is exactly when clearing
   *  a history stops being a decision about one disk only. */
  const peerId = useStore((s) => s.peerId);
  /** Which folders are open.  Open, not shut: a project opens with its
   *  tree collapsed, every time, so the first thing a writer sees is the
   *  shape of the document rather than every file in it.  This used to be
   *  the other way round -- a set of the folders that had been *closed*,
   *  starting empty, so everything was open on arrival and a thesis with
   *  eleven chapter folders opened as a hundred-row wall.
   *
   *  It is deliberately not remembered between visits.  Remembering would
   *  make what you see on opening depend on what you did last week, and the
   *  whole value of collapsed-on-open is that it is the same every time. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Which file the menu is asking about clearing, if any. */
  const [purging, setPurging] = useState<string | null>(null);
  /** What the last clearing did, so the writer is told rather than left to
   *  wonder whether anything happened. */
  const [purged, setPurged] = useState<string>("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState<
    { parent: string; directory: boolean; fromBar?: boolean } | null
  >(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // The filter box is opened rather than always present: the rail is 240px
  // and the bar has three buttons in it already.
  const [searching, setSearching] = useState(false);
  // The shortcut that opens a file by name is global, and the box it wants
  // is here. A nonce is how one tells the other to take focus without
  // either owning the other's state.
  const focusSearch = useStore((s) => s.focusTreeSearch);
  const wantsCaret = useRef(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement | null>(null);
  // The ref is read synchronously while a drag is over a row, where React
  // state would be a frame behind; the state exists only to fade the row
  // being dragged, which a ref cannot do because it does not re-render.
  const dragging = useRef<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  // A roving tabindex: the tree is one stop, and the arrow keys move
  // inside it.  Forty files should not be forty tab presses.
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const order = useRef<{ path: string; directory: boolean; open: boolean }[]>([]);
  /** Every path on screen this render, which is what makes a stale
   *  `focusPath` harmless: see `tabStopFor`. */
  const shown = useRef<Set<string>>(new Set());
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Only one menu is open at a time, so one ref is enough: the row that is
  // open claims it, and the dismiss hook leaves that button's own press
  // alone so the trigger can close what it opened.
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const previews = useStore((s) => s.previews);
  const candidates = useStore((s) => s.candidates);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRef, menu !== null, closeMenu, menuButton);
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

  /** Show a file that has just been written.
   *
   *  A file that lands inside a collapsed folder has, from where the
   *  writer is sitting, not landed at all. */
  const reveal = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of paths) for (const parent of ancestorsOf(path)) next.add(parent);
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

  /** Somewhere else made a file and wants it seen.
   *
   *  Duplicating from the tab strip is the case this exists for: the copy
   *  lands beside its original, which can be inside a folder the tree has
   *  shut, and a file nobody can see is a menu item that appeared to do
   *  nothing.  Keyed on the nonce, so revealing the same path twice running
   *  is two events rather than one. */
  const asked = useStore((s) => s.revealInTree);
  useEffect(() => {
    if (!asked) return;
    reveal([asked.path]);
  }, [asked?.nonce]);

  // Mod-Alt-O from anywhere. The row opens if it is closed, and the caret
  // goes into it either way, so pressing the key twice is not a way to
  // shut the box you just asked for.
  //
  // A flag rather than a `focus()` on a timer. The shortcut also unfolds
  // the rail, and the tree is unmounted while the rail is folded, so the
  // element to focus may not exist yet and the one that does may be
  // thrown away a moment later. The input claims the focus itself when it
  // arrives, which is true whichever of those happened.
  useEffect(() => {
    if (!focusSearch) return;
    wantsCaret.current = true;
    setSearching(true);
  }, [focusSearch]);

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
            // A file the server refused is not in the tree, and until this
            // was here nothing said so: the drop simply came up short.
            const trouble = whatDidNotLand(answer.results ?? []);
            if (trouble) set({ error: trouble });
          })
          .catch((error: any) => set({ error: error.message }));
        return;
      }
      setStaging({ files, directory, askDestination: ask, at, returnTo: from });
    },
    [onRefresh, reveal],
  );

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const act = async (action: string, node: TreeNode) => {
    const projectId = get().projectId;
    if (!projectId) return;
    // Clearing a file's versions is the one item here that asks first, and
    // it asks inside the menu rather than in a dialog over the app: the
    // question is about the row the menu is already pointing at, and a
    // sheet in the middle of the screen would lose that.  Trash does not
    // ask, and the difference is real -- the trash keeps what it takes.
    if (action === "purge") {
      setPurging(node.path);
      return;
    }
    setMenu(null);
    setPurging(null);
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
        if (parent) setExpanded((current) => {
          const next = new Set(current);
          next.add(parent);
          return next;
        });
        setCreating({ parent, directory: action === "newfolder" });
      } else if (action === "main") {
        await api.setMain(projectId, node.path);
        onRefresh();
      } else if (action === "preview") {
        await onPreview?.(node.path);
      } else if (action === "unpreview") {
        await onUnpreview?.(node.path);
      } else if (action === "history") {
        onOpen(node.path);
        onHistory?.();
      } else if (action === "plot") {
        // Pointing at a dataset, which is the whole interaction: naming a
        // file in prose is unreliable, and this is the same gesture the
        // selection verbs use one pane over. Seeded rather than sent, for
        // the reason the `Fix` button gives: the writer always presses
        // Enter on their own message, and here the second half of the
        // sentence is what the figure is actually about.
        onAskAbout?.(
          `Plot ${node.path}. Read it first, then say what you plotted and why: `,
        );
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

  /** Move one entry, from the menu or from a drag.  Both call this so the
   *  refusals and the error wording are written once. */
  const moveEntry = async (from: string, directory: string): Promise<void> => {
    const projectId = get().projectId;
    const name = from.split("/").pop()!;
    const to = directory ? `${directory}/${name}` : name;
    if (!projectId || to === from) return;
    // Refused here rather than at the server, where `rename` fails with an
    // errno that means nothing to anybody.
    if (isInside(from, directory)) {
      set({ error: "A folder cannot be moved inside itself." });
      return;
    }
    try {
      await api.renameFile(projectId, from, to);
      onRename?.(from, to);
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
  };

  /** Where a drop on this node lands: a folder takes it, a file means the
   *  folder holding it, and nothing means the project root. */
  const destinationFor = (node: TreeNode | null): string =>
    node ? (isDir(node) ? node.path : dirname(node.path)) : "";

  /** Whether an internal drag may be dropped here.  Dropping something on
   *  the folder it is already in is legal but pointless, and showing it as
   *  refused would be a lie. */
  const canDropInternal = (destination: string): boolean => {
    const from = dragging.current;
    if (!from) return false;
    if (isInside(from, destination)) return false;
    return dirname(from) !== destination;
  };

  const overDrag = (event: React.DragEvent, node: TreeNode | null) => {
    const destination = destinationFor(node);
    if (event.dataTransfer.types.includes(NX_PATH)) {
      // A row answers for itself.  Without this the event went on up to the
      // tree body, which asked the same question about the project root --
      // where the file already was -- said no, and set `dropEffect` back to
      // "none".  Chromium reads the last word, so the drop was refused and
      // the gesture ended in `dragend`: everything looked right except that
      // nothing moved.
      if (node) event.stopPropagation();
      if (!canDropInternal(destination)) {
        event.dataTransfer.dropEffect = "none";
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(node ? destination || ROOT_DROP : ROOT_DROP);
      return;
    }
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDropTarget(node ? destination || ROOT_DROP : ROOT_DROP);
  };

  const drop = (event: React.DragEvent, node: TreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const destination = destinationFor(node);
    // A row from this tree, not a file from the desktop.
    const moved = event.dataTransfer.getData(NX_PATH);
    if (moved) {
      dragging.current = null;
      setDraggingPath(null);
      if (!isInside(moved, destination) && dirname(moved) !== destination) {
        void moveEntry(moved, destination);
      }
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    // A file dropped on a folder has named its destination by being
    // dropped there, so nothing is asked unless a name collides.
    stage(files, destination, false,
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

  // What a query leaves on screen: the matches, and every folder on the way
  // down to one.  Null when there is no query, which is the ordinary tree.
  const hits = useMemo(() => {
    if (!query.trim()) return null;
    return searchTree(tree, query);
  }, [tree, query]);
  const found = hits
    ? `${hits.matches.size} ${hits.matches.size === 1 ? "match" : "matches"}`
    : "";

  const rows: React.ReactNode[] = [];
  // Two passes, and the first one exists so the second can know which row
  // carries the tab stop before it draws any of them. See `tabStopFor`:
  // the stop used to be `focusPath ?? activePath ?? first`, and a
  // `focusPath` naming a row that is no longer rendered left the tree with
  // no tab stop at all.
  order.current = [];
  const survey = (node: TreeNode, depth: number) => {
    if (hits && !hits.show.has(node.path)) return;
    const isDirectory = node.type === "dir";
    const isOpen = hits ? true : expanded.has(node.path);
    order.current.push({ path: node.path, directory: isDirectory, open: isOpen });
    if (isDirectory && isOpen) {
      for (const child of node.children ?? []) survey(child, depth + 1);
    }
  };
  if (tree) for (const child of tree.children ?? []) survey(child, 0);
  shown.current = new Set(order.current.map((row) => row.path));
  const tabStop = tabStopFor(
    [focusPath, activePath, order.current[0]?.path],
    shown.current,
  );

  const walk = (node: TreeNode, depth: number) => {
    if (hits && !hits.show.has(node.path)) return;
    const isDirectory = node.type === "dir";
    // While filtering every folder is drawn open, without touching
    // `collapsed` -- clearing the box has to give the writer back the tree
    // they had, not a tree unfolded on their behalf.
    const isOpen = hits ? true : expanded.has(node.path);
    const [stem, extension] = splitName(node.name);
    const errors = errorsByFile.get(node.path) ?? 0;
    const active = node.path === activePath;

    rows.push(
      <div
        key={node.path}
        data-path={node.path}
        role="treeitem"
        tabIndex={tabStop === node.path ? 0 : -1}
        aria-selected={active}
        // A treeitem with children has to say whether they are showing, and
        // this one never did. It mattered less while every folder was open
        // on arrival; now that a project opens collapsed, a screen reader
        // with no aria-expanded is being told there is a folder and not
        // told that its contents are hidden or that the row will reveal
        // them. The chevron has been saying so to everybody else all along.
        aria-expanded={isDirectory ? isOpen : undefined}
        className={[
          "group relative flex h-[26px] shrink-0 cursor-pointer items-center rounded-[3px] pr-1",
          active ? "bg-surface-2" : "hover:bg-surface-2",
          dropTarget === node.path ? "bg-pen-wash border-b border-pen" : "",
          draggingPath === node.path ? "opacity-50" : "",
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
        draggable={renaming !== node.path}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(NX_PATH, node.path);
          event.dataTransfer.effectAllowed = "move";
          dragging.current = node.path;
          setDraggingPath(node.path);
        }}
        onDragEnd={() => {
          dragging.current = null;
          setDraggingPath(null);
          setDropTarget(null);
        }}
        onDragEnter={(event) => overDrag(event, node)}
        onDragOver={(event) => overDrag(event, node)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => drop(event, node)}
      >
        {active ? (
          <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
        ) : null}
        {/* Two slots for a directory and one for a file, and the file's is
            the same width as the directory's icon so every name in the tree
            starts on one line whatever depth it is at.  The chevron is kept
            beside the folder rather than replaced by it: the folder says
            what the row is, the chevron says what will happen if you click
            it, and a folder that has to be interpreted as a state is slower
            to read than an arrow that only ever means one thing. */}
        <span className="flex w-3 shrink-0 items-center justify-center text-ink-3">
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
        <span
          className={`mr-[6px] flex w-[14px] shrink-0 items-center justify-center ${
            isDirectory ? "text-ink-2" : "text-ink-3"
          }`}
        >
          {isDirectory ? (
            <FolderIcon open={isOpen} />
          ) : (
            <FileIcon name={iconFor(node.path)} />
          )}
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
          ) : null}
          <button
            ref={menu === node.path ? menuButton : undefined}
            // Gated on a pointer that can hover: without that this control is not
              // small on a touch device, it is invisible.  The row is 22px, so the
              // tap area takes the row's height rather than 44 and steals nothing
              // from its neighbours.
              className="nx-tap quiet hoverable:opacity-0 hoverable:group-hover:opacity-100 focus:opacity-100 [--nx-tap-y:22px]"
            aria-label={`Actions for ${node.name}`}
            aria-expanded={menu === node.path}
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
            // Deliberately still not `role="menu"`, having tried it. The
            // three menus this was supposed to match carry the roles and
            // none of them implements the arrow-key navigation the role
            // promises, so copying them here would have spread an
            // incomplete pattern to a fourth place and told assistive
            // technology this is a menu widget when it is a column of
            // buttons. The real answer is roving focus in all four, which
            // is not done. Five browser specs failing on `getByRole
            // ("button")` is what made the difference visible: the role
            // does change what this is, and it should not change it until
            // it is true.
            data-testid="file-menu"
            // Fixed, not absolute: an absolute menu is clipped by the
            // tree's own scroll box, so the last row's menu was cut in half.
            className="fixed z-40 w-[184px] rounded-[5px] border border-line bg-surface py-1 shadow-float"
            style={menuAt ? { left: menuAt.x, top: menuAt.y } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {purging === node.path ? (
              <div className="px-3 py-2" data-testid="purge-confirm">
                {/* Says what goes and what stays, in that order, because
                    "delete version history" beside a file reads a great
                    deal like "delete the file" and the writer has to be
                    able to rule that out without thinking about it. */}
                <p className="t-meta text-ink">
                  Delete every stored version of {node.name}?
                </p>
                <p className="t-micro mt-1 text-ink-3">
                  The file itself is not touched. Disk is released within the
                  hour.
                </p>
                {/* Said plainly, and only where it is true. Clearing a
                    history is a decision about this disk, and a control
                    that looked as though it reached everybody's copy and
                    did not would be worse than no control -- the same
                    reason the sentence about removing a collaborator sits
                    beside that button rather than in the documentation. */}
                {peerId ? (
                  <p className="t-micro mt-1 text-ink-3">
                    Only on this computer. Collaborators keep their own copies.
                  </p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <button
                    className="ghost-button h-[26px] px-2 t-micro"
                    data-tone="danger"
                    data-testid="purge-confirm-yes"
                    onClick={async () => {
                      const projectId = get().projectId;
                      setMenu(null);
                      setPurging(null);
                      if (!projectId) return;
                      // Caught, like every other call in this file. Without
                      // it a refusal was an unhandled rejection: nothing on
                      // screen, and the writer reasonably concluded the
                      // versions had been deleted when they had not.
                      try {
                        const answer = await api.purgeHistory(projectId, node.path);
                        // What it freed as well as what it deleted. The
                        // route has answered with both the whole time and
                        // the interface dropped one of them, which is the
                        // number somebody emptying something is after: a
                        // count of versions says nothing about whether it
                        // was worth doing.
                        const freed = sizeOf(answer.freed);
                        const count =
                          answer.removed === 1
                            ? "Deleted 1 version"
                            : `Deleted ${answer.removed} versions`;
                        setPurged(freed ? `${count}, freeing ${freed}.` : `${count}.`);
                      } catch (error: any) {
                        set({ error: error.message });
                      }
                      window.setTimeout(() => setPurged(""), 6000);
                    }}
                  >
                    Delete history
                  </button>
                  <button
                    className="ghost-button h-[26px] px-2 t-micro"
                    data-testid="purge-confirm-no"
                    onClick={() => {
                      setPurging(null);
                      setMenu(null);
                    }}
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
            [
              ["rename", "Rename"],
              ["move", "Move to…"],
              // A .bib file's reason to have a menu opened on it at all is
              // its contents, which is why this sits with "set as main
              // document" rather than at the bottom with the file
              // operations every row has.
              ...(!isDirectory && isBib(node.name)
                ? [["papers", "Add papers from a folder…"]]
                : []),
              // A dataset's reason to have a menu opened on it is that
              // somebody wants a figure out of it, so this sits up here
              // with the other contents-of-the-file items rather than down
              // with the file operations every row has.
              ...(!isDirectory && isData(node.name) && onAskAbout
                ? [["plot", "Plot this…"]]
                : []),
              ...(!isDirectory && isTeX(node.name) &&
              node.path !== mainFile
                ? [["main", "Set as main document"]]
                : []),
              // Offered only where it can work: a document already on the
              // preview strip can come off it, and one the project has
              // recognised as standing on its own can go on.  A chapter is
              // neither, and an item that explains itself by failing is
              // worse than no item.
              ...(previews.includes(node.path) && node.path !== previews[0]
                ? [["unpreview", "Stop previewing"]]
                : candidates.includes(node.path)
                  ? [["preview", "Preview this document"]]
                  : []),
              // Everything about this file's past, kept together: looking
              // at it and throwing it away are the same subject, and the
              // second is the reason somebody opens the first.
              ...(!isDirectory
                ? [["rule:past", ""], ["history", "History"],
                   ["purge", "Delete version history…"]]
                : []),
              ["rule:out", ""],
              ["download", isDirectory ? "Download as zip" : "Download"],
              ["rule:new", ""],
              ["upload", "Upload here"],
              ["newfile", "New file here"],
              ["newfolder", "New folder here"],
              ["rule:gone", ""],
              ["delete", isDirectory ? "Move folder to trash" : "Move to trash"],
            ].map(([key, label]) =>
              // Twelve items in one undivided column was a list you had to
              // read all of to find anything. The groups are what the items
              // are about: this file's name and place, its past, getting a
              // copy out, putting something new in, and taking it away.
              key.startsWith("rule:") ? (
                <div key={key} className="my-1 border-t border-line" />
              ) : (
              <button
                key={key}
                className={[
                  "block w-full px-3 py-[3px] text-left t-ui hover:bg-surface-2",
                  key === "delete" || key === "purge" ? "hover:text-error" : "",
                ].join(" ")}
                onClick={() => act(key, node)}
              >
                {label}
              </button>
            )))}
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
  if (hits && !rows.length) {
    rows.push(
      <div
        key="no-matches"
        className="flex h-[26px] items-center px-[10px]"
        role="treeitem"
        aria-disabled="true"
        data-testid="no-matches"
      >
        <span className="t-meta truncate text-ink-3">
          Nothing matches &ldquo;{query.trim()}&rdquo;
        </span>
      </div>,
    );
  }
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
      setExpanded((current) => {
        const next = new Set(current);
        next.add(path);
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
    if (parent) setExpanded((current) => {
      const next = new Set(current);
      next.add(parent);
      return next;
    });
    setCreating({ parent, directory, fromBar: true });
  };

  return (
    // A floor, and containment.  `min-h-0` let this box be squeezed to zero
    // by the panels below it -- and a zero-height box does not hide what is
    // inside it, so the toolbar drew straight over the Sections header
    // underneath.  Reported from a real dissertation: 44 files, a long
    // outline and the context panel open was enough.
    //
    // `overflow-hidden` is the belt: whatever height this ends up with,
    // nothing inside it is drawn outside it.  The floor is what keeps the
    // toolbar and a couple of rows visible; past that the panel stack
    // scrolls, which is where the height has to come from.
    <div className="flex min-h-[104px] flex-1 flex-col overflow-hidden">
      <FilesBar
        onNewFile={() => startCreate(false)}
        onNewFolder={() => startCreate(true)}
        searching={searching}
        onSearch={() => {
          if (searching) {
            setSearching(false);
            setQuery("");
            return;
          }
          setSearching(true);
          window.requestAnimationFrame(() => searchInput.current?.focus());
        }}
        dropping={dropTarget === ROOT_DROP}
        onUpload={(event) => {
          uploadTo.current = rememberedUpload();
          uploadAsked.current = true;
          uploadFrom.current = event.currentTarget;
          uploadInput.current?.click();
        }}
        onDragEnter={(event) => overDrag(event, null)}
        onDragOver={(event) => overDrag(event, null)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => drop(event, null)}
      />
      {searching ? (
        <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-line px-[10px]">
          <input
            ref={(node) => {
              searchInput.current = node;
              if (node && wantsCaret.current) {
                wantsCaret.current = false;
                node.focus();
                node.select();
              }
            }}
            className="t-ui h-[20px] min-w-0 flex-1 rounded-[3px] bg-surface-2 px-1 text-ink outline-none placeholder:text-ink-3 focus:outline-1 focus:outline-pen"
            placeholder="Find a file"
            aria-label="Find a file"
            data-testid="file-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (query) {
                  setQuery("");
                  return;
                }
                setSearching(false);
                moveFocus(focusPath ?? order.current[0]?.path ?? "");
                return;
              }
              if (event.key === "Enter") {
                const first = order.current.find((row) => !row.directory);
                if (first) onOpen(first.path);
              }
            }}
          />
          {query ? (
            <span className="t-micro shrink-0 tabular-nums text-ink-3">
              {found}
            </span>
          ) : null}
        </div>
      ) : null}
      {purged ? (
        // Said once and then gone. Clearing a history is silent by nature --
        // the file does not change and the tree does not move -- so without
        // a line here the writer has no way to know it worked.
        <div className="t-micro px-[10px] py-1 text-ink-3" data-testid="purged-notice">
          {purged}
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-auto py-[6px]"
        role="tree"
        onDragEnter={(event) => overDrag(event, null)}
        onDragOver={(event) => overDrag(event, null)}
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
      {/* Named, because it is no longer the only file input in the app: the
          agent panel has one for attaching an image, and a spec reaching
          for "the file input" was relying on there being exactly one, which
          was never a promise. */}
      <input
        ref={uploadInput}
        id="nx-upload"
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
        <Suspense fallback={null}>
        <PapersChooser
          bibName={papersFor.name}
          at={papersFor.at}
          onClose={() => setPapersFor(null)}
          onStarted={() => setPapersFor(null)}
        />
        </Suspense>
      ) : null}
      {moving ? (
        <MoveTo
          moving={moving}
          onChange={(to) => setMoving((current) => current && { ...current, to })}
          onCancel={() => setMoving(null)}
          onMove={async () => {
            const { path, to } = moving;
            setMoving(null);
            await moveEntry(path, to ?? "");
          }}
        />
      ) : null}
      {staging ? (
        <Suspense fallback={null}>
        <UploadStaging
          staging={staging}
          onClose={() => setStaging(null)}
          onDone={(written) => {
            setStaging(null);
            onRefresh();
            reveal(written);
          }}
        />
        </Suspense>
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
  onSearch,
  searching,
  dropping,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSearch: () => void;
  searching: boolean;
  dropping: boolean;
  onDragEnter: (event: React.DragEvent) => void;
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
      onDragEnter={onDragEnter}
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
      <button
        className={`quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px] hover:bg-surface-3 ${
          searching ? "bg-surface-3 text-ink" : ""
        }`}
        aria-label="Find a file"
        title="Find a file"
        aria-expanded={searching}
        data-testid="file-search-open"
        onClick={onSearch}
      >
        <Magnifier />
      </button>
    </div>
  );
}

/** Small enough to draw rather than depend on. */
function Magnifier() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle
        cx="5"
        cy="5"
        r="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1="7.7"
        y1="7.7"
        x2="10.5"
        y2="10.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
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
