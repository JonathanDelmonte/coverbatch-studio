import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { readZip, safeName, writeZip } from './zip.js';
import { defaultFrame } from './store.js';

const imageRE = /\.(png|jpe?g|webp)$/i;
const normalizePath = name => safeName(name).replace(/^.*?(?=(capas-limpas-da-previa|fotos-publicadas|referencias)\/)/, '');
const text = b => b.toString('utf8').replace(/^\uFEFF/, '');
function parseArray(bytes) { const value = JSON.parse(text(bytes)); if (!Array.isArray(value)) throw new Error('O catálogo/manifesto deve ser uma lista JSON.'); return value; }

export async function importFiles(store, files, report = {}) {
  Object.assign(report, { phase: 'Lendo arquivos', processed: 0, warnings: [], errors: [] });
  const added = [];
  let catalogJSON, catalogCSV, manifest;
  async function entry(rawName, bytes) {
    const name = normalizePath(rawName); const basename = path.posix.basename(name);
    report.processed++;
    try {
      if (basename === 'catalogo.json') catalogJSON = parseArray(bytes);
      else if (basename === 'catalogo.csv' || (!imageRE.test(name) && /\.csv$/i.test(name))) {
        const str = text(bytes); const delimiter = str.split('\n')[0].includes(';') ? ';' : ',';
        catalogCSV = parse(str, { columns: true, delimiter, skip_empty_lines: true, trim: true, bom: true }).map(r => ({ ...r, id: r.id || r.id_produto, imagens: r.foto_principal_publicada ? [{ arquivo: r.foto_principal_publicada }] : r.arquivo ? [{ arquivo: r.arquivo }] : [] }));
      } else if (basename === 'capas-limpas-manifesto.json') manifest = parseArray(bytes);
      else if (imageRE.test(name)) {
        const kind = name.startsWith('referencias/') ? 'reference' : name.startsWith('capas-limpas-da-previa/') ? 'preview' : name.startsWith('fotos-publicadas/') ? 'published' : 'manual';
        const origin = { reference: 'Referência visual (não é base)', preview: 'Capa da prévia local • não publicada', published: 'Foto publicada • requer aprovação', manual: 'Arquivo fornecido localmente' }[kind];
        const a = await store.addAsset(bytes, name, kind, origin); added.push(a);
        if (a.error) report.errors.push({ file: name, error: a.error });
      }
      // Markdown and other product fields are data. Nothing in the archive is executed.
    } catch (e) { report.errors.push({ file: name, error: e.message }); }
  }
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) await readZip(file.path, entry);
    else await entry(file.name, await readFile(file.path));
  }
  if (catalogJSON || catalogCSV) store.state.catalog = catalogJSON || catalogCSV;
  if (manifest) store.state.manifest = manifest;
  report.phase = 'Associando produtos';
  const assets = store.state.assets.filter(a => !['layer', 'reference'].includes(a.kind));
  const find = name => {
    if (!name) return null;
    const n = normalizePath(name);
    const exact = assets.filter(a => a.name === n);
    if (exact.length === 1) return exact[0];
    // Loose-file uploads can match a catalog path only when the basename is unique.
    const loose = assets.filter(a => a.kind === 'manual' && path.posix.basename(a.name) === path.posix.basename(n));
    return loose.length === 1 ? loose[0] : null;
  };
  const known = new Map(store.state.products.map(p => [p.key, p]));
  const used = new Set(); const duplicate = new Set();
  for (const raw of store.state.catalog) {
    const id = String(raw.id ?? ''), slug = String(raw.slug ?? '');
    if (!id || !slug) { report.warnings.push('Produto sem ID ou slug ignorado.'); continue; }
    const key = `product-${id}`;
    if (duplicate.has(key)) { report.warnings.push(`ID repetido no catálogo: ${id}. Revise o arquivo.`); continue; }
    duplicate.add(key);
    const m = store.state.manifest.find(m => Array.isArray(m.produtos_slugs) && m.produtos_slugs.includes(slug));
    let clean = m && find(m.arquivo);
    if (clean && m.sha256 && clean.sha256 !== m.sha256) { report.warnings.push(`Hash divergente para ${m.arquivo}; base não aprovada.`); clean = null; }
    if (clean) { clean.source = String(m.origem || clean.origin); clean.expectedHash = m.sha256 || null; }
    // The manifest is authoritative for the prepared preview association.
    const choices = [clean, ...(raw.imagens || []).map(i => find(i.arquivo))].filter(Boolean);
    const old = known.get(key);
    const base = clean || choices[0];
    const p = old || { key, id, slug, name: String(raw.nome || slug), platform: String(raw.plataforma || ''), selected: false, templateId: null, availability: null, baseId: base?.id || null, baseApproved: !!clean, reviewed: false, override: {} };
    p.baseChoices = [...new Set([...(old?.baseChoices || []), ...choices.map(a => a.id)])];
    if (old && !old.baseId && base) { p.baseId = base.id; p.baseApproved = !!clean; p.reviewed = false; }
    if (!old) store.state.products.push(p);
    choices.forEach(a => used.add(a.id));
  }
  // Unassociated previews are never assigned by fuzzy game-name matching.
  for (const a of added.filter(a => a.kind === 'manual' && !used.has(a.id))) {
    if (store.state.products.some(p => p.manualAsset === a.id)) continue;
    const localId = randomUUID().slice(0, 8);
    const slug = path.posix.basename(a.name).replace(/\.[^.]+$/, '');
    store.state.products.push({ key: `local-${localId}`, id: `local-${localId}`, slug, name: slug, platform: '', selected: false, templateId: null, availability: null, baseId: a.id, baseChoices: [a.id], baseApproved: false, reviewed: false, override: {}, manualAsset: a.id });
  }
  report.phase = 'Concluído';
  report.totalProducts = store.state.products.length;
  report.previewAssets = store.state.assets.filter(a => a.kind === 'preview').length;
  report.withPreview = store.state.products.filter(p => p.baseChoices.some(id => store.asset(id).kind === 'preview')).length;
  report.withoutPreview = report.totalProducts - report.withPreview;
  report.withoutImage = store.state.products.filter(p => !p.baseId).length;
  report.references = store.state.assets.filter(a => a.kind === 'reference').length;
  store.state.importReport = structuredClone(report);
  await store.save(); return report;
}

