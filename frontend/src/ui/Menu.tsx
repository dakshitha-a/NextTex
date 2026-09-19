import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useOnScreen, type Wanted } from "../place-menu";
import { useDismiss } from "../useDismiss";
import { focusFirst, walkGrid, walkMenu } from "../panes/menu-keys";

/** A menu that floats over a pane.
 *
 *  Every menu in the app used to be its own `div`: the same shadow and
 *  border retyped at each site, a different width at each, and each one
 *  guessing at its own height to stay on the screen.  This is the one
 *  menu.  It is drawn as a card, 8 px round on a shadow with no border,
 *  and it keeps the promises the role makes: placed by `placeMenu` once its
 *  height is measured, so it flips above an anchor near the foot of the
 *  window and never leaves the screen; focus goes to its first item when
 *  it opens; the arrow keys walk the items; Escape closes it and the
 *  caller puts focus back where it came from; a press outside closes it,
 *  except on the anchor, which toggles.
 *
 *  `wanted` is the corner the menu would take with room to spare, in shell
 *  pixels (see `place-menu.ts`); `revision` is anything whose change makes
 *  the menu taller, such as a confirmation opening inside it.  `grid` is
 *  for a menu whose rows hold several items each, like the download
 *  menu's chips: Left and Right then move along a row.  A menu that is
 *  deliberately not `role="menu"`, because its items are plain buttons a
 *  spec reaches by name, passes `role="none"` and gives its items the same. */
export type MenuProps = {
  open: boolean;
  onClose: () => void;
  wanted: Wanted | null;
  /** The element that opened the menu; a press on it is left to it. */
  anchor?: RefObject<HTMLElement | null>;
  label?: string;
  testid?: string;
  width?: number;
  revision?: unknown;
  grid?: boolean;
  role?: "menu" | "none";
  className?: string;
  children: ReactNode;
};

export function Menu({
  open,
  onClose,
  wanted,
  anchor,
  label,
  testid,
  width = 232,
  revision,
  grid = false,
  role = "menu",
  className,
  children,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const placed = useOnScreen(ref, open ? wanted : null, revision);
  useDismiss(ref, open, onClose, anchor);
  // Focus the first item once, when the menu opens.  Not in a ref callback:
  // an inline ref is a new function every render, so React calls it again
  // and focus snapped back to the first row a beat after an arrow key had
  // moved it, which is the fault menu-keys.ts records.
  useLayoutEffect(() => {
    if (open && ref.current) focusFirst(ref.current);
  }, [open]);
  const keys = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      (grid ? walkGrid : walkMenu)(event, onClose);
    },
    [grid, onClose],
  );
  if (!open || !wanted) return null;
  const at = placed ?? { left: wanted.left, top: wanted.top };
  return (
    <div
      ref={ref}
      role={role === "none" ? undefined : role}
      aria-label={label}
      data-testid={testid}
      className={`nx-menu nx-arrive${className ? ` ${className}` : ""}`}
      style={{ left: at.left, top: at.top, width }}
      onKeyDown={keys}
    >
      {children}
    </div>
  );
}

/** One item of a menu.
 *
 *  A row 30 px tall with its label at the left and, when it has one, its
 *  shortcut at the right in the third ink.  The pointer focuses the item
 *  it passes over, which is what lets the arrow keys and the pointer agree
 *  on which item is current.  `danger` sets the label in the error ink,
 *  and a menu puts such an item last, after a divider.  `role` is
 *  `menuitem` unless the menu itself has no role, in which case the item
 *  is a plain button and a spec finds it by its name. */
export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  hint?: ReactNode;
  danger?: boolean;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox" | "none";
  icon?: ReactNode;
};

export function MenuItem({
  hint,
  danger = false,
  role = "menuitem",
  icon,
  className,
  children,
  type = "button",
  onPointerMove,
  ...rest
}: MenuItemProps) {
  return (
    <button
      type={type}
      role={role === "none" ? undefined : role}
      data-danger={danger || undefined}
      className={`nx-menu-item${className ? ` ${className}` : ""}`}
      onPointerMove={(event) => {
        if (event.movementX || event.movementY) event.currentTarget.focus();
        onPointerMove?.(event);
      }}
      {...rest}
    >
      {icon}
      <span className="nx-menu-label">{children}</span>
      {hint !== undefined && hint !== null ? <span className="nx-menu-hint">{hint}</span> : null}
    </button>
  );
}

/** A rule between two groups of a menu. */
export function MenuDivider() {
  return <div role="separator" className="nx-menu-divider" />;
}
