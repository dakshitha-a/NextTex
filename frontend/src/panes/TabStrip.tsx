import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "../useDismiss";
import { toShell, viewportHeight, viewportWidth } from "../viewport";
import { focusFirst, walkMenu } from "./menu-keys";
import {
  HiddenTabs, useFollowActive, useHiddenTabs, useWheelScroll,
} from "./tab-overflow";

/** A strip of tabs, drawn once for the source pane and the preview pane.
 *
 *  The two used to be two components written as "the same object", and
 *  they drifted: different inactive ink, different close buttons, a menu
 *  with keyboard support on one and not the other, a bottom rule on one
 *  header that ran under its active tab.  They sit one above the other on
 *  a wide screen and reading them as two kinds of thing is work the writer
 *  should not have to do, so there is one strip now and each pane says
 *  only what its tabs are.
 *
 *  The rule under the row is composed rather than drawn on the header:
 *  inactive tabs, the empty run and the trailing controls each carry a
 *  bottom border and the active tab does not, so the tab in front opens
 *  into the pane below it on both sides.
 *
 *  The gesture.  A click on the tab in front, or on the empty run past the
 *  last tab, is a click on the pane's header: it folds the pane, and a
 *  double-click gives the pane the window.  The tab in front is a handle
 *  because a writer with a dozen files open has no empty run left, which
 *  is what put the fold out of reach.  A click on any other tab selects
 *  it, and only that; the close button is excused everywhere.
 */

export type StripTab = {
  path: string;
  /** The name as drawn, already shortened. */
  label: string;
  /** Drawn after the label in the quiet ink: the source strip's `.tex`. */
  extension?: string;
  extensionTone?: "quiet" | "error";
  title: string;
  active: boolean;
  /** The close control's label; absent when the tab cannot go. */
  closeLabel?: string;
  /** After the label: an error count, a build dot. */
  badge?: ReactNode;
  testId?: string;
};

export type MenuItem =
  | { key: string; label: string; off?: boolean; run: () => void }
  | { key: string; rule: true };

