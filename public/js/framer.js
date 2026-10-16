import { h, stampButton } from './dom.js';
import { placeArt, defaultFrame, MAX_ZOOM } from './framing.js';

const SNAP = 6;      // screen pixels within which a drag snaps the art to the centre
const NUDGE = 0.01;  // of the frame per arrow key; Shift moves ten times as far

// The framing editor, shown in the inspector in place of the comparison: the whole
// art under the frame of the finished image, with the sticker and the logo where
// the file has them. Dragging moves the art; the wheel, a pinch and the slider zoom
// it. The placement is lib/framing.js itself, so the file comes out as shown.
// Nothing is saved until "Aplicar".
export function openFramer({ item, output, kit, batchId, onApply, onCancel }) {
  const { format } = item.rendered;
  const fw = item.width, fh = item.height, sw = item.sourceWidth, sh = item.sourceHeight;
  const place = frame => placeArt(sw, sh, fw, fh, frame);
  const pick = p => ({ x: p.x, y: p.y, zoom: p.zoom });
  const saved = item.frames?.[format] ?? null;
  const standard = place(defaultFrame(item.fit));
  let state = pick(place(saved ?? defaultFrame(item.fit)));
  let view = null; // where the frame sits on screen: { k (screen px per file px), left, top }

  // --- stage ------------------------------------------------------------------
  const src = `/api/batches/${batchId}/items/${item.id}/thumb/src`;
  const backdrop = h('img', { class: 'framer-backdrop', src, alt: '', draggable: false });
  const art = h('img', { class: 'framer-art', src, alt: '', draggable: false });
  const sticker = h('img', { alt: '', draggable: false, src: `/api/kit/sticker.png?platform=${output.platform}&label=${output.label}&h=192&v=${kit.revision}` });
  const logo = output.geometry.logo && kit.logo
    ? h('img', { alt: '', draggable: false, src: `/api/kit/logo.png?v=${kit.revision}`, style: { opacity: String(kit.logoOpacity) } }) : null;
  const win = h('div', { class: 'framer-window' }, backdrop);
  const mask = h('div', { class: 'framer-mask' });
  const marks = h('div', { class: 'framer-marks' }, sticker, logo);
  const guideX = h('div', { class: 'framer-guide is-x', hidden: true });
  const guideY = h('div', { class: 'framer-guide is-y', hidden: true });
  const status = h('p', { class: 'framer-status' }, 'Abrindo a arte inteira…');
  // Its own keys (arrows, + and −) make the stage an application for assistive technology.
  const stage = h('div', { class: 'insp-stage framer', tabindex: '0', role: 'application', 'aria-label': 'Arte da capa: arraste para escolher o que aparece. As setas movem a arte e as teclas + e − dão zoom.' },
    win, art, mask, marks, guideX, guideY, status);
  art.addEventListener('load', () => { status.hidden = true; });
  art.addEventListener('error', () => { status.textContent = 'Não foi possível abrir a arte desta capa.'; });

  const px = v => `${v}px`;
  const box = (el, left, top, width, height) => Object.assign(el.style, { left: px(left), top: px(top), width: px(width), height: px(height) });
  function layout() {
    const r = stage.getBoundingClientRect();
    const pad = Math.max(28, Math.min(r.width, r.height) * 0.08);
    const k = Math.min((r.width - 2 * pad) / fw, (r.height - 2 * pad) / fh);
    if (!(k > 0)) return;
    view = { k, left: (r.width - fw * k) / 2, top: (r.height - fh * k) / 2 };
    for (const el of [win, mask, marks]) box(el, view.left, view.top, fw * k, fh * k);
    const g = output.geometry;
    box(sticker, g.sticker.left * k, g.sticker.top * k, g.sticker.width * k, g.sticker.height * k);
    if (logo) box(logo, g.logo.left * k, g.logo.top * k, g.logo.width * k, g.logo.height * k);
    Object.assign(guideX.style, { left: px(view.left + (fw * k) / 2), top: px(view.top), height: px(fh * k) });
    Object.assign(guideY.style, { left: px(view.left), top: px(view.top + (fh * k) / 2), width: px(fw * k) });
    // About as soft as the engine's backdrop (lib/compose.js), at this screen size.
    win.style.setProperty('--blur', px(Math.max(4, Math.round(Math.max(fw, fh) * k / 36))));
    draw();
  }
  // The observer lays the stage out on the next frame; input that arrives first
  // (or in a window the browser is not painting) measures it on the spot.
  const ready = () => { if (!view) layout(); return !!view; };

  // --- zoom: logarithmic, so every step of the slider feels the same ------------
  const low = Math.log(standard.minZoom), span = Math.log(MAX_ZOOM) - low;
  const toSlider = zoom => (span > 0 ? ((Math.log(zoom) - low) / span) * 1000 : 0);
  const fromSlider = value => Math.exp(low + (value / 1000) * span);
  const zoomRange = h('input', { type: 'range', min: '0', max: '1000', step: '1', id: 'framerZoom' });
  const zoomValue = h('output', { class: 'num', for: 'framerZoom' });
  zoomRange.addEventListener('input', () => { ready(); zoomAt(fromSlider(Number(zoomRange.value))); });

  function draw() {
    const p = place(state), slider = toSlider(p.zoom), percent = `${Math.round(p.zoom * 100)}%`;
    zoomRange.value = String(Math.round(slider));
    zoomRange.style.setProperty('--fill', `${slider / 10}%`);
    // The slider runs on a logarithmic 0–1000 scale; it is announced as the zoom itself.
    zoomRange.setAttribute('aria-valuetext', percent);
    zoomValue.textContent = percent;
    if (view) box(art, view.left + p.left * view.k, view.top + p.top * view.k, p.width * view.k, p.height * view.k);
  }
  const set = frame => { state = pick(place(frame)); draw(); };
  // x or y for a wanted position of the art's edge; free is the room left (negative when the art overflows).
  const along = (pos, free) => (Math.abs(free) < 0.5 ? 0.5 : Math.min(1, Math.max(0, pos / free)));

  // From where the art's top-left corner should go (file pixels) to x and y.
  // Dragging close to the centre snaps to it, with a guide line.
  function moveTo(left, top, { snap = true } = {}) {
    const p = place(state);
    const axis = (pos, free) => {
      const centred = snap && Math.abs(free) >= 0.5 && Math.abs(pos - free / 2) * view.k < SNAP;
      return [centred ? 0.5 : along(pos, free), centred];
    };
    const [x, onX] = axis(left, fw - p.width), [y, onY] = axis(top, fh - p.height);
    guideX.hidden = !onX; guideY.hidden = !onY;
    set({ ...state, x, y });
  }

  // Zoom keeping the point of the art under (px, py), in file pixels, where it is.
  function zoomAt(zoom, px = fw / 2, py = fh / 2) {
    const before = place(state), after = place({ ...state, zoom });
    const u = (px - before.left) / before.width, v = (py - before.top) / before.height;
    set({ zoom: after.zoom, x: along(px - u * after.width, fw - after.width), y: along(py - v * after.height, fh - after.height) });
  }

  // One pointer drags at a time: a second finger on a touch screen is ignored
  // instead of starting a drag that fights the first.
  let dragging = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || dragging !== null || !ready()) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    try { stage.setPointerCapture(e.pointerId); } catch { /* the pointer was already released */ }
    stage.classList.add('is-dragging');
    dragging = e.pointerId;
    const start = place(state), x0 = e.clientX, y0 = e.clientY;
    const move = ev => { if (ev.pointerId === dragging) moveTo(start.left + (ev.clientX - x0) / view.k, start.top + (ev.clientY - y0) / view.k); };
    const end = ev => {
      if (ev.pointerId !== dragging) return;
      dragging = null;
      stage.classList.remove('is-dragging');
      guideX.hidden = true; guideY.hidden = true;
      stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', end); stage.removeEventListener('pointercancel', end);
    };
    stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  });
  // A mouse wheel, a trackpad scroll and a pinch (which arrives with ctrlKey) all zoom.
  stage.addEventListener('wheel', e => {
    if (!ready()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const r = stage.getBoundingClientRect();
    zoomAt(state.zoom * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), (e.clientX - r.left - view.left) / view.k, (e.clientY - r.top - view.top) / view.k);
  }, { passive: false });

  function keydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter' && !e.target.closest('button, a, input')) { e.preventDefault(); apply(); return; }
    if (e.target.closest('input')) return; // the slider moves with its own keys
    const step = (e.shiftKey ? 10 : 1) * NUDGE;
    const nudge = { ArrowLeft: [-step * fw, 0], ArrowRight: [step * fw, 0], ArrowUp: [0, -step * fh], ArrowDown: [0, step * fh] }[e.key];
    if (nudge) {
      e.preventDefault();
      const p = place(state);
      if (ready()) moveTo(p.left + nudge[0], p.top + nudge[1], { snap: false });
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(state.zoom * 1.1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(state.zoom / 1.1); }
  }

  // The same placement as before closes without saving; the batch's standard
  // placement goes back to it (null) instead of being kept as handwork. A v1.1
  // crop was not made by these rules, so applying it always redoes the file.
  const legacy = !!item.rendered.legacy;
  function apply() {
    const same = (a, b) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5;
    const p = place(state);
    if (!legacy && same(p, place(saved ?? defaultFrame(item.fit)))) return onCancel();
    onApply(same(p, standard) ? null : { ...state }, saved);
  }

  // --- panel ----------------------------------------------------------------------
  const preset = (text, frame) => h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ready(); set(frame()); } }, text);
  const panel = h('div', { class: 'insp-panel framer-panel' },
    h('section', null, h('h3', null, 'Ajustar enquadramento'),
      h('p', { class: 'hint' }, 'Arraste a arte para escolher o que aparece na capa. A roda do mouse, o gesto de pinça e o zoom abaixo aproximam e afastam.'),
      legacy && h('p', { class: 'hint' }, 'Esta capa foi recortada pela versão anterior do programa, de outro jeito. "Aplicar" a refaz como está aqui.')),
    h('section', { class: 'stack' },
      h('div', { class: 'slider' }, h('label', { for: 'framerZoom' }, 'Zoom'), zoomValue, zoomRange),
      h('div', { class: 'row' },
        preset('Capa inteira', () => ({ x: 0.5, y: 0.5, zoom: 0 })),
        preset('Preencher', () => ({ x: 0.5, y: 0.5, zoom: 1 })),
        preset('Centralizar', () => ({ ...state, x: 0.5, y: 0.5 }))),
      h('p', { class: 'hint' }, 'Onde a arte não chega, um fundo desfocado feito da própria arte completa a capa. O selo e a logo aparecem onde vão ficar.')),
    h('p', { class: 'hint' }, 'Setas movem a arte (com Shift, mais longe), + e − dão zoom, Enter aplica e Esc cancela.'),
    h('div', { class: 'insp-foot row' },
      stampButton('Aplicar', 'crop', { onclick: apply }),
      h('button', { class: 'btn', type: 'button', onclick: () => onCancel() }, 'Cancelar')));

  const observer = new ResizeObserver(layout);
  observer.observe(stage);
  draw();
  return {
    stage, panel, keydown, format,
    focus: () => stage.focus({ preventScroll: true }),
    destroy: () => observer.disconnect(),
  };
}
