import sharp from 'sharp';
import { layoutFor, REFERENCE } from './layout.js';
import { stickerSVG, STICKER, STICKER_ASPECT } from './sticker.js';

export const MAX_OUTPUT_PIXELS = 16_000_000;
export const MAX_INPUT_PIXELS = 60_000_000;
const INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'];

// Decode, orient and size the cover once. The raw pixels are reused for every
// platform of the same cover and for the already-stamped check.
export async function prepareBase(input, { size = 'original' } = {}) {
  const open = () => sharp(input, { failOn: 'truncated', limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true, animated: false });
  let meta;
  try { meta = await open().metadata(); }
  catch { throw new Error('Arquivo de imagem ilegível ou corrompido.'); }
  if (!INPUT_FORMATS.includes(meta.format)) throw new Error('Formato não suportado. Use JPEG, PNG, WebP ou AVIF.');
  const source = { width: meta.autoOrient?.width ?? meta.width, height: meta.autoOrient?.height ?? meta.height, format: meta.format };
  const notes = [];
  let pipeline = open().toColourspace('srgb');
  let width = source.width, height = source.height;
  if (size === 'store') {
    width = REFERENCE.width; height = REFERENCE.height;
    const scale = Math.max(width / source.width, height / source.height);
    if (Math.abs(source.width / source.height - width / height) > 0.02) notes.push({ code: 'cropped', text: 'Recortada para 1200 × 1500.' });
    if (scale > 1.05) notes.push({ code: 'upscaled', text: `Ampliada de ${source.width} × ${source.height}.` });
    pipeline = pipeline.resize(width, height, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' });
  } else if (width * height > MAX_OUTPUT_PIXELS) {
    const k = Math.sqrt(MAX_OUTPUT_PIXELS / (width * height));
    width = Math.floor(width * k); height = Math.floor(height * k);
    notes.push({ code: 'downscaled', text: `Reduzida de ${source.width} × ${source.height} para ${width} × ${height}.` });
    pipeline = pipeline.resize(width, height, { fit: 'fill', kernel: 'lanczos3' });
  }
  let decoded;
  try { decoded = await pipeline.raw().toBuffer({ resolveWithObject: true }); }
  catch { throw new Error('A imagem está incompleta ou corrompida.'); }
  const { data, info } = decoded;
  if (Math.min(info.width, info.height) < 500) notes.push({ code: 'low-res', text: `Resolução baixa (${info.width} × ${info.height}).` });
  return { data, info: { width: info.width, height: info.height, channels: info.channels }, source, notes };
}

export function geometryFor(base, kit, assets, platform) {
  const image = kit.sticker.mode === 'image' ? assets.images[platform] : null;
  return layoutFor(base.info.width, base.info.height, kit.layout, {
    stickerAspect: image ? image.aspect : STICKER_ASPECT,
    logoAspect: assets.logo ? assets.logo.aspect : 0,
  });
}

async function stickerLayer(kit, assets, platform, labelKey, box) {
  const image = kit.sticker.mode === 'image' ? assets.images[platform] : null;
  if (!image) {
    const label = kit.sticker.labels[labelKey] ?? kit.sticker.labels.immediate;
    const svg = stickerSVG({ platform, regular: label.regular, bold: label.bold, colors: kit.sticker.colors[platform], width: box.width, height: box.height });
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  let layer = sharp(image.bytes).resize(box.width, box.height, { fit: 'fill', kernel: 'lanczos3' });
  if (image.opaque) {
    // A rectangular crop gets the pill's rounded corners, like the built-in sticker.
    const r = (STICKER.radius / STICKER.height) * box.height;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="${box.width}" height="${box.height}" rx="${r}" ry="${r}"/></svg>`);
    layer = sharp(await layer.ensureAlpha().png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  return layer.png().toBuffer();
}

const withOpacity = async (png, width, height, alpha) => sharp(png).composite([{ input: { create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } }, blend: 'dest-in' }]).png().toBuffer();

async function logoLayers(base, assets, box) {
  const logo = await sharp(assets.logo.bytes).resize(box.width, box.height, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  const layers = [];
  // A white logo vanishes on light art: under a light area it gets a soft shadow,
  // stronger the lighter the cover is there. Dark covers stay exactly as designed.
  const strength = Math.min(1, Math.max(0, (luminanceUnder(base, box) - 150) / 80)) * 0.55;
  if (assets.logo.shadow && strength > 0.02) {
    const { width: W, height: H } = base.info;
    const pad = Math.max(1, Math.min(Math.round(box.height * 0.22), box.left, box.top, W - box.left - box.width, H - box.top - box.height));
    const shadow = await sharp(logo).negate({ alpha: false })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .blur(Math.max(0.3, pad / 3)).png().toBuffer();
    layers.push({ input: await withOpacity(shadow, box.width + 2 * pad, box.height + 2 * pad, strength), left: box.left - pad, top: box.top - pad });
  }
  layers.push({ input: assets.logo.opacity < 1 ? await withOpacity(logo, box.width, box.height, assets.logo.opacity) : logo, left: box.left, top: box.top });
  return layers;
}

// Mean luminance (0–255) of the cover under a box, sampled on a sparse grid.
function luminanceUnder(base, box) {
  const { data, info } = base, C = info.channels;
  const step = Math.max(1, Math.floor(Math.min(box.width, box.height) / 24));
  let sum = 0, count = 0;
  for (let y = box.top; y < box.top + box.height; y += step) for (let x = box.left; x < box.left + box.width; x += step) {
    const o = (y * info.width + x) * C;
    sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]; count++;
  }
  return count ? sum / count : 0;
}

// The one compositor: previews, thumbnails and files all come from here.
export async function composeOutput(base, { kit, assets, platform, label = 'immediate' }) {
  const geometry = geometryFor(base, kit, assets, platform);
  const layers = [{ input: await stickerLayer(kit, assets, platform, label, geometry.sticker), left: geometry.sticker.left, top: geometry.sticker.top }];
  if (geometry.logo) layers.push(...await logoLayers(base, assets, geometry.logo));
  let pipeline = sharp(base.data, { raw: base.info }).composite(layers);
  const { format, quality } = kit.output;
  const bytes = format === 'png'
    ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  return { bytes, width: base.info.width, height: base.info.height, format, geometry };
}

// The logo alone on a flat colour, drawn by the same layers as the covers, so the
// kit shows exactly how it lands on dark and on light art.
export async function logoSwatch(assets, { width = 520, height = 232, background = '#1d232a' } = {}) {
  if (!assets.logo) return null;
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(background.slice(i, i + 2), 16));
  const data = Buffer.alloc(width * height * 3);
  for (let o = 0; o < data.length; o += 3) { data[o] = r; data[o + 1] = g; data[o + 2] = b; }
  const base = { data, info: { width, height, channels: 3 } };
  const fit = Math.min(height * 0.42, (width * 0.76) / assets.logo.aspect);
  const box = { width: Math.max(1, Math.round(fit * assets.logo.aspect)), height: Math.max(1, Math.round(fit)) };
  Object.assign(box, { left: Math.round((width - box.width) / 2), top: Math.round((height - box.height) / 2) });
  return sharp(data, { raw: base.info }).composite(await logoLayers(base, assets, box)).png().toBuffer();
}

export async function thumbnail(input, width = 520) {
  return (input?.info ? sharp(input.data, { raw: input.info }) : sharp(input))
    .resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).webp({ quality: 82 }).toBuffer();
}
