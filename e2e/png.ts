import { deflateSync } from "node:zlib";

/** A real PNG of any size, made here rather than checked in.
 *
 *  The image viewer's bugs are about size: a plot exported at 300 dpi is
 *  thousands of pixels on a side, and a one-pixel PNG cannot show whether
 *  such a thing fits.  A file that large does not belong in the
 *  repository, and one this function makes is a few kilobytes on disk
 *  however big it claims to be, because it is one grey with a frame of
 *  black, which deflates to almost nothing.
 *
 *  Greyscale, eight bits, no interlace: the simplest PNG there is, and
 *  every browser draws it. */
export function png(width: number, height: number): Buffer {
  const rows = Buffer.alloc((width + 1) * height, 0xe0);
  for (let y = 0; y < height; y += 1) {
    const at = y * (width + 1);
    rows[at] = 0;   // filter: none
    // A dark border, so what is drawn has edges to measure against.
    if (y < 8 || y >= height - 8) rows.fill(0x20, at + 1, at + 1 + width);
    else {
      rows.fill(0x20, at + 1, at + 9);
      rows.fill(0x20, at + 1 + width - 8, at + 1 + width);
    }
  }
  return encode(width, height, rows);
}

/** A plot, for a picture that has to look like a writer's figure rather
 *  than a grey block: a decaying signal, the points it was fitted to, and
 *  two axes, all in grey on white.  Deterministic, so the README's
 *  screenshots come out the same on every run. */
export function plot(width: number, height: number): Buffer {
  const rows = Buffer.alloc((width + 1) * height, 0xff);
  const at = (x: number, y: number) => y * (width + 1) + 1 + x;
  const dot = (x: number, y: number, r: number, shade: number) => {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px >= 0 && px < width && py >= 0 && py < height && dx * dx + dy * dy <= r * r) rows[at(px, py)] = shade;
      }
    }
  };
  for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0;
  const left = Math.round(width * 0.12);
  const right = Math.round(width * 0.95);
  const top = Math.round(height * 0.08);
  const bottom = Math.round(height * 0.86);
  const stroke = Math.max(2, Math.round(height / 300));
  // The axes, with ticks.
  for (let x = left; x <= right; x += 1) for (let t = 0; t < stroke; t += 1) rows[at(x, bottom + t)] = 0x20;
  for (let y = top; y <= bottom; y += 1) for (let t = 0; t < stroke; t += 1) rows[at(left + t, y)] = 0x20;
  for (let i = 0; i <= 5; i += 1) {
    const x = Math.round(left + (i / 5) * (right - left));
    for (let y = bottom; y < bottom + stroke * 4; y += 1) for (let t = 0; t < stroke; t += 1) rows[at(x + t, y)] = 0x20;
  }
  for (let i = 0; i <= 3; i += 1) {
    const y = Math.round(bottom - (i / 3) * (bottom - top));
    for (let x = left - stroke * 4; x < left; x += 1) for (let t = 0; t < stroke; t += 1) rows[at(x, y + t)] = 0x20;
  }
  // The curve, 2.6 exp(-0.6 t) over five units, and twenty points about it.
  const curve = (t: number) => bottom - ((2.6 * Math.exp(-0.6 * t)) / 3) * (bottom - top);
  for (let x = left; x <= right; x += 1) {
    const t = ((x - left) / (right - left)) * 5;
    dot(x, curve(t), stroke, 0x30);
  }
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  for (let i = 0; i < 20; i += 1) {
    const t = 0.15 + (i / 19) * 4.7;
    const x = left + (t / 5) * (right - left);
    const y = curve(t) + noise() * (bottom - top) * 0.06;
    dot(x, y, stroke * 2.2, 0x70);
  }
  return encode(width, height, rows);
}

function encode(width: number, height: number, rows: Buffer): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;    // bit depth
  header[9] = 0;    // greyscale
  header[10] = 0;   // compression
  header[11] = 0;   // filter
  header[12] = 0;   // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table: Uint32Array | null = null;

function crc32(data: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
