import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { Kit } from '../lib/kit.js';
import { Batches } from '../lib/batch.js';
import { writeZip, readZip } from '../lib/zip.js';
import { sha256 } from '../lib/files.js';
import { cover, halves, tempDir, testLogo, waitFor } from './helpers.js';

async function setup(name) {
  const root = await tempDir(name);
  const kit = await new Kit(root).load();
  await kit.setLogo(await testLogo(), 'TESTE.png');
  const batches = await new Batches(root, kit).init();
  return { root, kit, batches };
}
async function zipOf(root, entries) {
  const file = path.join(root, `entrada-${Math.random().toString(16).slice(2)}.zip`);
  await writeZip(file, entries);
  return file;
}
const idle = (batches, id) => waitFor(() => { const b = batches.get(id); return batches.idle(b) && b; });
const byName = batch => Object.fromEntries(batch.items.map(i => [i.source, i]));

test('ZIP com pastas: plataforma por nome/pasta/ZIP, lixo ignorado, falha isolada, nomes únicos', async () => {
  const { root, batches } = await setup('batch-zip');
  const zip = await zipOf(root, [
    { name: 'PS4/god-of-war.jpg', bytes: await cover(900, 1125, '#7a2a2a') },
    { name: 'PS5/god-of-war.jpg', bytes: await cover(900, 1125, '#2a7a2a') },
    { name: 'Horizonte (PS4+PS5).png', bytes: await cover(1600, 900, '#2a2a7a', 'png') },
    { name: 'a/capa.jpg', bytes: await cover(600, 600) },
    { name: 'b/capa.jpg', bytes: await cover(600, 600, '#555') },
    { name: 'quebrada.jpg', bytes: Buffer.from('não é imagem') },
    { name: '__MACOSX/._x.jpg', bytes: Buffer.from('x') },
    { name: 'notas.txt', bytes: Buffer.from('x') },
  ]);
  const created = await batches.create({ files: [{ path: zip, name: 'capas-ps5.zip' }], title: 'capas-ps5.zip' });
  const batch = await idle(batches, created.id);
  const items = byName(batch);
  assert.equal(batch.items.length, 6);
  assert.deepEqual(batch.ingest.ignored, ['notas.txt']);
  assert.deepEqual(items['PS4/god-of-war.jpg'].outputs.map(o => o.name), ['god-of-war-ps4.jpg']);
  assert.deepEqual(items['PS5/god-of-war.jpg'].outputs.map(o => o.name), ['god-of-war-ps5.jpg']);
  assert.deepEqual(items['Horizonte (PS4+PS5).png'].outputs.map(o => o.name), ['horizonte-ps4.jpg', 'horizonte-ps5.jpg']);
  // No platform in file or folder: the ZIP name (capas-ps5.zip) decides.
  assert.deepEqual(items['a/capa.jpg'].outputs.map(o => o.name), ['capa-ps5.jpg']);
  assert.deepEqual(items['b/capa.jpg'].outputs.map(o => o.name), ['capa-ps5-2.jpg']);
  assert.equal(items['quebrada.jpg'].status, 'error');
  const out = await readdir(path.join(root, 'batches', batch.id, 'out'));
  assert.deepEqual(out.sort(), ['capa-ps5-2.jpg', 'capa-ps5.jpg', 'god-of-war-ps4.jpg', 'god-of-war-ps5.jpg', 'horizonte-ps4.jpg', 'horizonte-ps5.jpg']);
  const meta = await sharp(path.join(root, 'batches', batch.id, 'out', 'horizonte-ps5.jpg')).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1600, 900, 'jpeg'], 'tamanho original preservado');
});

