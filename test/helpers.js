import path from 'node:path';
import zlib from 'node:zlib';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { after } from 'node:test';
import sharp from 'sharp';

// Synthetic, clearly-marked TESTE material only: no store covers or brands.
// Each test file's folders go when that file finishes (KEEP_TEST_DIRS=1 keeps them).
const created = [];
after(async () => {
  if (process.env.KEEP_TEST_DIRS === '1') return;
  await Promise.all(created.map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})));
});
export async function tempDir(prefix) {
  await mkdir(path.resolve('work', 'testes'), { recursive: true });
  const dir = await mkdtemp(path.resolve('work', 'testes', `${prefix}-`));
  created.push(dir);
  return dir;
}

export function cover(width, height, color = '#2d4f7c', format = 'jpeg') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><circle cx="${width * 0.6}" cy="${height * 0.4}" r="${Math.min(width, height) * 0.25}" fill="#e8b04a" fill-opacity=".6"/></svg>`;
  const img = sharp(Buffer.from(svg));
  return format === 'png' ? img.png().toBuffer() : format === 'webp' ? img.webp().toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

// Left half red, right half blue: shows which part of the art a framing keeps.
export function halves(width, height) {
  const half = Math.round(width / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${half}" height="${height}" fill="#d02020"/><rect x="${half}" width="${width - half}" height="${height}" fill="#2040d0"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// A PNG whose header announces width × height and holds no pixels: enough for
// checks that read only the header, without allocating a huge image. (Own CRC:
// zlib.crc32 only arrived in Node 22.2, and the project supports any Node 22.)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function pngHeader(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(0))), chunk('IEND', Buffer.alloc(0))]);
}

// A white "TESTE" mark on transparency, 300 × 100, with padding around it.
export function testLogo() {
  return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect x="40" y="25" width="220" height="50" rx="10" fill="#fff"/></svg>')).png().toBuffer();
}

export async function waitFor(check, { timeout = 30_000, interval = 25 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('Tempo esgotado esperando a condição do teste.');
    await new Promise(r => setTimeout(r, interval));
  }
}

export async function pixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}
