import { memo, useMemo, type ReactNode } from "react";

/** Just enough Markdown for what an agent writes about a document.
 *
 *  A library would be 40 KB to render six constructs, and would bring its
 *  own opinions about typography into the one column of this app that is
 *  set in a serif on purpose.  Anything not handled here is left as the
 *  literal text the model wrote, which is the honest failure mode.
 */

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "quote"; text: string };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;   // the closing fence
      blocks.push({ kind: "code", text: body.join("\n"), language });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        index += 1;
      }
      blocks.push({ kind: "list", items, ordered });
      continue;
    }

    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].startsWith("> ")) {
        body.push(lines[index].slice(2));
        index += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
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
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }

  return blocks;
}

/** Inline spans: code, bold, italic.  Code wins, so `**` inside a path is
 *  left alone -- which matters when the paths are LaTeX. */
function inline(text: string, keyPrefix: string): ReactNode[] {
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
          className="t-code-sm rounded-[3px] bg-surface-2 px-[3px] py-[1px]"
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
      <pre className="t-code-sm overflow-x-auto rounded-[3px] bg-surface-2 p-2">
        {block.text}
      </pre>
    );
  }
  if (block.kind === "heading") {
    return (
      <div className="t-ui-lg font-serif text-ink">{inline(block.text, key)}</div>
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
      <blockquote className="border-l border-line pl-3 italic text-ink-2">
        {inline(block.text, key)}
      </blockquote>
    );
  }
  return <p className="whitespace-pre-wrap">{inline(block.text, key)}</p>;
}, same);

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
