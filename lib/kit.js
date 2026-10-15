import { copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readJSON, writeJSON, writeAtomic, sha256 } from './files.js';
import { DEFAULT_LAYOUT, sanitizeLayout } from './layout.js';
import { PLATFORMS, SCHEMES, SCHEME_PARTS, normalizeLabelText } from './sticker.js';
import { readZip, writeZip } from './zip.js';

// The brand kit is everything the store decided once: sticker style and phrases,
// the logo, where both sit, and how the finished files are written.
export const LABEL_KEYS = Object.freeze(['immediate', 'access', 'preorder']);
export const SECTIONS = Object.freeze(['logo', 'sticker', 'layout', 'output']);
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_OVERLAY_SIDE = 2400;

export function defaultKit() {
  return {
    version: 2, revision: 1,
    sticker: {
      mode: 'builtin',
      colors: { PS4: { ...SCHEMES.PS4 }, PS5: { ...SCHEMES.PS5 } },
      labels: {
        immediate: { regular: 'ENVIO', bold: 'IMEDIATO' },
        access: { regular: 'ACESSO', bold: 'IMEDIATO' },
        preorder: { regular: '', bold: 'PRÉ-VENDA' },
      },
      images: { PS4: null, PS5: null },
    },
    logo: null,
    logoOpacity: 0.8,
    // A soft shadow keeps the white logo readable when the cover is light there.
    logoShadow: true,
    layout: { ...DEFAULT_LAYOUT },
    output: { format: 'jpeg', quality: 92, size: 'original', fallback: ['PS4'], phrase: { PS4: 'immediate', PS5: 'immediate' } },
    profileId: null,
  };
}

const clamp = (v, low, high, fallback) => Number.isFinite(Number(v)) ? Math.min(high, Math.max(low, Number(v))) : fallback;

function cleanLabels(labels = {}, fallback = defaultKit().sticker.labels) {
  const out = {};
  for (const key of LABEL_KEYS) {
    const regular = normalizeLabelText(labels[key]?.regular ?? fallback[key].regular);
    const bold = normalizeLabelText(labels[key]?.bold ?? fallback[key].bold);
    if (!regular && !bold) throw new Error('O texto do selo não pode ficar vazio.');
    out[key] = { regular, bold };
  }
  return out;
}

// v1.0 kits stored one block colour per platform; the PS5 one predates the
// official black/white PS5 sticker, so only the PS4 blue is carried over.
function cleanColors(colors = {}, fallback = defaultKit().sticker.colors) {
  const out = {};
  for (const p of PLATFORMS) {
    let given = colors[p];
    if (typeof given === 'string') given = p === 'PS4' ? { block: given } : {};
    out[p] = {};
    for (const part of SCHEME_PARTS) {
      const value = given?.[part] ?? fallback[p][part];
      if (!HEX.test(value ?? '')) throw new Error('Cor inválida.');
      out[p][part] = value.toUpperCase();
    }
  }
  return out;
}

function cleanOutput(output = {}, fallback = defaultKit().output) {
  const format = output.format ?? fallback.format;
  const size = output.size ?? fallback.size;
  const platforms = output.fallback ?? fallback.fallback;
  if (!['jpeg', 'png'].includes(format)) throw new Error('Formato de saída inválido.');
  if (!['original', 'store'].includes(size)) throw new Error('Tamanho de saída inválido.');
  if (!Array.isArray(platforms) || !platforms.length || platforms.some(p => !PLATFORMS.includes(p))) throw new Error('Plataforma padrão inválida.');
  const phrase = {};
  for (const p of PLATFORMS) {
    phrase[p] = output.phrase?.[p] ?? fallback.phrase?.[p] ?? 'immediate';
    if (!LABEL_KEYS.includes(phrase[p])) throw new Error('Frase padrão inválida.');
  }
  return { format, size, quality: Math.round(clamp(output.quality ?? fallback.quality, 70, 100, 92)), fallback: PLATFORMS.filter(p => platforms.includes(p)), phrase };
}

