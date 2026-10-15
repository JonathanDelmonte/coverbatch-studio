import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderSticker, stickerSVG, normalizeLabelText, schemeFor, STICKER } from '../lib/sticker.js';
import { pixel } from './helpers.js';

const raw = async options => sharp(await renderSticker({ width: 655, height: 96, ...options })).raw().toBuffer({ resolveWithObject: true });
const count = (img, test, [x0, y0, x1, y1]) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * img.info.width + x) * 4; if (test(img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3])) n++; } return n; };
const MARK = [15, 31, 161, 63], BODY_TEXT = [210, 30, 625, 67];

test('PS4 oficial: bloco azul, pílula branca, cantos transparentes e inclinação da referência', async () => {
  const png = await renderSticker({ platform: 'PS4', width: STICKER.width, height: STICKER.height });
  assert.deepEqual([(await sharp(png).metadata()).width, (await sharp(png).metadata()).height], [655, 96]);
  assert.deepEqual((await pixel(png, 40, 15)).slice(0, 3), [29, 106, 178]);
  assert.deepEqual((await pixel(png, 645, 48)).slice(0, 3), [255, 255, 255]);
  assert.equal((await pixel(png, 0, 0))[3], 0);
  assert.deepEqual((await pixel(png, 178, 4)).slice(0, 3), [29, 106, 178]);
  assert.deepEqual((await pixel(png, 178, 90)).slice(0, 3), [255, 255, 255]);
});

test('PS5 oficial é o inverso: bloco branco com logotipo preto, pílula preta com texto branco', async () => {
  const png = await renderSticker({ platform: 'PS5', width: 655, height: 96 });
  assert.deepEqual((await pixel(png, 40, 15)).slice(0, 3), [255, 255, 255]);
  assert.deepEqual((await pixel(png, 645, 48)).slice(0, 3), [0, 0, 0]);
  assert.deepEqual((await pixel(png, 178, 4)).slice(0, 3), [255, 255, 255]);
  assert.deepEqual((await pixel(png, 178, 90)).slice(0, 3), [0, 0, 0]);
  const ps5 = await raw({ platform: 'PS5' }), ps4 = await raw({ platform: 'PS4' });
  assert.ok(count(ps5, (r, g, b) => r < 60 && g < 60 && b < 60, MARK) > 600, 'logotipo PS5 preto desenhado');
  assert.ok(count(ps4, (r, g, b) => r > 200 && g > 200 && b > 200, MARK) > 600, 'logotipo PS4 branco desenhado');
  assert.ok(count(ps5, (r, g, b) => r > 200 && g > 200 && b > 200, BODY_TEXT) > 4000, 'texto branco no PS5');
  assert.ok(count(ps4, (r, g, b) => r < 60 && g < 60 && b < 60, BODY_TEXT) > 4000, 'texto preto no PS4');
});

test('as três frases cabem com margem nas duas plataformas; texto sempre em curvas', async () => {
  assert.ok(!stickerSVG({ platform: 'PS5' }).includes('<text'));
  for (const platform of ['PS4', 'PS5']) for (const [regular, bold] of [['ENVIO', 'IMEDIATO'], ['ACESSO', 'IMEDIATO'], ['', 'PRÉ-VENDA'], ['ENVIO SUPER', 'IMEDIATÍSSIMO JÁ']]) {
    const img = await raw({ platform, regular, bold });
    const body = platform === 'PS4' ? 255 : 0;
    for (let y = 0; y < 96; y++) for (const x of [636, 648]) {
      const o = (y * 655 + x) * 4;
      assert.ok(img.data[o + 3] < 255 || Math.abs(img.data[o] - body) < 40, `${platform} ${regular} ${bold}: margem direita livre`);
    }
  }
  assert.equal(normalizeLabelText('  acesso\n imediato  '), 'ACESSO IMEDIATO');
  assert.equal(normalizeLabelText('x'.repeat(40)).length, 24);
});

test('cores próprias são validadas; plataforma inválida recusada; render determinístico', async () => {
  assert.deepEqual(schemeFor('PS5', { block: '#123456' }), { block: '#123456', mark: '#000000', body: '#000000', text: '#FFFFFF' });
  assert.throws(() => schemeFor('PS4', { text: 'preto' }), /Cor/);
  assert.throws(() => stickerSVG({ platform: 'Switch' }), /Plataforma/);
  const one = await renderSticker({ platform: 'PS5', width: 300 }), two = await renderSticker({ platform: 'PS5', width: 300 });
  assert.ok(one.equals(two));
});
