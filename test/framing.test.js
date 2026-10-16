import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { FORMATS, FORMAT_KEYS, MAX_ZOOM, placeArt, sanitizeFrame, normalizeFormat, defaultFrame } from '../lib/framing.js';
import { prepareBase } from '../lib/compose.js';
import { halves, pngHeader } from './helpers.js';

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);
const at = (base, x, y) => { const o = (y * base.info.width + x) * base.info.channels; return [...base.data.subarray(o, o + 3)]; };
const red = ([r, g, b]) => r > 150 && b < 100 && g < 100;
const blue = ([r, g, b]) => b > 150 && r < 100 && g < 100;

test('zoom 1 preenche o quadro, o menor zoom mostra a arte inteira, x e y alinham como object-position', () => {
  const fill = placeArt(2000, 2000, 1200, 1500);
  near(fill.width, 1500, 'largura ao preencher'); near(fill.height, 1500, 'altura ao preencher');
  near(fill.left, -150, 'centralizada'); near(fill.top, 0, 'sem sobra vertical');
  near(placeArt(2000, 2000, 1200, 1500, { x: 0 }).left, 0, 'x 0 alinha à esquerda');
  near(placeArt(2000, 2000, 1200, 1500, { x: 1 }).left, -300, 'x 1 alinha à direita');
  const whole = placeArt(2000, 2000, 1200, 1500, defaultFrame('contain'));
  near(whole.zoom, 0.8, 'zoom da arte inteira'); near(whole.width, 1200, 'largura inteira');
  near(whole.top, 150, 'faixas iguais em cima e embaixo');
  near(placeArt(2000, 2000, 1200, 1500, { zoom: 0, y: 1 }).top, 300, 'y 1 encosta a arte embaixo');
  assert.equal(placeArt(2000, 2000, 1200, 1500, { zoom: 99 }).zoom, MAX_ZOOM);
  assert.equal(placeArt(2000, 2000, 1200, 1500, { zoom: 'x', x: 'y' }).zoom, 1, 'valores estranhos voltam ao padrão');
  assert.equal(placeArt(2000, 2000, 1200, 1500, { x: -3 }).x, 0);
});

test('formatos: "store" da v1.1 vira 4:5; enquadramentos só com números dentro da faixa', () => {
  assert.equal(normalizeFormat('store'), '4x5');
  assert.equal(normalizeFormat('8x10'), null);
  assert.deepEqual(sanitizeFrame({ x: 1.7, y: -2, zoom: '1.23456' }), { x: 1, y: 0, zoom: 1.2346 });
  assert.equal(sanitizeFrame({ x: 0.5, y: 0.5, zoom: 40 }).zoom, MAX_ZOOM);
  assert.throws(() => sanitizeFrame({ x: 'a', y: 0, zoom: 1 }), /Enquadramento/);
  assert.throws(() => sanitizeFrame({ x: null, y: 0, zoom: 1 }), /Enquadramento/);
  assert.throws(() => sanitizeFrame(null), /Enquadramento/);
});

test('cada formato fixo sai no seu tamanho; Original mantém a imagem como veio', async () => {
  const source = await halves(3000, 1000);
  for (const key of FORMAT_KEYS.filter(k => k !== 'original')) {
    const base = await prepareBase(source, { size: key });
    assert.deepEqual([base.info.width, base.info.height], [FORMATS[key].width, FORMATS[key].height], key);
  }
  const legacy = await prepareBase(source, { size: 'store' });
  assert.deepEqual([legacy.info.width, legacy.info.height], [1200, 1500]);
  const original = await prepareBase(source);
  assert.deepEqual([original.info.width, original.info.height, original.notes.length], [3000, 1000, 0]);
});