test('padrão do kit, troca em lote, escolha por capa e capa fora do lote refletem nos arquivos', async () => {
  const { root, kit, batches } = await setup('batch-changes');
  const files = [];
  for (const name of ['jogo-a.jpg', 'jogo-b.jpg', 'jogo-c-ps5.jpg']) { const file = path.join(root, name); await writeFile(file, await cover(800, 1000)); files.push({ path: file, name }); }
  const created = await batches.create({ files, title: '3 arquivos' });
  let batch = await idle(batches, created.id);
  assert.equal(batches.summary(batch).counts.fallback, 2);
  assert.deepEqual(batch.items.map(i => i.platforms.join('+')), ['PS4', 'PS4', 'PS5']);

  await batches.updateBatch(batch.id, { fallbackPlatforms: ['PS4', 'PS5'] });
  batch = await idle(batches, batch.id);
  assert.deepEqual(batch.items.map(i => i.outputs.length), [2, 2, 1], 'só as capas sem plataforma no nome mudam');
  assert.equal(batches.summary(batch).counts.fallback, 0);

  const [a, b] = batch.items;
  await batches.updateItem(batch.id, a.id, { platforms: ['PS5'], label: 'preorder' });
  await batches.updateItem(batch.id, b.id, { excluded: true });
  batch = await idle(batches, batch.id);
  assert.deepEqual(a.outputs.map(o => [o.name, o.label]), [['jogo-a-ps5.jpg', 'preorder']]);
  assert.deepEqual(b.outputs, []);
  const out = (await readdir(path.join(root, 'batches', batch.id, 'out'))).sort();
  assert.deepEqual(out, ['jogo-a-ps5.jpg', 'jogo-c-ps5.jpg'], 'arquivos antigos e excluídos removidos');

  const { file, name } = await batches.zip(batch.id);
  assert.equal(name, '3-arquivos-com-selo.zip');
  const entries = new Map(); await readZip(file, (n, bytes) => entries.set(n, bytes));
  assert.deepEqual([...entries.keys()].sort(), out);
  for (const [n, bytes] of entries) assert.equal(sha256(bytes), sha256(await readFile(path.join(root, 'batches', batch.id, 'out', n))));

  await batches.updateBatch(batch.id, { platformMode: 'PS4' });
  batch = await idle(batches, batch.id);
  assert.deepEqual(batch.items.filter(i => !i.excluded).map(i => i.outputs.map(o => o.name).join()), ['jogo-a-ps4.jpg', 'jogo-c-ps4.jpg'], 'escolha do lote substitui as escolhas por capa');

  await kit.update({ output: { format: 'png' } });
  batches.formatChanged();
  batch = await idle(batches, batch.id);
  assert.ok(batch.items.filter(i => !i.excluded).every(i => i.outputs[0].name.endsWith('.png')));
});

test('formato da loja 1200 × 1500 recorta e avisa; mudança de kit fica pendente até reaplicar', async () => {
  const { root, kit, batches } = await setup('batch-store');
  await kit.update({ output: { size: 'store' } });
  const file = path.join(root, 'paisagem.jpg'); await writeFile(file, await cover(1920, 1080));
  const created = await batches.create({ files: [{ path: file, name: 'paisagem-ps4.jpg' }], title: 'x' });
  let batch = await idle(batches, created.id);
  const item = batch.items[0];
  assert.deepEqual([item.width, item.height], [1200, 1500]);
  assert.ok(item.flags.some(f => f.code === 'cropped'));
  await kit.update({ layout: { stickerHeight: 110 } });
  assert.equal(batches.summary(batch).counts.stale, 1);
  batches.reapplyKit(batch.id);
  batch = await idle(batches, batch.id);
  assert.equal(batches.summary(batch).counts.stale, 0);
});

