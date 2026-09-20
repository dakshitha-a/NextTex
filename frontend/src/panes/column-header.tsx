import type { ReactNode } from "react";
import { IconButton } from "../ui/Button";
import { Heading } from "../ui/controls";
import { ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";

/** The Claude column's header row, as the direction page draws it: the
 *  title at the left, whatever the row carries, and the icon buttons at
 *  the right, the last of them the fold. A view inside the column (past
 *  conversations, what Claude reads) draws the same row with a back
 *  control in front of its title, so the column is one place with one
 *  way back rather than three panels with three headers. */
export function ColumnHeader({
  title,
  onBack,
  backLabel = "Back",
  backTestid,
  onFold,
  children,
  testid,
  onClick,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  backTestid?: string;
  onFold?: () => void;
  /** What sits between the title and the buttons. */
  children?: ReactNode;
  testid?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="nx-column-head" data-testid={testid} onClick={onClick}>
      {onBack ? (
        <IconButton label={backLabel} data-testid={backTestid} onClick={onBack}>
          <ChevronLeftIcon />
        </IconButton>
      ) : null}
      <Heading level={2} className="mr-2 shrink-0">{title}</Heading>
      {children}
      {onFold ? (
        <IconButton label="Fold this panel away" onClick={onFold}>
          <ChevronRightIcon />
        </IconButton>
      ) : null}
    </div>
  );
}
