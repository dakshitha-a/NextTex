import type { ReactNode } from "react";

/** The 36px row at the top of the source pane and of the preview pane.
 *
 *  One shell for both, so they cannot drift: the same height, the same
 *  ground, the same place for the strip and for the controls at either
 *  end.  The header carries no rule under it and no hover of its own: the
 *  row sits on the second surface and the pane below on the first, and
 *  the step of tone is the whole separation, as the direction page draws
 *  it.  Hover belongs to the things that answer a click, which the row as
 *  a whole does not.
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
      className="nx-band flex h-9 shrink-0 select-none items-stretch bg-surround pr-1.5"
    >
      {leading ? (
        <div className="flex shrink-0 items-center gap-0.5 pl-1.5">
          {leading}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
