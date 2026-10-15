import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createApp } from '../server.js';
import { writeZip, readZip } from '../lib/zip.js';
import { cover, tempDir, testLogo, waitFor } from './helpers.js';

async function start() {
  const root = await tempDir('server');
  const opened = [];
  const { app } = await createApp(path.join(root, 'dados'), { open: dir => opened.push(dir) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await fetch(`${base}/api/session`).then(r => r.json());
  const stop = () => new Promise(r => { server.closeAllConnections(); server.close(r); });
  return { root, base, token, opened, stop, port: server.address().port };
}

test('servidor local recusa outros hosts, outras origens e escrita sem token', async () => {
  const s = await start();
  try {
    const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: s.port, path: '/api/session', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
    assert.equal(status, 403);
    assert.equal((await fetch(`${s.base}/api/kit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-local-token': s.token, Origin: 'https://example.org' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/kit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/batches/../../kit.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/api/batches/00000000-0000-0000-0000-000000000000`)).status, 404);
    const page = await fetch(`${s.base}/`);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(`${s.base}/fonts/selo-bold.ttf`)).status, 200);
  } finally { await s.stop(); }
});

test('fluxo completo: logo, ZIP solto, eventos ao vivo, imagem, ZIP final e pasta', async () => {
  const s = await start();
  try {
    const logo = new FormData(); logo.append('file', new Blob([await testLogo()]), 'TESTE-logo.png');
    const kit = await fetch(`${s.base}/api/kit/logo`, { method: 'PUT', headers: { 'x-local-token': s.token }, body: logo }).then(r => r.json());
    assert.deepEqual([kit.logo.width, kit.logo.height], [220, 50]);
    const bad = new FormData(); bad.append('file', new Blob([await cover(100, 100)]), 'logo.jpg');
    const refused = await fetch(`${s.base}/api/kit/logo`, { method: 'PUT', headers: { 'x-local-token': s.token }, body: bad });
    assert.equal(refused.status, 400); assert.match((await refused.json()).error, /transparente/);

    const zip = path.join(s.root, 'capas.zip');
    await writeZip(zip, [{ name: 'PS5/jogo.jpg', bytes: await cover(1080, 1350) }, { name: 'outro-ps4.webp', bytes: await cover(900, 900, '#345', 'webp') }]);
    const form = new FormData();
    form.append('files', new Blob([await readFile(zip)]), 'capas.zip');
    form.append('paths', JSON.stringify(['Pasta/capas.zip'])); form.append('title', 'capas.zip');
    const created = await fetch(`${s.base}/api/batches`, { method: 'POST', headers: { 'x-local-token': s.token }, body: form }).then(r => r.json());

    // The live stream opens with a full snapshot.
    const events = await fetch(`${s.base}/api/batches/${created.id}/events`);
    const reader = events.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^event: snapshot/);
    await reader.cancel();

    const batch = await waitFor(async () => { const b = await fetch(`${s.base}/api/batches/${created.id}`).then(r => r.json()); return b.status === 'done' && b; });
    assert.equal(batch.counts.outputs, 2);
    const item = batch.items.find(i => i.source === 'PS5/jogo.jpg');
    assert.deepEqual(item.outputs.map(o => o.name), ['jogo-ps5.jpg']);
    const image = await fetch(`${s.base}/api/batches/${created.id}/items/${item.id}/output/PS5?download`);
    assert.match(image.headers.get('content-disposition'), /jogo-ps5\.jpg/);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 1080);
    assert.equal((await fetch(`${s.base}/api/batches/${created.id}/items/${item.id}/thumb/orig`)).status, 200);

    const zipResponse = await fetch(`${s.base}/api/batches/${created.id}/zip`);
    assert.match(zipResponse.headers.get('content-disposition'), /capas-com-selo\.zip/);
    const out = path.join(s.root, 'saida.zip');
    await (await import('node:fs/promises')).writeFile(out, Buffer.from(await zipResponse.arrayBuffer()));
    const names = []; await readZip(out, n => names.push(n));
    assert.deepEqual(names.sort(), ['jogo-ps5.jpg', 'outro-ps4.jpg']);

    assert.equal((await fetch(`${s.base}/api/batches/${created.id}/open`, { method: 'POST', headers: { 'x-local-token': s.token } })).status, 200);
    assert.ok(s.opened[0].endsWith(path.join(created.id, 'out')));

    const sample = await fetch(`${s.base}/api/kit/sample.jpg?ratio=16x9&w=320&platform=PS5`);
    assert.equal(sample.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Object.values(await sharp(Buffer.from(await sample.arrayBuffer())).metadata()).length > 0, true);
    const sticker = await fetch(`${s.base}/api/kit/sticker.png?platform=PS5&h=48`);
    assert.equal((await sharp(Buffer.from(await sticker.arrayBuffer())).metadata()).height, 48);

    assert.equal((await fetch(`${s.base}/api/batches/${created.id}`, { method: 'DELETE', headers: { 'x-local-token': s.token } })).status, 200);
    assert.equal((await fetch(`${s.base}/api/batches/${created.id}`)).status, 404);
  } finally { await s.stop(); }
});

test('restaurar o kit pela API, amostras da logo e pasta de dados', async () => {
  const s = await start();
  const post = (url, json) => fetch(`${s.base}${url}`, { method: json === undefined ? 'POST' : 'POST', headers: { 'x-local-token': s.token, 'Content-Type': 'application/json' }, body: JSON.stringify(json ?? {}) });
  try {
    const session = await fetch(`${s.base}/api/session`).then(r => r.json());
    assert.equal(session.system.platform, process.platform);
    assert.ok(session.system.dataDir.endsWith('dados'));
    assert.equal((await fetch(`${s.base}/api/kit/logo-swatch.png?bg=light`)).status, 404, 'sem logo, sem amostra');
    const logo = new FormData(); logo.append('file', new Blob([await testLogo()]), 'TESTE-logo.png');
    await fetch(`${s.base}/api/kit/logo`, { method: 'PUT', headers: { 'x-local-token': s.token }, body: logo });
    const swatch = await fetch(`${s.base}/api/kit/logo-swatch.png?bg=dark`);
    assert.equal(swatch.headers.get('content-type'), 'image/png');

    const changed = await fetch(`${s.base}/api/kit`, { method: 'PATCH', headers: { 'x-local-token': s.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: { stickerHeight: 120 }, output: { phrase: { PS5: 'access' } } }) }).then(r => r.json());
    assert.deepEqual(changed.changed, { logo: false, sticker: false, layout: true, output: true });
    const partial = await post('/api/kit/restore', { section: 'layout' }).then(r => r.json());
    assert.equal(partial.layout.stickerHeight, 96); assert.equal(partial.changed.output, true);
    assert.equal((await post('/api/kit/restore', { section: 'tudo' })).status, 400);
    const all = await post('/api/kit/restore').then(r => r.json());
    assert.equal(all.output.phrase.PS5, 'immediate');
    assert.equal((await fetch(`${s.base}/api/kit/restore`, { method: 'POST' })).status, 403, 'restaurar exige o token da sessão');

    assert.equal((await post('/api/data/open')).status, 200);
    assert.equal(s.opened.at(-1), session.system.dataDir);
  } finally { await s.stop(); }
});
