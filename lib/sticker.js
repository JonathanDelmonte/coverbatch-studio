import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import opentype from 'opentype.js';

// Geometry of the store's sticker ("selo"), measured on the 1200×1500 reference
// cover. Every number is in sticker units: the pill is 655 × 96.
export const STICKER = Object.freeze({
  width: 655, height: 96, radius: 24,
  // The platform block ends in a slanted edge (≈12°), wider at the top.
  slantTop: 184, slantBottom: 164,
  // The official logotype, centred in the platform block as on the reference.
  markHeight: 31.2, markCenterX: 87.75, markCenterY: 46.8,
  // The phrase is centred on x = 417 like the reference, not on the body zone.
  capHeight: 36.36, capTop: 30, textLeft: 201.7, textRight: 633.7,
});
export const STICKER_ASPECT = STICKER.width / STICKER.height;
export const PLATFORMS = Object.freeze(['PS4', 'PS5']);

// The store's two official stickers: PS4 is a blue block on a white pill; PS5 is
// the inverse, a white block on a black pill (from the client's references).
export const SCHEME_PARTS = Object.freeze(['block', 'mark', 'body', 'text']);
export const SCHEMES = Object.freeze({
  PS4: Object.freeze({ block: '#1D6AB2', mark: '#FFFFFF', body: '#FFFFFF', text: '#000000' }),
  PS5: Object.freeze({ block: '#FFFFFF', mark: '#000000', body: '#000000', text: '#FFFFFF' }),
});

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const fonts = {};
function font(weight) {
  if (!fonts[weight]) {
    const bytes = readFileSync(path.join(assets, 'fonts', weight === 'bold' ? 'OpenSans-Bold.ttf' : 'OpenSans-Regular.ttf'));
    fonts[weight] = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return fonts[weight];
}

// The official PS4/PS5 logotypes (assets/marks) are used exactly as supplied:
// only their colour changes with the platform's scheme.
const marks = {};
function mark(platform) {
  if (!marks[platform]) {
    const svg = readFileSync(path.join(assets, 'marks', `${platform.toLowerCase()}.svg`), 'utf8');
    const viewBox = /viewBox="([^"]+)"/.exec(svg)[1].trim().split(/[\s,]+/).map(Number);
    const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map(m => m[1]);
    if (viewBox.length !== 4 || !paths.length) throw new Error(`Logotipo ${platform} ilegível.`);
    marks[platform] = { viewBox, paths };
  }
  return marks[platform];
}

const n = v => +v.toFixed(2);
const HEX = /^#[0-9a-f]{6}$/i;

// Lays out "REGULAR BOLD" on one line, centred in the body, shrinking the type
// only when a long phrase would otherwise touch the edges.
function labelPaths(regular, bold) {
  const S = STICKER;
  const reg = font('regular'), bld = font('bold');
  const capRatio = reg.tables.os2.sCapHeight / reg.unitsPerEm;
  let size = S.capHeight / capRatio;
  const parts = [];
  if (regular) parts.push({ f: reg, text: regular });
  if (bold) parts.push({ f: bld, text: bold });
  if (!parts.length) return '';
  const measure = sz => {
    let x = 0; const boxes = [];
    parts.forEach((p, i) => {
      const text = i < parts.length - 1 ? p.text + ' ' : p.text;
      const glyphs = p.f.getPath(p.text, 0, 0, sz, { kerning: true }).getBoundingBox();
      boxes.push({ ...p, x, x1: glyphs.x1, x2: glyphs.x2 });
      x += p.f.getAdvanceWidth(text, sz, { kerning: true });
    });
    return { boxes, inkLeft: boxes[0].x + boxes[0].x1, inkRight: boxes.at(-1).x + boxes.at(-1).x2 };
  };
  let m = measure(size);
  const available = S.textRight - S.textLeft;
  if (m.inkRight - m.inkLeft > available) { size *= available / (m.inkRight - m.inkLeft); m = measure(size); }
  const shift = (S.textLeft + S.textRight) / 2 - (m.inkLeft + m.inkRight) / 2;
  const baseline = S.capTop + size * capRatio;
  return m.boxes.map(b => b.f.getPath(b.text, b.x + shift, baseline, size, { kerning: true }).toPathData(2)).join('');
}

const labelCache = new Map();
function cachedLabel(regular, bold) {
  const key = `${regular}\u0000${bold}`;
  if (!labelCache.has(key)) { if (labelCache.size > 64) labelCache.clear(); labelCache.set(key, labelPaths(regular, bold)); }
  return labelCache.get(key);
}

export function normalizeLabelText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24).toLocaleUpperCase('pt-BR');
}

export function schemeFor(platform, colors = {}) {
  const scheme = { ...SCHEMES[platform], ...colors };
  for (const part of SCHEME_PARTS) if (!HEX.test(scheme[part] ?? '')) throw new Error('Cor do selo inválida.');
  return scheme;
}

// Returns the sticker as SVG at an exact pixel size. Text and logotypes are
// outlines, so the result never depends on the fonts installed on the computer.
export function stickerSVG({ platform = 'PS4', regular = 'ENVIO', bold = 'IMEDIATO', colors, width, height } = {}) {
  if (!PLATFORMS.includes(platform)) throw new Error(`Plataforma sem selo: ${platform}`);
  const c = schemeFor(platform, colors);
  const S = STICKER;
  const w = width ?? S.width, h = height ?? Math.round(w / STICKER_ASPECT);
  const { viewBox: [vx, vy, vw, vh], paths } = mark(platform);
  const mh = S.markHeight, mw = (mh * vw) / vh;
  const label = cachedLabel(normalizeLabelText(regular), normalizeLabelText(bold));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${S.width} ${S.height}" preserveAspectRatio="none">`
    + `<defs><clipPath id="pill"><rect width="${S.width}" height="${S.height}" rx="${S.radius}" ry="${S.radius}"/></clipPath></defs>`
    + `<g clip-path="url(#pill)"><rect width="${S.width}" height="${S.height}" fill="${c.body}"/>`
    + `<path d="M0 0H${S.slantTop}L${S.slantBottom} ${S.height}H0Z" fill="${c.block}"/></g>`
    + `<svg x="${n(S.markCenterX - mw / 2)}" y="${n(S.markCenterY - mh / 2)}" width="${n(mw)}" height="${n(mh)}" viewBox="${vx} ${vy} ${vw} ${vh}">`
    + paths.map(d => `<path d="${d}" fill="${c.mark}"/>`).join('') + '</svg>'
    + (label ? `<path d="${label}" fill="${c.text}"/>` : '')
    + '</svg>';
}

export async function renderSticker(options) {
  return sharp(Buffer.from(stickerSVG(options)), { density: 72 }).png().toBuffer();
}
