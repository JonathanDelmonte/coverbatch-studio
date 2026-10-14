import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const defaults = () => ({
  version: 1, assets: [], products: [], templates: [], catalog: [], manifest: [],
  importReport: null, profile: null,
  preferences: { format: 'jpeg', quality: 94, minQuality: 85, maxKB: 0, allowOpaqueLayers: false },
});
export const defaultFrame = () => ({ ratio: 'original', width: 0, height: 0, fit: 'contain', background: '#ffffff', focusX: 0.5, focusY: 0.5, cropConfirmed: false });

export class Store {
  constructor(root) { this.root = path.resolve(root); this.state = defaults(); this.writes = Promise.resolve(); }
  async init() {
    for (const dir of ['assets', 'temp', 'jobs']) await mkdir(path.join(this.root, dir), { recursive: true });
    try { this.state = { ...defaults(), ...JSON.parse(await readFile(path.join(this.root, 'project.json'), 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Não foi possível ler project.json. Preserve o arquivo e restaure seu backup.', { cause: error }); }
    return this;
  }
  async save() {
    const contents = JSON.stringify(this.state, null, 2);
    this.writes = this.writes.catch(() => {}).then(async () => {
      const file = path.join(this.root, 'project.json');
      await writeFile(file + '.tmp', contents);
      await rename(file + '.tmp', file);
    });
    await this.writes;
  }
  asset(id) { const a = this.state.assets.find(a => a.id === id); if (!a) throw new Error('Arquivo não encontrado.'); return a; }
  assetPath(id) { return path.join(this.root, 'assets', this.asset(id).file); }
  async addAsset(bytes, name, kind = 'manual', origin = 'Arquivo fornecido localmente', { allowOpaque = false } = {}) {
    const sha256 = hash(bytes);
    const id = hash(`${kind}:${name}:${sha256}`).slice(0, 24);
    const existing = this.state.assets.find(a => a.id === id);
    if (existing) return existing;
    const asset = { id, name, kind, origin, sha256, bytes: bytes.length, file: `${sha256}.bin` };
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' });
      const m = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(m.format)) throw new Error('Use JPEG, PNG ou WebP.');
      if ((m.pages || 1) > 1) throw new Error('Imagens animadas não são aceitas.');
      // Decode fully on import: a readable header alone does not prove integrity.
      await image.clone().raw().toBuffer();
      const swap = [5, 6, 7, 8].includes(m.orientation);
      Object.assign(asset, { width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format, hasAlpha: !!m.hasAlpha });
      if (kind === 'layer') {
        if (m.format !== 'png') throw new Error('A camada precisa ser um PNG.');
        let transparent = false;
        if (m.hasAlpha) {
          const { data, info } = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] < 255) { transparent = true; break; }
        }
        if (!transparent && !allowOpaque) throw new Error('O PNG está totalmente opaco. Exporte com transparência ou ative “Aceitar PNG opaco mantendo o fundo”.');
        asset.hasTransparency = transparent;
        asset.opaqueAccepted = !transparent;
      }
    } catch (e) { asset.error = e.message; }
    if (kind === 'layer' && asset.error) throw new Error(`${name}: ${asset.error}`);
    // Content-addressed originals are immutable. A second name can reference the
    // same bytes while Sharp/Windows still holds a read handle for the preview.
    if (!this.state.assets.some(a => a.sha256 === sha256)) {
      const file = path.join(this.root, 'assets', asset.file);
      try { await writeFile(file, bytes, { flag: 'wx' }); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (hash(await readFile(file)) !== sha256) throw new Error('Arquivo local inconsistente. Preserve seus dados e restaure o original.');
      }
    }
    this.state.assets.push(asset);
    return asset;
  }
  publicState() {
    const { catalog, manifest, ...s } = this.state;
    return { ...s, assets: s.assets.map(({ file, ...a }) => a) };
  }
}
