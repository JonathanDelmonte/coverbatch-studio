import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Kit, normalizeOverlay, defaultKit } from '../lib/kit.js';
import { seedProfile } from '../lib/profile.js';
import { writeZip } from '../lib/zip.js';
import { sha256 } from '../lib/files.js';
import { cover, tempDir, testLogo } from './helpers.js';

test('logo: margens transparentes são cortadas; JPEG, PNG opaco e SVG com recursos externos são recusados', async () => {
  const trimmed = await normalizeOverlay(await testLogo(), { what: 'logo' });
  assert.deepEqual([trimmed.width, trimmed.height], [220, 50]);
  await assert.rejects(normalizeOverlay(await cover(200, 100), { what: 'logo' }), /transparente/);
  await assert.rejects(normalizeOverlay(await sharp({ create: { width: 20, height: 20, channels: 4, background: '#fff' } }).png().toBuffer(), { what: 'logo' }), /transparente/);
  await assert.rejects(normalizeOverlay(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="file:///C:/Windows/win.ini" width="10" height="10"/></svg>')), /SVG/);
  await assert.rejects(normalizeOverlay(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()" width="10" height="10"/>')), /SVG/);
  const svg = await normalizeOverlay(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect x="10" y="10" width="180" height="60" fill="#fff"/></svg>'), { what: 'logo' });
  assert.ok(svg.width > 1000, 'SVG rasterizado em alta resolução');
  const opaque = await normalizeOverlay(await sharp({ create: { width: 64, height: 10, channels: 3, background: '#1d6ab2' } }).png().toBuffer(), { allowOpaque: true });
  assert.equal(opaque.opaque, true);
});

test('ajustes validados, revisão incrementa e kit é salvo no disco', async () => {
  const root = await tempDir('kit');
  const kit = await new Kit(root).load();
  const before = kit.revision;
  await kit.update({ sticker: { colors: { PS5: { block: '#101010' } }, labels: { immediate: { regular: 'envio', bold: 'imediato' } } }, layout: { stickerHeight: 120 }, output: { quality: 95, fallback: ['PS5'], phrase: { PS5: 'access' } } });
  assert.equal(kit.revision, before + 1);
  await assert.rejects(kit.update({ sticker: { colors: { PS4: 'azul' } } }), /Cor/);
  await assert.rejects(kit.update({ sticker: { labels: { preorder: { regular: '', bold: '' } } } }), /vazio/);
  await assert.rejects(kit.update({ output: { fallback: ['Xbox'] } }), /Plataforma/);
  const reloaded = await new Kit(root).load();
  assert.deepEqual(reloaded.data.sticker.colors.PS5, { block: '#101010', mark: '#000000', body: '#000000', text: '#FFFFFF' });
  assert.deepEqual(reloaded.data.output.phrase, { PS4: 'immediate', PS5: 'access' });
  assert.deepEqual(reloaded.data.sticker.labels.access, { regular: 'ACESSO', bold: 'IMEDIATO' });
  assert.equal(reloaded.data.sticker.labels.immediate.bold, 'IMEDIATO');
  assert.equal(reloaded.data.layout.stickerHeight, 120);
  assert.deepEqual(reloaded.data.output.fallback, ['PS5']);
});

test('kit exportado leva logo e selos próprios para outro computador', async () => {
  const root = await tempDir('kit-export');
  const kit = await new Kit(path.join(root, 'a')).load();
  await kit.setLogo(await testLogo(), 'TESTE-logo.png');
  await kit.setStickerImage('PS5', await sharp({ create: { width: 300, height: 44, channels: 3, background: '#000' } }).png().toBuffer(), 'TESTE-selo.png');
  await kit.update({ logoOpacity: 0.65, sticker: { mode: 'image' } });
  const zip = path.join(root, 'kit.zip');
  await kit.exportZip(zip);
  const other = await new Kit(path.join(root, 'b')).load();
  await other.importZip(zip);
  assert.equal(other.data.logoOpacity, 0.65);
  assert.equal(other.data.sticker.mode, 'image');
  assert.equal(other.data.sticker.images.PS5.opaque, true);
  assert.equal(sha256(await other.logoBytes()), sha256(await kit.logoBytes()));
  assert.ok(!JSON.stringify(other.data).includes(root), 'sem caminhos de outra máquina');
});

// The v0.x format: project.json + assets/<sha>.bin and template layers.
async function legacyLayers() {
  const banner = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="655" height="108"><rect width="655" height="108" fill="#fff"/><rect y="12" width="180" height="96" fill="#123d8a"/></svg>')).png().toBuffer();
  return { banner, logo: await testLogo() };
}

test('instalação antiga: logo, selos e cor do bloco migram dos modelos v0.x sem tocar no projeto', async () => {
  const root = await tempDir('kit-legacy');
  const { banner, logo } = await legacyLayers();
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const asset = async (id, bytes) => { const file = `${sha256(bytes)}.bin`; await writeFile(path.join(root, 'assets', file), bytes); return { id, name: `${id}.png`, kind: 'layer', file }; };
  const project = {
    version: 1, products: [{ key: 'x' }], profile: { id: 'kabban-teste' },
    assets: [await asset('b4', banner), await asset('lg', logo)],
    templates: ['PS4', 'PS5'].map(platform => ({ id: platform, name: platform, platform, availability: 'immediate', layers: [
      { role: 'banner', assetId: 'b4', anchor: 'bottom-left', width: 0.55, marginX: 0.06, marginY: 0.035, opacity: 1, trimTop: 12 },
      { role: 'logo', assetId: 'lg', anchor: 'bottom-right', width: 0.145, marginX: 0.03, marginY: 0.05, opacity: 0.75 },
    ] })),
  };
  await writeFile(path.join(root, 'project.json'), JSON.stringify(project));
  const kit = await new Kit(root).load();
  assert.ok(kit.data.logo);
  assert.equal(kit.data.logoOpacity, 0.75);
  assert.equal(kit.data.sticker.images.PS4.height, 96, 'margem superior antiga recortada');
  assert.equal(kit.data.sticker.colors.PS4.block, '#123D8A');
  assert.deepEqual(kit.data.sticker.colors.PS5, { block: '#FFFFFF', mark: '#000000', body: '#000000', text: '#FFFFFF' }, 'PS5 oficial');
  assert.equal(kit.data.sticker.mode, 'builtin', 'o selo vetorial continua o padrão');
  assert.equal(kit.data.profileId, 'kabban-teste');
  assert.equal(JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')).products.length, 1);
});

test('perfil privado semeia o kit uma vez (kit.zip ou templates.zip antigo) e preserva edições', async () => {
  const root = await tempDir('profile');
  const { banner, logo } = await legacyLayers();
  const profile = path.join(root, 'perfil'); await mkdir(profile);
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({ version: 1, id: 'teste', title: 'Criador de capas TESTE', developer: 'ZIRTUNO' }));
  await writeFile(path.join(profile, 'developer-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  await writeZip(path.join(profile, 'templates.zip'), [
    { name: 'templates.json', bytes: Buffer.from(JSON.stringify({ version: 1, assets: [{ id: 'b', entry: 'layers/b.png' }, { id: 'l', entry: 'layers/l.png' }], templates: [{ platform: 'PS4', availability: 'immediate', layers: [{ role: 'banner', assetId: 'b' }, { role: 'logo', assetId: 'l', opacity: 1 }] }] })) },
    { name: 'layers/b.png', bytes: banner }, { name: 'layers/l.png', bytes: logo },
  ]);
  const data = path.join(root, 'dados');
  const kit = await new Kit(data).load();
  const seeded = await seedProfile(data, kit, profile);
  assert.equal(seeded.title, 'Criador de capas TESTE');
  assert.equal(seeded.hasDeveloperLogo, true);
  assert.ok(kit.data.logo && kit.data.sticker.images.PS4);
  await kit.update({ logoOpacity: 0.4 });
  await seedProfile(data, kit, profile);
  assert.equal(kit.data.logoOpacity, 0.4, 'edição do cliente preservada');
  assert.equal(defaultKit().sticker.labels.immediate.bold, 'IMEDIATO');
});

test('restaurar original: fábrica volta tudo menos a logo que a loja adicionou', async () => {
  const root = await tempDir('kit-restore');
  const kit = await new Kit(root).load();
  await kit.setLogo(await testLogo(), 'TESTE.png');
  assert.deepEqual(kit.changes(), { logo: false, sticker: false, layout: false, output: false });
  assert.deepEqual((await new Kit(root).load()).changes(), { logo: false, sticker: false, layout: false, output: false }, 'kit lido do disco não parece alterado');
  await kit.update({ logoOpacity: 0.5, layout: { stickerHeight: 130 }, sticker: { labels: { access: { regular: 'ACESSO', bold: 'JÁ' } } }, output: { format: 'png' } });
  assert.deepEqual(kit.changes(), { logo: true, sticker: true, layout: true, output: true });
  const partial = await kit.restore('layout');
  assert.equal(partial.layout.stickerHeight, 96);
  assert.equal(partial.changed.layout, false); assert.equal(partial.changed.output, true);
  const all = await kit.restore();
  assert.deepEqual(all.changed, { logo: false, sticker: false, layout: false, output: false });
  assert.equal(all.logoOpacity, 0.8); assert.equal(all.output.format, 'jpeg'); assert.equal(all.sticker.labels.access.bold, 'IMEDIATO');
  assert.ok(kit.data.logo, 'logo da loja mantida');
  await assert.rejects(kit.restore('tudo'), /Seção/);
});

test('restaurar original: edição privada volta ao kit do perfil, inclusive a logo', async () => {
  const root = await tempDir('kit-restore-profile');
  const source = await new Kit(path.join(root, 'fonte')).load();
  await source.setLogo(await testLogo(), 'TESTE-logo.png');
  await source.update({ logoOpacity: 0.75, output: { phrase: { PS5: 'access' } } });
  const profile = path.join(root, 'perfil'); await mkdir(profile);
  await source.exportZip(path.join(profile, 'kit.zip'));
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({ version: 1, id: 'teste', title: 'TESTE' }));
  const data = path.join(root, 'dados');
  const kit = await new Kit(data).load();
  await seedProfile(data, kit, profile);
  const original = kit.data.logo.sha256;
  await kit.setLogo(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="30" fill="#fff"/></svg>')).png().toBuffer(), 'outra.png');
  await kit.update({ logoOpacity: 0.3, output: { phrase: { PS5: 'immediate' } } });
  assert.equal(kit.changes().logo, true);
  await kit.restore('logo');
  assert.equal(kit.data.logo.sha256, original); assert.equal(kit.data.logoOpacity, 0.75);
  await kit.restore('output');
  assert.equal(kit.data.output.phrase.PS5, 'access');
  // An install seeded before originals were kept rebuilds it from the profile.
  await rm(kit.originalDir, { recursive: true, force: true });
  const reopened = await new Kit(data).load();
  await seedProfile(data, reopened, profile);
  assert.equal(reopened.original.logoOpacity, 0.75);
  assert.equal(reopened.data.logoOpacity, 0.75);
});

test('formato da imagem e encaixe no kit: "store" da v1.1 vira 4:5, valores estranhos recusados', async () => {
  const root = await tempDir('kit-format');
  await writeFile(path.join(root, 'kit.json'), JSON.stringify({ ...defaultKit(), output: { format: 'jpeg', quality: 90, size: 'store', fallback: ['PS4'], phrase: { PS4: 'immediate', PS5: 'access' } } }));
  const kit = await new Kit(root).load();
  assert.deepEqual([kit.data.output.size, kit.data.output.fit, kit.data.output.quality], ['4x5', 'cover', 90]);
  await kit.update({ output: { size: '9x16', fit: 'contain' } });
  assert.deepEqual([kit.data.output.size, kit.data.output.fit], ['9x16', 'contain']);
  await assert.rejects(kit.update({ output: { size: '8x10' } }), /Formato da imagem/);
  await assert.rejects(kit.update({ output: { fit: 'esticar' } }), /Encaixe/);
  await kit.update({ output: { size: 'store' } });
  assert.equal(kit.data.output.size, '4x5');
});
