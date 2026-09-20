import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { onFrame } from "../timing";
import { under } from "../place-menu";
import { Menu, MenuItem } from "../ui/Menu";

/** What the two tab strips share, so they cannot drift apart again.
 *
 *  The source strip and the preview strip are deliberately the same object
 *  (see PreviewTabs.tsx), and for a year they were not: the source strip
 *  counted the tabs scrolled out of sight and the preview strip let them
 *  scroll away in silence, with a scrollbar under a 32px row.  Both now
 *  measure the same way, hide the bar the same way, scroll under a wheel
 *  the same way, and list what they hide the same way.
 */

/** The paths of the tabs scrolled out of sight, measured once per frame.
 *
 *  `measure` reads `offsetLeft` and `offsetWidth` for every tab, which
 *  forces layout, and it used to run on every scroll event and every
 *  resize notification.  Once per frame is as often as the answer can
 *  change on screen.  Tabs are the children carrying `data-path`.
 */
export function useHiddenTabs(
  strip: RefObject<HTMLElement | null>,
  count: number,
): string[] {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => {
      const children = Array.from(element.children) as HTMLElement[];
      const right = element.scrollLeft + element.clientWidth;
      // `offsetLeft` is measured from the nearest positioned ancestor, and
      // the strip is not one, so a tab's is taken relative to the strip's
      // own.  The source strip happened to sit at the left edge of its
      // positioned wrapper, which is why the old arithmetic worked there
      // and reported every preview tab hidden.
      const origin = element.offsetLeft;
      const out = children
        .filter((child) => {
          if (!child.dataset.path) return false;
          const left = child.offsetLeft - origin;
          return left + child.offsetWidth > right + 1 || left < element.scrollLeft - 1;
        })
        .map((child) => child.dataset.path!);
      setHidden((was) =>
        was.length === out.length && was.every((path, i) => path === out[i]) ? was : out,
      );
    };
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
  }, [strip, count]);
  return hidden;
}

/** The tab in front is kept in sight.
 *
 *  Choosing a tab from the hidden list, or reaching one with the keyboard
 *  cycle, put it in front while the strip stayed scrolled where it was, so
 *  the tab that was just chosen was the one still out of sight.
 */
export function useFollowActive(
  strip: RefObject<HTMLElement | null>,
  active: string | null,
): void {
  useEffect(() => {
    const element = strip.current;
    if (!element || !active) return;
    const tab = Array.from(element.children).find(
      (child) => (child as HTMLElement).dataset.path === active,
    ) as HTMLElement | undefined;
    if (!tab) return;
    // The strip's own scroll and nothing else's: `scrollIntoView` walks
    // every scrolling ancestor, and a tab brought into the strip must not
    // drag the pane it sits in.
    const left = tab.offsetLeft - element.offsetLeft;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + tab.offsetWidth > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + tab.offsetWidth - element.clientWidth;
    }
  }, [strip, active]);
}

/** A vertical wheel over the strip scrolls it sideways.
 *
 *  A strip is a row, and a mouse has one wheel, so a wheel turned over the
 *  header is the writer asking to see the tabs further along.  Attached
 *  with `passive: false` in an effect rather than through React's
 *  `onWheel`, because a passive listener cannot prevent the default and
 *  the default here is the page under the header scrolling instead.  A
 *  wheel that is mostly horizontal, a trackpad's, is left to the browser,
 *  which already scrolls the strip with it.
 */
export function useWheelScroll(
  strip: RefObject<HTMLElement | null>,
  /** Re-attach when this changes: the preview strip is not drawn at all
   *  for a project with one document, so on the first render there was
   *  nothing to listen on, and an effect keyed on the ref alone never
   *  looked again. */
  count: number,
): void {
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (element.scrollWidth <= element.clientWidth) return;
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [strip, count]);
}

/** The count of tabs out of sight, and a list of them on a press.
 *
 *  A count that only scrolled to the end, which is what it did, answered
 *  "how many" and not "which"; choosing one from the list brings it in
 *  front, and the strip scrolls to it because the strip follows the tab in
 *  front.  It claims `role="menu"` and keeps the promise: focus on open,
 *  arrow keys, Home, End, Escape.
 */
export function HiddenTabs({
  hidden,
  label,
  name,
  testId,
  onPick,
}: {
  hidden: string[];
  /** What one of these is called in the title: "open" or "previewed". */
  label: string;
  /** The last path segment, as the strip itself draws it. */
  name: (path: string) => string;
  testId: string;
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const wanted = useMemo(() => (open ? under(button.current, 232, "right") : null), [open]);
  useEffect(() => {
    if (!hidden.length) setOpen(false);
  }, [hidden.length]);
  if (!hidden.length) return null;
  return (
    <div className="relative flex shrink-0">
      {/* "+3", the way the page draws it: a count in the third ink with
          no box of its own, on the same row as the tabs it stands for. */}
      <button
        ref={button}
        className="t-meta tnum flex shrink-0 items-center px-2 text-ink-3 hover:text-ink"
        title={`${hidden.length} more ${label}`}
        aria-label={`${hidden.length} more ${label}, list them`}
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      >
        +{hidden.length}
      </button>
      {/* The kit's menu, hung from the button's right edge so it opens
          inward, and capped at the window's height: a strip with forty
          files open lists most of them here, and a list that ran off the
          bottom hid exactly the tabs it exists to reach. */}
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        wanted={wanted}
        anchor={button}
        testid={`${testId}-menu`}
        width={232}
      >
        {hidden.map((path) => (
          <MenuItem
            key={path}
            title={path}
            onClick={() => {
              setOpen(false);
              onPick(path);
            }}
          >
            {name(path)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}

