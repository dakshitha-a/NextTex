import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useStore } from "../store";
import { onFrame } from "../timing";
import { useDismiss } from "../useDismiss";
import { toShell, viewportHeight, viewportWidth } from "../viewport";
/** Fetched when somebody else turns up, which for most sessions is never.
 *  It draws nothing at all until then, so the parent decides whether to
 *  mount it and the chunk follows -- `bundle.initial_kb` is measured on the
 *  entry script and this is four kilobytes of it. */
const Collaborators = lazy(() => import("./Collaborators"));

function middleTruncate(stem: string, limit: number): string {
  if (stem.length <= limit) return stem;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}`;
}

export default function Tabs({
  onSelect,
  onClose,
  onCloseTabs,
  onDuplicate,
  onBlank,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Everything the right-click menu can do to the strip.  One prop rather
   *  than one per item: it is the signature of `afterClosing`, which does
   *  the thinking, so this component has nothing left to work out. */
  onCloseTabs: (what: "others" | "all", path: string) => void;
  onDuplicate: (path: string) => void;
  /** The empty run of the strip, past the last tab, acts as this pane's
   *  header the way the preview's title bar does. It is the only part of
   *  this row that is not already something -- and it shrinks to nothing
   *  as tabs fill the strip, which is the right behaviour: a writer with
   *  twelve files open has not left themselves a place to click. */
  onBlank?: () => void;
}) {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const diagnostics = useStore((s) => s.diagnostics);
  // Whether the strip has anything to say at all. Offline counts: a writer
  // whose typing is not reaching the file has to be told, collaborators or
  // not.
  const others = useStore((s) => s.collaborators.length);
  const connection = useStore((s) => s.connection);
  const anybodyElse = others > 0 || connection === "offline";

  const errorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of diagnostics) {
      if (item.severity !== "error" || !item.file) continue;
      counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
    }
    return counts;
  }, [diagnostics]);

  const strip = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(0);

  // The right-click menu, and which tab it belongs to.  Only ever the tab
  // in front: its items are about the file being written, and a menu on a
  // tab that is not in front would have to say which file it meant.
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRef, menu !== null, closeMenu);

  // A menu can outlive the tab it was opened on: the file is renamed
  // underneath it, or another window closes it.  Leaving it up would leave
  // a column of items pointing at nothing.
  useEffect(() => {
    if (menu && !tabs.some((tab) => tab.path === menu.path)) setMenu(null);
  }, [menu, tabs]);

  // How many tabs are scrolled out of sight, so the overflow says so
  // instead of swallowing them silently.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => {
      const children = Array.from(element.children) as HTMLElement[];
      const right = element.scrollLeft + element.clientWidth;
      setHidden(
        children.filter(
          (child) =>
            child.dataset.tab &&
            (child.offsetLeft + child.offsetWidth > right + 1 ||
              child.offsetLeft < element.scrollLeft - 1),
        ).length,
      );
    };
    // `measure` reads `offsetLeft` and `offsetWidth` for every tab, which
    // forces layout, and it ran on every scroll event and every resize
    // notification. Once per frame is as often as the answer can change on
    // screen.
    const settle = onFrame(measure);
    measure();
    element.addEventListener("scroll", settle);
    const observer = new ResizeObserver(settle);
    observer.observe(element);
    return () => {
      settle.cancel();
      element.removeEventListener("scroll", settle);
      observer.disconnect();
    };
  }, [tabs.length]);

  return (
    <div className="relative flex h-[32px] shrink-0">
      {/* A labelled group of buttons rather than an ARIA tablist.  The tab
          pattern promises arrow-key navigation between tabs and a panel
          associated with each one, and this strip has neither -- claiming
          the role would tell a screen reader something untrue. */}
      <div
        ref={strip}
        role="group"
        aria-label="Open files"
        className="no-scrollbar flex h-[32px] min-w-0 flex-1 overflow-x-auto bg-surface-2"
      >
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : "";
        const active = tab.path === activePath;
        const errors = errorCounts.get(tab.path) ?? 0;
        return (
          // The tab and its close button are siblings rather than nested:
          // a control inside another control is announced as one thing and
          // reached as two, and there is no way to say which is which.
          <div
            key={tab.path}
            data-tab="1"
            data-path={tab.path}
            className={[
              "relative flex min-w-[96px] max-w-[200px] shrink-0 items-center gap-2 border-r border-line pr-[10px]",
              active
                ? "bg-surface"
                : "border-b border-line hover:bg-surface-3",
            ].join(" ")}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.path);
              }
            }}
            onContextMenu={(event) => {
              // Only the tab in front.  A right-click on any other one is
              // left entirely alone, browser menu and all: taking that away
              // without putting something in its place would be a loss.
              if (!active) return;
              event.preventDefault();
              // `clientX` is a viewport pixel and `style.left` is read in
              // the zoomed shell's own, so everything here goes through
              // `toShell` once.  The clamps keep a menu opened on the last
              // tab, or near the foot of a short window, on screen.
              setMenu({
                path: tab.path,
                x: Math.min(toShell(event.clientX), viewportWidth() - 192),
                y: Math.min(toShell(event.clientY), viewportHeight() - 100),
              });
            }}
          >
            {active ? (
              <span className="absolute left-0 top-0 h-[2px] w-full bg-pen" />
            ) : null}
            <button
              aria-current={active ? "true" : undefined}
              title={
                errors
                  ? `${tab.path}, ${errors} ${errors === 1 ? "error" : "errors"}`
                  : tab.path
              }
              className="t-meta flex min-w-0 flex-1 cursor-pointer items-center truncate pl-[10px] text-left"
              onClick={() => onSelect(tab.path)}
            >
              <span className="text-ink">{middleTruncate(stem, 18)}</span>
              <span className={errors ? "text-error" : "text-ink-3"}>{extension}</span>
              {errors ? (
                // A number, not a coloured dot: the count says the same
                // thing without depending on being able to see the colour.
                <span
                  className="t-micro tnum ml-[6px] text-error"
                  title={`${errors} ${errors === 1 ? "error" : "errors"} in this file`}
                >
                  {errors}
                </span>
              ) : null}
            </button>
            <button
              className="nx-tap group flex h-4 w-4 shrink-0 items-center justify-center text-ink-3 hover:text-ink [--nx-tap-y:26px]"
              aria-label={`Close ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
        <div
          className={`flex-1 border-b border-line ${onBlank ? "cursor-pointer" : ""}`}
          data-testid="tabs-blank"
          title={
            onBlank
              ? "Click to fold the source away, double-click to write"
              : undefined
          }
          onClick={onBlank}
        />
      </div>
      {hidden > 0 ? (
        <button
          className="flex w-6 shrink-0 items-center justify-center border-b border-l border-line bg-surface-2 t-micro text-ink-3 hover:text-ink"
          title={`${hidden} more open`}
          onClick={() => {
            const element = strip.current;
            if (element) element.scrollLeft = element.scrollWidth;
          }}
        >
          {hidden}
        </button>
      ) : null}
      {menu ? (
        <div
          ref={menuRef}
          // Not `role="menu"`, for the reason the file tree's menu is not
          // either: the role promises arrow-key navigation between items
          // and this is a column of buttons.  See the note beside that one.
          data-testid="tab-menu"
          // Fixed, not absolute.  The strip is `overflow-x-auto`, so an
          // absolute menu would be clipped by it -- the same bug the tree
          // hit inside its own scroll box.
          className="fixed z-40 w-[184px] rounded-[5px] border border-line bg-surface py-1 shadow-float"
          style={{ left: menu.x, top: menu.y }}
        >
          {[
            ["others", "Close the others"],
            ["all", "Close all"],
            ["rule:copy", ""],
            ["duplicate", "Duplicate"],
          ].map(([key, label]) =>
            key.startsWith("rule:") ? (
              // Closing tabs and copying a file are not the same subject,
              // and an undivided column of three reads as three ways of
              // doing one thing.
              <div key={key} className="my-1 border-t border-line" />
            ) : (
              <button
                key={key}
                className="block w-full px-3 py-[3px] text-left t-ui hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                // "Close the others" with nothing else open is the one item
                // here that can have nothing to do, and an item that
                // explains itself by doing nothing is worse than one that
                // says so first.
                disabled={key === "others" && tabs.length < 2}
                onClick={() => {
                  setMenu(null);
                  if (key === "duplicate") onDuplicate(menu.path);
                  else onCloseTabs(key as "others" | "all", menu.path);
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>
      ) : null}
      {/* Who else is here, at the strip's end. A project with one writer
          looks exactly as it did, and does not download this. */}
      {anybodyElse ? (
        <div className="flex shrink-0 items-center border-b border-line bg-surface-2">
          <Suspense fallback={null}>
            <Collaborators />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
