import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

/** Mount a tree into jsdom for a test, and take it down again.
 *
 *  The kit's tests are the first in this repository to render React:
 *  everything before them tested pure functions.  This is the whole of the
 *  harness, so that a test reads as the DOM it asserts on and nothing
 *  else.  `act` is React's own, so effects have run when `mount` returns. */
export function mount(node: ReactNode): { container: HTMLElement; unmount: () => void; rerender: (next: ReactNode) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
