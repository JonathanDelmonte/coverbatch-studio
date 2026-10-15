import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFor, sanitizeLayout, DEFAULT_LAYOUT } from '../lib/layout.js';
import { STICKER_ASPECT } from '../lib/sticker.js';

const LOGO = 164 / 61;

test('na capa de referência 1200 × 1500 o selo e a logo caem exatamente onde a loja posiciona', () => {
  const g = layoutFor(1200, 1500, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: LOGO });
  assert.deepEqual(g.sticker, { left: 70, top: 1349, width: 655, height: 96 });
  assert.equal(g.logo.left + g.logo.width, 1161);
  assert.equal(g.logo.height, 62);
  assert.ok(Math.abs((g.logo.top + g.logo.height / 2) - (g.sticker.top + 48 - 5)) <= 1);
  assert.equal(g.scale, 1);
});

test('qualquer proporção: tudo dentro da capa, sem sobreposição, peso visual estável', () => {
  const sizes = [[600, 800], [1000, 1000], [1920, 1080], [1080, 1920], [800, 1600], [3000, 1000], [320, 400], [4000, 5000], [1200, 1200], [2560, 1080]];
  for (const [w, h] of sizes) {
    const g = layoutFor(w, h, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: LOGO });
    for (const box of [g.sticker, g.logo]) {
      assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= w && box.top + box.height <= h, `${w}×${h} dentro`);
    }
    assert.ok(g.sticker.left + g.sticker.width < g.logo.left, `${w}×${h} sem sobrepor`);
    assert.ok(g.sticker.height <= 0.14 * h + 1, `${w}×${h} selo proporcional à altura`);
    const area = (g.sticker.width * g.sticker.height) / (w * h);
    assert.ok(area > 0.012 && area < 0.05, `${w}×${h} área do selo ${area.toFixed(4)}`);
  }
});

test('capas maiores recebem selo maior na mesma proporção; logo muito larga é limitada', () => {
  const small = layoutFor(600, 750, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: LOGO });
  const big = layoutFor(2400, 3000, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: LOGO });
  assert.ok(Math.abs(big.sticker.width / small.sticker.width - 4) < 0.02);
  const wide = layoutFor(1200, 1500, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: 12 });
  assert.ok(wide.logo.width <= 260 && wide.logo.height < 62, JSON.stringify(wide.logo));
  assert.ok(Math.abs(wide.logo.width / wide.logo.height - 12) < 0.6, 'proporção da logo mantida');
  assert.equal(layoutFor(1200, 1500, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT }).logo, null);
});

test('ajustes do kit são limitados a faixas seguras', () => {
  const l = sanitizeLayout({ stickerHeight: 999, stickerLeft: -5, logoShiftY: 12.34 });
  assert.equal(l.stickerHeight, 160); assert.equal(l.stickerLeft, 0); assert.equal(l.logoShiftY, 12.3);
  assert.throws(() => sanitizeLayout({ logoHeight: 'abc' }), /inválido/);
});

test('logo padronizada pela área: quadrada ou larga, o mesmo peso visual da logo da referência', () => {
  const at = aspect => layoutFor(1200, 1500, DEFAULT_LAYOUT, { stickerAspect: STICKER_ASPECT, logoAspect: aspect }).logo;
  const reference = at(LOGO), area = box => box.width * box.height;
  for (const aspect of [1.6, 2, 3.5, 4.4]) {
    const box = at(aspect);
    assert.ok(Math.abs(area(box) / area(reference) - 1) < 0.04, `proporção ${aspect}: área ${area(box)} contra ${area(reference)}`);
    assert.ok(Math.abs((box.top + box.height / 2) - (reference.top + reference.height / 2)) <= 1, 'mesma linha de centro');
    assert.equal(box.left + box.width, reference.left + reference.width, 'mesma margem direita');
  }
  // Square and tall logos stop at about the sticker's height.
  assert.ok(at(1).height <= 93 && at(0.4).height <= 93);
});
