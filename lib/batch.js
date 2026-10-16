import { mkdir, readdir, readFile, rm, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readJSON, writeJSON, sha256 } from './files.js';
import { readZip, writeZip } from './zip.js';
import { prepareBase, composeOutput, geometryFor, thumbnail, sourcePreview } from './compose.js';
import { platformHint, baseSlug, findExistingSticker } from './detect.js';
import { PLATFORMS } from './sticker.js';
import { LABEL_KEYS } from './kit.js';
import { FORMATS, FORMAT_KEYS, FITS, normalizeFormat, sanitizeFrame } from './framing.js';

const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|avif|gif|tiff?)$/i;
const JUNK = /(^|\/)(__MACOSX|\.[^/]*|thumbs\.db|desktop\.ini)(\/|$)/i;
const MAX_ITEMS = 3000;
export const BATCH_ID = /^[a-f0-9-]{36}$/;
export const ITEM_ID = /^[a-f0-9]{10}$/;
const MODES = ['auto', 'PS4', 'PS5', 'both'];
const BATCH_FORMATS = ['auto', ...FORMAT_KEYS];
const BATCH_FITS = ['auto', ...FITS];

// Hand-made framings, one per fixed format: framing a cover for 4:5 leaves its
// 1:1 framing alone, and coming back to 4:5 finds it as it was left.
function cleanFrames(frames) {
  const out = {};
  for (const [format, frame] of Object.entries(frames ?? {})) {
    if (!FORMAT_KEYS.includes(format) || format === 'original') continue;
    try { out[format] = sanitizeFrame(frame); } catch { /* dropped */ }
  }
  return out;
}
// `legacy` marks a file another rule made; it never decides whether to render.
const framingKey = r => JSON.stringify(r ? { format: r.format, frame: r.frame, fit: r.fit } : null);
const sameFraming = (a, b) => framingKey(a) === framingKey(b);

// What a cover finished before formats existed really is: v1.1 wrote either the
// art's own shape or 1200 × 1500 cropped by sharp's attention guess. The guess is
// marked `legacy` so a framing chosen now redoes the file even when it matches
// the new default; the framing editor never pretends the old crop was centred.
function legacyRendering(item, planned) {
  const store = FORMATS['4x5'];
  const sameShape = item.sourceWidth === store.width && item.sourceHeight === store.height;
  if (item.width === store.width && item.height === store.height && !sameShape) return { format: '4x5', fit: 'cover', legacy: true };
  return sameShape && planned.format === '4x5' ? planned : { format: 'original' };
}

const cleanPath = name => String(name ?? '').replaceAll('\\', '/').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\/+/, '').slice(-300);
const extOf = name => { const e = (path.posix.extname(name).slice(1) || 'jpg').toLowerCase(); return e === 'jfif' || e === 'jpeg' ? 'jpg' : e === 'tif' ? 'tiff' : e; };
export const titleSlug = title => baseSlug(String(title || 'lote').replace(/\.zip$/i, '') + '.x');

