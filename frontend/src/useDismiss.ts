import { useEffect, type RefObject } from "react";

/** Close when the user looks away.
 *
 *  A menu that stays open until you click the same three dots again is a
 *  menu that follows you around the app. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const element = ref.current;
      if (element && !element.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // Capture, so a click that opens something else still closes this
    // first, and pointerdown rather than click so it feels immediate.
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", escape);
    };
  }, [ref, open, close]);
}