test('lote interrompido ao fechar o programa continua de onde parou', async () => {
  const { root, kit, batches } = await setup('batch-resume');
  const file = path.join(root, 'capa.jpg'); await writeFile(file, await cover(700, 875));
  const created = await batches.create({ files: [{ path: file, name: 'capa-ps4.jpg' }], title: 'x' });
  await idle(batches, created.id);
  await batches.flush();
  const json = path.join(root, 'batches', created.id, 'batch.json');
  const saved = JSON.parse(await readFile(json, 'utf8'));
  saved.items[0].status = 'queued'; saved.items[0].outputs = [];
  await writeFile(json, JSON.stringify(saved));
  const reopened = await new Batches(root, kit).init();
  const batch = await idle(reopened, created.id);
  assert.equal(batch.items[0].status, 'done');
  assert.ok((await stat(path.join(root, 'batches', created.id, 'out', 'capa-ps4.jpg'))).size > 0);
  await reopened.remove(created.id);
  await assert.rejects(stat(path.join(root, 'batches', created.id)));
});

test('frase padrão por plataforma, frase do lote, escolha por capa e desfazer escolhas', async () => {
  const { root, kit, batches } = await setup('batch-phrase');
  await kit.update({ output: { phrase: { PS5: 'access' } } });
  const file = path.join(root, 'jogo.jpg'); await writeFile(file, await cover(800, 1000, '#888888'));
  const created = await batches.create({ files: [{ path: file, name: 'jogo-ps4-ps5.jpg' }], title: 'x' });
  let batch = await idle(batches, created.id);
  const item = batch.items[0];
  const labels = () => item.outputs.map(o => `${o.platform}:${o.label}`).join(' ');
  assert.equal(labels(), 'PS4:immediate PS5:access');
  // The PS5 file carries the official inverted sticker: black body, PS4 a white one.
  for (const o of item.outputs) {
    const { data, info } = await sharp(path.join(root, 'batches', batch.id, 'out', o.name)).raw().toBuffer({ resolveWithObject: true });
    const s = o.geometry.sticker, at = ((s.top + (s.height >> 1)) * info.width + s.left + Math.round(s.width * 0.97)) * info.channels;
    assert.ok(o.platform === 'PS5' ? data[at] < 40 : data[at] > 215, `${o.platform}: cor do corpo do selo`);
  }
  await batches.updateBatch(batch.id, { label: 'preorder' });
  batch = await idle(batches, batch.id);
  assert.equal(labels(), 'PS4:preorder PS5:preorder');
  await batches.updateItem(batch.id, item.id, { platforms: ['PS5'], label: 'immediate' });
  batch = await idle(batches, batch.id);
  assert.equal(labels(), 'PS5:immediate');
  assert.equal(batches.summary(batch).modified, true);
  await batches.updateItem(batch.id, item.id, { reset: true });
  batch = await idle(batches, batch.id);
  assert.equal(labels(), 'PS4:preorder PS5:preorder', 'desfazer a capa volta à escolha do lote');
  await batches.updateBatch(batch.id, { reset: true });
  batch = await idle(batches, batch.id);
  assert.equal(labels(), 'PS4:immediate PS5:access', 'desfazer o lote volta ao nome do arquivo e ao kit');
  assert.equal(batches.summary(batch).modified, false);
  await assert.rejects(batches.updateBatch(batch.id, { label: 'urgente' }), /Frase/);
});

test('lote da v1.0: frase "immediate" salva como padrão vira automática ao reabrir', async () => {
  const { root, kit, batches } = await setup('batch-v1');
  await kit.update({ output: { phrase: { PS5: 'access' } } });
  const file = path.join(root, 'capa.jpg'); await writeFile(file, await cover(700, 875));
  const created = await batches.create({ files: [{ path: file, name: 'capa-ps5.jpg' }], title: 'x' });
  await idle(batches, created.id);
  await batches.flush();
  const json = path.join(root, 'batches', created.id, 'batch.json');
  const saved = JSON.parse(await readFile(json, 'utf8'));
  delete saved.v; saved.label = 'immediate';
  for (const item of saved.items) delete item.labels;
  await writeFile(json, JSON.stringify(saved));
  const reopened = await new Batches(root, kit).init();
  const batch = reopened.get(created.id);
  assert.equal(batch.label, 'auto');
  assert.equal(reopened.summary(batch).modified, false);
  assert.deepEqual(reopened.publicBatch(batch).items[0].labels, { PS5: 'access' }, 'frases calculadas já ao abrir');
});

