import path from 'node:path';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Store, defaultFrame, defaults, hash } from '../lib/store.js';
import { importFiles, exportTemplates } from '../lib/importer.js';
import { compose, runJob, newJob } from '../lib/render.js';
import { readZip } from '../lib/zip.js';

const input = process.argv[2];
if (!input) throw new Error('Uso: npm run validate:real -- "C:\\caminho\\pacote.zip"');
const folder = path.resolve('work/private/validation');
const out = path.resolve('outputs'); await mkdir(out, { recursive: true });
const store = await new Store(folder).init();
// Rebuild only this scratch validation state, making repeated checks reproducible.
store.state = defaults();
const report = await importFiles(store, [{ name: 'pacote.zip', path: path.resolve(input) }]);
console.log(JSON.stringify(report, null, 2));
assert.equal(report.totalProducts, 696); assert.equal(report.previewAssets, 152); assert.equal(report.withPreview, 195);
assert.equal(report.withoutPreview, 501); assert.equal(report.withoutImage, 258); assert.equal(report.errors.length, 0);
const eligible = store.state.products.filter(p => store.state.assets.find(a => a.id === p.baseId)?.kind === 'preview');
assert.equal(eligible.length, 195);
const inputHashes = new Map(eligible.map(p => [p.baseId, store.asset(p.baseId).sha256]));
const logoBytes = await sharp(Buffer.from('<svg width="120" height="80"><rect x="3" y="3" width="114" height="74" rx="8" fill="#ffffff" stroke="#148fbd" stroke-width="6"/><text x="60" y="46" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#12536b">TESTE</text></svg>')).png().toBuffer();
const logo = await store.addAsset(logoBytes, 'TESTE-logo-nao-final.png', 'layer');
await writeFile(path.join(out, 'TESTE-logo-nao-final.png'), logoBytes);
const templates = [];
for (const platform of ['PS4', 'PS5']) {
  const bytes = await sharp(Buffer.from(`<svg width="480" height="70"><rect x="2" y="2" width="476" height="66" rx="9" fill="#12536b"/><text x="240" y="30" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold" fill="white">${platform} · ADESIVO DE TESTE</text><text x="240" y="53" text-anchor="middle" font-family="sans-serif" font-size="17" fill="white">NÃO USAR NA LOJA</text></svg>`)).png().toBuffer();
  const a = await store.addAsset(bytes, `TESTE-faixa-${platform}-nao-final.png`, 'layer');
  await writeFile(path.join(out, `TESTE-faixa-${platform}-nao-final.png`), bytes);
  templates.push({ id: `validation-${platform}`, name: `TESTE ${platform} — não usar na loja`, platform, availability: 'other', frame: defaultFrame(), layers: [{ assetId: a.id, anchor: 'bottom-left', width: .65, marginX: .035, marginY: .03, opacity: 1 }, { assetId: logo.id, anchor: 'bottom-right', width: .17, marginX: .035, marginY: .03, opacity: .9 }] });
}
store.state.templates = templates;
for (const p of eligible) Object.assign(p, { templateId: `validation-${p.platform}`, availability: 'other', reviewed: true, selected: false, override: {} });
const pair = eligible.filter(p => /ea-sports-fc-26/.test(p.slug));
assert.equal(pair.length, 2); assert.deepEqual(new Set(pair.map(p => p.platform)), new Set(['PS4', 'PS5'])); assert.equal(pair[0].baseId, pair[1].baseId);
const sample = [...pair, ...eligible.filter(p => !pair.includes(p)).slice(0, 6)];
// The real preview set has a single native size (600×800). Use smaller copies of
// two correctly associated covers to exercise heterogeneous native dimensions.
const reductions = [];
for (const [p, width] of [[sample[2], 450], [sample[3], 300]]) {
  const source = store.asset(p.baseId);
  const bytes = await sharp(store.assetPath(source.id)).resize({ width, withoutEnlargement: true }).jpeg({ quality: 98 }).toBuffer();
  const derived = await store.addAsset(bytes, `TESTE-reduzida-${p.slug}.jpg`, 'manual', `Cópia de teste reduzida de ${source.name}`);
  reductions.push({ id: p.id, original: source.name, original_sha256: source.sha256, original_dimensions: [source.width, source.height], test_dimensions: [derived.width, derived.height] });
  p.baseId = derived.id;
}
const batch = await runJob(store, newJob(), eligible.map(p => p.key), { format: 'jpeg', quality: 94, minQuality: 85, maxKB: 0 });
assert.equal(batch.results.filter(r => r.status === 'ok').length, 195);
async function verify(job) {
  let manifest; const names = new Set(), hashes = new Map();
  await readZip(path.join(folder, 'jobs', job.id, 'lote.zip'), async (name, bytes) => {
    assert.ok(!names.has(name.toLowerCase())); names.add(name.toLowerCase());
    if (name === 'export-manifest.json') manifest = JSON.parse(bytes);
    if (/\.jpg$/.test(name)) { const m = await sharp(bytes).metadata(); await sharp(bytes).raw().toBuffer(); hashes.set(name, { sha256: hash(bytes), width: m.width, height: m.height }); }
  });
  for (const row of manifest.produtos) {
    const actual = hashes.get(row.arquivo); assert.equal(actual.sha256, row.sha256); assert.equal(actual.width, row.largura); assert.equal(actual.height, row.altura);
    assert.ok(row.arquivo.includes(`--${row.id}`)); assert.ok(row.modelo.includes(row.plataforma));
    for (const l of row.camadas) assert.ok(l.left >= 0 && l.top >= 0 && l.left + l.width <= row.largura && l.top + l.height <= row.altura);
  }
  return manifest;
}
await verify(batch);
const small = await runJob(store, newJob(), sample.map(p => p.key), { format: 'jpeg', quality: 94, minQuality: 85, maxKB: 0 });
const manifest = await verify(small);
assert.equal(manifest.produtos.length, 8);
assert.notEqual(manifest.produtos[0].sha256, manifest.produtos[1].sha256);
for (const [id, sha256] of inputHashes) assert.equal(hash(await readFile(store.assetPath(id))), sha256);
await copyFile(path.join(folder, 'jobs', small.id, 'lote.zip'), path.join(out, 'amostra-privada-TESTE-8-produtos.zip'));
await copyFile(path.join(folder, 'jobs', batch.id, 'lote.zip'), path.join(out, 'lote-privado-TESTE-195-produtos.zip'));
await exportTemplates(store, path.join(out, 'modelos-TESTE-nao-finais.zip'));
await copyFile(path.join(folder, 'jobs', small.id, small.results[0].file), path.join(out, 'amostra-visual-TESTE.jpg'));
// Verify unapproved published photos remain uncomposed, including their native dimensions.
const published = store.state.products.filter(p => store.state.assets.find(a => a.id === p.baseId)?.kind === 'published').slice(0, 3);
const publishedChecks = [];
for (const p of published) { const r = await compose(store, p); assert.equal(r.geometry.length, 0); publishedChecks.push({ id: p.id, dimensions: [r.width, r.height], no_overlays: true }); }
const result = { validation_date: new Date().toISOString(), node: process.versions.node, sharp: sharp.versions.sharp, import: report, full_batch: { products: batch.total, ok: batch.results.filter(r => r.status === 'ok').length, failures: batch.results.filter(r => r.status !== 'ok') }, sample: manifest, shared_art_ps4_ps5: pair.map(p => ({ id: p.id, slug: p.slug, platform: p.platform, base_sha256: store.asset(p.baseId).sha256 })), heterogeneous_dimensions: reductions, published_unapproved_checks: publishedChecks, originals_unchanged: inputHashes.size, warning: 'Todos os adesivos são TESTE. Não são a logo nem a faixa finais da loja.' };
await writeFile(path.join(out, 'validacao-privada.json'), JSON.stringify(result, null, 2));
await store.save();
console.log(`VALIDAÇÃO OK: ${batch.total} produtos, 8 na amostra, ${inputHashes.size} originais intactos. Saída: outputs/`);
