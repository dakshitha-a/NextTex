import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** One numbered part of the tutorial, and the anchor its contents row jumps to. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} data-section={id} className="scroll-mt-2">
      <h3 className="t-ui-lg mb-2 font-semibold text-ink">{title}</h3>
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

/** The contents, fixed above the scroller so a return visit is one click
 *  from any answer.  One tab stop with arrow keys, not one per row: the
 *  file tree and the sections panel both learned that lesson already. */
export function Contents({
  entries,
  current,
  onGo,
}: {
  entries: Entry[];
  current: string;
  onGo: (id: string) => void;
}) {
  const [focused, setFocused] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);

  const move = (index: number) => {
    const at = Math.max(0, Math.min(index, entries.length - 1));
    setFocused(at);
    list.current
      ?.querySelectorAll<HTMLElement>("[data-contents-row]")
      ?.[at]?.focus();
  };

  return (
    <div
      ref={list}
      className="shrink-0 border-b border-line py-1"
      role="list"
      aria-label="Tutorial contents"
    >
      {entries.map((entry, index) => {
        const here = entry.id === current;
        return (
          <button
            key={entry.id}
            role="listitem"
            data-contents-row
            data-testid="tutorial-contents-row"
            aria-current={here ? "true" : undefined}
            tabIndex={index === focused ? 0 : -1}
            className="flex h-[26px] w-full items-center gap-[6px] px-[10px] text-left transition-colors duration-[90ms] hover:bg-surface-2"
            onFocus={() => setFocused(index)}
            onClick={() => onGo(entry.id)}
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
              }
            }}
          >
            <span className={`t-ui min-w-0 flex-1 truncate ${here ? "text-ink" : "text-ink-2"}`}>
              {entry.label}
            </span>
            {/* The dot alone marks where you are.  A fill would make the
                current row the one row that does not answer the pointer. */}
            <span
              className={`h-[4px] w-[4px] shrink-0 rounded-full ${
                here ? "bg-pen" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
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
