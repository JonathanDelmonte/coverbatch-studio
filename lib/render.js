import sharp from 'sharp';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { defaultFrame, hash } from './store.js';
import { writeZip } from './zip.js';

export const anchors = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'center'];
const number = (v, low, high, label) => { if (!Number.isFinite(Number(v)) || Number(v) < low || Number(v) > high) throw new Error(`${label}: use um valor entre ${low} e ${high}.`); return Number(v); };
export function validateTemplate(store, t) {
  if (!t || typeof t.name !== 'string' || !t.name.trim() || !Array.isArray(t.layers) || t.layers.length > 20) throw new Error('Modelo inválido (máximo de 20 camadas).');
  if (typeof t.platform !== 'string' || typeof t.availability !== 'string') throw new Error('Defina plataforma e disponibilidade do modelo.');
  for (const l of t.layers) {
    const a = store.asset(l.assetId); if (a.kind !== 'layer' || a.error) throw new Error('Modelo contém PNG de camada inválido.');
    if (!anchors.includes(l.anchor)) throw new Error('Âncora inválida.');
    number(l.width, .01, 1, 'Largura'); number(l.marginX, 0, 1, 'Margem horizontal'); number(l.marginY, 0, 1, 'Margem vertical'); number(l.opacity, 0, 1, 'Opacidade');
    number(l.trimTop || 0, 0, a.height - 1, 'Margem interna superior'); number(l.rounding || 0, 0, .5, 'Cantos arredondados');
  }
  return t;
}

export function effective(store, p, overrideTemplate) {
  const t = overrideTemplate || store.state.templates.find(t => t.id === p.templateId);
  return { template: t, frame: { ...defaultFrame(), ...(t?.frame || {}), ...(p.override?.frame || {}) }, layers: p.override?.layers || t?.layers || [] };
}
export function readiness(store, p) {
  if (!p.baseId) return 'Sem capa: forneça a arte correta.';
  const a = store.asset(p.baseId);
  if (a.error) return `Imagem inválida: ${a.error}`;
  if (a.kind === 'reference' || a.kind === 'layer') return 'Uma referência ou adesivo não pode ser usado como capa.';
  if (!p.baseApproved) return 'Aprove esta imagem como base após avaliar os adesivos já incorporados.';
  const { template: t, layers, frame } = effective(store, p);
  if (!t) return 'Escolha um modelo.';
  if (!p.platform || t.platform !== p.platform) return 'A plataforma do modelo não corresponde ao produto.';
  if (!p.availability || p.availability !== t.availability) return 'Confirme a disponibilidade correspondente ao modelo.';
  if (layers.length < 2) return 'Adicione ao menos duas camadas PNG ao modelo.';
  if (frame.fit === 'cover' && frame.ratio !== 'original' && !frame.cropConfirmed) return 'Confirme o recorte individual após conferir a prévia.';
  if (!p.reviewed) return 'Confira a prévia e marque o produto como revisado.';
  return null;
}