export async function exportTemplates(store, file) {
  const templates = structuredClone(store.state.templates);
  const ids = [...new Set(templates.flatMap(t => t.layers.map(l => l.assetId)))];
  const assets = ids.map(id => { const a = store.asset(id); return { id, name: path.posix.basename(a.name), sha256: a.sha256, entry: `layers/${id}.png` }; });
  await writeZip(file, [
    { name: 'templates.json', bytes: Buffer.from(JSON.stringify({ version: 1, templates, assets, preferences: store.state.preferences }, null, 2)) },
    ...assets.map(a => ({ name: a.entry, path: store.assetPath(a.id) })),
  ]);
}

export async function importTemplates(store, file) {
  const entries = new Map();
  await readZip(file, (name, bytes) => { entries.set(name, bytes); if (entries.size > 300) throw new Error('Até 300 arquivos por pacote de modelos.'); });
  const content = entries.get('templates.json');
  if (!content) throw new Error('templates.json não encontrado.');
  const pack = JSON.parse(text(content));
  if (pack.version !== 1 || !Array.isArray(pack.templates) || !Array.isArray(pack.assets)) throw new Error('Formato de modelos inválido.');
  const remap = new Map();
  for (const a of pack.assets) {
    const bytes = entries.get(a.entry); if (!bytes) throw new Error(`PNG ausente: ${a.name}`);
    const actual = await store.addAsset(bytes, String(a.name), 'layer');
    if (actual.sha256 !== a.sha256) throw new Error(`Hash divergente: ${a.name}`);
    remap.set(a.id, actual.id);
  }
  // Validate template schemas through the same renderer validator used by the API.
  const { validateTemplate } = await import('./render.js');
  for (const t of pack.templates) {
    t.id = randomUUID(); t.layers = t.layers.map(l => ({ ...l, assetId: remap.get(l.assetId) }));
    validateTemplate(store, t);
    store.state.templates.push(t);
  }
  if (pack.preferences) store.state.preferences = { ...store.state.preferences, ...pack.preferences };
  await store.save();
}
