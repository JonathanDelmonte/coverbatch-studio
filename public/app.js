import { h, icon, fill } from './js/dom.js';
import { api, setToken, upload } from './js/api.js';
import { plural, displayTitle } from './js/util.js';
import { accepted, fromInput, titleFor, installDrop, installPaste } from './js/drop.js';
import { renderHome } from './js/home.js';
import { renderBatch } from './js/batch-view.js';
import { openKit } from './js/kit-sheet.js';
import { openHelp } from './js/help.js';

const $ = id => document.getElementById(id);
const view = $('view');
const state = { kit: null, batches: [], profile: null, version: '', system: null };
let leave = null;

// --- feedback ---------------------------------------------------------------
// Toasts go to the topmost open dialog (the rest of the page is inert under it).
function toastRegion() {
  const host = [...document.querySelectorAll('dialog[open]')].pop() ?? document.body;
  return host.querySelector(':scope > .toasts') ?? host.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
}
function toast(message, { tone = 'info', action } = {}) {
  const el = h('div', { class: `toast${tone === 'error' ? ' is-error' : ''}`, role: tone === 'error' ? 'alert' : 'status' },
    h('p', null, message), action && h('button', { type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label));
  toastRegion().append(el);
  setTimeout(() => el.remove(), tone === 'error' || action ? 9000 : 5000);
}
function confirmDialog({ title, text, action }) {
  const dialog = $('confirm');
  return new Promise(resolve => {
    const done = value => { dialog.close(); resolve(value); };
    fill(dialog, h('h2', null, title), h('p', null, text), h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Cancelar'),
      h('button', { class: 'btn btn-stamp', type: 'button', style: { padding: '0 22px' }, onclick: () => done(true) }, action)));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    dialog.showModal();
  });
}

// --- kit appearance -----------------------------------------------------------
// Relative luminance (0 to 1) of a #RRGGBB colour.
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function setKit(kit) {
  state.kit = kit;
  const css = document.documentElement.style, { PS4, PS5 } = kit.sticker.colors;
  // The PS4 block colours the band and the primary buttons; a pale custom colour
  // would leave their white text unreadable, so the interface falls back to slate.
  css.setProperty('--blue', luminance(PS4.block) > 0.3 ? '#1d232a' : PS4.block);
  for (const [platform, scheme] of [['ps4', PS4], ['ps5', PS5]]) for (const [part, value] of Object.entries(scheme)) css.setProperty(`--${platform}-${part}`, value);
  const logo = $('bandLogo');
  logo.hidden = !kit.logo;
  if (kit.logo) logo.src = `/api/kit/logo.png?v=${kit.revision}`;
  const sticker = $('bandSticker');
  sticker.src = `/api/kit/sticker.png?platform=PS4&h=48&v=${kit.revision}`;
  sticker.hidden = false;
}

// --- sending files -----------------------------------------------------------
async function send({ list, roots }) {
  const files = list.filter(e => accepted(e.path));
  if (!files.length) return toast('Nenhuma imagem ou ZIP entre os arquivos. Use JPEG, PNG, WebP ou um ZIP com as capas.', { tone: 'error' });
  const title = titleFor(roots, files);
  const status = h('p', { class: 'batch-status', 'aria-live': 'polite' }, 'Recebendo os arquivos…');
  const bar = h('span');
  leave?.(); leave = null;
  view.replaceChildren(h('div', { class: 'batch' },
    h('a', { class: 'back', href: '#/' }, icon('back'), 'Início'),
    h('div', { class: 'batch-head' }, h('div', null, h('h1', { class: 'batch-title' }, displayTitle(title)), status)),
    h('div', { class: 'progress' }, bar)));
  const form = new FormData();
  for (const e of files) form.append('files', e.file, e.file.name);
  form.append('paths', JSON.stringify(files.map(e => e.path)));
  form.append('title', title);
  try {
    const batch = await upload('/api/batches', form, p => { bar.style.width = `${Math.round(p * 100)}%`; status.textContent = `Recebendo ${plural(files.length, 'arquivo', 'arquivos')}… ${Math.round(p * 100)}%`; });
    location.hash = `#/lote/${batch.id}`;
  } catch (e) {
    toast(e.message, { tone: 'error' });
    location.hash = '#/'; route();
  }
}

const ctx = {
  state, toast, setKit, confirm: confirmDialog,
  pickFiles: () => $('pickFiles').click(),
  pickFolder: () => $('pickFolder').click(),
  openBatch: id => { location.hash = `#/lote/${id}`; },
  addLogo: () => openKit(ctx),
  openHelp: () => openHelp(ctx),
  onKitClosed: () => { if (!location.hash.startsWith('#/lote/')) route(); },
};

// --- routing ------------------------------------------------------------------
async function route() {
  leave?.(); leave = null;
  // The kit may have changed in another tab or window of the same program.
  try { setKit(await api('/api/kit')); } catch { /* keep the last kit */ }
  const match = /^#\/lote\/([a-f0-9-]{36})$/.exec(location.hash);
  if (match) { leave = renderBatch(view, match[1], ctx); view.focus({ preventScroll: true }); return; }
  document.title = state.profile?.title || 'Criador de capas';
  try { state.batches = await api('/api/batches'); } catch { /* keep the last list */ }
  renderHome(view, ctx);
}

async function boot() {
  let session;
  try { session = await api('/api/session'); }
  catch (e) { view.replaceChildren(h('div', { class: 'home' }, h('p', { class: 'batch-status' }, e.message))); return; }
  setToken(session.token);
  // Tells the program this window is open; the Windows launcher stops it after the last one closes.
  window.coverbatchPresence = new EventSource('/api/presence');
  Object.assign(state, { batches: session.batches, profile: session.profile, version: session.version, system: session.system });
  setKit(session.kit);
  if (session.profile?.title) $('bandTitle').textContent = session.profile.title;
  const dev = session.profile?.developer || 'ZIRTUNO';
  $('footDev').replaceChildren(...[session.profile?.hasDeveloperLogo && h('img', { src: '/api/profile/developer-logo.svg', alt: '' }), `Desenvolvido por ${dev}. Versão ${session.version}.`].filter(Boolean));
  $('openKit').addEventListener('click', () => openKit(ctx));
  $('openHelp').prepend(icon('help'));
  $('openHelp').addEventListener('click', () => openHelp(ctx));
  // "?" opens the help from anywhere except text fields and other open panels.
  window.addEventListener('keydown', e => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;
    e.preventDefault(); openHelp(ctx);
  });
  $('pickFiles').addEventListener('change', e => send(fromInput(e.target)));
  $('pickFolder').addEventListener('change', e => send(fromInput(e.target)));
  installDrop({ veil: $('veil'), count: $('veilCount'), onDrop: send, enabled: () => !document.querySelector('dialog[open]') });
  installPaste(payload => { if (!document.querySelector('dialog[open]')) send(payload); });
  window.addEventListener('hashchange', route);
  route();
}
boot();
