import { hunksOf } from "./patch";

/** A unified diff, drawn the way the agent's edit chip has always drawn
 *  one: a monospace block, additions washed with the ok colour and
 *  removals with the error colour, capped and scrolling.
 *
 *  Pulled out of the chip because the git panel and the history banner
 *  now show patches too, and three renderers of the same text would be
 *  three slightly different colours for "added". */
export default function Patch({ text, testId }: { text: string; testId?: string }) {
  return (
    <pre
      className="t-code-sm mt-1 max-h-[220px] overflow-auto whitespace-pre rounded-[3px] border-l border-line bg-surface-2 p-2"
      data-testid={testId}
    >
      {hunksOf(text).map((line, index) => (
        <div
          key={index}
          className={
            line.startsWith("+")
              ? "bg-[color-mix(in_oklab,var(--ok)_10%,transparent)]"
              : line.startsWith("-")
                ? "bg-[color-mix(in_oklab,var(--error)_10%,transparent)]"
                : ""
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
