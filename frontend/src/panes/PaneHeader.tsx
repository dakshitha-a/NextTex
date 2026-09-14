import type { ReactNode } from "react";

/** The 32px row at the top of the source pane and of the preview pane.
 *
 *  One shell for both, so they cannot drift: the same height, the same
 *  ground, the same rule under the row, the same place for the strip and
 *  for the controls at either end.  The header itself carries no bottom
 *  border and no hover of its own.  The rule is composed by what sits in
 *  the row, inactive tabs, the empty run and the two slots here, and the
 *  tab in front carries none, so it opens into the pane below it.  Hover
 *  belongs to the things that answer a click, which the row as a whole
 *  does not.
 *
 *  `select-none`, because the row answers a double-click by entering a
 *  mode, and a double-click on text also selects the word under it, which
 *  used to leave a tab's name highlighted in the one colour reserved for
 *  "the agent touched this".
 */
export default function PaneHeader({
  testId,
  leading,
  trailing,
  children,
}: {
  testId: string;
  /** Before the strip: the project controls when the file list is folded. */
  leading?: ReactNode;
  /** After the strip: the pane's own controls, then the fold chevron. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex h-[32px] shrink-0 select-none items-stretch bg-surface-2"
    >
      {leading ? (
        <div className="flex shrink-0 items-center border-b border-r border-line pl-1">
          {leading}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-line pl-1 pr-1">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
