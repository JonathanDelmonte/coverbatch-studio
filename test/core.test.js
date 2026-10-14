import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Store, defaultFrame, hash } from '../lib/store.js';
import { compose, encode, readiness, outputName, runJob, newJob } from '../lib/render.js';
import { importFiles, exportTemplates, importTemplates } from '../lib/importer.js';
import { writeZip, readZip, safeName } from '../lib/zip.js';
import { createApp } from '../server.js';

async function fixture() {
  const root = await mkdtemp(path.resolve('work/test-'));
  const store = await new Store(path.join(root, '.local-data')).init();
  const baseBytes = await sharp({ create: { width: 100, height: 150, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
  const base = await store.addAsset(baseBytes, 'capa.png', 'manual');
  const overlay = Buffer.from('<svg width="20" height="10"><rect width="10" height="10" fill="red"/></svg>');
  const red = await store.addAsset(await sharp(overlay).png().toBuffer(), 'TESTE-faixa.png', 'layer');
  const logo = await store.addAsset(await sharp(Buffer.from('<svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="white"/></svg>')).png().toBuffer(), 'TESTE-logo.png', 'layer');
  const template = { id: 't', name: 'Modelo TESTE PS5', platform: 'PS5', availability: 'other', frame: defaultFrame(), layers: [{ assetId: red.id, anchor: 'bottom-left', width: .2, marginX: .1, marginY: .1, opacity: .5 }, { assetId: logo.id, anchor: 'bottom-right', width: .1, marginX: .05, marginY: .05, opacity: 1 }] };
  const product = { key: 'p', id: '123', slug: 'jogo-teste-ps5', name: 'Jogo teste', platform: 'PS5', baseId: base.id, baseChoices: [base.id], baseApproved: true, templateId: template.id, availability: 'other', reviewed: true, selected: true, override: {} };
  store.state.templates.push(template); store.state.products.push(product);
  return { store, base, baseBytes, red, logo, template, product, root };
}

test('transparência, opacidade, margens e proporção preservadas em pixels', async () => {
  const { store, product, baseBytes } = await fixture();
  const rendered = await compose(store, product);
  assert.deepEqual(rendered.geometry[0], { assetId: store.state.templates[0].layers[0].assetId, width: 20, height: 10, left: 10, top: 125, opacity: .5 });
  const { data, info } = await sharp(rendered.bytes).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4)];
  assert.deepEqual(px(25, 130), [0, 0, 255, 255]); // transparent half retains blue base
  assert.ok(px(12, 130)[0] >= 127 && px(12, 130)[2] >= 126); // half-opacity blend
  assert.deepEqual(px(9, 125), [0, 0, 255, 255]); // exact left margin
  assert.equal(rendered.width, 100); assert.equal(rendered.height, 150);
  assert.equal(hash(await readFile(store.assetPath(product.baseId))), hash(baseBytes));
  assert.deepEqual((await compose(store, product)).bytes, rendered.bytes); // deterministic
});
test('quadros explícitos: preenchimento, recorte confirmado e bloqueio de ampliação', async () => {
  const { store, product } = await fixture();
  product.override.frame = { ratio: '1:1', width: 100, fit: 'contain', background: '#ffffff' };
  const square = await compose(store, product); assert.equal(square.width, square.height);
  const { data } = await sharp(square.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
  product.override.frame = { ratio: '4:5', width: 100, fit: 'cover', cropConfirmed: false };
  assert.match(readiness(store, product), /recorte/);
  product.override.frame.cropConfirmed = true; assert.equal(readiness(store, product), null);
  assert.equal((await compose(store, product)).height, 125);
  product.override.frame = { ratio: 'original', width: 200 };
  await assert.rejects(compose(store, product), /ampliação/);
});
test('JPEG alta qualidade, PNG e limite inviável ficam pendentes', async () => {
  const { store, product } = await fixture(); const composed = await compose(store, product);
  const jpg = await encode(composed, { format: 'jpeg', quality: 94, minQuality: 85, maxKB: 0 });
  assert.equal((await sharp(jpg.bytes).metadata()).format, 'jpeg'); assert.equal(jpg.quality, 94);
  assert.equal((await encode(composed, { format: 'png', quality: 94, maxKB: 0 })).quality, null);
  await assert.rejects(encode(composed, { format: 'jpeg', quality: 94, minQuality: 85, maxKB: .01 }), /pendente/);
});
test('plataformas, disponibilidade e revisão têm bloqueios independentes', async () => {
  const { store, product } = await fixture();
  product.platform = 'PS4'; assert.match(readiness(store, product), /plataforma/);
  product.platform = 'PS5'; product.availability = null; assert.match(readiness(store, product), /disponibilidade/);
  product.availability = 'other'; product.reviewed = false; assert.match(readiness(store, product), /prévia/);
  product.reviewed = true; product.baseApproved = false; assert.match(readiness(store, product), /Aprove/);
  assert.equal((await compose(store, product)).geometry.length, 0); // published/unapproved never composed
});
test('nomes repetidos, caracteres Windows e CSV seguro', async () => {
  const used = new Set(), p = { slug: '../../CON', id: '1' };
  assert.equal(outputName(p, 'jpeg', used), '_con--1.jpg');
  assert.equal(outputName(p, 'jpeg', used), '_con--1--2.jpg');
  assert.throws(() => safeName('../x.png'), /inseguro/);
});
test('manifesto associa uma única arte a PS4 e PS5; inválida não destrói lote; referências excluídas', async () => {
  const { store, root, baseBytes, template } = await fixture(); store.state.products = [];
  const file = path.join(root, 'input.zip');
  await writeZip(file, [
    { name: 'capas-limpas-da-previa/jogo.png', bytes: baseBytes },
    { name: 'referencias/exemplo.png', bytes: baseBytes },
    { name: 'fotos-publicadas/game--2/01.png', bytes: baseBytes },
    { name: 'quebrada.png', bytes: Buffer.from('not an image') },
    { name: 'catalogo.json', bytes: Buffer.from(JSON.stringify([{ id: 1, slug: 'game-ps4', nome: 'Game PS4', plataforma: 'PS4', imagens: [] }, { id: 2, slug: 'game-ps5', nome: 'Game PS5', plataforma: 'PS5', imagens: [{ arquivo: 'fotos-publicadas/game--2/01.png' }] }, { id: 3, slug: 'sem-capa', plataforma: 'PS5', imagens: [] }])) },
    { name: 'capas-limpas-manifesto.json', bytes: Buffer.from(JSON.stringify([{ arquivo: 'capas-limpas-da-previa/jogo.png', sha256: hash(baseBytes), produtos_slugs: ['game-ps4', 'game-ps5'] }])) },
  ]);
  const report = await importFiles(store, [{ name: 'input.zip', path: file }]);
  assert.equal(report.errors.length, 1); assert.equal(report.withPreview, 2);
  const ps4 = store.state.products[0], ps5 = store.state.products[1];
  assert.equal(ps4.baseId, ps5.baseId); assert.equal(ps4.baseApproved, true);
  const t4 = { ...structuredClone(template), id: 't4', platform: 'PS4', name: 'TESTE PS4' }; t4.layers[0].opacity = 1; store.state.templates.push(t4);
  for (const p of [ps4, ps5]) Object.assign(p, { templateId: p.platform === 'PS4' ? 't4' : 't', availability: 'other', reviewed: true });
  const job = await runJob(store, newJob(), store.state.products.map(p => p.key), { format: 'png', quality: 94 });
  assert.equal(job.results.filter(r => r.status === 'ok').length, 2);
  assert.equal(job.results.filter(r => r.status === 'error').length, 1);
  assert.equal(job.results.filter(r => r.status === 'pending').length, 1);
  const entries = new Map(); await readZip(path.join(store.root, 'jobs', job.id, 'lote.zip'), (n,b) => entries.set(n,b));
  const manifest = JSON.parse(entries.get('export-manifest.json')); assert.equal(manifest.produtos.length, 2);
  assert.notEqual(hash(entries.get(manifest.produtos[0].arquivo)), hash(entries.get(manifest.produtos[1].arquivo)));
  for (const row of manifest.produtos) assert.equal(row.sha256, hash(entries.get(row.arquivo)));
  assert.ok(entries.has('export-manifest.csv'));
  const failed = store.state.products.find(p => p.manualAsset);
  Object.assign(failed, { baseId: ps5.baseId, baseApproved: true, platform: 'PS5', templateId: 't', availability: 'other', reviewed: true });
  const retry = await runJob(store, newJob(), [failed.key], { format: 'jpeg', quality: 94 });
  assert.equal(retry.total, 1); assert.equal(retry.results[0].status, 'ok');
});
test('modelos portáteis incluem os PNGs; nomes repetidos de uploads são distintos', async () => {
  const { store, root } = await fixture(); const zip = path.join(root, 'templates.zip'); await exportTemplates(store, zip);
  const second = await new Store(path.join(root, 'second')).init(); await importTemplates(second, zip);
  assert.equal(second.state.templates.length, 1); assert.equal(second.state.assets.length, 2);
  assert.equal((await readFile(second.assetPath(second.state.templates[0].layers[0].assetId))).length > 0, true);
  const bytes = await sharp({ create: { width: 50, height: 50, channels: 3, background: 'green' } }).png().toBuffer();
  const file = path.join(root, 'different.png'); await writeFile(file, bytes);
  await importFiles(second, [{ name: 'mesmo-nome.png', path: file }, { name: 'mesmo-nome.png', path: store.assetPath(store.state.products[0].baseId) }]);
  assert.equal(second.state.products.length, 2); assert.notEqual(second.state.products[0].id, second.state.products[1].id);
});
test('camadas opacas e falsas são rejeitadas', async () => {
  const { store, baseBytes } = await fixture();
  await assert.rejects(store.addAsset(baseBytes, 'opaca.png', 'layer'), /opaco/);
  await assert.rejects(store.addAsset(Buffer.from('oops'), 'falsa.png', 'layer'));
});
test('HTTP recusa origens externas, persiste ajustes e permite repetir só uma falha', async () => {
  const { root } = await fixture(); const { app, store } = await createApp(path.join(root, 'api'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const s = await fetch(base+'/api/state').then(r=>r.json()); assert.ok(s.token);
    const denied = await fetch(base+'/api/preferences', { method:'PUT', headers:{'Content-Type':'application/json',Origin:'https://example.org'}, body:'{}' }); assert.equal(denied.status,403);
    const noToken = await fetch(base+'/api/preferences', { method:'PUT',headers:{'Content-Type':'application/json'},body:'{}' });assert.equal(noToken.status,403);
    const ok = await fetch(base+'/api/preferences', { method:'PUT',headers:{'Content-Type':'application/json','x-local-token':s.token},body:JSON.stringify({format:'png'}) });assert.equal(ok.status,200);
    const reloaded = await new Store(store.root).init();assert.equal(reloaded.state.preferences.format,'png');
  } finally { await new Promise(r=>server.close(r)); }
});

test('HTTP serve imagens e downloads da pasta privada sem bloqueio de dotfiles', async () => {
  const fixtureData = await fixture(); await fixtureData.store.save();
  const { app } = await createApp(fixtureData.store.root);
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const state = await fetch(base+'/api/state').then(r=>r.json());
    const original = await fetch(base+'/api/assets/'+fixtureData.base.id);
    assert.equal(original.status,200); assert.match(original.headers.get('content-type'),/image\/png/);
    assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(fixtureData.baseBytes));
    const response = await fetch(base+'/api/export',{method:'POST',headers:{'Content-Type':'application/json','x-local-token':state.token},body:JSON.stringify({keys:['p']})});
    const {id} = await response.json(); let job;
    do { job = await fetch(base+'/api/jobs/'+id).then(r=>r.json()); if(!job.complete)await new Promise(r=>setTimeout(r,10)); } while(!job.complete);
    assert.equal(job.results[0].status,'ok');
    const zip = await fetch(base+`/api/jobs/${id}/download/lote.zip`);assert.equal(zip.status,200);
    const bytes = Buffer.from(await zip.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
    const image = await fetch(base+`/api/jobs/${id}/download/${job.results[0].file}`);assert.equal(image.status,200);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,100);
    const models = await fetch(base+'/api/templates-export');assert.equal(models.status,200);
    assert.equal(Buffer.from(await models.arrayBuffer()).subarray(0,2).toString(),'PK');
  }finally{await new Promise(r=>server.close(r));}
});
