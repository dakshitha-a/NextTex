import { useEffect, useMemo, useRef, useState } from "react";
import { headingAt, type Heading } from "../outline";
import { useStore } from "../store";
import { Chevron } from "../chrome";
import { Empty } from "../ui/controls";

/** The indent step, matching the file tree above it: the width of a Source
 *  Sans lowercase n at 13px, so the two lists sit on one grid. */
/** Sixteen pixels a level, as the page draws the drawer's indents. */
const INDENT = 16;

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
  open = false,
  onToggle,
  onJump,
  grow,
  /** How an included path is resolved, so a row can say whether the file
   *  it names is actually there. */
  resolve,
  drawer = false,
}: {
  open?: boolean;
  onToggle?: () => void;
  onJump: (heading: Heading) => void;
  /** True when the file list is folded away and there is room to spare. */
  grow: boolean;
  resolve: (path: string) => string | undefined;
  /** Inside the activity bar's drawer, which draws the heading row and
   *  holds one instrument at a time: the panel's own header is not drawn
   *  and its body is always open. */
  drawer?: boolean;
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
  // Clamped, and reset when the file changes. It is an index into
  // `headings`, and the list is rebuilt whenever the editor opens
  // something else: a heading number from a long chapter left a
  // three-heading file with no row carrying the tab stop at all, so the
  // rail could not be reached with Tab until somebody clicked it. The same
  // fault as the file tree's, in the panel underneath it.
  const stop = headings.length ? Math.min(focused, headings.length - 1) : 0;
  useEffect(() => setFocused(0), [activePath]);
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

  const shown = drawer || open;
  return (
    <div
      className={`${drawer ? "" : "border-t border-line "}${
        shown && grow
          ? "flex min-h-[104px] flex-1 flex-col overflow-hidden"
          : "shrink-0"
      }`}
      data-testid="sections-panel"
    >
      {drawer ? null : (
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
      )}
      {shown ? (
        <div
          ref={list}
          className={`flex flex-col px-2 py-[4px] ${
            grow ? "min-h-0 flex-1 overflow-auto" : "max-h-[240px] overflow-auto"
          }`}
        >
          {!activePath ? (
            <Empty>Open a file to see its sections.</Empty>
          ) : !headings.length ? (
            <Empty>No sections in this file yet.</Empty>
          ) : (
            headings.map((heading, index) => {
              const current = index === here && !heading.path;
              const gone = heading.path ? missing.has(heading.path) : false;
              const weight =
                heading.kind === "chapter" || heading.kind === "part"
                  ? "font-medium"
                  : "";
              return (
                // The kit's row, as the page draws the drawer: 30 px, the
                // wash under the pointer and the chosen one, 16 px per
                // level, the pen dot on the heading under the caret, and a
                // heading whose file is not in the project yet greyed with
                // the reason as its tail.
                <button
                  key={`${heading.line}:${heading.title}`}
                  data-testid="section-row"
                  aria-current={current ? "true" : undefined}
                  data-selected={current || undefined}
                  data-line={heading.line}
                  data-kind={heading.kind}
                  disabled={gone}
                  tabIndex={index === stop ? 0 : -1}
                  className={`nx-row shrink-0 ${gone ? "cursor-default !text-ink-3 hover:!bg-transparent" : ""}`}
                  style={{ paddingLeft: 8 + (heading.level - base) * INDENT }}
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
                    className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                      current ? "bg-pen" : "bg-transparent"
                    }`}
                  />
                  <span className={`nx-row-label ${weight}`}>{heading.title}</span>
                  {gone ? (
                    <span className="nx-row-trailing nx-row-trailing-always">not in the project yet</span>
                  ) : mixed && heading.path ? (
                    <span className="nx-row-trailing nx-row-trailing-always">file</span>
                  ) : null}
                </button>
              );
            })
          )}
          {viewing ? (
            <p className="nx-note">
              Sections of the old version. Clicking one returns to the live
              file.
            </p>
          ) : null}
          {activePath && headings.length ? (
            <p className="nx-note mt-auto pt-3">Click a heading to go there.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

