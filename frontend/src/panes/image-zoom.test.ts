import { describe, expect, it } from "vitest";
import { STEPS, fitScale, nextStep } from "./image-zoom";

describe("fitScale", () => {
  it("shrinks a huge image until both axes are inside the frame", () => {
    // The plot that showed the bug: 7000 by 4200 in a 489 by 916 frame,
    // drawn at 7000 wide.  Width is the tighter axis here.
    const fit = fitScale({ width: 489, height: 916 }, { w: 7000, h: 4200 });
    expect(7000 * fit).toBeLessThanOrEqual(489 - 42 + 1e-9);
    expect(4200 * fit).toBeLessThanOrEqual(916 - 42 + 1e-9);
    expect(7000 * fit).toBeCloseTo(447, 0);
  });

  it("is the height when that is the tighter axis", () => {
    const fit = fitScale({ width: 1000, height: 300 }, { w: 800, h: 800 });
    expect(800 * fit).toBeCloseTo(258, 5);
  });

  it("never enlarges a small figure", () => {
    expect(fitScale({ width: 1000, height: 1000 }, { w: 300, h: 200 })).toBe(1);
  });

  it("survives a frame that has not been laid out", () => {
    expect(fitScale({ width: 0, height: 0 }, { w: 300, h: 200 })).toBeGreaterThan(0);
  });
});

describe("nextStep", () => {
  it("steps from a fit between rungs to the next rung, not the nearest", () => {
    // 0.064 is the fit for the plot above: the rung nearest it is 0.25,
    // and so is the next one up.  A fit of 0.9 is nearest 1, and `+` must
    // give 1 rather than 1.5.
    expect(nextStep(0.064, 1)).toBe(0.25);
    expect(nextStep(0.9, 1)).toBe(1);
    expect(nextStep(1.1, -1)).toBe(1);
  });

  it("walks the ladder rung by rung from a rung", () => {
    for (let i = 0; i < STEPS.length - 1; i += 1) {
      expect(nextStep(STEPS[i], 1)).toBe(STEPS[i + 1]);
      expect(nextStep(STEPS[i + 1], -1)).toBe(STEPS[i]);
    }
  });

  it("stays put at either end", () => {
    expect(nextStep(3, 1)).toBe(3);
    expect(nextStep(0.25, -1)).toBe(0.25);
    // Below the lowest rung, zooming out has nowhere to go and says so by
    // answering with what it was given.
    expect(nextStep(0.064, -1)).toBe(0.064);
  });
});
