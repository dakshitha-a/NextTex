import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useDismiss } from "../useDismiss";
import { toShell, viewportHeight, viewportWidth } from "../viewport";
import { focusFirst, walkMenu } from "./menu-keys";
import {
  HiddenTabs, useFollowActive, useHiddenTabs, useWheelScroll,
} from "./tab-overflow";

/** The documents being previewed, as tabs.
 *
 *  Deliberately the same object as the editor's tab strip: same height, same
 *  2px accent on the one in front, same middle-click to close. They sit one
 *  above the other on a wide screen and reading them as two different kinds
 *  of thing would be work the writer should not have to do.
 *
 *  What is different is that the last tab cannot be closed: a preview
 *  strip with nothing in it would be a pane with no way to get anything
 *  back into it.
 *
 *  The right-click menu is the source strip's too, minus Duplicate, which
 *  is about a file and not a build, plus Download PDF, which is about a
 *  build and not a file.
 */

const stem = (path: string) => path.split("/").pop() ?? path;

function middleTruncate(name: string, limit: number): string {
  if (name.length <= limit) return name;
  const head = Math.ceil((limit - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (limit - 1 - head))}`;
}

export default function PreviewTabs({
  onSelect,
  onClose,
  onCloseMany,
  onDownload,
  onAdd,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Stop previewing several at once: "the others", which leaves the tab
   *  the menu was opened on, so the strip is never emptied. */
  onCloseMany: (paths: string[]) => void;
  onDownload: (path: string) => void;
  onAdd: (path: string) => void;
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

  const strip = useRef<HTMLDivElement | null>(null);
  const hidden = useHiddenTabs(strip, previews.length);
  useWheelScroll(strip, previews.length);
  useFollowActive(strip, active);

  // The right-click menu, on the tab in front only, for the reason the
  // source strip gives: its items are about the document being read, and
  // a menu on a tab that is not in front would have to say which one.
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  );
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  useDismiss(tabMenuRef, tabMenu !== null, closeTabMenu);
  useEffect(() => {
    if (tabMenu && !previews.includes(tabMenu.path)) setTabMenu(null);
  }, [tabMenu, previews]);
  // Focus goes into a menu once, when it opens, and from an effect keyed
  // on the opening rather than from the ref: an inline ref is a new
  // function on every render, React calls a new ref with the node again,
  // and this strip re-renders on every build tick, which put focus back
  // on the first row while the writer was walking down the list.
  useEffect(() => {
    if (tabMenu) focusFirst(tabMenuRef.current);
  }, [tabMenu]);
  useEffect(() => {
    if (open) focusFirst(menu.current);
  }, [open]);
  const others = previews.filter((path) => path !== tabMenu?.path);

  // Nothing to draw for a project with one document: a strip of one tab is
  // a label pretending to be a control.
  const solo = previews.length < 2;

  useEffect(() => {
    if (!candidates.length) setOpen(false);
  }, [candidates.length]);

  return (
    <div className="flex min-w-0 flex-1 items-center">
      {solo ? (
        <span className="t-ui-lg shrink-0 select-none pl-1 font-serif text-ink">Preview</span>
      ) : (
        <div
          ref={strip}
          data-testid="preview-strip"
          className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto"
        >
          {previews.map((path) => {
            const showing = path === active;
            const build = builds[path];
            return (
              <div
                key={path}
                data-preview-tab="1"
                data-path={path}
                className={[
                  "relative flex h-[32px] min-w-[72px] max-w-[200px] basis-[200px] shrink items-center",
                  "gap-2 border-r border-line pr-[10px]",
                  showing
                    ? "bg-surface"
                    : "border-b border-line hover:bg-surface-3",
                ].join(" ")}
                onMouseDown={(event) => {
                  if (event.button === 1 && previews.length > 1) {
                    event.preventDefault();
                    onClose(path);
                  }
                }}
                onContextMenu={(event) => {
                  if (!showing) return;
                  event.preventDefault();
                  setTabMenu({
                    path,
                    x: Math.min(toShell(event.clientX), viewportWidth() - 224),
                    y: Math.min(toShell(event.clientY), viewportHeight() - 120),
                  });
                }}
              >
                {showing ? (
                  <span className="absolute left-0 top-0 h-[2px] w-full bg-pen" />
                ) : null}
                <button
                  aria-current={showing ? "true" : undefined}
                  title={path}
                  data-testid={`preview-tab-${path}`}
                  className="t-meta flex min-w-0 flex-1 items-center truncate pl-[10px] text-left"
                  onClick={() => onSelect(path)}
                >
                  <span className={showing ? "text-ink" : "text-ink-2"}>
                    {middleTruncate(stem(path).replace(/\.(tex|ltx)$/i, ""), 18)}
                  </span>
                  {/* Building, or behind the source.  Without this a
                      background document gives no sign it is out of date
                      until you switch to it and find an old page. */}
                  {build?.compiling ? (
                    <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-hint" />
                  ) : build?.stale ? (
                    <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full border border-ink-3" />
                  ) : null}
                </button>
                {/* The last document has no close button rather than a
                    disabled one: a control that is always refused is worse
                    than no control. */}
                {previews.length < 2 ? null : (
                  <button
                    className="quiet flex h-4 w-4 shrink-0 items-center justify-center"
                    aria-label={`Stop previewing ${stem(path)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(path);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {solo ? null : (
        <HiddenTabs
          hidden={hidden}
          label="previewed"
          name={(path) => stem(path).replace(/\.(tex|ltx)$/i, "")}
          testId="preview-hidden"
          onPick={onSelect}
        />
      )}
      {tabMenu ? (
        <div
          ref={tabMenuRef}
          role="menu"
          data-testid="preview-tab-menu"
          // Fixed, not absolute: the strip is `overflow-x-auto`, and an
          // absolute menu would be clipped by it.
          className="nx-furniture nx-arrive fixed z-40 w-[220px] rounded-[5px] border border-line bg-surface py-[3px] shadow-float"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onKeyDown={(event) => walkMenu(event, closeTabMenu)}
        >
          {[
            // "The others" with nothing else to stop, and "all" with only
            // the main document open, can have nothing to do, and an item
            // that explains itself by doing nothing is worse than one that
            // says so first.
            { key: "others", label: "Stop previewing the others", off: others.length === 0,
              run: () => onCloseMany(others) },
            { key: "rule", label: "", off: false, run: () => undefined },
            { key: "download", label: "Download PDF", off: false,
              run: () => onDownload(tabMenu.path) },
          ].map((item) =>
            item.key === "rule" ? (
              <div key={item.key} className="my-1 border-t border-line" />
            ) : (
              <button
                key={item.key}
                role="menuitem"
                className="t-ui block w-full px-3 py-[3px] text-left text-ink focus:bg-hint-wash disabled:opacity-40"
                disabled={item.off}
                onPointerMove={(event) => {
                  if (event.movementX || event.movementY) event.currentTarget.focus();
                }}
                onClick={() => {
                  setTabMenu(null);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}

      {candidates.length ? (
        <div className="relative shrink-0">
          <button
            ref={plus}
            className="quiet t-meta flex h-[24px] w-[24px] items-center justify-center"
            aria-label="Preview another document"
            aria-expanded={open}
            data-testid="add-preview"
            onClick={() => setOpen((value) => !value)}
          >
            +
            {/* The nudge.  A quiet mark when the file being edited is one of
                the documents that could be previewed and is not -- which is
                exactly the moment somebody wants this button and has no
                reason to know it is here. */}
            {activePath && candidates.includes(activePath) ? (
              <span className="absolute right-[3px] top-[3px] h-[4px] w-[4px] rounded-full bg-hint" />
            ) : null}
          </button>
          {open ? (
            <div
              ref={menu}
              role="menu"
              data-testid="preview-menu"
              // Furniture, like the other menus, and it keeps the role's
              // promise now: focus on open, arrow keys, Escape back to
              // the button.
              className="nx-furniture nx-arrive absolute right-0 top-[24px] z-40 w-[220px] rounded-[5px] border border-line bg-surface py-[3px] shadow-float"
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
    </div>
  );
}
