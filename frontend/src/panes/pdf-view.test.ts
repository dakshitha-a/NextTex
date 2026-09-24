import { describe, expect, test } from "vitest";
import {
  boxOnTurned, darkTransfer, figureBoxes, fromTurned, nextRotation, onCanvas, parseColour,
  toTurned, type Ops, type Rotation,
} from "./pdf-view";

const W = 612;
const H = 792;

describe("a page turned a quarter at a time", () => {
  test("goes round and comes back", () => {
    expect([0, 90, 180, 270].map((r) => nextRotation(r as Rotation))).toEqual([90, 180, 270, 0]);
  });

  test("puts the top-left corner where a clockwise turn puts it", () => {
    expect(toTurned(0, W, H, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(toTurned(90, W, H, 0, 0)).toEqual({ x: H, y: 0 });
    expect(toTurned(180, W, H, 0, 0)).toEqual({ x: W, y: H });
    expect(toTurned(270, W, H, 0, 0)).toEqual({ x: 0, y: W });
  });

  test("the way back undoes the way there, for every turn", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const on = toTurned(rotation, W, H, 100, 250);
      expect(fromTurned(rotation, W, H, on.x, on.y)).toEqual({ x: 100, y: 250 });
    }
  });

  test("a SyncTeX box keeps its size, turned", () => {
    const box = { x: 72, y: 100, width: 200, height: 12 };
    expect(boxOnTurned(0, W, H, box)).toEqual({ left: 72, top: 88, width: 200, height: 12 });
    const quarter = boxOnTurned(90, W, H, box);
    expect([quarter.width, quarter.height]).toEqual([12, 200]);
    expect(quarter.left).toBe(H - 100);
    expect(quarter.top).toBe(72);
  });
});

const OPS: Ops = {
  save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5,
  paintImageXObjectRepeat: 6, paintFormXObjectBegin: 7, paintFormXObjectEnd: 8,
  beginGroup: 9, endGroup: 10,
};

describe("where the figures are", () => {
  test("an image fills the unit square of its transform", () => {
    const boxes = figureBoxes(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [[], [200, 0, 0, 100, 72, 500], ["img"], []],
      OPS,
    );
    expect(boxes).toEqual([[72, 500, 272, 600]]);
  });

  test("a PDF figure is its form's box under its matrix", () => {
    const boxes = figureBoxes(
      [OPS.transform, OPS.paintFormXObjectBegin, OPS.paintFormXObjectEnd, OPS.paintImageXObject],
      [[1, 0, 0, 1, 100, 100], [[2, 0, 0, 2, 0, 0], [0, 0, 50, 25]], [], ["img"]],
      OPS,
    );
    // The form's matrix is undone at its end: the image after it is back
    // under the page's own transform.
    expect(boxes).toEqual([[100, 100, 200, 150], [100, 100, 101, 101]]);
  });

  test("a form that is a group is read off the group", () => {
    const boxes = figureBoxes(
      [OPS.paintFormXObjectBegin, OPS.beginGroup, OPS.endGroup, OPS.paintFormXObjectEnd],
      [[null, null], [{ bbox: [0, 0, 10, 20], matrix: [1, 0, 0, 1, 5, 5] }], [], []],
      OPS,
    );
    expect(boxes).toEqual([[5, 5, 15, 25]]);
  });

  test("a restore with nothing saved does not throw", () => {
    expect(figureBoxes([OPS.restore, OPS.paintImageXObject], [[], []], OPS)).toEqual([[0, 0, 1, 1]]);
  });
});

describe("a figure on the canvas", () => {
  // A viewport's transform at scale 1 flips y about the page's height.
  const flip = [1, 0, 0, -1, 0, 792];

  test("is whole pixels, the right way up", () => {
    expect(onCanvas(flip, [72, 500, 272, 600], 612, 792)).toEqual({ x: 72, y: 192, width: 200, height: 100 });
  });

  test("a sliver, or a box the size of the page, is not a figure", () => {
    expect(onCanvas(flip, [0, 0, 1, 1], 612, 792)).toBeNull();
    expect(onCanvas(flip, [0, 0, 612, 792], 612, 792)).toBeNull();
  });
});

describe("the dark page's colours", () => {
  test("paper becomes the surface and black the ink", () => {
    const surface: [number, number, number] = [35, 40, 37];
    const ink: [number, number, number] = [227, 232, 226];
    const lines = darkTransfer(surface, ink);
    for (let channel = 0; channel < 3; channel += 1) {
      const { slope, intercept } = lines[channel];
      expect(Math.round((slope * 1 + intercept) * 255)).toBe(surface[channel]);
      expect(Math.round(intercept * 255)).toBe(ink[channel]);
    }
  });

  test("reads the token spellings", () => {
    expect(parseColour("#232825")).toEqual([35, 40, 37]);
    expect(parseColour(" #fff ")).toEqual([255, 255, 255]);
    expect(parseColour("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColour("oklch(0.5 0.1 120)")).toBeNull();
  });
});