// Rebuild a kit from stored JSON, keeping only valid fields.
function mergeKit(saved) {
  const kit = defaultKit();
  if (!saved || saved.version !== 2) return kit;
  kit.revision = Number.isInteger(saved.revision) ? saved.revision : 1;
  kit.profileId = typeof saved.profileId === 'string' ? saved.profileId : null;
  const s = saved.sticker ?? {};
  if (['builtin', 'image'].includes(s.mode)) kit.sticker.mode = s.mode;
  try { kit.sticker.colors = cleanColors(s.colors); } catch { /* keep defaults */ }
  for (const p of PLATFORMS) {
    const img = s.images?.[p];
    if (img && /^sticker-ps[45]\.png$/.test(img.file)) kit.sticker.images[p] = { file: img.file, width: img.width, height: img.height, opaque: !!img.opaque, name: String(img.name ?? '').slice(0, 120), sha256: img.sha256 };
  }
  try { kit.sticker.labels = cleanLabels(s.labels); } catch { /* keep defaults */ }
  if (saved.logo?.file === 'logo.png') kit.logo = { file: 'logo.png', width: saved.logo.width, height: saved.logo.height, name: String(saved.logo.name ?? '').slice(0, 120), sha256: saved.logo.sha256 };
  kit.logoOpacity = clamp(saved.logoOpacity, 0.1, 1, kit.logoOpacity);
  if (typeof saved.logoShadow === 'boolean') kit.logoShadow = saved.logoShadow;
  try { kit.layout = sanitizeLayout(saved.layout); } catch { /* keep defaults */ }
  try { kit.output = cleanOutput(saved.output); } catch { /* keep defaults */ }
  return kit;
}

const SVG_SNIFF = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const SVG_UNSAFE = /<script|<foreignObject|<!ENTITY|<!DOCTYPE|<iframe|<object|<embed|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)|url\(\s*["']?\s*(?!#|data:image\/)|@import/i;

// Logos and custom stickers are trimmed to their visible pixels, so placement is
// measured on what the eye sees and never on invisible padding.
export async function normalizeOverlay(bytes, { allowOpaque = false, what = 'imagem' } = {}) {
  let image;
  if (SVG_SNIFF.test(bytes.subarray(0, 2048).toString('utf8'))) {
    if (SVG_UNSAFE.test(bytes.toString('utf8'))) throw new Error('SVG com scripts ou arquivos externos não é aceito. Exporte como PNG transparente.');
    const probe = await sharp(bytes, { density: 72 }).metadata();
    const long = Math.max(probe.width || 0, probe.height || 0);
    if (!long) throw new Error('O SVG não informa largura e altura.');
    image = sharp(bytes, { density: Math.min(2400, Math.max(72, 72 * MAX_OVERLAY_SIDE / long)), limitInputPixels: 40_000_000 });
  } else {
    image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, autoOrient: true, animated: false });
    const meta = await image.metadata().catch(() => { throw new Error(`Não foi possível ler a ${what}. Use PNG ou SVG.`); });
    if (!['png', 'webp', 'avif', 'gif', 'tiff'].includes(meta.format)) throw new Error(`A ${what} precisa de fundo transparente: use PNG ou SVG (JPEG não tem transparência).`);
  }
  const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1, translucent = false;
  for (let y = 0, o = 3; y < info.height; y++) for (let x = 0; x < info.width; x++, o += 4) {
    const a = data[o];
    if (a < 255) translucent = true;
    if (a > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) throw new Error(`A ${what} está vazia (totalmente transparente).`);
  if (!translucent && !allowOpaque) throw new Error(`A ${what} não tem fundo transparente. Exporte como PNG transparente ou SVG.`);
  const { data: png, info: out } = await sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ width: MAX_OVERLAY_SIDE, height: MAX_OVERLAY_SIDE, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  return { bytes: png, width: out.width, height: out.height, opaque: !translucent };
}

// Colour of the platform block of an old raster sticker (left part, minus the
// white wordmark), so a migrated kit keeps the store's colours.
async function blockColor(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rs = [], gs = [], bs = [];
  const x0 = Math.floor(info.width * 0.05), x1 = Math.ceil(info.width * 0.2), y0 = Math.floor(info.height * 0.15), y1 = Math.ceil(info.height * 0.85);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * info.width + x) * 4;
    if (data[o + 3] < 200) continue;
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    if (lum > 200) continue;
    rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
  }
  if (rs.length < (x1 - x0) * (y1 - y0) * 0.3) return null;
  const median = a => a.sort((p, q) => p - q)[a.length >> 1];
  return '#' + [median(rs), median(gs), median(bs)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Key order differs between defaults and kits read back from disk, so objects are
// compared with their keys sorted.
const canonical = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));
const same = (a, b) => canonical(a) === canonical(b);
const stickerState = k => ({ mode: k.sticker.mode, colors: k.sticker.colors, labels: k.sticker.labels, images: PLATFORMS.map(p => k.sticker.images[p]?.sha256 ?? null) });

