// Placement of the sticker and the logo on a cover of any size.
//
// Every distance lives in "reference units": pixels of the 1200 × 1500 cover the
// store designed by hand. A cover is mapped to that reference by the square root
// of its area ratio, so the stamp keeps the same visual weight on portrait,
// square and landscape art, then the scale is clamped so both elements always fit.
export const REFERENCE = Object.freeze({ width: 1200, height: 1500 });

export const DEFAULT_LAYOUT = Object.freeze({
  stickerHeight: 96, stickerLeft: 70, stickerBottom: 55,
  logoHeight: 62, logoRight: 39, logoShiftY: -5,
});

export const LAYOUT_LIMITS = Object.freeze({
  stickerHeight: [48, 160], stickerLeft: [0, 200], stickerBottom: [0, 200],
  logoHeight: [20, 160], logoRight: [0, 200], logoShiftY: [-60, 60],
});

// The store's logo measures 164 × 61 on the reference cover. A logo of another
// shape is sized by area against it, so a square or a very wide logo keeps the
// same visual weight instead of the same height.
export const REFERENCE_LOGO_ASPECT = 164 / 61;

const MIN_GAP = 32;              // between the sticker and the logo
const MAX_LOGO_WIDTH = 260;      // a very wide logo shrinks instead of crowding the sticker
const MAX_LOGO_GROWTH = 1.5;     // a tall logo stops at 1.5 × logoHeight, about the sticker's height
const MAX_STICKER_SHARE = 0.14;  // of the cover height, for panoramic covers

export function layoutFor(width, height, layout = DEFAULT_LAYOUT, { stickerAspect, logoAspect = 0 } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('Dimensões inválidas.');
  if (!(stickerAspect > 0)) throw new Error('Proporção do selo inválida.');
  const L = { ...DEFAULT_LAYOUT, ...layout };
  const stickerW = L.stickerHeight * stickerAspect;
  let logoH = logoAspect > 0 ? Math.min(L.logoHeight * Math.sqrt(REFERENCE_LOGO_ASPECT / logoAspect), L.logoHeight * MAX_LOGO_GROWTH) : 0;
  const widthCapped = logoH * logoAspect > MAX_LOGO_WIDTH;
  if (widthCapped) logoH = MAX_LOGO_WIDTH / logoAspect;
  const logoW = logoH * logoAspect;
  const needed = L.stickerLeft + stickerW + (logoW ? MIN_GAP + logoW + L.logoRight : L.stickerLeft);

  let scale = Math.sqrt((width * height) / (REFERENCE.width * REFERENCE.height));
  scale = Math.min(scale, width / needed, (MAX_STICKER_SHARE * height) / L.stickerHeight);

  const sh = Math.max(1, Math.round(L.stickerHeight * scale));
  const sw = Math.max(1, Math.round(sh * stickerAspect));
  const sticker = { left: Math.round(L.stickerLeft * scale), top: height - Math.round(L.stickerBottom * scale) - sh, width: sw, height: sh };

  let logo = null;
  if (logoW) {
    // Round the governing dimension first so a width cap still holds after rounding.
    const scaledH = Math.round(logoH * scale);
    const lw = Math.max(1, widthCapped ? Math.round(logoW * scale) : Math.round(scaledH * logoAspect));
    const lh = Math.max(1, widthCapped ? Math.round(lw / logoAspect) : scaledH);
    const centerY = sticker.top + sh / 2 + L.logoShiftY * scale;
    logo = { left: width - Math.round(L.logoRight * scale) - lw, top: Math.round(centerY - lh / 2), width: lw, height: lh };
    logo.top = Math.min(Math.max(0, logo.top), height - lh);
  }
  sticker.top = Math.max(0, sticker.top);
  return { scale, sticker, logo };
}

export function sanitizeLayout(input = {}) {
  const out = {};
  for (const [key, [low, high]] of Object.entries(LAYOUT_LIMITS)) {
    const value = Number(input[key] ?? DEFAULT_LAYOUT[key]);
    if (!Number.isFinite(value)) throw new Error('Posição ou tamanho inválido.');
    out[key] = Math.min(high, Math.max(low, Math.round(value * 10) / 10));
  }
  return out;
}
