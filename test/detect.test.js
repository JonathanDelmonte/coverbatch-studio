import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { platformHint, platformsIn, baseSlug, findExistingSticker } from '../lib/detect.js';
import { Kit } from '../lib/kit.js';
import { prepareBase, composeOutput, geometryFor } from '../lib/compose.js';
import { cover, tempDir, testLogo } from './helpers.js';

test('plataforma vem do nome do arquivo, depois das pastas, depois do nome do ZIP', () => {
  assert.deepEqual(platformHint('FC 27 (PS4).png'), { platforms: ['PS4'], from: 'nome' });
  assert.deepEqual(platformHint('PS5/god-of-war.jpg'), { platforms: ['PS5'], from: 'pasta' });
  assert.deepEqual(platformHint('Capas/PlayStation 4/x.jpg'), { platforms: ['PS4'], from: 'pasta' });
  assert.deepEqual(platformHint('PS4/gta-ps5.jpg'), { platforms: ['PS5'], from: 'nome' }); // the file wins
  assert.deepEqual(platformHint('jogos/fifa.png', 'lote-ps5.zip'), { platforms: ['PS5'], from: 'lote' });
  assert.deepEqual(platformHint('fifa.png'), { platforms: [], from: null });
  assert.deepEqual(platformsIn('gta-ps4-ps5'), ['PS4', 'PS5']);
  assert.deepEqual(platformsIn('ps4+ps5'), ['PS4', 'PS5']);
  for (const miss of ['ps45.png', 'eps4x.png', 'maps5.png', 'ps 3']) assert.deepEqual(platformsIn(miss), [], miss);
});

test('nomes de saída são limpos, sem a plataforma duplicada e seguros no Windows', () => {
  assert.equal(baseSlug('EA SPORTS FC 27 (PS4).png'), 'ea-sports-fc-27');
  assert.equal(baseSlug('pasta/God of War Ragnarök – PS5.jpeg'), 'god-of-war-ragnarok');
  assert.equal(baseSlug('CON.jpg'), '_con');
  assert.equal(baseSlug('PS4.jpg'), 'capa');
  assert.equal(baseSlug('../../segredo.png'), 'segredo');
});

test('detecta capa que já tem o selo, inclusive deslocado ou reduzido; capas limpas passam', async () => {
  const root = await tempDir('detect');
  const kit = await new Kit(root).load();
  await kit.setLogo(await testLogo(), 'TESTE.png');
  const assets = await kit.assets();
  const clean = await prepareBase(await cover(1200, 1500));
  const expected = geometryFor(clean, kit.data, assets, 'PS4').sticker;
  assert.equal((await findExistingSticker(clean, expected)).found, false);
  const stamped = await composeOutput(clean, { kit: kit.data, assets, platform: 'PS4' });
  const found = await findExistingSticker(stamped.bytes, expected);
  assert.ok(found.found && found.score > 0.85, `score ${found.score}`);
  // Stamped, then resized by someone else: the expected box scales with the cover.
  const sharp = (await import('sharp')).default;
  const smaller = await sharp(stamped.bytes).resize(600, 750).jpeg().toBuffer();
  const base = await prepareBase(smaller);
  assert.ok((await findExistingSticker(base, geometryFor(base, kit.data, assets, 'PS4').sticker)).found);
  assert.ok(path.isAbsolute(root));
});