export class Kit {
  constructor(root) {
    this.root = root; this.dir = path.join(root, 'kit'); this.file = path.join(root, 'kit.json');
    this.originalDir = path.join(this.dir, 'original');
    this.data = defaultKit(); this.cache = null; this.original = defaultKit();
  }
  async load() {
    await mkdir(this.dir, { recursive: true });
    const saved = await readJSON(this.file, null);
    if (saved) this.data = mergeKit(saved);
    else { await this.migrateLegacyProject(); await this.save(false); }
    const original = await readJSON(path.join(this.originalDir, 'kit.json'), null).catch(() => null);
    this.original = original ? mergeKit(original) : defaultKit();
    return this;
  }
  get revision() { return this.data.revision; }
  async save(bump = true) {
    if (bump) this.data.revision++;
    this.cache = null;
    await writeJSON(this.file, this.data);
  }

  // --- the "original" every restore button goes back to ----------------------
  // The kit installed by the store's profile, or the factory settings. Files the
  // store added itself (a logo, a sticker image) only count when the original had one.
  changes() {
    const a = this.data, b = this.original;
    const ownImages = PLATFORMS.some(p => b.sticker.images[p]);
    const sticker = k => ({ ...stickerState(k), images: ownImages ? stickerState(k).images : null });
    return {
      logo: a.logoOpacity !== b.logoOpacity || a.logoShadow !== b.logoShadow || (!!b.logo && a.logo?.sha256 !== b.logo.sha256),
      sticker: !same(sticker(a), sticker(b)),
      layout: !same(a.layout, b.layout),
      output: !same(a.output, b.output),
    };
  }
  // Older private installs were seeded before the original was kept: rebuild it
  // from the profile's kit without touching the store's current settings.
  async adoptOriginalFrom(pack) {
    const temp = new Kit(path.join(this.root, 'temp', `kit-original-${Date.now()}`));
    try {
      await temp.load(); await temp.importZip(pack); await temp.saveOriginal();
      await rm(this.originalDir, { recursive: true, force: true });
      await cp(temp.originalDir, this.originalDir, { recursive: true });
      this.original = temp.original;
    } finally { await rm(temp.root, { recursive: true, force: true }); }
  }
  async saveOriginal() {
    await rm(this.originalDir, { recursive: true, force: true });
    await mkdir(this.originalDir, { recursive: true });
    const { revision: _r, profileId: _p, ...snapshot } = structuredClone(this.data);
    if (this.data.logo) await copyFile(path.join(this.dir, this.data.logo.file), path.join(this.originalDir, this.data.logo.file));
    for (const p of PLATFORMS) { const img = this.data.sticker.images[p]; if (img) await copyFile(path.join(this.dir, img.file), path.join(this.originalDir, img.file)); }
    await writeJSON(path.join(this.originalDir, 'kit.json'), { ...snapshot, revision: 1 });
    this.original = mergeKit({ ...snapshot, revision: 1 });
  }
  async restore(section = 'all') {
    const sections = section === 'all' ? SECTIONS : [section];
    if (!sections.every(s => SECTIONS.includes(s))) throw new Error('Seção inválida.');
    const o = this.original;
    for (const s of sections) {
      if (s === 'logo') {
        this.data.logoOpacity = o.logoOpacity; this.data.logoShadow = o.logoShadow;
        // A logo the store added itself is never removed by a restore.
        if (o.logo) { await copyFile(path.join(this.originalDir, o.logo.file), path.join(this.dir, 'logo.png')); this.data.logo = { ...o.logo, file: 'logo.png' }; }
      }
      if (s === 'sticker') {
        this.data.sticker.mode = o.sticker.mode;
        this.data.sticker.colors = structuredClone(o.sticker.colors);
        this.data.sticker.labels = structuredClone(o.sticker.labels);
        for (const p of PLATFORMS) {
          const img = o.sticker.images[p];
          if (img) { await copyFile(path.join(this.originalDir, img.file), path.join(this.dir, img.file)); this.data.sticker.images[p] = { ...img }; }
        }
      }
      if (s === 'layout') this.data.layout = { ...o.layout };
      if (s === 'output') this.data.output = structuredClone(o.output);
    }
    await this.save();
    return this.toPublic();
  }

  toPublic() {
    const { sticker, logo, logoOpacity, logoShadow, layout, output, revision } = this.data;
    const o = this.original;
    return {
      revision, sticker: structuredClone(sticker), logo: logo && { width: logo.width, height: logo.height, name: logo.name },
      logoOpacity, logoShadow, layout: { ...layout }, output: structuredClone(output),
      changed: this.changes(), schemes: SCHEMES,
      original: { layout: { ...o.layout }, labels: structuredClone(o.sticker.labels), colors: structuredClone(o.sticker.colors), output: structuredClone(o.output), logoOpacity: o.logoOpacity, hasLogo: !!o.logo },
    };
  }

