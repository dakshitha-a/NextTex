/** Compress the built assets once, here, instead of on every request.
 *
 *  Compression is not free: gzipping this bundle costs about 38 ms of CPU,
 *  and on a fast link that is more than it saves.  Measured over loopback,
 *  compressing on the fly took the bundle from 1.9 ms to 40 ms -- twenty
 *  times slower for somebody running NextTex on the machine they are
 *  sitting at.  Doing it at build time removes the choice: the bytes are
 *  already small, and serving them costs a file read.
 *
 *  Brotli rather than zstd.  It is smaller here (202 kB against 210), and
 *  every browser has understood it for years while zstd is still missing
 *  from Safari.  gzip is written too, for anything that asks for neither.
 *
 *  Node's zlib has all of this built in, so nothing is added to anyone's
 *  install for it.
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { brotliCompress, gzip, constants } from "node:zlib";
import { promisify } from "node:util";

const br = promisify(brotliCompress);
const gz = promisify(gzip);

const DIR = "dist/assets";
// Text compresses; a PNG or a woff2 is already compressed and would only
// grow.  Fonts are left alone for the same reason.  WebAssembly and the
// `.mjs` pdf.js worker compress well and were missing: the grammar
// checker's 16 MB module went out whole, and brotli takes it to 7.4 MB;
// the worker goes from 1.27 MB to 0.31 MB.
const WORTH_IT = new Set([".js", ".mjs", ".css", ".svg", ".json", ".map", ".wasm"]);
// Quality 11 is the smallest brotli and the slowest: on the 16 MB module it
// took 39 s for 4 % less than quality 9 managed in 2.4 s.  Past this size
// the build takes the faster setting, and writes no gzip copy: browsers
// offer brotli wherever the link is TLS, which is every address NextTex
// serves to another machine, and loopback is fast enough to send the file
// whole.  A gzip copy of the module would add 8 MB to every published
// interface for nobody.
const LARGE = 4 * 1024 * 1024;
// Below this the saving is smaller than the headers describing it.
const FLOOR = 1024;

const files = await readdir(DIR);
let before = 0;
let after = 0;
let count = 0;

for (const name of files) {
  if (!WORTH_IT.has(extname(name))) continue;
  const path = join(DIR, name);
  const info = await stat(path);
  if (info.size < FLOOR) continue;
  const raw = await readFile(path);
  const large = info.size > LARGE;
  const [brotli, gzipped] = await Promise.all([
    br(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: large ? 9 : 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    large ? null : gz(raw, { level: 9 }),
  ]);
  await writeFile(`${path}.br`, brotli);
  if (gzipped) await writeFile(`${path}.gz`, gzipped);
  before += raw.length;
  after += brotli.length;
  count += 1;
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
console.log(
  `precompressed ${count} files: ${kb(before)} kB -> ${kb(after)} kB brotli` +
    ` (${(before / after).toFixed(2)}x)`,
);