test('o enquadramento escolhe o pedaço da arte; a arte inteira ganha faixas de fundo desfocado', async () => {
  // Left half red, right half blue: in 4:5 the art is 4500 px wide at zoom 1.
  const source = await halves(3000, 1000);
  const left = await prepareBase(source, { size: '4x5', frame: { x: 0, y: 0.5, zoom: 1 } });
  assert.ok(red(at(left, 600, 750)), 'x 0 mostra o lado esquerdo');
  assert.ok(left.notes.some(n => n.code === 'cropped'));
  const right = await prepareBase(source, { size: '4x5', frame: { x: 1, y: 0.5, zoom: 1 } });
  assert.ok(blue(at(right, 600, 750)), 'x 1 mostra o lado direito');

  // Whole art: 1200 × 400 in the middle, bands above and below.
  const whole = await prepareBase(source, { size: '4x5', fit: 'contain' });
  assert.ok(red(at(whole, 300, 750)) && blue(at(whole, 900, 750)), 'a arte inteira no meio');
  assert.ok(!whole.notes.some(n => n.code === 'cropped'), 'nada recortado');
  const [r1, , b1] = at(whole, 80, 120), [r2, , b2] = at(whole, 1120, 1380);
  assert.ok(r1 > b1 + 40 && b2 > r2 + 40, 'faixas com as cores da própria arte');
  const top = at(whole, 600, 300), artEdge = at(whole, 600, 560);
  assert.notDeepEqual(top, artEdge, 'a faixa não é a arte');

  // Pushed to the top, the whole bottom band is free (where the sticker goes).
  const up = await prepareBase(source, { size: '4x5', frame: { x: 0.5, y: 0, zoom: 0 } });
  assert.ok(red(at(up, 300, 200)) && blue(at(up, 900, 200)), 'arte encostada em cima');
  const [r, , b] = at(up, 600, 1300);
  assert.ok(r > 50 && b > 50, 'embaixo, o fundo desfocado mistura as cores da arte');
});

test('arte já no formato do quadro não é recortada nem ganha faixas; transparência não quebra', async () => {
  const exact = await prepareBase(await halves(1200, 1500), { size: '4x5', fit: 'contain' });
  assert.deepEqual([exact.info.width, exact.info.height, exact.notes.length], [1200, 1500, 0]);
  const png = await sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 30, g: 60, b: 200, alpha: 0.5 } } }).png().toBuffer();
  const framed = await prepareBase(png, { size: '1x1', fit: 'contain' });
  assert.deepEqual([framed.info.width, framed.info.height], [1200, 1200]);
  assert.ok(framed.notes.some(n => n.code === 'upscaled'), 'arte pequena ampliada avisa');
});

test('avisos: ampliação forte vira "resolução baixa"; recortes mínimos não viram aviso', async () => {
  const blurry = await prepareBase(await halves(300, 300), { size: '4x5' });
  assert.ok(blurry.notes.some(n => n.code === 'low-res' && /ampliada 5 vezes/.test(n.text)), JSON.stringify(blurry.notes));
  assert.ok(!blurry.notes.some(n => n.code === 'upscaled'), 'um aviso só');
  const zoomed = await prepareBase(await halves(1600, 2000), { size: '4x5', frame: { x: 0.5, y: 0.5, zoom: 3 } });
  assert.ok(zoomed.notes.some(n => n.code === 'low-res'), 'zoom forte também conta');
  const slight = await prepareBase(await halves(1200, 1520), { size: '4x5' });
  assert.deepEqual(slight.notes, [], 'recorte de 1% não é aviso');
});

test('imagens fora dos limites são recusadas com mensagem clara', async () => {
  await assert.rejects(prepareBase(await halves(40, 3000)), /pequena demais para o selo \(40 × 3000\)/);
  const sliver = await prepareBase(await halves(40, 3000), { size: '4x5' });
  assert.deepEqual([sliver.info.width, sliver.info.height], [1200, 1500], 'num formato fixo a capa sai');
  for (const size of ['original', '4x5']) await assert.rejects(prepareBase(pngHeader(9000, 9000), { size }), /grande demais \(9000 × 9000\)/);
  await assert.rejects(prepareBase(Buffer.from('não é imagem')), /ilegível/);
});
