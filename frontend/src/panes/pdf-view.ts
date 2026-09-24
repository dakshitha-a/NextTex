// How a page is shown, apart from its size: turned a quarter at a time,
// and in the dark. Pure, so the arithmetic is tested without a browser.

/** A turn added to the page, clockwise, on top of any the PDF carries. */
export type Rotation = 0 | 90 | 180 | 270;

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

/** A point SyncTeX gives, in points from the top-left of the page as
 *  TeX set it, where it lands on the page as turned: also points from the
 *  top-left, of the turned page. `width` and `height` are the page's own,
 *  unturned. */
export function toTurned(
  rotation: Rotation, width: number, height: number, x: number, y: number,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: height - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: width - x };
    default:
      return { x, y };
  }
}

/** The way back: a point on the turned page, as TeX's coordinates. */
export function fromTurned(
  rotation: Rotation, width: number, height: number, u: number, v: number,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: v, y: height - u };
    case 180:
      return { x: width - u, y: height - v };
    case 270:
      return { x: width - v, y: u };
    default:
      return { x: u, y: v };
  }
}

/** A SyncTeX box, whose `y` is its baseline and which reaches `height`
 *  above it, as a rectangle on the turned page. */
export function boxOnTurned(
  rotation: Rotation,
  width: number,
  height: number,
  box: { x: number; y: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const corners = [
    toTurned(rotation, width, height, box.x, box.y - box.height),
    toTurned(rotation, width, height, box.x + box.width, box.y),
  ];
  const left = Math.min(corners[0].x, corners[1].x);
  const top = Math.min(corners[0].y, corners[1].y);
  return {
    left,
    top,
    width: Math.abs(corners[0].x - corners[1].x),
    height: Math.abs(corners[0].y - corners[1].y),
  };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` then `b`, the way a canvas composes `transform` calls: points are
 *  mapped by `b` first and then by `a`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A rectangle, in PDF user space, as its corners' bounding box. */
export type Box = [number, number, number, number];

function bounds(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const points = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The operators this walk reads, by pdf.js's own numbering, passed in so
 *  a test needs no pdf.js. */
export type Ops = {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageXObjectRepeat: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginGroup: number;
  endGroup: number;
};

/** Where the figures are on a page: every raster image, and every form
 *  XObject, which is what an `\includegraphics` of a PDF or an EPS
 *  becomes, as rectangles in the page's user space.
 *
 *  The transform is tracked through save, restore and every `transform`,
 *  as the canvas does. An image fills the unit square of its transform. A
 *  form carries its box, and its matrix, on `paintFormXObjectBegin`; when
 *  the form is a transparency group pdf.js passes that nothing and hands
 *  the box and matrix to `beginGroup` instead, so both are read. A TikZ
 *  drawing set inline is paths, not a form, and is not a figure here: it
 *  darkens with the text, which is what a diagram drawn in the text's own
 *  ink should do. */
export function figureBoxes(fnArray: number[], argsArray: unknown[][], ops: Ops): Box[] {
  const found: Box[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = (argsArray[i] ?? []) as any[];
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.transform) ctm = multiply(ctm, args.slice(0, 6) as Matrix);
    else if (
      fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageXObjectRepeat
    ) {
      found.push(bounds(ctm, 0, 0, 1, 1));
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const [matrix, bbox] = args;
      if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(ctm, matrix as Matrix);
      if (Array.isArray(bbox) && bbox.length === 4) {
        found.push(bounds(ctm, bbox[0], bbox[1], bbox[2], bbox[3]));
      }
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.beginGroup) {
      stack.push(ctm);
      const group = args[0] ?? {};
      if (Array.isArray(group.matrix) && group.matrix.length === 6) {
        ctm = multiply(ctm, group.matrix as Matrix);
      }
      if (Array.isArray(group.bbox) && group.bbox.length === 4) {
        found.push(bounds(ctm, group.bbox[0], group.bbox[1], group.bbox[2], group.bbox[3]));
      }
    } else if (fn === ops.endGroup) {
      ctm = stack.pop() ?? IDENTITY;
    }
  }
  return found;
}

/** A box in user space, on a canvas drawn with `transform` (a pdf.js
 *  viewport's), as whole device pixels, clipped to the canvas. A box that
 *  covers nearly the whole page is dropped: that is a background or a
 *  page-sized group, and keeping it would leave the whole page light. */
export function onCanvas(
  transform: number[], box: Box, canvasWidth: number, canvasHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  const [x0, y0, x1, y1] = bounds(transform as Matrix, box[0], box[1], box[2], box[3]);
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(canvasWidth, Math.ceil(x1));
  const bottom = Math.min(canvasHeight, Math.ceil(y1));
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;
  if (width * height > 0.85 * canvasWidth * canvasHeight) return null;
  return { x: left, y: top, width, height };
}

/** The dark page's colour mapping, per channel, as an SVG
 *  `feComponentTransfer` takes it: a line through white to the theme's
 *  surface and black to its ink, so the paper is the surface and the text
 *  the body ink, never pure black and white. The filter turns the hue
 *  half way round before this, so a blue link stays blue. Colours are
 *  0 to 255 per channel. */
export function darkTransfer(
  surface: [number, number, number], ink: [number, number, number],
): { slope: number; intercept: number }[] {
  return [0, 1, 2].map((channel) => {
    const paper = surface[channel] / 255;
    const text = ink[channel] / 255;
    return { slope: +(paper - text).toFixed(4), intercept: +text.toFixed(4) };
  });
}

/** "rgb(20, 24, 23)", "#141817" or "#fff" as three channels; null for
 *  anything else. */
export function parseColour(value: string): [number, number, number] | null {
  const text = value.trim();
  const rgb = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (!hex) return null;
  const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
}
