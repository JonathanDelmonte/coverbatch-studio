import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Kit } from '../lib/kit.js';
import { prepareBase, composeOutput, geometryFor } from '../lib/compose.js';
import { findExistingSticker } from '../lib/detect.js';
import { tempDir, testLogo } from './helpers.js';

const flat = color => sharp({ create: { width: 1200, height: 1500, channels: 3, background: color } }).png().toBuffer();
async function setup() {
  const kit = await new Kit(await tempDir('compose')).load();
  await kit.setLogo(await testLogo(), 'TESTE.png');
  return { kit, assets: await kit.assets() };
}
// Darkest pixel just below the logo, where only a shadow could darken the cover.
async function belowLogo(bytes, logo) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  let min = 255;
  for (let x = logo.left; x < logo.left + logo.width; x++) min = Math.min(min, data[((logo.top + logo.height + 3) * info.width + x) * info.channels]);
  return min;
}

test('logo branca ganha sombra suave só onde a capa é clara', async () => {
  const { kit, assets } = await setup();
  const light = await prepareBase(await flat('#f4f4f4')), dark = await prepareBase(await flat('#202020'));
  const onLight = await composeOutput(light, { kit: kit.data, assets, platform: 'PS4' });
  assert.ok(await belowLogo(onLight.bytes, onLight.geometry.logo) < 225, 'sombra visível na capa clara');
  const onDark = await composeOutput(dark, { kit: kit.data, assets, platform: 'PS4' });
  assert.ok(await belowLogo(onDark.bytes, onDark.geometry.logo) >= 30, 'capa escura sem sombra');
  await kit.update({ logoShadow: false });
  const off = await composeOutput(light, { kit: kit.data, assets: await kit.assets(), platform: 'PS4' });
  assert.ok(await belowLogo(off.bytes, off.geometry.logo) > 238, 'sombra desligada no kit');
});

test('detecta selo PS5 (preto) já aplicado, além do PS4', async () => {
  const { kit, assets } = await setup();
  const base = await prepareBase(await flat('#5a6b7c'));
  const stamped = await composeOutput(base, { kit: kit.data, assets, platform: 'PS5', label: 'access' });
  const expected = geometryFor(base, kit.data, assets, 'PS5').sticker;
  assert.equal((await findExistingSticker(stamped.bytes, expected)).found, true);
  assert.equal((await findExistingSticker(base, expected)).found, false);
});

test('amostra da logo no kit usa o mesmo compositor: sombra só no fundo claro', async () => {
  const { assets } = await setup();
  const { logoSwatch } = await import('../lib/compose.js');
  const darkest = async bg => { const { data } = await sharp(await logoSwatch(assets, { background: bg })).removeAlpha().raw().toBuffer({ resolveWithObject: true }); let min = 255; for (let o = 0; o < data.length; o += 3) min = Math.min(min, data[o]); return min; };
  assert.ok(await darkest('#ecebe6') < 200, 'fundo claro ganha sombra');
  assert.equal(await darkest('#1d232a'), 0x1d, 'fundo escuro intacto');
  assert.equal(await logoSwatch({ logo: null }), null);
});
