// How a cover's art fills the finished image. Shared by the engine and by the
// framing editor in the browser (served as /js/framing.js), so what the person
// drags on screen follows exactly the rules that produce the file.

// 'original' keeps the art's own shape and size; every other format is a fixed
// frame the art is placed into. 4:5 is the store's reference cover (lib/layout.js).
export const FORMATS = Object.freeze({
  original: Object.freeze({ name: 'Original', short: 'Original' }),
  '4x5': Object.freeze({ name: 'Retrato 4:5', short: '4:5', width: 1200, height: 1500 }),
  '1x1': Object.freeze({ name: 'Quadrada 1:1', short: '1:1', width: 1200, height: 1200 }),
  '3x4': Object.freeze({ name: 'Retrato 3:4', short: '3:4', width: 1200, height: 1600 }),
  '2x3': Object.freeze({ name: 'Retrato 2:3', short: '2:3', width: 1000, height: 1500 }),
  '16x9': Object.freeze({ name: 'Paisagem 16:9', short: '16:9', width: 1920, height: 1080 }),
  '9x16': Object.freeze({ name: 'Story 9:16', short: '9:16', width: 1080, height: 1920 }),
});
export const FORMAT_KEYS = Object.freeze(Object.keys(FORMATS));

// How the art meets a fixed frame when nobody framed it by hand: filling it (the
// excess is cropped) or whole (a blurred copy of the art fills the bands).
export const FITS = Object.freeze(['cover', 'contain']);
export const MAX_ZOOM = 4;

const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// v1.1 kits called the 1200 × 1500 crop 'store'.
export function normalizeFormat(value) {
  const key = value === 'store' ? '4x5' : value;
  return FORMAT_KEYS.includes(key) ? key : null;
}

// Zoom 0 is clamped up to "the whole art", whatever the frame's shape.
export const defaultFrame = fit => ({ x: 0.5, y: 0.5, zoom: fit === 'contain' ? 0 : 1 });

// Where the art lands in a frame of fw × fh, in frame pixels. Zoom 1 fills the
// frame exactly, cropping one axis; the smallest zoom shows the whole art. x and
// y work like CSS object-position: 0 lines the art's left (top) edge up with the
// frame's, 1 the right (bottom) edge, 0.5 centres it. The same value serves art
// larger and smaller than the frame, so the art never leaves a gap on a side
// where it also overflows.
export function placeArt(sw, sh, fw, fh, frame = {}) {
  const cover = Math.max(fw / sw, fh / sh), contain = Math.min(fw / sw, fh / sh);
  const minZoom = contain / cover;
  const zoom = clamp(finite(Number(frame.zoom), 1), minZoom, MAX_ZOOM);
  const scale = cover * zoom, width = sw * scale, height = sh * scale;
  const x = clamp(finite(Number(frame.x), 0.5), 0, 1), y = clamp(finite(Number(frame.y), 0.5), 0, 1);
  return { scale, zoom, minZoom, x, y, width, height, left: (fw - width) * x, top: (fh - height) * y };
}

// A framing from the browser or from batch.json: numbers only, in range, rounded.
export function sanitizeFrame(input) {
  const [x, y, zoom] = [input?.x, input?.y, input?.zoom].map(v => (v === null || v === '' ? NaN : Number(v)));
  if (![x, y, zoom].every(Number.isFinite)) throw new Error('Enquadramento inválido.');
  const round = v => Math.round(v * 10000) / 10000;
  return { x: round(clamp(x, 0, 1)), y: round(clamp(y, 0, 1)), zoom: round(clamp(zoom, 0, MAX_ZOOM)) };
}
