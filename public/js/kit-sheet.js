import { h, icon, seg, fill } from './dom.js';
import { api, download } from './api.js';
import { debounce, phraseName, LABEL_KEYS, LABEL_NAMES } from './util.js';
import { FIT_OPTIONS, formatGrid, formatSize } from './formats.js';

const RATIOS = [['4x5', 'Retrato 4:5', 0.8], ['1x1', 'Quadrada 1:1', 1], ['16x9', 'Paisagem 16:9', 16 / 9]];
const SLIDERS = [
  ['stickerHeight', 'Tamanho do selo', 'size'], ['stickerLeft', 'Distância da borda esquerda', 'size'], ['stickerBottom', 'Distância da borda de baixo', 'size'],
  ['logoHeight', 'Tamanho da logo', 'size'], ['logoRight', 'Distância da borda direita', 'size'], ['logoShiftY', 'Altura da logo em relação ao selo', 'shift'],
];
const LIMITS = { stickerHeight: [48, 160], stickerLeft: [0, 200], stickerBottom: [0, 200], logoHeight: [20, 160], logoRight: [0, 200], logoShiftY: [-60, 60] };
const SECTION_NAMES = { logo: 'Logo da loja', sticker: 'Selo', layout: 'Posição e tamanho', output: 'Imagens finais' };
const PARTS = [['block', 'Bloco'], ['mark', 'Logotipo'], ['body', 'Fundo'], ['text', 'Texto']];
const MIN_LOGO_WIDTH = 400;
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = isObject(v) && isObject(a[k]) ? merge(a[k], v) : v; return out; };
const sameScheme = (a, b) => PARTS.every(([part]) => a?.[part]?.toUpperCase() === b?.[part]?.toUpperCase());
const listing = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;

function picker(accept, onFile) {
  const input = h('input', { type: 'file', accept, hidden: true, onchange: () => { const file = input.files[0]; input.value = ''; if (file) onFile(file); } });
  return input;
}
function dropTarget(el, onFile) {
  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); const file = e.dataTransfer.files[0]; if (file) onFile(file); });
  return el;
}

