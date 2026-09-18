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