// A pixel of a finished file (fx, fy as fractions of its size), to see which part of the art it kept.
async function centre(root, batch, item, fx = 0.5, fy = 0.5) {
  const { data, info } = await sharp(path.join(root, 'batches', batch.id, 'out', item.outputs[0].name)).raw().toBuffer({ resolveWithObject: true });
  const o = (Math.round(info.height * fy) * info.width + Math.round(info.width * fx)) * info.channels;
  return { size: [info.width, info.height], rgb: [data[o], data[o + 1], data[o + 2]] };
}
const isRed = ([r, , b]) => r > 150 && b < 100, isBlue = ([r, , b]) => b > 150 && r < 100;

test('formato do lote e da capa, enquadramento à mão por formato e desfazer', async () => {
  const { root, batches } = await setup('batch-frame');
  const file = path.join(root, 'larga.png'); await writeFile(file, await halves(3000, 1000));
  const created = await batches.create({ files: [{ path: file, name: 'larga-ps4.png' }], title: 'x' });
  let batch = await idle(batches, created.id);
  const item = batch.items[0];
  assert.deepEqual([item.width, item.height], [3000, 1000], 'padrão do kit: original');
  assert.deepEqual(item.rendered, { format: 'original' });

  await batches.updateBatch(batch.id, { format: '4x5' });
  batch = await idle(batches, batch.id);
  assert.deepEqual((await centre(root, batch, item)).size, [1200, 1500]);
  assert.equal(item.formatSource, 'todas');

  // Framed by hand: the left (red) side of the art.
  await batches.updateItem(batch.id, item.id, { frame: { format: '4x5', x: 0, y: 0.5, zoom: 1 } });
  batch = await idle(batches, batch.id);
  assert.ok(isRed((await centre(root, batch, item)).rgb), 'enquadrada à esquerda');
  assert.deepEqual(item.rendered, { format: '4x5', frame: { x: 0, y: 0.5, zoom: 1 } });

  // Another format for this cover only; the 4:5 framing waits for it to come back.
  await batches.updateItem(batch.id, item.id, { format: '1x1' });
  batch = await idle(batches, batch.id);
  assert.deepEqual((await centre(root, batch, item)).size, [1200, 1200]);
  assert.equal(item.formatSource, 'manual');
  await batches.updateItem(batch.id, item.id, { format: null });
  batch = await idle(batches, batch.id);
  assert.ok(isRed((await centre(root, batch, item)).rgb), 'o enquadramento de 4:5 voltou junto');

  // "Desfazer escolhas" of the batch keeps the handwork; the cover's own reset clears it.
  await batches.updateBatch(batch.id, { format: '4x5', reset: true });
  batch = await idle(batches, batch.id);
  assert.equal(batch.format, 'auto');
  assert.deepEqual(item.frames, { '4x5': { x: 0, y: 0.5, zoom: 1 } });
  await batches.updateBatch(batch.id, { format: '4x5' });
  await batches.updateItem(batch.id, item.id, { reset: true });
  batch = await idle(batches, batch.id);
  assert.deepEqual(item.frames, {});
  assert.ok(isRed((await centre(root, batch, item, 0.25)).rgb) && isBlue((await centre(root, batch, item, 0.75)).rgb), 'de volta ao centro da arte');

  await assert.rejects(batches.updateItem(batch.id, item.id, { frame: { format: 'original', x: 0, y: 0, zoom: 1 } }), /formato com recorte/);
  await assert.rejects(batches.updateItem(batch.id, item.id, { frame: { format: '4x5', x: 'esquerda', y: 0, zoom: 1 } }), /Enquadramento/);
  await assert.rejects(batches.updateBatch(batch.id, { format: '8x10' }), /Formato/);
  await assert.rejects(batches.updateBatch(batch.id, { fit: 'esticar' }), /Encaixe/);
});

