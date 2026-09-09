import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chevron } from "../../chrome";
import { APPEARANCE_CHANGED, type Theme } from "../../appearance";

/** The theme, live.
 *
 *  Screenshots have to follow it: a light crop on the dark sheet reads as a
 *  broken image.  `prefers-color-scheme` is the wrong test here -- this app
 *  chooses its own theme and stamps `data-theme` on the root before React
 *  renders, so the media query answers a question nobody asked.  The same
 *  mistake once made the light hero shot come out dark. */
export function useTheme(): Theme {
  const read = (): Theme =>
    (document.documentElement.dataset.theme as Theme) ?? "dark";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const onChange = () => setTheme(read());
    window.addEventListener(APPEARANCE_CHANGED, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGED, onChange);
  }, []);
  return theme;
}

/** One numbered part of the tutorial, and the anchor its contents row jumps to.
 *
 *  Numbered, at last.  This docstring has said "numbered" since it was
 *  written and nothing was: eleven headings in one typeface, and a reader
 *  coming back for the third time had no way to say where they had got to.
 *  A number is only worth drawing when the thing really is a sequence, and
 *  this one is -- it is read top to bottom the first time and dipped into
 *  afterwards, which is exactly the shape a number serves. */
export function Section({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} data-section={id} className="scroll-mt-2">
      <h3 className="t-ui-lg mb-2 flex items-baseline gap-2 font-semibold text-ink">
        <span className="t-code-sm tnum w-[15px] shrink-0 text-right font-normal text-ink-3">{n}</span>
        <span>{title}</span>
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** A paragraph.  Emphasis is `--ink` at the same weight and nothing else:
 *  `--pen` means the agent touched something and `--hint` means live
 *  interactive state, and neither may be spent on running text. */
export function P({ children }: { children: ReactNode }) {
  return <p className="t-ui text-ink-2">{children}</p>;
}

/** The sentence the section would give if it could give only one.
 *
 *  Every section was three or four paragraphs at one size in one colour,
 *  and eleven of those in a 380px column is a wall.  The lead is set in
 *  --ink rather than --ink-2 and nothing else changes, so a reader skimming
 *  the sheet gets eleven answers and a reader reading it straight through
 *  does not notice.  It is the first paragraph promoted, not a summary
 *  written on top of one: a section whose opening sentence does not carry
 *  it wants rewriting rather than labelling. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="t-ui text-ink">{children}</p>;
}

/** A literal the machine produced or consumes: a key, a path, a filename. */
export function C({ children }: { children: ReactNode }) {
  return <code className="t-code-sm text-ink">{children}</code>;
}

/** The shortcut table.  Rows on the app's 26px grid, no borders, no header:
 *  it is a list of pairs rather than data with columns to compare. */
export function Keys({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-col">
      {rows.map(([key, does]) => (
        <div key={key} className="flex h-[26px] items-center gap-3">
          <span className="t-code-sm w-[92px] shrink-0 text-ink">{key}</span>
          <span className="t-ui min-w-0 flex-1 text-ink-2">{does}</span>
        </div>
      ))}
    </div>
  );
}

/** A cropped screenshot of the real interface.
 *
 *  `width` and `height` are always set so nothing reflows as the image
 *  arrives -- text that jumps while figures load is the same failure the
 *  status strip's fixed slots exist to prevent.  The caption says what to
 *  look for; the alt text says what the picture is.  They are not the same
 *  sentence. */
export function Figure({
  light,
  dark,
  alt,
  caption,
  width,
  height,
  eager,
}: {
  light: string;
  dark: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  eager?: boolean;
}) {
  const theme = useTheme();
  return (
    <figure className="my-1">
      <img
        src={theme === "dark" ? dark : light}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        className="block w-full rounded-[3px] border border-line"
      />
      <figcaption className="t-micro mt-[6px] text-ink-3">{caption}</figcaption>
    </figure>
  );
}

export type Entry = { id: string; label: string };

/** The contents, and where you are, in one 30px row.
 *
 *  Eleven entries at 26px is 290 pixels of a 380px sheet, above the fold,
 *  before a single word of the tutorial -- a third of the surface spent on
 *  an index, permanently, on a first read where nobody has anywhere to go
 *  back to yet.  But the index is not decoration either: §13 says this is
 *  reference material as much as a first read, and reference material with
 *  no way in is a scroll.
 *
 *  So it is both, one click apart.  Closed, the row names the section you
 *  are in -- which is the other job the old list was doing badly, with a
 *  4px dot at the end of a row on the far side of the sheet from the words
 *  it marked.  Open, it is the same list it always was, with the same
 *  single tab stop and the same arrow keys, and choosing from it closes it
 *  again, because you asked to be somewhere rather than to have a list.
 *
 *  The current entry is marked with a 2px leading bar in --pen, which is
 *  what every other list in this application does: the file tree, the
 *  history panel, the diagnostics list and the folder chooser all say "this
 *  one" the same way.
 */
export function Contents({
  entries,
  current,
  onGo,
}: {
  entries: Entry[];
  current: string;
  onGo: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const at = entries.findIndex((entry) => entry.id === current);
  const here = at < 0 ? 0 : at;

  // Opening puts the caret on the row you are already in, so the first
  // arrow key moves from where you are rather than from the top.
  useEffect(() => {
    if (!open) return;
    setFocused(here);
    list.current
      ?.querySelectorAll<HTMLElement>("[data-contents-row]")
      ?.[here]?.focus();
  }, [open, here]);

  const move = (index: number) => {
    const to = Math.max(0, Math.min(index, entries.length - 1));
    setFocused(to);
    list.current
      ?.querySelectorAll<HTMLElement>("[data-contents-row]")
      ?.[to]?.focus();
  };

  const leave = (id: string) => {
    onGo(id);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="shrink-0 border-b border-line">
      <button
        ref={trigger}
        data-contents-row
        data-testid="tutorial-contents"
        aria-expanded={open}
        aria-controls="tutorial-contents-list"
        className="nx-tap [--nx-tap-y:30px] flex h-[30px] w-full items-center gap-[6px] px-[10px] text-left transition-colors duration-[90ms] hover:bg-surface"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="t-code-sm tnum w-[15px] shrink-0 text-right text-ink-3">{here + 1}</span>
        <span className="t-ui min-w-0 flex-1 truncate text-ink">
          {entries[here]?.label ?? "Contents"}
        </span>
        <span className="t-micro shrink-0 text-ink-3">
          {open ? "Close" : "Contents"}
        </span>
        <Chevron direction={open ? "up" : "down"} />
      </button>

      {open ? (
        <div
          ref={list}
          id="tutorial-contents-list"
          className="border-t border-line py-1"
          role="list"
          aria-label="Tutorial contents"
        >
          {entries.map((entry, index) => {
            const mine = entry.id === current;
            return (
              <button
                key={entry.id}
                role="listitem"
                data-contents-row
                data-testid="tutorial-contents-row"
                aria-current={mine ? "true" : undefined}
                tabIndex={index === focused ? 0 : -1}
                className="relative flex h-[26px] w-full items-center gap-[6px] px-[10px] text-left transition-colors duration-[90ms] hover:bg-surface"
                onFocus={() => setFocused(index)}
                onClick={() => leave(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    move(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    move(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    move(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    move(entries.length - 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    trigger.current?.focus();
                  }
                }}
              >
                {mine ? (
                  <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
                ) : null}
                <span className="t-code-sm tnum w-[15px] shrink-0 text-right text-ink-3">
                  {index + 1}
                </span>
                <span
                  className={`t-ui min-w-0 flex-1 truncate ${
                    mine ? "text-ink" : "text-ink-2"
                  }`}
                >
                  {entry.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Which section the reader is in, from the headings themselves. */
export function useCurrentSection(
  scroller: React.RefObject<HTMLElement | null>,
  ids: string[],
): string {
  const [current, setCurrent] = useState(ids[0] ?? "");
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set((entry.target as HTMLElement).dataset.section ?? "", entry.isIntersecting);
        }
        const first = ids.find((id) => seen.get(id));
        if (first) setCurrent(first);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const id of ids) {
      const node = root.querySelector(`[data-section="${id}"]`);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [scroller, ids]);
  return current;
}
