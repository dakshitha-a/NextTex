import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "../ui/Button";
import { PlusIcon } from "../ui/icons";
import { get, set, useStore } from "../store";
import { pageWindowUrl } from "../page-window";
import { under } from "../place-menu";
import { Menu, MenuItem as Item } from "../ui/Menu";
import PaneHeader from "./PaneHeader";
import TabStrip, { middleTruncate, type MenuItem, type StripTab } from "./TabStrip";

/** The preview pane's header: the documents being previewed, as tabs.
 *
 *  The same PaneHeader and the same TabStrip as the source pane, so the two
 *  rows one above the other read as one kind of thing.  What this one says
 *  is which tabs there are: one per document on the strip, always drawn,
 *  one included, because the tab in front is the pane's handle and a label
 *  is not a handle.  The last tab has no close button rather than a
 *  disabled one: a control that is always refused is worse than no
 *  control, and a strip with nothing on it would have no way back.
 *
 *  Beside the strip, the `+` lists the documents in the project that are
 *  not on it yet.  A quiet mark on it when the file being edited is one of
 *  them, which is exactly the moment somebody wants this button and has no
 *  reason to know it is here.
 */

const stem = (path: string) => (path.split("/").pop() ?? path).replace(/\.(tex|ltx)$/i, "");

export default function PreviewHeader({
  onSelect,
  onClose,
  onCloseMany,
  onDownload,
  onAdd,
  onRunScript,
  onStopScript,
  onSelectMarkdown,
  onCloseMarkdown,
  onHeaderClick,
  trailing,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Stop previewing several at once: "the others", which leaves the tab
   *  the menu was opened on, so the strip is never emptied. */
  onCloseMany: (paths: string[]) => void;
  onDownload: (path: string) => void;
  onAdd: (path: string) => void;
  /** The script tab's menu.  The tab itself is this window's: selecting
   *  it and closing it are store writes and need nobody's help. */
  onRunScript: (path: string) => void;
  onStopScript: (path: string) => void;
  /** The Markdown tab was chosen: the pane is this window's own and
   *  comes forward on its own, and this is for the source to follow,
   *  the way a document's does.  The script tab has no such thing on
   *  purpose: its content is a run's output, read beside the page while
   *  the chapter that includes the figure is being written. */
  onSelectMarkdown?: (path: string) => void;
  /** The Markdown tab was closed: the rendering goes, and its file with
   *  it, the way a document's files go when its preview stops.  Given,
   *  the caller writes the tab's own state in the same store write as
   *  the file's tab; absent, the tab closes on its own. */
  onCloseMarkdown?: (path: string) => void;
  /** A click on the tab in front or the empty run: fold, or double-click
   *  for reading mode.  Absent below 900px, where nothing folds. */
  onHeaderClick?: () => void;
  trailing?: ReactNode;
}) {
  const previews = useStore((s) => s.previews);
  const active = useStore((s) => s.activePreview);
  const script = useStore((s) => s.script);
  const markdown = useStore((s) => s.markdown);
  const showing = useStore((s) => s.previewShowing);
  const candidates = useStore((s) => s.candidates);
  const builds = useStore((s) => s.builds);
  const activePath = useStore((s) => s.activePath);

  const [open, setOpen] = useState(false);
  const plus = useRef<HTMLButtonElement | null>(null);
  // Measured once per opening, not per render: the header re-renders on
  // every build tick.
  const wanted = useMemo(() => (open ? under(plus.current, 232, "right") : null), [open]);
  useEffect(() => {
    if (!candidates.length) setOpen(false);
  }, [candidates.length]);

  const tabs: StripTab[] = previews.map((path) => {
    const build = builds[path];
    return {
      path,
      label: middleTruncate(stem(path), 18),
      title: path,
      active: showing === "document" && path === active,
      closeLabel: previews.length > 1 ? `Stop previewing ${path.split("/").pop() ?? path}` : undefined,
      testId: `preview-tab-${path}`,
      // Building, or behind the source, drawn before the name as the
      // page has it.  Without this a background document gives no sign it
      // is out of date until you switch to it and find an old page.
      leading: build?.compiling ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hint" />
      ) : build?.stale ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--ink-3)]" />
      ) : undefined,
    };
  });
  // After the documents, the script this window is looking at, if one:
  // its name with the extension a source tab carries, closeable, and
  // breathing while it runs.  It never reaches the server's strip.
  if (script) {
    const name = script.path.split("/").pop() ?? script.path;
    const dot = name.lastIndexOf(".");
    tabs.push({
      path: script.path,
      label: middleTruncate(dot > 0 ? name.slice(0, dot) : name, 18),
      extension: dot > 0 ? name.slice(dot) : "",
      title: script.path,
      active: showing === "script",
      closeLabel: `Close ${name}`,
      testId: `script-tab-${script.path}`,
      badge: script.running ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hint" />
      ) : script.result && !script.result.ok ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" />
      ) : undefined,
    });
  }

  // And the Markdown file this window is looking at, after the script:
  // its name with its extension, closeable, drawn from what the editor
  // holds.  It never reaches the server's strip either.
  if (markdown) {
    const name = markdown.path.split("/").pop() ?? markdown.path;
    const dot = name.lastIndexOf(".");
    tabs.push({
      path: markdown.path,
      label: middleTruncate(dot > 0 ? name.slice(0, dot) : name, 18),
      extension: dot > 0 ? name.slice(dot) : "",
      title: markdown.path,
      active: showing === "markdown",
      closeLabel: `Close ${name}`,
      testId: `markdown-tab-${markdown.path}`,
    });
  }

  const select = (path: string) => {
    if (script && path === script.path) {
      set({ previewShowing: "script" });
      return;
    }
    if (markdown && path === markdown.path) {
      set({ previewShowing: "markdown" });
      onSelectMarkdown?.(path);
      return;
    }
    set({ previewShowing: "document" });
    onSelect(path);
  };
  const close = (path: string) => {
    if (script && path === script.path) {
      set({ script: null, previewShowing: showing === "script" ? "document" : showing });
      return;
    }
    if (markdown && path === markdown.path) {
      if (onCloseMarkdown) onCloseMarkdown(path);
      else set({ markdown: null, previewShowing: showing === "markdown" ? "document" : showing });
      return;
    }
    onClose(path);
  };

  const menuFor = (path: string): MenuItem[] => {
    if (markdown && path === markdown.path) {
      return [{ key: "close", label: "Close", run: () => close(path) }];
    }
    if (script && path === script.path) {
      return [
        script.running
          ? { key: "stop", label: "Stop", run: () => onStopScript(path) }
          : { key: "run", label: "Run", run: () => onRunScript(path) },
        { key: "rule", rule: true },
        { key: "close", label: "Close", run: () => close(path) },
      ];
    }
    const others = previews.filter((other) => other !== path);
    return [
      // The source strip's menu, minus Duplicate, which is about a file and
      // not a build, plus Download PDF, which is about a build and not a
      // file.  "The others" with nothing else to stop can have nothing to
      // do, and says so first.
      { key: "others", label: "Stop previewing the others", off: others.length === 0,
        run: () => onCloseMany(others) },
      { key: "rule", rule: true },
      { key: "download", label: "Download PDF", run: () => onDownload(path) },
      // The page alone, in a window of its own, for a second monitor.
      // A new window rather than a tab, since a tab beside this one is
      // not what a second monitor wants; the browser decides which it
      // gets and the writer can drag it either way.
      { key: "window", label: "Open in its own window", run: () => {
        const id = get().projectId;
        if (id) window.open(pageWindowUrl(id, path), "_blank", "noopener");
      } },
    ];
  };

  return (
    <PaneHeader
      testId="preview-header"
      trailing={
        candidates.length || trailing ? (
          <>
            {candidates.length ? (
              <div className="relative flex shrink-0 items-center">
                <IconButton
                  ref={plus}
                  label="Preview another document"
                  aria-expanded={open}
                  data-testid="add-preview"
                  on={open}
                  className="relative"
                  onClick={() => setOpen((value) => !value)}
                >
                  <PlusIcon />
                  {activePath && candidates.includes(activePath) ? (
                    <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-hint" />
                  ) : null}
                </IconButton>
                {/* The kit's menu, hung from the button's right edge. */}
                <Menu
                  open={open}
                  onClose={() => setOpen(false)}
                  wanted={wanted}
                  anchor={plus}
                  testid="preview-menu"
                  width={232}
                >
                  {candidates.map((path) => (
                    <Item
                      key={path}
                      title={path}
                      onClick={() => {
                        setOpen(false);
                        onAdd(path);
                      }}
                    >
                      {path}
                    </Item>
                  ))}
                </Menu>
              </div>
            ) : null}
            {trailing}
          </>
        ) : undefined
      }
    >
      <TabStrip
        kind="preview"
        tabs={tabs}
        ariaLabel="Previewed documents"
        hiddenLabel="previewed"
        hiddenName={stem}
        onSelect={select}
        onClose={close}
        menuFor={menuFor}
        menuTestId="preview-tab-menu"
        onHeaderClick={onHeaderClick}
        headerTitle="Click to fold the preview away, double-click to read"
      />
    </PaneHeader>
  );
}