  async update(patch = {}) {
    const next = structuredClone(this.data);
    if (patch.sticker) {
      const s = patch.sticker;
      if (s.mode !== undefined) { if (!['builtin', 'image'].includes(s.mode)) throw new Error('Estilo de selo inválido.'); next.sticker.mode = s.mode; }
      if (s.colors) {
        const merged = structuredClone(next.sticker.colors);
        for (const p of PLATFORMS) if (s.colors[p]) Object.assign(merged[p], typeof s.colors[p] === 'string' ? { block: s.colors[p] } : s.colors[p]);
        next.sticker.colors = cleanColors(merged, next.sticker.colors);
      }
      if (s.labels) next.sticker.labels = cleanLabels({ ...next.sticker.labels, ...s.labels }, next.sticker.labels);
    }
    if (patch.logoOpacity !== undefined) next.logoOpacity = Math.round(clamp(patch.logoOpacity, 0.1, 1, next.logoOpacity) * 100) / 100;
    if (patch.logoShadow !== undefined) next.logoShadow = !!patch.logoShadow;
    if (patch.layout) next.layout = sanitizeLayout({ ...next.layout, ...patch.layout });
    if (patch.output) next.output = cleanOutput({ ...next.output, ...patch.output, phrase: { ...next.output.phrase, ...patch.output.phrase } }, next.output);
    this.data = next;
    await this.save();
    return this.toPublic();
  }

  async setLogo(bytes, name, { save = true } = {}) {
    const o = await normalizeOverlay(bytes, { what: 'logo' });
    await writeAtomic(path.join(this.dir, 'logo.png'), o.bytes);
    this.data.logo = { file: 'logo.png', width: o.width, height: o.height, name: String(name ?? 'logo.png').slice(0, 120), sha256: sha256(o.bytes) };
    if (save) await this.save();
    return this.data.logo;
  }
  async removeLogo() {
    await rm(path.join(this.dir, 'logo.png'), { force: true });
    this.data.logo = null; await this.save();
  }
  async setStickerImage(platform, bytes, name, { trimTop = 0, save = true } = {}) {
    if (!PLATFORMS.includes(platform)) throw new Error('Plataforma inválida.');
    let input = bytes;
    if (trimTop > 0) {
      const m = await sharp(bytes).metadata();
      if (trimTop < m.height - 1) input = await sharp(bytes).extract({ left: 0, top: Math.round(trimTop), width: m.width, height: m.height - Math.round(trimTop) }).png().toBuffer();
    }
    const o = await normalizeOverlay(input, { allowOpaque: true, what: 'imagem do selo' });
    const file = `sticker-${platform.toLowerCase()}.png`;
    await writeAtomic(path.join(this.dir, file), o.bytes);
    this.data.sticker.images[platform] = { file, width: o.width, height: o.height, opaque: o.opaque, name: String(name ?? file).slice(0, 120), sha256: sha256(o.bytes) };
    if (save) await this.save();
    return this.data.sticker.images[platform];
  }
  async removeStickerImage(platform) {
    const img = this.data.sticker.images[platform];
    if (!img) return;
    await rm(path.join(this.dir, img.file), { force: true });
    this.data.sticker.images[platform] = null;
    if (!PLATFORMS.some(p => this.data.sticker.images[p])) this.data.sticker.mode = 'builtin';
    await this.save();
  }

  // Bytes needed by the compositor, read once per kit revision.
  async assets() {
    if (this.cache?.revision === this.revision) return this.cache;
    const read = async file => readFile(path.join(this.dir, file)).catch(() => null);
    const logoBytes = this.data.logo ? await read(this.data.logo.file) : null;
    const images = {};
    for (const p of PLATFORMS) {
      const img = this.data.sticker.images[p];
      const bytes = img ? await read(img.file) : null;
      images[p] = bytes ? { bytes, aspect: img.width / img.height, opaque: img.opaque } : null;
    }
    this.cache = {
      revision: this.revision,
      logo: logoBytes ? { bytes: logoBytes, aspect: this.data.logo.width / this.data.logo.height, opacity: this.data.logoOpacity, shadow: this.data.logoShadow } : null,
      images,
    };
    return this.cache;
  }
  async logoBytes() { return this.data.logo ? readFile(path.join(this.dir, this.data.logo.file)) : null; }