test('encaixe "capa inteira" no lote: a arte toda aparece, com faixas desfocadas', async () => {
  const { root, kit, batches } = await setup('batch-fit');
  await kit.update({ output: { size: '4x5' } });
  const file = path.join(root, 'larga.png'); await writeFile(file, await halves(3000, 1000));
  const created = await batches.create({ files: [{ path: file, name: 'larga-ps4.png' }], title: 'x' });
  let batch = await idle(batches, created.id);
  const item = batch.items[0];
  assert.ok(item.flags.some(f => f.code === 'cropped'), 'padrão: preenche e recorta');
  await batches.updateBatch(batch.id, { fit: 'contain' });
  batch = await idle(batches, batch.id);
  assert.ok(!item.flags.some(f => f.code === 'cropped'), 'capa inteira: nada recortado');
  assert.deepEqual(item.rendered, { format: '4x5', fit: 'contain' });
  assert.equal(batches.summary(batch).modified, true);
});

test('capas feitas antes dos formatos não são refeitas ao reabrir', async () => {
  const { root, kit, batches } = await setup('batch-legacy-frame');
  const file = path.join(root, 'capa.jpg'); await writeFile(file, await cover(700, 875));
  const created = await batches.create({ files: [{ path: file, name: 'capa-ps4.jpg' }], title: 'x' });
  await idle(batches, created.id);
  await batches.flush();
  const json = path.join(root, 'batches', created.id, 'batch.json');
  const saved = JSON.parse(await readFile(json, 'utf8'));
  delete saved.format; delete saved.fit;
  for (const item of saved.items) { delete item.rendered; delete item.frames; }
  await writeFile(json, JSON.stringify(saved));
  const reopened = await new Batches(root, kit).init();
  const batch = reopened.get(created.id), item = batch.items[0];
  assert.deepEqual([batch.format, batch.fit, item.frames], ['auto', 'auto', {}]);
  assert.equal(reopened.needsRender(item), false);
  reopened.refresh(batch);
  assert.equal(item.status, 'done', 'nada voltou para a fila');
  assert.deepEqual(item.rendered, { format: 'original' });
  // The kit now says 4:5: the file is still in the art's own shape, so it is
  // planned to be redone (with "Aplicar o kit atual") and not passed off as 4:5.
  await kit.update({ output: { size: '4x5' } });
  const later = await new Batches(root, kit).init();
  const stale = later.get(created.id).items[0];
  assert.deepEqual([stale.format, stale.rendered.format, later.needsRender(stale)], ['4x5', 'original', true]);
});

test('capa 1200 × 1500 da v1.1 (recorte automático): fica como está e o editor sempre a refaz', async () => {
  const { root, kit, batches } = await setup('batch-legacy-store');
  await kit.update({ output: { size: '4x5' } });
  const file = path.join(root, 'larga.png'); await writeFile(file, await halves(3000, 1000));
  const created = await batches.create({ files: [{ path: file, name: 'larga-ps4.png' }], title: 'x' });
  await idle(batches, created.id);
  await batches.flush();
  const json = path.join(root, 'batches', created.id, 'batch.json');
  const saved = JSON.parse(await readFile(json, 'utf8'));
  delete saved.format; delete saved.fit;
  for (const item of saved.items) { delete item.rendered; delete item.frames; }
  await writeFile(json, JSON.stringify(saved));
  const reopened = await new Batches(root, kit).init();
  let batch = reopened.get(created.id);
  const item = batch.items[0];
  assert.deepEqual(item.rendered, { format: '4x5', fit: 'cover', legacy: true });
  assert.equal(reopened.needsRender(item), false, 'aberta como está');
  // The editor's "Aplicar" on the new default placement: the file must be redone.
  await reopened.updateItem(batch.id, item.id, { frame: { format: '4x5', reset: true } });
  batch = await idle(reopened, batch.id);
  assert.deepEqual(item.rendered, { format: '4x5', fit: 'cover' }, 'refeita pelas regras novas');
});
