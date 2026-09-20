import { hunksOf } from "./patch-hunks";

/** A unified diff, drawn the way the direction page draws one: a block in
 *  the mono at 11.5 on 16, 4 px round, additions on the ok wash and
 *  removals on the error wash at 18 percent, context in the third ink,
 *  capped and scrolling.
 *
 *  One renderer, because the agent's edit chip, the git drawer and the
 *  history banner all show patches, and three renderers of the same text
 *  would be three slightly different colours for "added". */
export default function Patch({
  text,
  testId,
  className,
}: {
  text: string;
  testId?: string;
  className?: string;
}) {
  return (
    <pre className={`nx-patch${className ? ` ${className}` : ""}`} data-testid={testId}>
      {hunksOf(text).map((line, index) => (
        <div
          key={index}
          className={line.startsWith("+") ? "nx-patch-add" : line.startsWith("-") ? "nx-patch-del" : "nx-patch-ctx"}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