  async exportZip(file) {
    const { profileId: _profile, revision: _revision, ...portable } = structuredClone(this.data);
    const entries = [{ name: 'kit.json', bytes: Buffer.from(JSON.stringify({ ...portable, revision: 1 }, null, 2)) }];
    if (this.data.logo) entries.push({ name: 'kit/logo.png', path: path.join(this.dir, 'logo.png') });
    for (const p of PLATFORMS) { const img = this.data.sticker.images[p]; if (img) entries.push({ name: `kit/${img.file}`, path: path.join(this.dir, img.file) }); }
    await writeZip(file, entries);
  }

  // Accepts kits exported by this version and template packs of v0.x.
  async importZip(file) {
    const entries = new Map();
    await readZip(file, (name, bytes) => { entries.set(name, bytes); if (entries.size > 300) throw new Error('Pacote de kit com arquivos demais.'); });
    if (entries.has('kit.json')) return this.importEntries(entries);
    if (entries.has('templates.json')) return this.importLegacyTemplates(entries);
    throw new Error('Este ZIP não é um kit do CoverBatch (kit.json ausente).');
  }
  async importEntries(entries) {
    let saved;
    try { saved = JSON.parse(entries.get('kit.json').toString('utf8')); } catch { throw new Error('kit.json ilegível.'); }
    if (saved?.version !== 2) throw new Error('Versão de kit não suportada.');
    const merged = mergeKit({ ...saved, revision: this.revision, profileId: this.data.profileId });
    merged.logo = null; merged.sticker.images = { PS4: null, PS5: null };
    const previous = this.data;
    this.data = merged;
    try {
      if (saved.logo && entries.has('kit/logo.png')) await this.setLogo(entries.get('kit/logo.png'), saved.logo.name, { save: false });
      for (const p of PLATFORMS) {
        const img = saved.sticker?.images?.[p], bytes = img && entries.get(`kit/sticker-${p.toLowerCase()}.png`);
        if (bytes) await this.setStickerImage(p, bytes, img.name, { save: false });
      }
    } catch (e) { this.data = previous; throw e; }
    await this.save();
    return this.toPublic();
  }
  async importLegacyTemplates(entries) {
    let pack;
    try { pack = JSON.parse(entries.get('templates.json').toString('utf8')); } catch { throw new Error('templates.json ilegível.'); }
    if (!Array.isArray(pack?.templates) || !Array.isArray(pack?.assets)) throw new Error('Pacote de modelos antigo inválido.');
    const byId = new Map(pack.assets.map(a => [a.id, a]));
    await this.applyLegacy(pack.templates, async id => entries.get(byId.get(id)?.entry) ?? null);
    await this.save();
    return this.toPublic();
  }
  // v0.x installations kept templates and layer PNGs in project.json/assets.
  async migrateLegacyProject() {
    const project = await readJSON(path.join(this.root, 'project.json'), null).catch(() => null);
    if (!project?.templates?.length || !Array.isArray(project.assets)) return false;
    const byId = new Map(project.assets.map(a => [a.id, a]));
    await this.applyLegacy(project.templates, async id => {
      const a = byId.get(id);
      return a?.file && /^[a-f0-9]{64}\.bin$/.test(a.file) ? readFile(path.join(this.root, 'assets', a.file)).catch(() => null) : null;
    });
    if (project.profile?.id) this.data.profileId = project.profile.id;
    return true;
  }
  async applyLegacy(templates, load) {
    const layers = templates.flatMap(t => (t.layers ?? []).map(l => ({ ...l, platform: t.platform, availability: t.availability })));
    const logo = layers.find(l => l.role === 'logo') ?? layers.find(l => l.anchor === 'bottom-right');
    if (logo) {
      const bytes = await load(logo.assetId);
      if (bytes) {
        try { await this.setLogo(bytes, 'logo.png', { save: false }); this.data.logoOpacity = Math.round(clamp(logo.opacity, 0.1, 1, 1) * 100) / 100; }
        catch { /* an opaque legacy logo is left for the user to replace */ }
      }
    }
    for (const platform of PLATFORMS) {
      const isBanner = l => l.platform === platform && (l.role === 'banner' || (!l.role && l.anchor === 'bottom-left'));
      const banner = layers.find(l => isBanner(l) && l.availability === 'immediate') ?? layers.find(isBanner);
      const bytes = banner && await load(banner.assetId);
      if (!bytes) continue;
      try {
        // Only the PS4 blue is carried over: the PS5 sticker is now the official black/white one.
        const color = platform === 'PS4' ? await blockColor(bytes) : null;
        if (color) this.data.sticker.colors.PS4.block = color;
        await this.setStickerImage(platform, bytes, `selo-${platform}.png`, { trimTop: banner.trimTop || 0, save: false });
      } catch { /* unreadable legacy layer: the built-in sticker covers it */ }
    }
  }
}
