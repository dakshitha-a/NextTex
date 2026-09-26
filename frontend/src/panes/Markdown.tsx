import { memo, useEffect, useMemo, useRef } from "react";
import { get, useStore } from "../store";
import { busyTyping } from "../timing";
import type { WordHint } from "./locate-word";
import { lineOf, sameWithLines } from "./markdown-source";
import { inline, parseBlocks, type Block } from "./prose";

/** A Markdown file, rendered as it is typed.
 *
 *  A `.md` in front of the editor puts this pane in front of the page,
 *  the way a `.py` puts the script pane there: a README, a set of notes,
 *  a journal's cover letter kept beside the manuscript, each is a file
 *  that is written in the same editor and read in the same pane as the
 *  document it travels with.  The text is what the editor holds, a
 *  quarter of a second behind the keyboard, published by the editor from
 *  the same place it publishes the section list, so a version being
 *  viewed from History renders that version.
 *
 *  The renderer is the chat's own, `parseBlocks` and `inline` from
 *  `prose.tsx`: headings, paragraphs, lists, fenced code, quotes, and
 *  code, bold and italic within them.  Deliberately not a library, for
 *  the reason that file gives, and deliberately not more than it does: a
 *  writer who needs tables and images in a README has a renderer on the
 *  other end of the push, and what is wanted here is to see the shape of
 *  the prose while writing it.  What the parser does not know it leaves
 *  as the literal text, which is the honest failure.
 *
 *  On paper, like the typeset page and a figure, with a measure of about
 *  seventy characters: it is a page being read, not a panel.  Unlike the chat's rendering the headings keep their
 *  levels, because a document's structure is what a preview of it is for.
 *
 *  And like the page, a double-click on it goes to the source.  The page
 *  asks SyncTeX; this pane asks nobody, because the parser read the
 *  file's lines itself and every block carries the one it starts on, in
 *  `data-line`, with each list item carrying its own.  The word the
 *  second click selected says which line of a paragraph the click was
 *  on, and the editor puts the caret on that word.
 */

const HEADING = [
  "",
  "t-display mt-2 first:mt-0",
  "text-md-h1 leading-6 font-semibold mt-3",
  "text-md-h2 leading-5.5 font-semibold mt-2",
  "text-md-h3 leading-5.5 font-semibold mt-2",
];

const Rendered = memo(function Rendered({ block, id }: { block: Block; id: string }) {
  if (block.kind === "heading") {
    const level = Math.min(Math.max(block.level, 1), 4);
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
    return (
      <Tag className={`${HEADING[level]} text-ink`} data-line={block.line}>
        {inline(block.text, id)}
      </Tag>
    );
  }
  if (block.kind === "code") {
    return (
      <pre
        className="t-code-sm overflow-x-auto rounded-control bg-surface-2 p-2 text-ink"
        data-line={block.line}
      >
        {block.text}
      </pre>
    );
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag
        className={`flex flex-col gap-1 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}
        data-line={block.line}
      >
        {block.items.map((item, index) => (
          <li key={`${id}-${index}`} data-line={block.lines[index]}>
            {inline(item, `${id}-${index}`)}
          </li>
        ))}
      </Tag>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="border-l-2 border-line pl-3 italic text-ink-2" data-line={block.line}>
        {inline(block.text, id)}
      </blockquote>
    );
  }
  return (
    <p className="whitespace-pre-wrap" data-line={block.line}>
      {inline(block.text, id)}
    </p>
  );
}, sameWithLines);

export default function Markdown({
  onNavigate,
}: {
  /** A double-click on the rendering: the file, the line it landed on,
   *  and the word, for the caret to find on that line. */
  onNavigate?: (path: string, line: number, hint: WordHint) => void;
}) {
  const tab = useStore((s) => s.markdown);
  const source = useStore((s) => s.markdownSource);
  // The text for the tab's file, and nothing for another file's: the
  // editor may be a beat behind a switch between two Markdown files.
  const text = tab && source && source.path === tab.path ? source.text : "";
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const name = tab?.path.split("/").pop() ?? "";

  // The rendering follows the caret, gently, the way the page follows it
  // after a build (§28 of the design record): only when the text has just
  // changed under this keyboard, and only when the block the caret is in
  // is not already on screen.  On the text and never on the cursor, so a
  // click into the editor after reading the rendering moves nothing, and
  // a collaborator's or the agent's change moves nothing either: those
  // are the anti-jump cases.  No flash, because there was no build.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pane = scroller.current;
    if (!pane || !text || !busyTyping()) return;
    const caret = get().cursor.line;
    const block = blocks.reduce<Block | null>(
      (held, candidate) => (candidate.line <= caret ? candidate : held),
      null,
    );
    if (!block) return;
    const target = pane.querySelector<HTMLElement>(`[data-line="${block.line}"]`);
    if (!target) return;
    const box = target.getBoundingClientRect();
    const frame = pane.getBoundingClientRect();
    const onScreen = box.top >= frame.top && box.bottom <= frame.bottom;
    if (!onScreen) target.scrollIntoView({ block: "center" });
  }, [text]);

  const onDoubleClick = (event: React.MouseEvent) => {
    if (!tab || !onNavigate) return;
    const target = (event.target as HTMLElement).closest("[data-line]") as HTMLElement | null;
    if (!target) return;
    // Read before anything else can clear it: the second click selected
    // the word, and that word is what says which line of a paragraph
    // this was, and where on it the caret should land.
    const word = String(window.getSelection() ?? "");
    const line = Number(target.dataset.line);
    if (!Number.isFinite(line) || line < 1) return;
    // The list item's line is its own; every other element's is its
    // block's first, and the word picks the line inside the block.
    const block = target.tagName === "LI" ? undefined : blocks.find((b) => b.line === line);
    onNavigate(tab.path, block ? lineOf(block, word) : line, { word, plain: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surround" data-testid="markdown-view">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-5" data-testid="markdown-scroll">
        {/* The white page's own palette, whatever the shell's: `.nx-page`
            is paper in both themes, and paper takes dark ink.  Without
            the skin the dark shell handed the page its light ink, and
            the first render was pale grey on white, the very thing the
            menu audit exists to catch; that spec measures this pane. */}
        <article
          className="nx-page nx-theme-light nx-theme-white t-prose mx-auto flex max-w-[72ch] flex-col gap-3 px-11 py-10 text-ink"
          aria-label={name ? `${name}, rendered` : undefined}
          title={onNavigate ? "Double-click to go to this line in the source" : undefined}
          onDoubleClick={onDoubleClick}
        >
          {blocks.length ? (
            blocks.map((block, index) => (
              <Rendered key={`b${index}`} id={`b${index}`} block={block} />
            ))
          ) : (
            // An empty file is an empty page, and says so once rather
            // than offering a blank sheet with nothing on it to read.
            <p className="t-meta text-ink-3">Nothing written yet.</p>
          )}
        </article>
      </div>
    </div>
  );
}