export function openKit(ctx) {
  const dialog = document.getElementById('kitSheet');
  let kit = ctx.state.kit, pending = {};
  const view = { platform: 'PS4', label: 'immediate', colors: { PS4: false, PS5: false } };
  const saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });
  const previews = [];
  const restoreButtons = new Map();
  const schemeControls = new Map();
  let originalStatus = null, restoreAllButton = null;

  const save = async () => {
    const patch = pending; pending = {};
    if (!Object.keys(patch).length) return;
    saveState.textContent = 'Salvando…';
    try { kit = await api('/api/kit', { method: 'PATCH', json: patch }); ctx.setKit(kit); saveState.textContent = 'Salvo'; refreshPreviews(); updateRestore(); syncSchemes(); }
    catch (e) { saveState.textContent = ''; ctx.toast(e.message, { tone: 'error' }); }
  };
  const flush = debounce(save, 350);
  const change = patch => { pending = merge(pending, patch); saveState.textContent = 'Alterado'; flush(); };
  const replaceKit = next => { kit = next; ctx.setKit(next); render(); };
  const fail = e => ctx.toast(e.message, { tone: 'error' });
  async function send(url, file, done) {
    const form = new FormData(); form.append('file', file);
    saveState.textContent = 'Enviando…';
    try { replaceKit(await api(url, { method: url.endsWith('import') ? 'POST' : 'PUT', form })); saveState.textContent = 'Salvo'; ctx.toast(done); }
    catch (e) { saveState.textContent = ''; fail(e); }
  }
  // Every image of the sheet is drawn by the program from the current kit.
  function refreshPreviews() {
    const v = Date.now();
    for (const { img, src } of previews) img.src = `${src()}&v=${v}`;
  }
  const preview = (img, src) => { previews.push({ img, src }); return img; };

  // --- back to the original kit ---------------------------------------------
  // Each section has its own button, shown only once that section differs from
  // the kit that came installed; a restore can itself be undone from the toast.
  function sectionHead(section) {
    const button = h('button', { class: 'btn btn-quiet btn-small restore', type: 'button', hidden: !kit.changed?.[section], onclick: () => restore(section) }, icon('undo'), 'Restaurar original');
    restoreButtons.set(section, button);
    return h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, SECTION_NAMES[section]), button);
  }
  const changedNames = () => Object.keys(SECTION_NAMES).filter(s => kit.changed?.[s]).map(s => SECTION_NAMES[s]);
  function updateRestore() {
    for (const [section, button] of restoreButtons) button.hidden = !kit.changed?.[section];
    const names = changedNames();
    if (restoreAllButton) restoreAllButton.disabled = !names.length;
    if (originalStatus) originalStatus.textContent = names.length ? `Diferente do original: ${listing(names).toLocaleLowerCase('pt-BR')}.` : 'Tudo igual ao kit original.';
  }
  async function restore(section) {
    if (Object.keys(pending).length) await flush.flush();
    const before = kit, sections = section === 'all' ? Object.keys(SECTION_NAMES) : [section];
    // The current logo is kept in memory so "Desfazer" can put it back.
    const logo = sections.includes('logo') && before.logo && before.original?.hasLogo
      ? await fetch(`/api/kit/logo.png?v=${before.revision}`).then(r => (r.ok ? r.blob() : null)).catch(() => null) : null;
    try {
      replaceKit(await api('/api/kit/restore', { method: 'POST', json: { section } }));
      ctx.toast(section === 'all' ? 'O kit voltou ao original.' : `${SECTION_NAMES[section]}: de volta ao original.`, { action: { label: 'Desfazer', run: () => undo(before, sections, logo) } });
    } catch (e) { fail(e); }
  }
  async function undo(before, sections, logo) {
    const patch = {};
    if (sections.includes('logo')) Object.assign(patch, { logoOpacity: before.logoOpacity, logoShadow: before.logoShadow });
    if (sections.includes('sticker')) patch.sticker = { mode: before.sticker.mode, colors: before.sticker.colors, labels: before.sticker.labels };
    if (sections.includes('layout')) patch.layout = before.layout;
    if (sections.includes('output')) patch.output = before.output;
    try {
      let next = await api('/api/kit', { method: 'PATCH', json: patch });
      if (logo) { const form = new FormData(); form.append('file', logo, before.logo.name || 'logo.png'); next = await api('/api/kit/logo', { method: 'PUT', form }); }
      ctx.setKit(next); kit = next;
      if (dialog.open) render();
      ctx.toast('Suas alterações voltaram.');
    } catch (e) { fail(e); }
  }
  async function confirmRestoreAll() {
    const names = changedNames();
    const ok = await ctx.confirm({
      title: 'Restaurar o kit original?',
      text: `Volta ao original: ${listing(names).toLocaleLowerCase('pt-BR')}. Os lotes já carimbados só mudam se você aplicar o kit de novo neles.`,
      action: 'Restaurar tudo',
    });
    if (ok) restore('all');
  }

  // --- sections --------------------------------------------------------------
  function previewSection() {
    const row = h('div', { class: 'preview-row' }, RATIOS.map(([ratio, caption, grow]) => {
      const img = preview(h('img', { alt: `Exemplo ${caption}`, width: '480', height: String(Math.round(480 / grow)) }),
        () => `/api/kit/sample.jpg?ratio=${ratio}&w=480&platform=${view.platform}&label=${view.label}`);
      return h('figure', { style: { '--grow': grow } }, img, h('figcaption', null, caption));
    }));
    const tools = h('div', { class: 'preview-tools' },
      seg([['PS4', 'PS4'], ['PS5', 'PS5']], view.platform, v => { view.platform = v; render(); }, 'Plataforma do exemplo'),
      seg(LABEL_KEYS.map(k => [k, phraseName(kit, k)]), view.label, v => { view.label = v; render(); }, 'Frase do exemplo'));
    return h('section', { class: 'kit-section' }, row, tools);
  }

  function toggle(label, checked, onChange) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: () => onChange(input.checked) });
    return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), label);
  }

  function logoSection() {
    const upload = file => send('/api/kit/logo', file, 'Logo atualizada. Os próximos lotes já saem com ela.');
    const input = picker('.png,.svg,.webp,image/png,image/svg+xml,image/webp', upload);
    // Both tiles are drawn by the compositor itself: opacity and shadow included.
    const swatch = bg => preview(h('img', { class: 'brand-swatch', alt: '', width: '520', height: '232' }), () => `/api/kit/logo-swatch.png?bg=${bg}`);
    const lightCaption = h('figcaption', null, kit.logoShadow ? 'Em capa clara, com sombra suave' : 'Em capa clara');
    const tiles = dropTarget(kit.logo
      ? h('div', { class: 'brand-tiles' },
        h('figure', { class: 'brand-tile' }, swatch('dark'), h('figcaption', null, 'Em capa escura')),
        h('figure', { class: 'brand-tile' }, swatch('light'), lightCaption))
      : h('div', { class: 'logo-empty' }, h('p', null, 'Arraste a logo para cá.'), h('p', null, 'PNG ou SVG com fundo transparente, de preferência com 1000 pixels de largura ou mais.')), upload);
    const small = kit.logo && kit.logo.width < MIN_LOGO_WIDTH;
    const info = kit.logo && h('p', { class: `logo-info${small ? ' is-warn' : ''}` }, small
      ? `A logo tem só ${kit.logo.width} pixels de largura e pode ficar borrada em capas grandes. Se tiver uma versão maior (ou em SVG), troque por ela.`
      : `${kit.logo.name || 'logo.png'}, ${kit.logo.width} × ${kit.logo.height} pixels.`);
    const opacity = kit.logo && slider('logoOpacity', 'Opacidade', Math.round(kit.logoOpacity * 100), 10, 100, v => `${v}%`, v => change({ logoOpacity: v / 100 }));
    const shadow = kit.logo && toggle('Sombra suave quando a capa é clara no canto da logo', kit.logoShadow, on => {
      lightCaption.textContent = on ? 'Em capa clara, com sombra suave' : 'Em capa clara';
      change({ logoShadow: on });
    });
    return h('section', { class: 'kit-section' }, sectionHead('logo'),
      h('p', null, 'Vai no canto inferior direito, alinhada pelo centro do selo. As margens transparentes do arquivo são ignoradas, e logos de formatos diferentes ganham o mesmo peso visual.'),
      tiles, info, h('div', { class: 'row' }, input,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => input.click() }, icon('upload'), kit.logo ? 'Trocar logo' : 'Adicionar logo'),
        kit.logo && h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => { try { replaceKit(await api('/api/kit/logo', { method: 'DELETE' })); } catch (e) { fail(e); } } }, 'Remover')),
      opacity, shadow);
  }

  function labelFields(key) {
    const value = kit.sticker.labels[key];
    const field = (part, cls, hint) => h('label', null, h('span', { class: 'input-caption' }, hint),
      h('input', { class: `text-input ${cls}`, value: value[part], maxlength: '24', spellcheck: false, autocomplete: 'off', oninput: e => change({ sticker: { labels: { [key]: { [part]: e.target.value } } } }) }));
    return h('div', null, h('p', { class: 'field-label', style: { 'margin-bottom': '6px' } }, LABEL_NAMES[key]),
      h('div', { class: 'label-pair' }, field('regular', '', 'Parte normal'), field('bold', 'is-bold', 'Parte em negrito')));
  }

  // The official PlayStation look, or the store's own colours for each part. The
  // label and the button follow each change at once, without redrawing the field:
  // a redraw would close the colour picker in the middle of a choice.
  function syncSchemes() {
    for (const [platform, { status, reset }] of schemeControls) {
      const official = kit.schemes?.[platform], isOfficial = sameScheme(kit.sticker.colors[platform], official);
      status.textContent = `${platform}: ${isOfficial ? 'cores oficiais' : 'cores próprias'}`;
      reset.disabled = isOfficial || !official;
    }
  }
  function schemeField(platform) {
    const scheme = kit.sticker.colors[platform], official = kit.schemes?.[platform];
    const img = preview(h('img', { class: 'scheme-sticker', alt: '', height: '28' }), () => `/api/kit/sticker.png?platform=${platform}&label=${view.label}&h=56`);
    const pick = part => e => {
      const colors = { [platform]: { [part]: e.target.value.toUpperCase() } };
      kit = merge(kit, { sticker: { colors } });
      change({ sticker: { colors } });
      syncSchemes();
    };
    const swatches = PARTS.map(([part, name]) => h('label', { class: 'color-field' },
      h('input', { type: 'color', value: scheme[part].toLowerCase(), oninput: pick(part) }), name));
    const status = h('span');
    const reset = h('button', { class: 'btn btn-small', type: 'button', onclick: () => {
      change({ sticker: { colors: { [platform]: official } } });
      kit = merge(kit, { sticker: { colors: { [platform]: official } } });
      render();
    } }, 'Usar as cores oficiais');
    schemeControls.set(platform, { status, reset });
    const details = h('details', { class: 'scheme', open: view.colors[platform] },
      h('summary', null, img, status),
      h('div', { class: 'scheme-body' }, h('div', { class: 'swatches' }, swatches), reset));
    details.addEventListener('toggle', () => { view.colors[platform] = details.open; });
    syncSchemes();
    return details;
  }

  function stickerSection() {
    const s = kit.sticker;
    const slots = s.mode === 'image' && ['PS4', 'PS5'].map(p => {
      const img = s.images[p];
      const upload = file => send(`/api/kit/sticker/${p}`, file, `Selo ${p} atualizado.`);
      const input = picker('.png,.svg,.webp,image/png,image/svg+xml,image/webp', upload);
      return dropTarget(h('div', { class: 'upload-slot' },
        h('img', { src: `/api/kit/sticker.png?platform=${p}&h=64&v=${kit.revision}`, alt: `Selo ${p}` }),
        h('span', null, img ? img.name : `${p}: usando o desenho oficial`), h('div', { class: 'row' }, input,
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => input.click() }, img ? 'Trocar' : 'Enviar imagem'),
          img && h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => { try { replaceKit(await api(`/api/kit/sticker/${p}`, { method: 'DELETE' })); } catch (e) { fail(e); } } }, 'Remover'))),
      upload);
    });
    const catalog = s.mode === 'builtin' && h('div', null,
      h('div', { class: 'catalog', role: 'group', 'aria-label': 'Selos da loja' }, LABEL_KEYS.flatMap(key => ['PS4', 'PS5'].map(p => {
        const img = preview(h('img', { alt: `${p}, ${phraseName(kit, key)}` }), () => `/api/kit/sticker.png?platform=${p}&label=${key}&h=68`);
        return h('button', { class: 'catalog-item', type: 'button', 'aria-pressed': String(view.platform === p && view.label === key), onclick: () => { view.platform = p; view.label = key; render(); } }, img);
      }))),
      h('p', { class: 'field-hint' }, 'Os seis selos da loja. Clique em um para vê-lo nos exemplos lá em cima.'));
    return h('section', { class: 'kit-section' }, sectionHead('sticker'),
      h('p', null, 'Vai no canto inferior esquerdo. O desenho oficial usa os logotipos PS4 e PS5 e fica nítido em qualquer tamanho de capa.'),
      seg([['builtin', 'Desenho oficial'], ['image', 'Imagem própria']], s.mode, v => { change({ sticker: { mode: v } }); kit = merge(kit, { sticker: { mode: v } }); render(); }, 'Desenho do selo'),
      slots && h('div', { style: { display: 'grid', gap: '10px' } }, slots),
      catalog,
      s.mode === 'builtin' && [h('div', { class: 'stack' }, LABEL_KEYS.map(labelFields)), h('div', { class: 'stack' }, h('p', { class: 'field-label' }, 'Cores'), schemeField('PS4'), schemeField('PS5'))]);
  }

  function slider(key, label, value, min, max, format, onInput) {
    const out = h('output', { class: 'num' }, format(value));
    const fill = v => `${((v - min) / (max - min)) * 100}%`;
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(value), id: `kit-${key}`, style: { '--fill': fill(value) } });
    range.addEventListener('input', () => { const v = Number(range.value); out.textContent = format(v); range.style.setProperty('--fill', fill(v)); onInput(v); });
    return h('div', { class: 'slider' }, h('label', { for: `kit-${key}` }, label), out, range);
  }

  function layoutSection() {
    const base = kit.original?.layout ?? kit.layout;
    const rows = SLIDERS.map(([key, label, kind]) => {
      const [min, max] = LIMITS[key];
      const format = kind === 'shift' ? v => (v === 0 ? 'no centro' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`)
        : base[key] ? v => `${Math.round((v / base[key]) * 100)}%` : v => `${v}`;
      return slider(key, label, kit.layout[key], min, max, format, v => change({ layout: { [key]: v } }));
    });
    return h('section', { class: 'kit-section' }, sectionHead('layout'),
      h('p', null, 'Medidas da capa de referência (1200 × 1500), em relação ao original. Em capas de outros tamanhos tudo é ajustado na mesma proporção.'),
      rows);
  }

  function outputSection() {
    const o = kit.output;
    const quality = o.format === 'jpeg' && slider('quality', 'Qualidade do JPEG', o.quality, 70, 100, v => `${v}`, v => change({ output: { quality: v } }));
    const set = patch => { change({ output: patch }); kit = merge(kit, { output: patch }); render(); };
    const field = (label, control, hint) => h('div', null, h('p', { class: 'field-label', style: { 'margin-bottom': '8px' } }, label), control, hint && h('p', { class: 'field-hint' }, hint));
    return h('section', { class: 'kit-section' }, sectionHead('output'),
      field('Frase de cada plataforma', h('div', { class: 'stack' }, ['PS4', 'PS5'].map(p => h('div', { class: 'phrase-row' },
        h('span', { class: 'chip is-on', dataset: { platform: p } }, p),
        seg(LABEL_KEYS.map(k => [k, phraseName(kit, k)]), o.phrase[p], v => set({ phrase: { [p]: v } }), `Frase do selo ${p}`)))),
      'Usada em todos os lotes, a não ser que você escolha outra frase no lote ou na capa.'),
      field('Quando o nome do arquivo não diz a plataforma',
        seg([['PS4', 'PS4'], ['PS5', 'PS5'], ['both', 'PS4 e PS5']], o.fallback.length === 2 ? 'both' : o.fallback[0], v => set({ fallback: v === 'both' ? ['PS4', 'PS5'] : [v] }), 'Plataforma padrão')),
      field('Formato da imagem', formatGrid(o.size, v => set({ size: v })), o.size === 'original'
        ? 'Cada capa sai inteira, no formato e no tamanho da imagem enviada (as capas da PlayStation Store são quadradas).'
        : `Toda capa sai com ${formatSize(o.size)} pixels. No lote dá para trocar o formato, e na capa aberta, "Ajustar enquadramento" escolhe o que aparece.`),
      o.size !== 'original' && field('Quando a arte tem outro formato', seg(FIT_OPTIONS, o.fit, v => set({ fit: v }), 'Encaixe'), o.fit === 'contain'
        ? 'Capa inteira: a arte aparece toda, e um fundo desfocado feito da própria arte completa a capa.'
        : 'Preencher: a arte ocupa a capa toda, centralizada, e o que sobra é recortado.'),
      field('Tipo de arquivo', seg([['jpeg', 'JPEG'], ['png', 'PNG']], o.format, v => set({ format: v }), 'Tipo de arquivo'), o.format === 'jpeg' ? 'JPEG: arquivos leves, o que as lojas recomendam.' : 'PNG: sem perda, arquivos bem maiores.'),
      quality);
  }

  function transferSection() {
    const input = picker('.zip,application/zip', file => send('/api/kit/import', file, 'Kit importado.'));
    return h('section', { class: 'kit-section' }, h('h3', { class: 'section-title' }, 'Usar em outro computador'),
      h('p', null, 'O kit exportado leva a logo, os selos e as medidas. Ele contém a marca da loja: envie só para quem vai usar.'),
      h('div', { class: 'row' }, input,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => download('/api/kit/export') }, icon('download'), 'Exportar kit'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => input.click() }, icon('upload'), 'Importar kit')));
  }

  function originalSection() {
    originalStatus = h('p', { class: 'original-status', 'aria-live': 'polite' });
    restoreAllButton = h('button', { class: 'btn btn-small', type: 'button', onclick: confirmRestoreAll }, icon('undo'), 'Restaurar tudo');
    const section = h('section', { class: 'kit-section kit-original' }, h('h3', { class: 'section-title' }, 'Kit original'),
      h('p', null, ctx.state.profile?.title
        ? 'É o kit que veio instalado com o programa da loja. Restaurar volta a logo, o selo, as medidas e as imagens finais para ele.'
        : 'São as configurações que vieram com o programa. Restaurar volta a logo, o selo, as medidas e as imagens finais para elas.'),
      originalStatus, h('div', { class: 'row' }, restoreAllButton));
    updateRestore();
    return section;
  }

  function render() {
    const scroll = dialog.querySelector('.sheet-body')?.scrollTop ?? 0;
    previews.length = 0; restoreButtons.clear(); schemeControls.clear();
    const body = h('div', { class: 'sheet-body' },
      h('p', { class: 'sheet-intro' }, 'O que você muda aqui vale para os próximos lotes e é salvo na hora. Lotes já carimbados avisam e oferecem aplicar o kit de novo.'),
      previewSection(), logoSection(), stickerSection(), layoutSection(), outputSection(), transferSection(), originalSection());
    fill(dialog, h('div', { class: 'sheet-head' },
      h('h2', { id: 'kitTitle' }, 'Kit da loja'), saveState,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('close'))), body);
    body.scrollTop = scroll;
    refreshPreviews();
  }

  const onClose = () => { dialog.removeEventListener('close', onClose); if (Object.keys(pending).length) flush.flush(); ctx.onKitClosed?.(); };
  dialog.addEventListener('close', onClose);
  dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
  render();
  if (!dialog.open) dialog.showModal();
}
