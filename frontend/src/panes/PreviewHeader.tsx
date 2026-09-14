import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlusIcon } from "../chrome";
import { useStore } from "../store";
import { useDismiss } from "../useDismiss";
import { focusFirst, walkMenu } from "./menu-keys";
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
  /** A click on the tab in front or the empty run: fold, or double-click
   *  for reading mode.  Absent below 900px, where nothing folds. */
  onHeaderClick?: () => void;
  trailing?: ReactNode;
}) {
  const previews = useStore((s) => s.previews);
  const active = useStore((s) => s.activePreview);
  const candidates = useStore((s) => s.candidates);
  const builds = useStore((s) => s.builds);
  const activePath = useStore((s) => s.activePath);

  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const plus = useRef<HTMLButtonElement | null>(null);
  useDismiss(menu, open, () => setOpen(false), plus);
  useEffect(() => {
    if (open) focusFirst(menu.current);
  }, [open]);
  useEffect(() => {
    if (!candidates.length) setOpen(false);
  }, [candidates.length]);

  const tabs: StripTab[] = previews.map((path) => {
    const build = builds[path];
    return {
      path,
      label: middleTruncate(stem(path), 18),
      title: path,
      active: path === active,
      closeLabel: previews.length > 1 ? `Stop previewing ${path.split("/").pop() ?? path}` : undefined,
      testId: `preview-tab-${path}`,
      // Building, or behind the source.  Without this a background
      // document gives no sign it is out of date until you switch to it
      // and find an old page.
      badge: build?.compiling ? (
        <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-hint" />
      ) : build?.stale ? (
        <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full border border-ink-3" />
      ) : undefined,
    };
  });

  const menuFor = (path: string): MenuItem[] => {
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
                <button
                  ref={plus}
                  className="quiet relative flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
                  aria-label="Preview another document"
                  title="Preview another document"
                  aria-expanded={open}
                  data-testid="add-preview"
                  onClick={() => setOpen((value) => !value)}
                >
                  <PlusIcon />
                  {activePath && candidates.includes(activePath) ? (
                    <span className="absolute right-[3px] top-[3px] h-[4px] w-[4px] rounded-full bg-hint" />
                  ) : null}
                </button>
                {open ? (
                  <div
                    ref={menu}
                    role="menu"
                    data-testid="preview-menu"
                    // Furniture, like the other menus, and it keeps the
                    // role's promise: focus on open, arrow keys, Escape
                    // back to the button.
                    className="nx-furniture nx-arrive absolute right-0 top-[28px] z-40 w-[220px] rounded-[5px] border border-line bg-surface py-[3px] shadow-float"
                    onKeyDown={(event) => {
                      if (walkMenu(event, () => setOpen(false)) && event.key === "Escape") {
                        plus.current?.focus();
                      }
                    }}
                  >
                    {candidates.map((path) => (
                      <button
                        key={path}
                        role="menuitem"
                        title={path}
                        className="t-ui block w-full truncate px-3 py-[3px] text-left text-ink focus:bg-hint-wash"
                        onPointerMove={(event) => {
                          if (event.movementX || event.movementY) event.currentTarget.focus();
                        }}
                        onClick={() => {
                          setOpen(false);
                          onAdd(path);
                        }}
                      >
                        {path}
                      </button>
                    ))}
                  </div>
                ) : null}
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
        onSelect={onSelect}
        onClose={onClose}
        menuFor={menuFor}
        menuTestId="preview-tab-menu"
        onHeaderClick={onHeaderClick}
        headerTitle="Click to fold the preview away, double-click to read"
      />
    </PaneHeader>
  );
}
