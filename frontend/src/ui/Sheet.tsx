import { forwardRef, useRef, type HTMLAttributes, type ReactNode } from "react";
import { useDismiss } from "../useDismiss";

/** A sheet that covers the app: settings, sharing, access, a chooser.
 *
 *  One shape for every dialog: a scrim over everything, the sheet centred
 *  on it, 12 px round on the float shadow, its focus kept inside and put
 *  back where it came from on close, Escape and a press on the scrim both
 *  closing it.  The dialog's role, its name and its testid sit on the
 *  sheet itself, not on the scrim, which is what every spec that opens one
 *  by name expects.  `labelledBy` names a heading inside the sheet when
 *  one exists; otherwise `label` is the name. */
export type SheetProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  testid?: string;
  width?: number;
  /** Centred, or hung from the top of the window like a palette. */
  align?: "center" | "top";
  /** A sheet that is a field over a list, like the palette: tighter
   *  padding, and the list scrolls inside it. */
  list?: boolean;
  className?: string;
  children: ReactNode;
};

export const Sheet = forwardRef<HTMLDivElement, SheetProps>(function Sheet(
  {
    open,
    onClose,
    label,
    labelledBy,
    testid,
    width = 540,
    align = "center",
    list = false,
    className,
    children,
    ...rest
  },
  outer,
) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  if (!open) return null;
  return (
    <div
      // A track that cannot grow: on an auto track the sheet's own width
      // widened the cell and its max-width of 100% then bound nothing, so
      // a 780 px sheet ran off a 600 px window.
      className={`nx-scrim fixed inset-0 z-50 p-6 ${align === "top" ? "flex items-start justify-center pt-[12vh]" : "grid grid-cols-[minmax(0,1fr)] place-items-center"}`}
      role="presentation"
    >
      <div
        ref={(node) => {
          ref.current = node;
          if (typeof outer === "function") outer(node);
          else if (outer) outer.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        data-testid={testid}
        data-list={list || undefined}
        className={`nx-sheet nx-arrive${className ? ` ${className}` : ""}`}
        style={{ width: "100%", maxWidth: width }}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
});
