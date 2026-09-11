import { useMemo, useRef, useState } from "react";
import { headingAt, type Heading } from "../outline";
import { useStore } from "../store";
import { Chevron } from "../chrome";
import { findNode } from "../tree";

/** The indent step, matching the file tree above it: the width of a Source
 *  Sans lowercase n at 13px, so the two lists sit on one grid. */
const INDENT = 13;

/** The table of contents for the file in the editor.
 *
 *  It lists what the source says rather than what the last build produced,
 *  so a section shows up in the rail the moment it is typed rather than one
 *  compile later.  In a skeleton document like main.tex the `\include`
 *  lines are the outline, so those are listed too and open the file they
 *  name -- which makes this the chapter list for the whole dissertation
 *  when main.tex is in front, and the section list for a chapter when the
 *  chapter is. */
export default function SectionsPanel({
  open,
  onToggle,
  onJump,
  grow,
  /** How an included path is resolved, so a row can say whether the file
   *  it names is actually there. */
  resolve,
}: {
  open: boolean;
  onToggle: () => void;
  onJump: (heading: Heading) => void;
  /** True when the file list is folded away and there is room to spare. */
  grow: boolean;
  resolve: (path: string) => string | undefined;
}) {
  const headings = useStore((s) => s.outline);
  const line = useStore((s) => s.cursor.line);
  const activePath = useStore((s) => s.activePath);
  const tree = useStore((s) => s.tree);
  const viewing = useStore((s) => s.viewing);
  // A roving tabindex, as in the file tree beside it: the list is one tab
  // stop and the arrow keys move within it.  A chapter file has forty
  // headings, and forty tab stops between the tree and the trash is not a
  // keyboard path anybody would use twice.
  const [focused, setFocused] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);

  // Where the caret is, which is what makes this navigation rather than a
  // list: the section being written is the one shown as current.
  const here = useMemo(() => headingAt(headings, line), [headings, line]);
  // A chapter file has no \chapter in it, so its sections would otherwise
  // sit indented against a left edge nothing occupies.
  const base = useMemo(
    () => (headings.length ? Math.min(...headings.map((h) => h.level)) : 0),
    [headings],
  );
  // The badge earns its place only when it distinguishes something.  On a
  // skeleton document every row is a file, and the word repeated down the
  // whole rail says nothing.
  const mixed = useMemo(
    () => headings.some((h) => h.path) && headings.some((h) => !h.path),
    [headings],
  );
  // An \include for a chapter not yet written is the normal state of a
  // skeleton document.  Saying so is more useful than a row that looks
  // live and does nothing -- and it names the compile error coming next.
  const missing = useMemo(() => {
    const gone = new Set<string>();
    if (!tree) return gone;
    for (const heading of headings) {
      if (heading.path && !resolve(heading.path)) gone.add(heading.path);
    }
    return gone;
  }, [headings, tree, resolve]);

  const moveFocus = (index: number) => {
    const clamped = Math.max(0, Math.min(index, headings.length - 1));
    setFocused(clamped);
    const rows = list.current?.querySelectorAll<HTMLElement>("[data-testid='section-row']");
    rows?.[clamped]?.focus();
  };

  return (
    <div
      className={`border-t border-line ${
        open && grow
          ? "flex min-h-[104px] flex-1 flex-col overflow-hidden"
          : "shrink-0"
      }`}
      data-testid="sections-panel"
    >
      <button
        className="flex h-[26px] w-full shrink-0 items-center justify-between px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        aria-expanded={open}
        data-testid="sections-toggle"
        onClick={onToggle}
      >
        <span className="t-micro text-ink-2">Sections</span>
        <span className="flex items-center gap-2">
          {headings.length ? (
            <span className="t-micro text-ink-3">{headings.length}</span>
          ) : null}
          <span className={`text-ink-3 ${open ? "rotate-180" : ""}`}>
            <Chevron direction="down" />
          </span>
        </span>
      </button>
      {open ? (
        <div
          ref={list}
          className={`py-[4px] ${
            grow ? "min-h-0 flex-1 overflow-auto" : "max-h-[240px] overflow-auto"
          }`}
        >
          {!activePath ? (
            <p className="t-micro px-[10px] py-1 text-ink-3">
              Open a file to see its sections.
            </p>
          ) : !headings.length ? (
            <p className="t-micro px-[10px] py-1 text-ink-3">
              No sections in this file yet.
            </p>
          ) : (
            headings.map((heading, index) => {
              const current = index === here && !heading.path;
              const gone = heading.path ? missing.has(heading.path) : false;
              const weight =
                heading.kind === "chapter" || heading.kind === "part"
                  ? "font-medium"
                  : "";
              // One colour, computed: three competing text utilities in one
              // string leave the winner to stylesheet order.
              const ink = gone ? "text-ink-3" : current ? "text-ink" : "text-ink-2";
              return (
                <button
                  key={`${heading.line}:${heading.title}`}
                  data-testid="section-row"
                  aria-current={current ? "true" : undefined}
                  data-line={heading.line}
                  data-kind={heading.kind}
                  disabled={gone}
                  tabIndex={index === focused ? 0 : -1}
                  className={`flex h-[26px] w-full items-center gap-[6px] pr-2 text-left transition-colors duration-[90ms] ${
                    gone ? "cursor-default" : "hover:bg-surface-2"
                  }`}
                  style={{ paddingLeft: 10 + (heading.level - base) * INDENT }}
                  title={
                    heading.path
                      ? gone
                        ? `${heading.path} is not in this project yet`
                        : `Open ${heading.path}`
                      : `${heading.title}, line ${heading.line}`
                  }
                  onFocus={() => setFocused(index)}
                  onClick={() => onJump(heading)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveFocus(index + 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveFocus(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveFocus(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveFocus(headings.length - 1);
                    }
                  }}
                >
                  {/* A dot rather than a rule or a fill: the mark moves as
                      the writer types, and anything that changed a row's
                      size would shift every row below it several times a
                      minute.  A fill would also take the row's own hover. */}
                  <span
                    className={`h-[4px] w-[4px] shrink-0 rounded-full ${
                      current ? "bg-pen" : "bg-transparent"
                    }`}
                  />
                  <span className={`t-ui min-w-0 flex-1 truncate ${ink} ${weight}`}>
                    {heading.title}
                  </span>
                  {mixed && heading.path ? (
                    <span className="t-micro shrink-0 text-ink-3">file</span>
                  ) : null}
                </button>
              );
            })
          )}
          {viewing ? (
            <p className="t-micro px-[10px] pt-1 text-ink-3">
              Sections of the old version. Clicking one returns to the live
              file.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Kept here so the panel and its caller agree on what a row points at. */
export function includePath(
  tree: Parameters<typeof findNode>[0] | null,
  mainFile: string,
  path: string,
): string | undefined {
  // LaTeX resolves an included path against the main file's directory, not
  // against the file doing the including, so a project whose main.tex sits
  // in a subfolder still opens the right file.
  const cut = mainFile.lastIndexOf("/");
  const base = cut === -1 ? "" : mainFile.slice(0, cut + 1);
  if (!tree) return undefined;
  return [base + path, path].find((candidate) => findNode(tree, candidate));
}
