import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { panesMoving, useFold, whenPanesRest } from "./motion";
import { mount } from "./ui/mount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Pane({ open }: { open: boolean }) {
  return <span data-phase={useFold(open)} />;
}

function Two({ a, b }: { a: boolean; b: boolean }) {
  return (
    <>
      <Pane open={a} />
      <Pane open={b} />
    </>
  );
}

let mounted: { unmount: () => void } | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const phases = (root: HTMLElement) => Array.from(root.querySelectorAll("span")).map((s) => s.dataset.phase);

/** The preview waits for this before it draws its pages for a new width,
 *  so it has to mean the frame the last pane stops in: not before, which
 *  draws inside the slide, and not on a timer after, which leaves the page
 *  soft for a third of a second. */
describe("panes at rest", () => {
  test("work waiting for rest runs when the fold reaches closed, and not before", () => {
    const m = (mounted = mount(<Pane open />));
    const done = vi.fn();
    expect(panesMoving()).toBe(false);
    m.rerender(<Pane open={false} />);
    expect(panesMoving()).toBe(true);
    whenPanesRest(done);
    act(() => void vi.advanceTimersByTime(100));
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(phases(m.container)).toEqual(["closed"]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(panesMoving()).toBe(false);
  });

  test("two panes folding together are at rest only when both are", () => {
    const m = (mounted = mount(<Two a b={false} />));
    act(() => void vi.advanceTimersByTime(500));
    const done = vi.fn();
    // One opens over 180 ms while the other closes over 140 ms.
    m.rerender(<Two a={false} b />);
    whenPanesRest(done);
    act(() => void vi.advanceTimersByTime(170));
    expect(phases(m.container)[0]).toBe("closed");
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(phases(m.container)).toEqual(["closed", "open"]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("at rest it runs at once, and a cancelled wait never runs", () => {
    mounted = mount(<Pane open />);
    const now = vi.fn();
    whenPanesRest(now);
    expect(now).toHaveBeenCalledTimes(1);
    const m = mounted as ReturnType<typeof mount>;
    m.rerender(<Pane open={false} />);
    const never = vi.fn();
    whenPanesRest(never)();
    act(() => void vi.advanceTimersByTime(500));
    expect(never).not.toHaveBeenCalled();
  });

  test("a pane taken away mid-move does not leave the others waiting", () => {
    const m = (mounted = mount(<Pane open />));
    m.rerender(<Pane open={false} />);
    expect(panesMoving()).toBe(true);
    m.unmount();
    mounted = null;
    expect(panesMoving()).toBe(false);
  });
});
