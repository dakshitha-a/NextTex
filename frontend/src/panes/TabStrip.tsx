import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toShell } from "../viewport";
import { Menu, MenuDivider, MenuItem as Item } from "../ui/Menu";
import { CloseIcon } from "../ui/icons";
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
 *  As the direction page draws it: a 36 px row on the second surface with
 *  no rule under it and none between the tabs; the tab in front by ink
 *  weight and a 2 px ink underline, the extension in the third ink, the
 *  close control on the tab in front and the hovered one only, the hover
 *  as a wash; and a 2 px pen underline reserved for a tab whose file
 *  Claude is editing in the current turn, which is the one place the pen
 *  appears on a strip.
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
  /** Before the label: the preview's build dot. */
  leading?: ReactNode;
  /** After the label: an error count, a script's state. */
  badge?: ReactNode;
  /** Claude is editing this file in the current turn: the pen underline. */
  pen?: boolean;
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
  const closeMenu = useCallback(() => setMenu(null), []);
  // Where the pointer was is where it wants to be; where it fits is the
  // kit's Menu's to decide once it has measured itself.
  const wanted = useMemo(
    () => (menu ? { left: menu.x, top: menu.y, flip: menu.y } : null),
    [menu],
  );
  // A menu can outlive the tab it was opened on: the file is renamed
  // underneath it, or another window closes it.  Leaving it up would leave
  // a column of items pointing at nothing.
  useEffect(() => {
    if (menu && !tabs.some((tab) => tab.path === menu.path)) setMenu(null);
  }, [menu, tabs]);

  const dataAttribute = kind === "source" ? "data-tab" : "data-preview-tab";
  const blankTestId = kind === "source" ? "tabs-blank" : "preview-blank";
  const items = menu && menuFor ? menuFor(menu.path) : [];

  return (
    <div className="relative flex h-[36px] shrink-0">
      {/* A labelled group of buttons rather than an ARIA tablist.  The tab
          pattern promises arrow-key navigation between tabs and a panel
          associated with each one, and this strip has neither; claiming
          the role would tell a screen reader something untrue. */}
      <div
        ref={strip}
        role="group"
        aria-label={ariaLabel}
        data-testid={kind === "source" ? "source-strip" : "preview-strip"}
        className="no-scrollbar flex h-[36px] min-w-0 flex-1 gap-[2px] overflow-x-auto"
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
              data-pen={tab.pen ? "true" : undefined}
              // A tab is as wide as its name, as the page draws it, up to
              // 200px, and squeezes down to 72px before the strip overflows,
              // the way a browser's do: a writer with eight files open sees
              // eight names, shortened, rather than four and a count.  The
              // count is for when even that is not room.
              className={[
                "group relative flex h-[36px] min-w-[72px] max-w-[200px] basis-auto shrink items-center",
                "gap-[6px] rounded-none pr-2 transition-colors duration-[90ms] hover:bg-wash",
                tab.active ? "text-ink" : "text-ink-3",
                // The underline is an inset shadow rather than a border, so
                // it takes no height from the row and the two rows stay
                // one object.  The pen wins over the ink: while Claude is
                // in the file, that is the thing to know.
                tab.pen
                  ? "shadow-[inset_0_-2px_0_var(--pen)]"
                  : tab.active
                    ? "shadow-[inset_0_-2px_0_var(--ink)]"
                    : "",
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
                // the zoomed shell's own, so both go through `toShell`.
                // Keeping it on screen is `useOnScreen`'s job, from the
                // menu's measured size rather than a guess at it.
                setMenu({
                  path: tab.path,
                  x: toShell(event.clientX),
                  y: toShell(event.clientY),
                });
              }}
            >
              <button
                aria-current={tab.active ? "true" : undefined}
                title={tab.title}
                data-testid={tab.testId}
                // The tab's left padding is the button's, so a click on the
                // tab's edge is a click on the tab.
                className={`t-ui flex min-w-0 flex-1 cursor-pointer items-center gap-[6px] truncate pl-3 text-left ${
                  tab.active ? "font-medium" : ""
                }`}
                onClick={() => {
                  // The tab in front is the header's handle, and the click
                  // reaches the row above; any other tab is selected.
                  if (!tab.active) onSelect(tab.path);
                }}
              >
                {tab.leading}
                <span className="truncate">
                  {tab.label}
                  {tab.extension ? (
                    <span
                      className={
                        tab.extensionTone === "error"
                          ? "text-error"
                          : tab.active
                            ? "text-ink-2"
                            : "text-ink-3"
                      }
                    >
                      {tab.extension}
                    </span>
                  ) : null}
                </span>
                {tab.badge}
              </button>
              {tab.closeLabel ? (
                // Shown on the tab in front and under the pointer, and
                // always on a finger, which has no pointer to hover with.
                // Its finger target is drawn on a coarse pointer only: a
                // tab is as wide as its name now, and a 44px zone under a
                // mouse reached the name and closed what a click meant to
                // select.
                <button
                  className={`nx-tap-coarse flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-ink-3 hover:text-ink [--nx-tap-y:36px] ${
                    tab.active ? "" : "hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:focus-visible:opacity-100"
                  }`}
                  aria-label={tab.closeLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.path);
                  }}
                >
                  <CloseIcon size={11} />
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
            "flex-1 transition-colors duration-[90ms]",
            onHeaderClick ? "cursor-pointer hover:bg-wash" : "",
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
      {/* The kit's menu: fixed rather than absolute, because the strip is
          `overflow-x-auto` and an absolute menu would be clipped by it, the
          bug the tree hit inside its own scroll box; and it keeps itself on
          the screen from its measured size. */}
      <Menu
        open={menu !== null && items.length > 0}
        onClose={closeMenu}
        wanted={wanted}
        testid={menuTestId}
        width={kind === "source" ? 200 : 232}
      >
        {items.map((item) =>
          "rule" in item ? (
            // Two subjects in one column read as two ways of doing one
            // thing; the rule says where one ends.
            <MenuDivider key={item.key} />
          ) : (
            <Item
              key={item.key}
              // An item that can have nothing to do says so first rather
              // than explaining itself by doing nothing.
              disabled={item.off}
              onClick={() => {
                setMenu(null);
                item.run();
              }}
            >
              {item.label}
            </Item>
          ),
        )}
      </Menu>
    </div>
  );
}

/** A file name shortened in the middle, the way both strips draw one. */
export function middleTruncate(name: string, limit: number): string {
  if (name.length <= limit) return name;
  const head = Math.ceil((limit - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (limit - 1 - head))}`;
}
