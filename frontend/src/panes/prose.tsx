import { memo, useMemo, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";

/** Just enough Markdown for what an agent writes about a document.
 *
 *  A library would be 40 KB to render six constructs, and would bring its
 *  own opinions about typography into a column whose type is the app's
 *  own.  Anything not handled here is left as the literal text the model
 *  wrote, which is the honest failure mode.
 */

/** Every block carries `line`, the 1-based source line it starts on, and
 *  a list carries one per item.  The chat never reads them; the Markdown
 *  pane does, so a double-click on the rendering can say which line of
 *  the file it landed on, the way SyncTeX does for the page.  A code
 *  block's line is its opening fence, so its text begins one below. */
export type Block =
  | { kind: "paragraph"; text: string; line: number }
  | { kind: "code"; text: string; language: string; line: number }
  | { kind: "heading"; text: string; level: number; line: number }
  | { kind: "list"; items: string[]; lines: number[]; ordered: boolean; line: number }
  | { kind: "quote"; text: string; line: number };

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
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index])
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
          className="t-code-sm rounded-control bg-surface-2 px-[3px] py-[1px]"
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
  return "text" in one && "text" in two && one.text === two.text;
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
