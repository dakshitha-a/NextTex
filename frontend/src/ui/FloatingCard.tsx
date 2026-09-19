import { forwardRef, type HTMLAttributes } from "react";

/** A card that floats over the editor or a pane: a hover card, the
 *  completion list, the selection bar, a preview.
 *
 *  The same card as a menu, 8 px round on the float shadow with no
 *  border, and one thing more: it takes the shell's palette explicitly.
 *  A card anchored inside the editor is a child of the editor's ground,
 *  which may be a white page under a dark shell, and without this it
 *  would inherit the page's inks and paint pale on pale.  `.nx-theme-dark`
 *  and `.nx-theme-light` are the two palettes contrast.test.ts already
 *  measures, so a card is always drawn in one of them and nothing new has
 *  to be certified.  The theme is read from the root's `data-theme`, which
 *  appearance.ts stamps before the first paint. */
export type FloatingCardProps = HTMLAttributes<HTMLDivElement> & {
  testid?: string;
};

export function shellTheme(): "nx-theme-dark" | "nx-theme-light" {
  return document.documentElement.dataset.theme === "light" ? "nx-theme-light" : "nx-theme-dark";
}

export const FloatingCard = forwardRef<HTMLDivElement, FloatingCardProps>(function FloatingCard(
  { testid, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-testid={testid}
      className={`nx-card nx-arrive ${shellTheme()}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
});
