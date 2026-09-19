import { useRef, type ReactNode } from "react";
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
export type SheetProps = {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  testid?: string;
  width?: number;
  className?: string;
  children: ReactNode;
};

export function Sheet({
  open,
  onClose,
  label,
  labelledBy,
  testid,
  width = 540,
  className,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  if (!open) return null;
  return (
    <div className="nx-scrim fixed inset-0 z-50 grid place-items-center p-6" role="presentation">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        data-testid={testid}
        className={`nx-sheet nx-arrive${className ? ` ${className}` : ""}`}
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}