export async function compose(store, p, { template, original = false } = {}) {
  if (!p.baseId) throw new Error('Produto sem capa.');
  const a = store.asset(p.baseId);
  if (a.error) throw new Error(a.error);
  if (['reference', 'layer'].includes(a.kind)) throw new Error('Este arquivo não pode ser usado como base.');
  const settings = effective(store, p, template);
  let frame = settings.frame;
  const warnings = [];
  const blocked = !p.baseApproved;
  if (original || blocked) frame = defaultFrame();
  if (blocked) warnings.push('Base ainda não aprovada: mostrando original sem adesivos.');
  let w = a.width, h = a.height;
  let targetW = number(frame.width || 0, 0, 6000, 'Largura de saída');
  if (frame.ratio === 'original') {
    if (targetW > a.width) throw new Error('A largura supera o original. Reduza para evitar ampliação artificial.');
    w = Math.round(targetW || a.width); h = Math.round(a.height * w / a.width);
  } else {
    const ratios = { '4:5': .8, '3:4': .75, '1:1': 1 };
    if (frame.ratio === 'custom') { w = Math.round(number(frame.width, 1, 6000, 'Largura')); h = Math.round(number(frame.height, 1, 6000, 'Altura')); }
    else { const ratio = ratios[frame.ratio]; if (!ratio) throw new Error('Proporção inválida.'); w = Math.round(targetW || a.width); h = Math.round(w / ratio); }
  }
  if (w * h > 16_000_000) throw new Error('Saída limitada a 16 megapixels.');
  if (!/^#[0-9a-f]{6}$/i.test(frame.background)) throw new Error('Cor de preenchimento inválida.');
  const bg = frame.background;
  let base;
  const src = () => sharp(store.assetPath(a.id), { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().toColourspace('srgb');
  if (frame.ratio !== 'original' && frame.fit === 'cover') {
    const targetRatio = w / h, nativeRatio = a.width / a.height;
    const cropW = Math.min(a.width, Math.floor(a.height * targetRatio));
    const cropH = Math.min(a.height, Math.floor(a.width / targetRatio));
    if (w > cropW || h > cropH) throw new Error(`Recorte disponível em ${cropW} × ${cropH}. Reduza as dimensões; a arte não será ampliada.`);
    const left = Math.round((a.width - cropW) * number(frame.focusX, 0, 1, 'Foco horizontal'));
    const top = Math.round((a.height - cropH) * number(frame.focusY, 0, 1, 'Foco vertical'));
    // Separate auto-orientation from extraction so EXIF coordinates match the UI.
    const oriented = await src().png().toBuffer();
    base = await sharp(oriented).extract({ left, top, width: cropW, height: cropH }).resize(w, h, { fit: 'fill' }).png().toBuffer();
    if (Math.abs(nativeRatio - targetRatio) > .001) warnings.push('Recorte ativo: parte da arte original fica fora do quadro.');
  } else if (frame.ratio === 'original') {
    base = await src().resize(w, h, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } else {
    const resized = await src().resize(w, h, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const left = Math.floor((w - resized.info.width) / 2), top = Math.floor((h - resized.info.height) / 2);
    base = await sharp({ create: { width: w, height: h, channels: 4, background: bg } }).composite([{ input: resized.data, left, top }]).png().toBuffer();
    warnings.push('Arte inteira preservada; preenchimento visível nas áreas restantes.');
  }
  const layers = original || blocked ? [] : settings.layers;
  const geometry = []; const overlays = [];
  for (const l of layers) {
    validateTemplate(store, { name: 'Prévia', platform: '', availability: '', layers: [l] });
    const asset = store.asset(l.assetId);
    if (asset.opaqueAccepted && !l.rounding) warnings.push(`Camada “${asset.name}”: PNG opaco; o fundo original está incorporado ao resultado.`);
    const trimTop = Math.round(l.trimTop || 0), rounding = Number(l.rounding || 0);
    const lw = Math.max(1, Math.round(w * l.width)), lh = Math.max(1, Math.round(lw * (asset.height - trimTop) / asset.width));
    const mx = Math.round(w * l.marginX), my = Math.round(h * l.marginY);
    const left = l.anchor === 'center' ? Math.round((w - lw) / 2 + mx) : l.anchor.endsWith('right') ? w - mx - lw : mx;
    const top = l.anchor === 'center' ? Math.round((h - lh) / 2 + my) : l.anchor.startsWith('bottom') ? h - my - lh : my;
    if (left < 0 || top < 0 || left + lw > w || top + lh > h) throw new Error(`A camada “${asset.name}” ultrapassa o quadro. Reduza tamanho/margens.`);
    let layer = sharp(store.assetPath(l.assetId));
    if (trimTop) layer = layer.extract({left:0,top:trimTop,width:asset.width,height:asset.height-trimTop});
    let layerBytes = await layer.resize(lw, lh, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().png().toBuffer();
    if (rounding) {
      const radius = Math.min(lw, lh) * rounding;
      const mask = Buffer.from(`<svg width="${lw}" height="${lh}"><rect width="${lw}" height="${lh}" rx="${radius}" fill="white"/></svg>`);
      layerBytes = await sharp(layerBytes).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
    }
    const { data, info } = await sharp(layerBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * l.opacity);
    overlays.push({ input: data, raw: { width: info.width, height: info.height, channels: 4 }, left, top });
    geometry.push({ assetId: asset.id, width: lw, height: lh, left, top, opacity: l.opacity, ...(trimTop || rounding ? {trimTop,rounding} : {}), ...(l.role ? {role:l.role} : {}) });
    if (lw > asset.width) warnings.push(`Camada ${asset.name}: PNG menor que o tamanho configurado.`);
  }
  const bytes = overlays.length ? await sharp(base).composite(overlays).png().toBuffer() : base;
  return { bytes, width: w, height: h, background: bg, warnings, geometry };
}

export async function encode(composed, prefs) {
  const format = prefs.format === 'png' ? 'png' : 'jpeg';
  const quality = Math.round(number(prefs.quality ?? 94, 85, 100, 'Qualidade JPEG'));
  const minQuality = Math.round(number(prefs.minQuality ?? 85, 85, quality, 'Qualidade mínima'));
  const maxBytes = number(prefs.maxKB || 0, 0, 100000, 'Limite KB') * 1024;
  let bytes, usedQuality = format === 'jpeg' ? quality : null;
  for (let q = quality; q >= minQuality; q--) {
    const pipeline = sharp(composed.bytes);
    bytes = format === 'png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer() : await pipeline.flatten({ background: composed.background }).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer();
    usedQuality = format === 'jpeg' ? q : null;
    if (!maxBytes || bytes.length <= maxBytes) return { ...composed, bytes, format, quality: usedQuality, size: bytes.length };
    if (format === 'png') break;
  }
  const error = new Error(`Limite de ${prefs.maxKB} KB não atendido sem baixar a qualidade mínima (${minQuality}). Item pendente.`);
  error.pending = true; throw error;
}

export function safePart(str, fallback = 'produto', limit = 100) {
  let s = String(str).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, limit);
  if (!s) s = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = `_${s}`;
  return s;
}
export function outputName(p, format, used = new Set()) {
  const root = `${safePart(p.slug)}--${safePart(p.id, 'local', 48)}`; const ext = format === 'png' ? 'png' : 'jpg';
  let name = `${root}.${ext}`, n = 2;
  while (used.has(name.toLowerCase())) name = `${root}--${n++}.${ext}`;
  used.add(name.toLowerCase()); return name;
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
export function manifestCSV(rows) {
  const cols = ['arquivo', 'id', 'slug', 'plataforma', 'modelo', 'disponibilidade', 'origem', 'capa_arquivo', 'capa_sha256', 'sha256', 'largura', 'altura', 'formato', 'qualidade', 'bytes'];
  return '\uFEFF' + [cols.join(';'), ...rows.map(r => cols.map(c => csvCell(r[c])).join(';'))].join('\r\n');
}

export async function runJob(store, job, productKeys, prefs) {
  const dir = path.join(store.root, 'jobs', job.id); await mkdir(dir, { recursive: true });
  // Freeze the batch so edits during rendering cannot change the outputs midway.
  const frozen = Object.create(store); frozen.state = structuredClone(store.state);
  job.total = productKeys.length; job.done = 0; job.results = []; job.phase = 'Compondo imagens';
  const entries = [], rows = [], used = new Set();
  try {
    for (const key of productKeys) {
      const p = frozen.state.products.find(p => p.key === key);
      try {
        if (!p) throw new Error('Produto não encontrado.');
        const reason = readiness(frozen, p); if (reason) { const e = new Error(reason); e.pending = !(p.baseId && frozen.asset(p.baseId).error); throw e; }
        const rendered = await encode(await compose(frozen, p), prefs);
        const filename = outputName(p, rendered.format, used);
        const filepath = path.join(dir, filename); await writeFile(filepath, rendered.bytes);
        const a = frozen.asset(p.baseId), t = effective(frozen, p).template;
        const row = { arquivo: filename, id: p.id, slug: p.slug, plataforma: p.platform, modelo: t.name, disponibilidade: p.availability, origem: a.origin, capa_arquivo: a.name, capa_sha256: a.sha256, sha256: hash(rendered.bytes), largura: rendered.width, altura: rendered.height, formato: rendered.format, qualidade: rendered.quality, bytes: rendered.size, ajustes: p.override, camadas: rendered.geometry, avisos: rendered.warnings };
        rows.push(row); entries.push({ name: filename, path: filepath });
        job.results.push({ key, name: p.name, status: 'ok', file: filename, width: rendered.width, height: rendered.height, bytes: rendered.size, quality: rendered.quality, warnings: rendered.warnings });
      } catch (e) { job.results.push({ key, name: p?.name || key, status: e.pending ? 'pending' : 'error', error: e.message }); }
      job.done++;
    }
    job.phase = 'Montando ZIP';
    entries.push({ name: 'export-manifest.json', bytes: Buffer.from(JSON.stringify({ version: 1, produtos: rows, falhas: job.results.filter(r => r.status !== 'ok') }, null, 2)) });
    entries.push({ name: 'export-manifest.csv', bytes: Buffer.from(manifestCSV(rows)) });
    entries.push({ name: 'LEIA-ME.txt', bytes: Buffer.from('Imagens compostas localmente. Extraia este ZIP e envie cada arquivo ao produto indicado no manifesto. O ZIP não distribui imagens automaticamente na loja.\r\n') });
    await writeZip(path.join(dir, 'lote.zip'), entries);
    job.phase = 'Concluído'; job.complete = true;
  } catch (e) { job.phase = 'Falha ao montar lote'; job.error = e.message; job.complete = true; }
  await writeFile(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  return job;
}
export function newJob() { return { id: randomUUID(), phase: 'Preparando', total: 0, done: 0, results: [], complete: false }; }
