import { memo, useMemo, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";

/** Just enough Markdown for what an agent writes about a document.
 *
 *  A library would be 40 KB to render seven constructs, and would bring its
 *  own opinions about typography into a column whose type is the app's
 *  own.  Anything not handled here is left as the literal text the model
 *  wrote, which is the honest failure mode.
 */

/** Every block carries `line`, the 1-based source line it starts on, and
 *  a list carries one per item.  The chat never reads them; the Markdown
 *  pane does, so a double-click on the rendering can say which line of
 *  the file it landed on, the way SyncTeX does for the page.  A code
 *  block's line is its opening fence, so its text begins one below.
 *  A table's line is its header's, and its body rows carry one each. */
export type Block =
  | { kind: "paragraph"; text: string; line: number }
  | { kind: "code"; text: string; language: string; line: number }
  | { kind: "heading"; text: string; level: number; line: number }
  | { kind: "list"; items: string[]; lines: number[]; ordered: boolean; line: number }
  | { kind: "quote"; text: string; line: number }
  | TableBlock;

/** A column's alignment, from the colons on the delimiter row; `null`
 *  when there are none, which draws as the start of the line. */
export type Align = "left" | "center" | "right" | null;

export type TableBlock = {
  kind: "table";
  header: string[];
  align: Align[];
  rows: string[][];
  lines: number[];
  line: number;
};

/** The row under a table's header: dashes, optionally colons, cells
 *  parted by pipes.  A pipe is required, since a line of dashes alone
 *  under text is how Markdown writes a heading or a rule. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A row's cells: split on the pipes that are not escaped, with the
 *  outer pipes a row may start and end with dropped, and `\|` kept as
 *  the pipe it stands for. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/** Whether a table starts at this line: a row with a pipe, and under it
 *  a delimiter row with as many cells.  The count is what keeps a
 *  sentence that happens to hold a pipe from becoming a table, and it
 *  is also why a table still streaming in reads as a paragraph until
 *  its delimiter row is whole. */
function tableAt(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  if (next === undefined || !lines[index].includes("|")) return false;
  if (!next.includes("|") || !DELIMITER.test(next)) return false;
  return splitRow(lines[index]).length === splitRow(next).length;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const at = index + 1;

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;   // the closing fence
      blocks.push({ kind: "code", text: body.join("\n"), language, line: at });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
        line: at,
      });
      index += 1;
      continue;
    }

    if (tableAt(lines, index)) {
      const header = splitRow(line);
      const align = splitRow(lines[index + 1]).map(alignOf);
      const rows: string[][] = [];
      const rowLines: number[] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        // A row with too few cells is padded and one with too many is
        // cut, so every row has the header's columns.
        const cells = splitRow(lines[index]).slice(0, header.length);
        while (cells.length < header.length) cells.push("");
        rows.push(cells);
        rowLines.push(index + 1);
        index += 1;
      }
      blocks.push({ kind: "table", header, align, rows, lines: rowLines, line: at });
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      const itemLines: number[] = [];
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        itemLines.push(index + 1);
        index += 1;
      }
      blocks.push({ kind: "list", items, lines: itemLines, ordered, line: at });
      continue;
    }

    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].startsWith("> ")) {
        body.push(lines[index].slice(2));
        index += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n"), line: at });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,4})\s/.test(lines[index]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index]) &&
      // A table may follow a sentence with no blank line between, as a
      // model often writes "Here they are:" straight above one.
      !tableAt(lines, index)
    ) {
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: body.join("\n"), line: at });
  }

  return blocks;
}

/** Inline spans: code, bold, italic.  Code wins, so `**` inside a path is
 *  left alone -- which matters when the paths are LaTeX. */