export class Batches extends EventEmitter {
  constructor(root, kit) {
    super();
    this.setMaxListeners(100);
    this.dir = path.join(root, 'batches'); this.kit = kit;
    this.batches = new Map();
    this.queue = []; this.queued = new Set(); this.running = new Set(); this.again = new Set(); this.active = 0;
    this.saveTimers = new Map(); this.previews = new Map();
    const cores = os.availableParallelism?.() ?? os.cpus().length;
    this.concurrency = Math.max(1, Math.min(4, Math.floor(cores / 2)));
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !BATCH_ID.test(entry.name)) continue;
      const batch = await readJSON(path.join(this.dir, entry.name, 'batch.json'), null).catch(() => null);
      if (!batch?.items || batch.id !== entry.name) continue;
      // File names in batch.json become paths: accept only names this program generates.
      batch.items = batch.items.filter(i => ITEM_ID.test(i.id) && /^[a-f0-9]{10}\.[a-z0-9]{2,5}$/.test(i.file)
        && (i.outputs ?? []).every(o => /^[a-z0-9_][a-z0-9_.-]{0,120}\.(jpg|png)$/.test(o.name)));
      if (batch.reading) { batch.reading = false; batch.ingest = { ...batch.ingest, interrupted: true }; }
      // v1.0 saved its default phrase as 'immediate'; since v1.1 the default is 'auto'
      // (the kit's phrase for each platform) and 'immediate' is a choice.
      if (!batch.v) { if (!batch.label || batch.label === 'immediate') batch.label = 'auto'; batch.v = 2; }
      if (!BATCH_FORMATS.includes(batch.format)) batch.format = 'auto';
      if (!BATCH_FITS.includes(batch.fit)) batch.fit = 'auto';
      for (const item of batch.items) {
        item.frames = cleanFrames(item.frames);
        if (item.override?.format && !FORMAT_KEYS.includes(item.override.format)) delete item.override.format;
      }
      this.batches.set(batch.id, batch);
      this.assignNames(batch);
      // Covers made before formats and framing existed are taken as they are.
      for (const item of batch.items) if (item.status === 'done' && !item.rendered) item.rendered = legacyRendering(item, this.framing(item));
      // Work interrupted by closing the program resumes; a cover that keeps
      // failing to render does not loop forever.
      for (const item of batch.items) if (['queued', 'working'].includes(item.status) && !item.excluded) {
        if ((item.attempts ?? 0) >= 2) { item.status = 'error'; item.error = 'O processamento desta imagem foi interrompido repetidamente.'; }
        else this.enqueue(batch, item);
      }
    }
    return this;
  }

  pathOf(batch, ...parts) { return path.join(this.dir, batch.id, ...parts); }
  get(id) {
    const batch = BATCH_ID.test(String(id)) ? this.batches.get(id) : null;
    if (!batch || batch.deleted) throw Object.assign(new Error('Lote não encontrado.'), { status: 404 });
    return batch;
  }
  item(batch, itemId) {
    const item = ITEM_ID.test(String(itemId)) && batch.items.find(i => i.id === itemId);
    if (!item) throw Object.assign(new Error('Capa não encontrada.'), { status: 404 });
    return item;
  }

  // --- planning ---------------------------------------------------------
  plan(batch, item) {
    const fallback = this.kit.data.output.fallback;
    let platforms, source;
    if (item.override?.platforms?.length) { platforms = item.override.platforms; source = 'manual'; }
    else if (batch.platformMode !== 'auto') { platforms = batch.platformMode === 'both' ? [...PLATFORMS] : [batch.platformMode]; source = 'todas'; }
    else if (item.hint.platforms.length) { platforms = item.hint.platforms; source = item.hint.from; }
    else { platforms = fallback; source = 'padrão'; }
    item.platforms = PLATFORMS.filter(p => platforms.includes(p));
    item.platformSource = source;
    // Phrase per platform: this cover's choice, else the batch's, else the kit's default for the platform.
    const phrase = this.kit.data.output.phrase;
    item.labels = Object.fromEntries(item.platforms.map(p => [p, item.override?.label ?? (batch.label && batch.label !== 'auto' ? batch.label : phrase[p] ?? 'immediate')]));
    item.labelSource = item.override?.label ? 'manual' : batch.label && batch.label !== 'auto' ? 'todas' : 'padrão';
    // Image format: this cover's, else the batch's, else the kit's. The fit only
    // matters for covers nobody framed by hand.
    const output = this.kit.data.output, fromBatch = batch.format && batch.format !== 'auto' ? batch.format : null;
    item.format = item.override?.format ?? fromBatch ?? output.size;
    item.formatSource = item.override?.format ? 'manual' : fromBatch ? 'todas' : 'padrão';
    item.fit = batch.fit && batch.fit !== 'auto' ? batch.fit : output.fit;
  }
  // Everything besides the kit that decides a cover's pixels. Saved with the
  // files as `rendered`, so a different format or framing renders it again.
  framing(item) {
    if (item.format === 'original') return { format: 'original' };
    const frame = item.frames?.[item.format];
    return frame ? { format: item.format, frame } : { format: item.format, fit: item.fit };
  }
  // Output names follow the order of the batch, so they never depend on which
  // cover happened to finish first. Duplicated names get -2, -3…
  assignNames(batch) {
    const used = new Set(), ext = this.kit.data.output.format === 'png' ? 'png' : 'jpg';
    batch.owners = {};
    for (const item of batch.items) {
      this.plan(batch, item);
      item.names = {};
      if (item.excluded) continue;
      for (const p of item.platforms) {
        const root = `${item.slug}-${p.toLowerCase()}`;
        let name = `${root}.${ext}`, n = 2;
        while (used.has(name)) name = `${root}-${n++}.${ext}`;
        used.add(name); item.names[p] = name; batch.owners[name] = item.id;
      }
    }
  }
  // True when the planned files differ from the files on disk. A kit change alone
  // does not re-render (the batch offers "Reaplicar"); errors retry on request.
  needsRender(item) {
    if (item.excluded || item.status === 'error') return false;
    if (item.status !== 'done') return true;
    const done = Object.fromEntries((item.outputs ?? []).map(o => [o.platform, o]));
    return item.platforms.some(p => done[p]?.name !== item.names[p] || done[p]?.label !== item.labels[p]) || (item.outputs ?? []).some(o => !item.platforms.includes(o.platform))
      || !sameFraming(item.rendered, this.framing(item));
  }

  // --- creation & ingestion --------------------------------------------
  async create({ files, title }) {
    if (!files?.length) throw new Error('Nenhum arquivo recebido.');
    const batch = {
      id: randomUUID(), title: String(title || files[0].name || 'Lote').slice(0, 120),
      createdAt: new Date().toISOString(), platformMode: 'auto', label: 'auto', format: 'auto', fit: 'auto', v: 2,
      reading: true, ingest: { files: files.length, images: 0, ignored: [], errors: [] }, items: [], outputsRev: 0,
    };
    await mkdir(this.pathOf(batch, 'in'), { recursive: true });
    await mkdir(this.pathOf(batch, 'out'), { recursive: true });
    await mkdir(this.pathOf(batch, 'thumbs'), { recursive: true });
    this.batches.set(batch.id, batch);
    await this.persist(batch, true);
    this.ingest(batch, files).catch(e => { batch.ingest.errors.push({ file: batch.title, error: e.message }); })
      .finally(async () => { batch.reading = false; this.emitBatch(batch); await this.persist(batch, true); });
    return batch;
  }

  async ingest(batch, files) {
    for (const file of files) {
      const name = cleanPath(file.name);
      try {
        if (/\.zip$/i.test(name)) {
          await readZip(file.path, async (entry, bytes) => {
            if (batch.deleted) throw new Error('Lote excluído.');
            const inner = cleanPath(entry);
            if (JUNK.test(inner) || inner.endsWith('/')) return;
            if (!IMAGE_EXT.test(inner)) { batch.ingest.ignored.push(inner); return; }
            await this.addItem(batch, inner, bytes, path.posix.basename(name));
          });
        } else if (IMAGE_EXT.test(name)) {
          await this.addItem(batch, name, await readFile(file.path), batch.title);
        } else if (!JUNK.test(name)) batch.ingest.ignored.push(name);
      } catch (e) {
        if (batch.deleted) return;
        batch.ingest.errors.push({ file: name, error: /ZIP|zip|central directory|signature/.test(e.message) ? `ZIP ilegível ou danificado (${e.message}).` : e.message });
      } finally {
        await unlink(file.path).catch(() => {});
      }
    }
  }

  async addItem(batch, source, bytes, batchName) {
    if (batch.items.length >= MAX_ITEMS) { batch.ingest.ignored.push(source); return; }
    const item = {
      id: randomBytes(5).toString('hex'), source, slug: baseSlug(source), file: '', bytes: bytes.length, sha256: sha256(bytes),
      hint: platformHint(source, batchName), override: {}, frames: {}, excluded: false, status: 'queued', flags: [], outputs: [], rev: 0, attempts: 0,
    };
    item.file = `${item.id}.${extOf(source)}`;
    await writeFile(this.pathOf(batch, 'in', item.file), bytes);
    batch.items.push(item); batch.ingest.images++;
    this.assignNames(batch);
    this.enqueue(batch, item);
    this.emitItem(batch, item);
    this.persist(batch);
  }

  // --- render queue -------------------------------------------------------
  enqueue(batch, item) {
    const key = `${batch.id}:${item.id}`;
    if (this.running.has(key)) { this.again.add(key); return; }
    if (!this.queued.has(key)) { this.queued.add(key); this.queue.push({ batch, item, key }); }
    item.status = 'queued';
    this.pump();
  }
  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.queued.delete(job.key); this.running.add(job.key); this.active++;
      this.render(job.batch, job.item).catch(() => {}).finally(() => {
        this.active--; this.running.delete(job.key);
        if (this.again.delete(job.key) && !job.batch.deleted) this.enqueue(job.batch, job.item);
        else if (!job.batch.deleted && this.idle(job.batch)) { this.emitBatch(job.batch); this.persist(job.batch, true); }
        this.pump();
      });
    }
  }
  idle(batch) { return !batch.reading && batch.items.every(i => !['queued', 'working'].includes(i.status)); }

  async render(batch, item) {
    if (batch.deleted || item.excluded) { if (item.excluded) item.status = 'done'; return; }
    const kit = this.kit.data, assets = await this.kit.assets(), revision = this.kit.revision;
    this.plan(batch, item);
    const names = { ...item.names }, platforms = [...item.platforms], labels = { ...item.labels }, framing = this.framing(item);
    item.status = 'working'; item.attempts = (item.attempts ?? 0) + 1;
    this.emitItem(batch, item); this.persist(batch);
    try {
      const base = await prepareBase(this.pathOf(batch, 'in', item.file), { size: framing.format, frame: framing.frame, fit: framing.fit });
      const flags = [...base.notes];
      const probe = geometryFor(base, kit, assets, platforms[0]).sticker;
      if ((await findExistingSticker(base, probe)).found) flags.push({ code: 'stamped', text: 'Esta capa parece já ter o selo. Confira para não carimbar duas vezes.' });
      if (!assets.logo) flags.push({ code: 'no-logo', text: 'Kit sem logo: só o selo foi aplicado.' });
      // Large enough for the before/after comparison in the inspector.
      await writeFile(this.pathOf(batch, 'thumbs', `${item.id}-orig.webp`), await thumbnail(base, 1200));
      const outputs = [];
      for (const platform of platforms) {
        const label = labels[platform];
        const out = await composeOutput(base, { kit, assets, platform, label });
        if (batch.deleted) return;
        await writeFile(this.pathOf(batch, 'out', names[platform]), out.bytes);
        await writeFile(this.pathOf(batch, 'thumbs', `${item.id}-${platform}.webp`), await thumbnail(out.bytes));
        outputs.push({ platform, name: names[platform], label, width: out.width, height: out.height, bytes: out.bytes.length, format: out.format, geometry: { sticker: out.geometry.sticker, logo: out.geometry.logo } });
      }
      if (item.excluded) {
        for (const o of outputs) if ((batch.owners?.[o.name] ?? item.id) === item.id) await unlink(this.pathOf(batch, 'out', o.name)).catch(() => {});
        Object.assign(item, { outputs: [], status: 'done', attempts: 0 });
        return;
      }
      // Remove this cover's previous files unless another cover now owns the name.
      for (const old of item.outputs ?? []) {
        if (!outputs.some(o => o.name === old.name) && (batch.owners?.[old.name] ?? item.id) === item.id) await unlink(this.pathOf(batch, 'out', old.name)).catch(() => {});
      }
      Object.assign(item, { outputs, flags, status: 'done', error: null, width: base.info.width, height: base.info.height, sourceWidth: base.source.width, sourceHeight: base.source.height, kitRevision: revision, rendered: framing, attempts: 0 });
    } catch (e) {
      Object.assign(item, { status: 'error', error: e.message || 'Falha ao processar a imagem.', attempts: 0 });
    }
    item.rev++; batch.outputsRev++;
    this.emitItem(batch, item); this.emitBatch(batch); this.persist(batch);
  }

  // --- changes ------------------------------------------------------------
  refresh(batch, { force = false } = {}) {
    this.assignNames(batch);
    for (const item of batch.items) {
      if (item.excluded) continue;
      if (force || this.needsRender(item)) this.enqueue(batch, item);
    }
    this.emitBatch(batch); this.persist(batch);
  }
  async updateBatch(id, patch = {}) {
    const batch = this.get(id);
    if (patch.platformMode !== undefined) { if (!MODES.includes(patch.platformMode)) throw new Error('Plataforma inválida.'); batch.platformMode = patch.platformMode; }
    if (patch.label !== undefined) { if (patch.label !== 'auto' && !LABEL_KEYS.includes(patch.label)) throw new Error('Frase inválida.'); batch.label = patch.label; }
    if (patch.format !== undefined) { if (!BATCH_FORMATS.includes(patch.format)) throw new Error('Formato inválido.'); batch.format = patch.format; }
    if (patch.fit !== undefined) { if (!BATCH_FITS.includes(patch.fit)) throw new Error('Encaixe inválido.'); batch.fit = patch.fit; }
    // "Desfazer escolhas": the batch goes back to what the file names and the kit
    // decide. Framings are handwork on single covers and stay.
    if (patch.reset) {
      batch.platformMode = 'auto'; batch.label = 'auto'; batch.format = 'auto'; batch.fit = 'auto';
      for (const item of batch.items) {
        item.override = {};
        if (item.excluded) { item.excluded = false; item.status = 'queued'; }
      }
    }
    // A batch-wide choice applies to every cover, replacing per-cover choices.
    if (patch.platformMode !== undefined || patch.label !== undefined || patch.format !== undefined) {
      for (const item of batch.items) {
        item.override = {
          ...item.override,
          platforms: patch.platformMode !== undefined ? undefined : item.override.platforms,
          label: patch.label !== undefined ? undefined : item.override.label,
          format: patch.format !== undefined ? undefined : item.override.format,
        };
      }
    }
    // Only the covers whose names said nothing about the platform.
    if (patch.fallbackPlatforms !== undefined) {
      const chosen = patch.fallbackPlatforms;
      if (!Array.isArray(chosen) || !chosen.length || chosen.some(p => !PLATFORMS.includes(p))) throw new Error('Plataforma inválida.');
      for (const item of batch.items) if (item.platformSource === 'padrão') item.override = { ...item.override, platforms: PLATFORMS.filter(p => chosen.includes(p)) };
    }
    if (typeof patch.title === 'string' && patch.title.trim()) batch.title = patch.title.trim().slice(0, 120);
    this.refresh(batch);
    for (const item of batch.items) this.emitItem(batch, item);
    return this.summary(batch);
  }
  async updateItem(id, itemId, patch = {}) {
    const batch = this.get(id), item = this.item(batch, itemId);
    if (patch.platforms !== undefined) {
      if (patch.platforms !== null && (!Array.isArray(patch.platforms) || !patch.platforms.length || patch.platforms.some(p => !PLATFORMS.includes(p)))) throw new Error('Escolha ao menos uma plataforma.');
      item.override = { ...item.override, platforms: patch.platforms ?? undefined };
    }
    if (patch.label !== undefined) {
      if (patch.label !== null && !LABEL_KEYS.includes(patch.label)) throw new Error('Frase inválida.');
      item.override = { ...item.override, label: patch.label ?? undefined };
    }
    if (patch.format !== undefined) {
      if (patch.format !== null && !FORMAT_KEYS.includes(patch.format)) throw new Error('Formato inválido.');
      item.override = { ...item.override, format: patch.format ?? undefined };
    }
    // { format, x, y, zoom } frames the cover for that format; { format, reset: true }
    // goes back to the batch's fit. The format is explicit: it is the one on screen.
    if (patch.frame !== undefined) {
      const format = normalizeFormat(patch.frame?.format);
      if (!format || format === 'original') throw new Error('Escolha um formato com recorte para enquadrar a capa.');
      const frames = { ...item.frames };
      if (patch.frame.reset) delete frames[format]; else frames[format] = sanitizeFrame(patch.frame);
      item.frames = frames;
      // A v1.1 crop was made by another rule: any framing chosen for it redoes the file.
      if (item.rendered?.legacy && item.status === 'done' && !item.excluded) this.enqueue(batch, item);
    }
    if (patch.reset) {
      item.override = {}; item.frames = {};
      if (item.excluded) { item.excluded = false; item.status = 'queued'; }
    }
    if (patch.excluded !== undefined) {
      item.excluded = !!patch.excluded;
      if (item.excluded) {
        for (const o of item.outputs ?? []) await unlink(this.pathOf(batch, 'out', o.name)).catch(() => {});
        item.outputs = []; item.status = 'done'; batch.outputsRev++;
      } else item.status = 'queued';
    }
    if (item.status === 'error' && !item.excluded) this.enqueue(batch, item);
    this.refresh(batch);
    item.rev++;
    this.emitItem(batch, item);
    return this.publicItem(item);
  }
  reapplyKit(id) { const batch = this.get(id); this.refresh(batch, { force: true }); return this.summary(batch); }
  // A different output format renames every file, so open batches follow it.
  formatChanged() { for (const batch of this.batches.values()) if (!batch.deleted) this.refresh(batch); }

  async remove(id) {
    const batch = this.get(id);
    batch.deleted = true; this.batches.delete(id);
    clearTimeout(this.saveTimers.get(id)); this.saveTimers.delete(id);
    this.queue = this.queue.filter(j => j.batch !== batch);
    await rm(path.join(this.dir, batch.id), { recursive: true, force: true, maxRetries: 3 });
    this.emit('event', { batchId: id, type: 'removed', data: { id } });
  }

  // --- outputs ------------------------------------------------------------
  readyOutputs(batch) {
    return batch.items.filter(i => !i.excluded && i.status === 'done').flatMap(i => i.outputs ?? []);
  }
  async zip(id) {
    const batch = this.get(id);
    if (!this.idle(batch)) throw Object.assign(new Error('Aguarde o fim do processamento para baixar o ZIP.'), { status: 409 });
    const outputs = this.readyOutputs(batch);
    if (!outputs.length) throw Object.assign(new Error('Nenhuma capa pronta neste lote.'), { status: 409 });
    const file = this.pathOf(batch, 'lote.zip');
    if (batch.zipRev !== batch.outputsRev || !(await stat(file).then(() => true, () => false))) {
      await writeZip(file, outputs.map(o => ({ name: o.name, path: this.pathOf(batch, 'out', o.name) })));
      batch.zipRev = batch.outputsRev; this.persist(batch, true);
    }
    return { file, name: `${titleSlug(batch.title)}-com-selo.zip` };
  }
  outputFolder(id) { return this.pathOf(this.get(id), 'out'); }
  // The whole art for the framing editor, made the first time it is asked for.
  async sourcePreview(batch, item) {
    const file = this.pathOf(batch, 'thumbs', `${item.id}-src.webp`);
    if (await stat(file).then(() => true, () => false)) return file;
    const key = `${batch.id}:${item.id}`;
    if (!this.previews.has(key)) {
      // A batch deleted meanwhile, or a full disk, must not reach the window as a raw file-system error.
      const made = sourcePreview(this.pathOf(batch, 'in', item.file)).then(bytes => writeFile(file, bytes).catch(() => {
        throw Object.assign(new Error('Não foi possível preparar a arte desta capa.'), { status: batch.deleted ? 404 : 500 });
      }));
      this.previews.set(key, made.finally(() => this.previews.delete(key)));
    }
    await this.previews.get(key);
    return file;
  }
  async sampleInput() {
    const recent = [...this.batches.values()].filter(b => !b.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const batch of recent) {
      const item = batch.items.find(i => i.status === 'done' && !i.excluded && !i.flags?.some(f => f.code === 'stamped'));
      if (item) return this.pathOf(batch, 'in', item.file);
    }
    return null;
  }

  // --- views & persistence -----------------------------------------------
  publicItem(item) {
    const { file: _f, sha256: _s, names: _n, attempts: _a, ...rest } = item;
    return { ...rest, stale: item.status === 'done' && !item.excluded && (item.kitRevision ?? 0) !== this.kit.revision };
  }
  summary(batch) {
    const items = batch.items, count = fn => items.filter(fn).length;
    const live = items.filter(i => !i.excluded);
    const pending = count(i => ['queued', 'working'].includes(i.status) && !i.excluded);
    return {
      id: batch.id, title: batch.title, createdAt: batch.createdAt, platformMode: batch.platformMode, label: batch.label, format: batch.format, fit: batch.fit,
      modified: batch.platformMode !== 'auto' || batch.label !== 'auto' || batch.format !== 'auto' || batch.fit !== 'auto'
        || items.some(i => i.excluded || i.override?.platforms || i.override?.label || i.override?.format),
      status: batch.reading ? 'reading' : pending ? 'working' : 'done',
      ingest: { ...batch.ingest, ignored: batch.ingest.ignored.length, ignoredSample: batch.ingest.ignored.slice(0, 5) },
      counts: {
        items: live.length, excluded: items.length - live.length, pending,
        done: count(i => i.status === 'done' && !i.excluded), errors: count(i => i.status === 'error' && !i.excluded),
        flagged: count(i => !i.excluded && i.flags?.some(f => f.code === 'stamped')),
        fallback: count(i => !i.excluded && i.status !== 'error' && i.platformSource === 'padrão'),
        stale: count(i => i.status === 'done' && !i.excluded && (i.kitRevision ?? 0) !== this.kit.revision),
        outputs: this.readyOutputs(batch).length,
      },
      preview: live.filter(i => i.status === 'done' && i.outputs?.length).slice(0, 4).map(i => ({ id: i.id, platform: i.outputs[0].platform, rev: i.rev })),
    };
  }
  publicBatch(batch) { return { ...this.summary(batch), items: batch.items.map(i => this.publicItem(i)) }; }
  list() { return [...this.batches.values()].filter(b => !b.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(b => this.summary(b)); }

  emitItem(batch, item) { this.emit('event', { batchId: batch.id, type: 'item', data: this.publicItem(item) }); }
  emitBatch(batch) { this.emit('event', { batchId: batch.id, type: 'batch', data: this.summary(batch) }); }
  persist(batch, now = false) {
    if (batch.deleted) return Promise.resolve();
    clearTimeout(this.saveTimers.get(batch.id));
    const write = () => { this.saveTimers.delete(batch.id); if (batch.deleted) return Promise.resolve(); const { deleted: _d, ...data } = batch; return writeJSON(this.pathOf(batch, 'batch.json'), data).catch(() => {}); };
    if (now) return write();
    this.saveTimers.set(batch.id, setTimeout(write, 400));
    return Promise.resolve();
  }
  async flush() { await Promise.all([...this.batches.values()].map(b => this.persist(b, true))); }
}
