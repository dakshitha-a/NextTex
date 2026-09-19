import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/** The one button.
 *
 *  Four tones and three sizes, and nothing else a pane may choose: every
 *  button in the interface used to be hand-rolled at its call site, with
 *  five different literal heights and two radii, and this is what replaced
 *  them.  `quiet` is a text control in the second ink; `ghost` is the same
 *  with a hairline, for an action that stands alone; `pen` is filled with
 *  the agent's colour and is the one button on a surface that sends or
 *  creates; `danger` is a ghost in the error ink for an action that
 *  destroys something.  A danger button does not take the hover colour that
 *  means "safe and interactive", which is the rule the old `.quiet` class
 *  kept and this one keeps.
 *
 *  Sizes: `sm` is the control height (28), `md` the row height (32) for a
 *  button that sits beside a field or closes a sheet, and `inline` (24)
 *  for an action inside a strip or a banner that must not push the strip
 *  taller.  Every attribute a spec selects by, `data-testid`, `aria-*`,
 *  `title`, `disabled`, goes straight through to the element. */
export type ButtonVariant = "quiet" | "ghost" | "pen" | "danger";
export type ButtonSize = "sm" | "md" | "inline";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon drawn before the label, from `ui/icons.tsx`. */
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "quiet", size = "sm", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      className={`nx-button${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

/** A button that is only an icon.
 *
 *  It always has a name, because an icon alone tells a screen reader
 *  nothing and tells a pointer nothing until it hovers: `label` becomes
 *  both `aria-label` and `title`.  `on` draws the wash that marks the
 *  active one of a set, the activity bar's chosen drawer or a toggled
 *  search field.  The touch extension `.nx-tap` is kept so a finger's
 *  target stays 44 px however small the glyph is. */
export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  on?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, on = false, size = "sm", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-on={on || undefined}
      data-size={size}
      className={`nx-icon-button nx-tap${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
});
