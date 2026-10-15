import sharp from 'sharp';
import { renderSticker } from './sticker.js';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TOKEN = /(^|[^a-z0-9])(?:ps|playstation)[\s._-]*([45])(?![0-9])/g;

// Platforms named in one path segment: "fc-27-ps4.jpg", "PS5/", "PlayStation 4", "ps4+ps5".
export function platformsIn(text) {
  const found = new Set();
  for (const m of fold(text).matchAll(TOKEN)) found.add(`PS${m[2]}`);
  return ['PS4', 'PS5'].filter(p => found.has(p));
}

// The file name wins over its folders (closest folder first), which win over the
// name of the batch itself (e.g. "capas-ps5.zip").
export function platformHint(sourcePath, batchName = '') {
  const parts = String(sourcePath).split('/').filter(Boolean);
  const file = parts.pop() ?? '';
  const fromFile = platformsIn(file.replace(/\.[^.]+$/, ''));
  if (fromFile.length) return { platforms: fromFile, from: 'nome' };
  for (const folder of parts.reverse()) {
    const fromFolder = platformsIn(folder);
    if (fromFolder.length) return { platforms: fromFolder, from: 'pasta' };
  }
  const fromBatch = platformsIn(batchName.replace(/\.zip$/i, ''));
  if (fromBatch.length) return { platforms: fromBatch, from: 'lote' };
  return { platforms: [], from: null };
}

// "EA SPORTS FC 27 (PS4).png" -> "ea-sports-fc-27"
export function baseSlug(sourcePath) {
  const file = String(sourcePath).split('/').pop().replace(/\.[^.]+$/, '');
  let s = fold(file).replace(TOKEN, '$1').replace(/[()[\]{}]/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  if (!s) s = 'capa';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(s)) s = `_${s}`;
  return s;
}

// --- Already-stamped detection --------------------------------------------
// A cover that went through the tool (or through the old Canva routine) already
// carries the sticker. Normalised cross-correlation against our own sticker,
// rendered at a few sizes around the expected one, finds it even when the old
// placement differs a little.
const PROBE_HEIGHT = 14;
const SCALES = [0.8, 0.9, 1, 1.12, 1.25];
const templates = new Map();

async function template(height, platform) {
  const key = `${platform}:${height}`;
  if (!templates.has(key)) {
    const width = Math.round(height * 655 / 96);
    const png = await renderSticker({ platform, width, height });
    const { data } = await sharp(png).flatten({ background: '#808080' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const t = Float32Array.from(data);
    let mean = 0; for (const v of t) mean += v; mean /= t.length;
    let norm = 0; for (let i = 0; i < t.length; i++) { t[i] -= mean; norm += t[i] * t[i]; }
    templates.set(key, { width, height, data: t, norm: Math.sqrt(norm) });
  }
  return templates.get(key);
}

function ncc(roi, rw, t, x, y) {
  const n = t.width * t.height;
  let sum = 0, sum2 = 0, cross = 0;
  for (let ty = 0, k = 0; ty < t.height; ty++) {
    let o = (y + ty) * rw + x;
    for (let tx = 0; tx < t.width; tx++, k++, o++) { const v = roi[o]; sum += v; sum2 += v * v; cross += v * t.data[k]; }
  }
  const variance = sum2 - (sum * sum) / n;
  return variance > 1 ? cross / (Math.sqrt(variance) * t.norm) : -1;
}

// Coarse pass on a 2 px grid, then a 1 px refinement around the best hit.
function bestMatch(roi, rw, rh, t) {
  let best = { score: -1, x: 0, y: 0 };
  for (let y = 0; y + t.height <= rh; y += 2) for (let x = 0; x + t.width <= rw; x += 2) {
    const score = ncc(roi, rw, t, x, y); if (score > best.score) best = { score, x, y };
  }
  const { x: cx, y: cy } = best;
  for (let y = Math.max(0, cy - 1); y <= Math.min(rh - t.height, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(rw - t.width, cx + 1); x++) {
    const score = ncc(roi, rw, t, x, y); if (score > best.score) best = { score, x, y };
  }
  return best;
}

// `image` is a sharp input (path, buffer or { data, info } raw pixels) already
// oriented; `expected` is where the layout would put the sticker.
export async function findExistingSticker(image, expected, { threshold = 0.72 } = {}) {
  const open = () => image?.info ? sharp(image.data, { raw: image.info }) : sharp(image);
  const { width: W, height: H } = image?.info ?? await open().metadata();
  const f = Math.min(1, PROBE_HEIGHT / expected.height);
  const top = Math.max(0, Math.floor(expected.top - 1.2 * expected.height));
  const right = Math.min(W, Math.ceil(expected.left + expected.width * 1.3 + expected.height));
  if (right < 8 || H - top < 8) return { found: false, score: 0 };
  const rw = Math.max(1, Math.round(right * f)), rh = Math.max(1, Math.round((H - top) * f));
  const { data } = await open().extract({ left: 0, top, width: right, height: H - top })
    .resize(rw, rh, { fit: 'fill' }).flatten({ background: '#808080' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const roi = Float32Array.from(data);
  // PS4 (blue on white) and PS5 (white on black) are near-inverses in grey, so
  // each platform's sticker is searched for with its own template.
  let best = { score: 0 };
  for (const platform of ['PS4', 'PS5']) for (const s of SCALES) {
    const t = await template(Math.max(6, Math.round(expected.height * f * s)), platform);
    if (t.width > rw || t.height > rh) continue;
    const m = bestMatch(roi, rw, rh, t);
    if (m.score > best.score) best = m;
  }
  return { found: best.score >= threshold, score: Math.round(Math.max(0, best.score) * 1000) / 1000 };
}