export default function TabStrip({
  kind,
  tabs,
  ariaLabel,
  hiddenLabel,
  hiddenName,
  onSelect,
  onClose,
  menuFor,
  menuTestId,
  onHeaderClick,
  headerTitle,
}: {
  kind: "source" | "preview";
  tabs: StripTab[];
  ariaLabel: string;
  /** What one hidden tab is called in the count's title: "open", "previewed". */
  hiddenLabel: string;
  hiddenName: (path: string) => string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** The right-click menu for the tab in front, or nothing.  Only ever the
   *  tab in front: its items are about the thing being worked on, and a
   *  menu on a tab that is not in front would have to say which one. */
  menuFor?: (path: string) => MenuItem[];
  menuTestId?: string;
  /** A click on the header: the tab in front or the empty run.  Absent
   *  where the pane cannot fold, below 900px. */
  onHeaderClick?: () => void;
  headerTitle?: string;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  const active = tabs.find((tab) => tab.active)?.path ?? null;
  // Which tabs are scrolled out of sight, a wheel over the strip to bring
  // them in, and the strip following the tab in front: tab-overflow.tsx.
  const hidden = useHiddenTabs(strip, tabs.length);
  useWheelScroll(strip, tabs.length);
  useFollowActive(strip, active);

  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRef, menu !== null, closeMenu);
  // A menu can outlive the tab it was opened on: the file is renamed
  // underneath it, or another window closes it.  Leaving it up would leave
  // a column of items pointing at nothing.
  useEffect(() => {
    if (menu && !tabs.some((tab) => tab.path === menu.path)) setMenu(null);
  }, [menu, tabs]);
  // Focus goes into the menu once, when it opens, and from an effect keyed
  // on the opening rather than from the ref: an inline ref is a new
  // function on every render, React calls a new ref with the node again,
  // and this strip re-renders on every build tick, which put focus back on
  // the first row while the writer was walking down the list.
  useEffect(() => {
    if (menu) focusFirst(menuRef.current);
  }, [menu]);

  const dataAttribute = kind === "source" ? "data-tab" : "data-preview-tab";
  const blankTestId = kind === "source" ? "tabs-blank" : "preview-blank";
  const items = menu && menuFor ? menuFor(menu.path) : [];

  return (
    <div className="relative flex h-[32px] shrink-0">
      {/* A labelled group of buttons rather than an ARIA tablist.  The tab
          pattern promises arrow-key navigation between tabs and a panel
          associated with each one, and this strip has neither; claiming
          the role would tell a screen reader something untrue. */}
      <div
        ref={strip}
        role="group"
        aria-label={ariaLabel}
        data-testid={kind === "source" ? "source-strip" : "preview-strip"}
        className="no-scrollbar flex h-[32px] min-w-0 flex-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const handle = tab.active && onHeaderClick !== undefined;
          return (
            // The tab and its close button are siblings rather than nested:
            // a control inside another control is announced as one thing
            // and reached as two, and there is no way to say which is which.
            <div
              key={tab.path}
              {...{ [dataAttribute]: "1" }}
              data-path={tab.path}
              // A tab squeezes from 200px down to 72px before the strip
              // overflows, the way a browser's do: a writer with eight
              // files open sees eight names, shortened, rather than four
              // and a count.  The count is for when even that is not room.
              className={[
                "relative flex h-[32px] min-w-[72px] max-w-[200px] basis-[200px] shrink items-center",
                "gap-2 border-r border-line pr-[10px] transition-colors duration-[90ms]",
                tab.active ? "bg-surface" : "border-b border-line hover:bg-surface-3",
                handle ? "cursor-pointer" : "",
              ].join(" ")}
              title={handle ? headerTitle : undefined}
              onClick={handle ? onHeaderClick : undefined}
              onMouseDown={(event) => {
                if (event.button === 1 && tab.closeLabel) {
                  event.preventDefault();
                  onClose(tab.path);
                }
              }}
              onContextMenu={(event) => {
                // Only the tab in front.  A right-click on any other one is
                // left entirely alone, browser menu and all: taking that
                // away without putting something in its place is a loss.
                if (!tab.active || !menuFor) return;
                event.preventDefault();
                // `clientX` is a viewport pixel and `style.left` is read in
                // the zoomed shell's own, so both go through `toShell`.  The
                // clamps keep a menu opened on the last tab, or near the
                // foot of a short window, on screen.
                setMenu({
                  path: tab.path,
                  x: Math.min(toShell(event.clientX), viewportWidth() - 224),
                  y: Math.min(toShell(event.clientY), viewportHeight() - 120),
                });
              }}
            >
              {tab.active ? (
                <span className="absolute left-0 top-0 h-[2px] w-full bg-pen" />
              ) : null}
              <button
                aria-current={tab.active ? "true" : undefined}
                title={tab.title}
                data-testid={tab.testId}
                className="t-meta flex min-w-0 flex-1 cursor-pointer items-center truncate pl-[10px] text-left"
                onClick={() => {
                  // The tab in front is the header's handle, and the click
                  // reaches the row above; any other tab is selected.
                  if (!tab.active) onSelect(tab.path);
                }}
              >
                <span className={tab.active ? "text-ink" : "text-ink-2"}>{tab.label}</span>
                {tab.extension ? (
                  <span className={tab.extensionTone === "error" ? "text-error" : "text-ink-3"}>
                    {tab.extension}
                  </span>
                ) : null}
                {tab.badge}
              </button>
              {tab.closeLabel ? (
                <button
                  className="quiet nx-tap flex h-4 w-4 shrink-0 items-center justify-center [--nx-tap-y:26px]"
                  aria-label={tab.closeLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.path);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        {/* The empty run past the last tab is the header too.  It shrinks
            to nothing as tabs fill the strip, which is why the tab in
            front is a handle as well. */}
        <div
          className={[
            "flex-1 border-b border-line transition-colors duration-[90ms]",
            onHeaderClick ? "cursor-pointer hover:bg-surface-3" : "",
          ].join(" ")}
          data-testid={blankTestId}
          title={onHeaderClick ? headerTitle : undefined}
          onClick={onHeaderClick}
        />
      </div>
      <HiddenTabs
        hidden={hidden}
        label={hiddenLabel}
        name={hiddenName}
        testId={kind === "source" ? "tabs-hidden" : "preview-hidden"}
        onPick={onSelect}
      />
      {menu && items.length ? (
        <div
          ref={menuRef}
          role="menu"
          data-testid={menuTestId}
          // Fixed, not absolute: the strip is `overflow-x-auto`, and an
          // absolute menu would be clipped by it, the bug the tree hit
          // inside its own scroll box.
          className="nx-furniture nx-arrive fixed z-40 w-[220px] rounded-[5px] border border-line bg-surface py-[3px] shadow-float"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => walkMenu(event, closeMenu)}
        >
          {items.map((item) =>
            "rule" in item ? (
              // Two subjects in one column read as two ways of doing one
              // thing; the rule says where one ends.
              <div key={item.key} className="my-1 border-t border-line" />
            ) : (
              <button
                key={item.key}
                role="menuitem"
                className="t-ui block w-full px-3 py-[3px] text-left text-ink focus:bg-hint-wash disabled:opacity-40"
                // An item that can have nothing to do says so first rather
                // than explaining itself by doing nothing.
                disabled={item.off}
                onPointerMove={(event) => {
                  if (event.movementX || event.movementY) event.currentTarget.focus();
                }}
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A file name shortened in the middle, the way both strips draw one. */
export function middleTruncate(name: string, limit: number): string {
  if (name.length <= limit) return name;
  const head = Math.ceil((limit - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (limit - 1 - head))}`;
}