export function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${count++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="t-code-sm rounded-control bg-surface-2 px-0.75 py-px"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Whether two blocks would render identically.
 *
 *  `parseBlocks` builds fresh objects every time it runs, so reference
 *  equality is always false and `memo` on its own would never skip
 *  anything. Comparing the text is what makes it work, and it is cheap
 *  next to what it saves: while an answer streams in, every block but the
 *  last is unchanged, and this is the difference between React rebuilding
 *  the whole message twenty times a second and rebuilding its final
 *  paragraph.
 *
 *  The source lines are deliberately not compared: the chat draws
 *  nothing from them, and a message re-parsed after a line was added
 *  above a block would otherwise redraw every block below it for no
 *  visible change.  The Markdown pane, which does draw them, compares
 *  them as well (`sameWithLines` in `markdown-source.ts`).
 */
export function same(before: { block: Block }, after: { block: Block }): boolean {
  const one = before.block;
  const two = after.block;
  if (one.kind !== two.kind) return false;
  if (one.kind === "list" && two.kind === "list") {
    return (
      one.ordered === two.ordered
      && one.items.length === two.items.length
      && one.items.every((item, at) => item === two.items[at])
    );
  }
  if (one.kind === "heading" && two.kind === "heading") {
    return one.level === two.level && one.text === two.text;
  }
  if (one.kind === "code" && two.kind === "code") {
    return one.language === two.language && one.text === two.text;
  }
  if (one.kind === "table" && two.kind === "table") {
    const cells = (a: string[], b: string[]) =>
      a.length === b.length && a.every((cell, at) => cell === b[at]);
    return (
      cells(one.header, two.header)
      && one.align.every((side, at) => side === two.align[at])
      && one.rows.length === two.rows.length
      && one.rows.every((row, at) => cells(row, two.rows[at]))
    );
  }
  return "text" in one && "text" in two && one.text === two.text;
}

const alignClass = (side: Align) =>
  side === "center" ? "text-center" : side === "right" ? "text-right" : "text-left";

/** How a cell takes a narrow column.  Left to the browser, a table in
 *  the Claude column shrank every cell to its longest word, so "Figure
 *  1" and "212 KB" stood on two lines and a path broke at each hyphen.
 *  A short cell, or one with no space in it such as a path, keeps its
 *  line and the box scrolls instead; a sentence wraps, but no narrower
 *  than 12 rem. */
const fitCell = (cell: string) =>
  cell.length > 40 && /\s/.test(cell.trim()) ? "min-w-48" : "whitespace-nowrap";

/** A table, as the table hover card draws a LaTeX one: the header at
 *  600 with the one hairline under it, no rules between rows, air
 *  instead, figures tabular so a column of numbers lines up.  At the
 *  interface size rather than the prose's, since a table is read across
 *  and down.  A table wider than its column scrolls inside its own box,
 *  which in the Claude column is most tables of five columns or more.
 *
 *  `withLines` writes the source line of the table and of each row into
 *  `data-line`, which the Markdown pane reads on a double-click and the
 *  chat has no use for. */
export function Table(
  { block, id, withLines = false }: { block: TableBlock; id: string; withLines?: boolean },
) {
  const line = (at: number) => (withLines ? at : undefined);
  return (
    <div className="overflow-x-auto" data-testid="prose-table" data-line={line(block.line)}>
      <table className="t-ui border-collapse tabular-nums">
        <thead>
          <tr data-line={line(block.line)}>
            {block.header.map((cell, column) => (
              <th
                key={column}
                className={`border-b border-line py-1 pr-4 align-top font-semibold last:pr-0 ${alignClass(block.align[column])} ${fitCell(cell)}`}
              >
                {inline(cell, `${id}-h${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, at) => (
            <tr key={at} data-line={line(block.lines[at])}>
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={`py-1 pr-4 align-top last:pr-0 ${alignClass(block.align[column])} ${fitCell(cell)}`}
                >
                  {inline(cell, `${id}-${at}-${column}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Rendered = memo(function Rendered(
  { block, id: key }: { block: Block; id: string },
) {
  if (block.kind === "code") {
    return (
      <div className="group relative">
        <pre className="t-code-sm overflow-x-auto rounded-control bg-surface-2 p-2">
          {block.text}
        </pre>
        <CopyButton text={block.text} />
      </div>
    );
  }
  if (block.kind === "heading") {
    return (
      <div className="t-ui-lg text-ink">{inline(block.text, key)}</div>
    );
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag
        className={`flex flex-col gap-1 pl-5 ${
          block.ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
        ))}
      </Tag>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="border-l-2 border-line pl-3 italic text-ink-2">
        {inline(block.text, key)}
      </blockquote>
    );
  }
  if (block.kind === "table") return <Table block={block} id={key} />;
  return <p className="whitespace-pre-wrap">{inline(block.text, key)}</p>;
}, same);

/** Copy on a code block.
 *
 *  What an agent writes in a code block is usually meant to be taken
 *  somewhere: a command to run, a preamble line to paste. Selecting the
 *  text of a `<pre>` by hand works and is the wrong tool for a thing that
 *  happens every conversation. Its own component because `Rendered` is
 *  memoised on the block and the "Copied" moment is state that must not
 *  break that.
 *
 *  Hidden until hover only where hover exists (`hoverable:`), the way the
 *  error drawer's Copy is, so a finger sees it; and the same clipboard
 *  call, so a browser that refuses is refused in one place. */
function CopyButton({ text }: { text: string }) {
  const [said, setSaid] = useState<"" | "Copied" | "Could not copy">("");
  return (
    <Button
      variant="ghost"
      size="inline"
      className="absolute right-1 top-1 hoverable:opacity-0 hoverable:group-hover:opacity-100 focus:opacity-100"
      data-testid="code-copy"
      onClick={() => {
        const clipboard = navigator.clipboard;
        if (!clipboard) {
          setSaid("Could not copy");
          return;
        }
        clipboard
          .writeText(text)
          .then(() => setSaid("Copied"))
          .catch(() => setSaid("Could not copy"));
        window.setTimeout(() => setSaid(""), 1500);
      }}
    >
      {said || "Copy"}
    </Button>
  );
}

export default function Prose({ text }: { text: string }) {
  // Parsed once per distinct message rather than once per render: a chat
  // re-renders for reasons that have nothing to do with any one message.
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="t-prose flex flex-col gap-3 text-ink">
      {blocks.map((block, index) => (
        <Rendered key={`b${index}`} id={`b${index}`} block={block} />
      ))}
    </div>
  );
}
