import { h, icon, stampButton, seg, put } from './dom.js';
import { api, stream } from './api.js';
import { plural, displayTitle, fileName, phraseName, phrasesLine, LABEL_KEYS, FILE_MANAGER, PLATFORM_SOURCE_SHORT } from './util.js';
import { openInspector } from './inspector.js';

const CHECK_FLAGS = ['stamped', 'low-res'];
const SHORT_FLAG = { stamped: 'Parece já ter o selo', 'low-res': 'Resolução baixa', upscaled: 'Ampliada', cropped: 'Recortada', downscaled: 'Reduzida' };
const needsCheck = item => !item.excluded && item.flags?.some(f => CHECK_FLAGS.includes(f.code));
const orderLabel = list => list.length === 2 ? 'PS4 e PS5' : list[0];

export function renderBatch(view, id, ctx) {
  let summary = null, filter = 'all', inspector = null;
  const items = new Map(), cards = new Map();
  const thumb = (item, which) => `/api/batches/${id}/items/${item.id}/thumb/${which}?v=${item.rev}`;
  const patchItem = (item, json) => api(`/api/batches/${id}/items/${item.id}`, { method: 'PATCH', json }).catch(e => ctx.toast(e.message, { tone: 'error' }));
  const patchBatch = json => api(`/api/batches/${id}`, { method: 'PATCH', json }).catch(e => ctx.toast(e.message, { tone: 'error' }));

  const title = h('h1', { class: 'batch-title' });
  const status = h('p', { class: 'batch-status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'batch-actions' });
  const bar = h('span');
  const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Capas carimbadas', 'aria-valuemin': '0' }, bar);
  const controls = h('div', { class: 'controls' });
  const notes = h('div', { class: 'notes' });
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Mostrar' });
  const grid = h('div', { class: 'grid' });
  const empty = h('p', { class: 'empty-filter', hidden: true });
  const remove = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => confirmRemove() }, icon('trash'), 'Excluir este lote');
  view.replaceChildren(h('div', { class: 'batch' },
    h('a', { class: 'back', href: '#/' }, icon('back'), 'Início'),
    h('div', { class: 'batch-head' }, h('div', { style: { 'min-width': '0' } }, title, status), actions),
    progress, controls, notes, filters, grid, empty, h('div', { style: { 'margin-top': '48px' } }, remove)));

  async function confirmRemove() {
    const ok = await ctx.confirm({ title: `Excluir o lote “${displayTitle(summary?.title)}”?`, text: 'As imagens prontas deste lote serão apagadas deste computador. Os arquivos originais que você arrastou continuam onde estavam.', action: 'Excluir lote' });
    if (!ok) return;
    try { await api(`/api/batches/${id}`, { method: 'DELETE' }); ctx.toast('Lote excluído.'); location.hash = '#/'; }
    catch (e) { ctx.toast(e.message, { tone: 'error' }); }
  }

  // --- header -------------------------------------------------------------
  function renderHead() {
    const c = summary.counts;
    title.textContent = displayTitle(summary.title);
    document.title = `${displayTitle(summary.title)} — Criador de capas`;
    if (summary.status === 'reading') status.replaceChildren(`Lendo os arquivos… ${plural(c.items, 'capa encontrada', 'capas encontradas')} até agora.`);
    else if (summary.status === 'working') status.replaceChildren('Carimbando ', h('b', { class: 'num' }, `${c.done} de ${c.items}`), ' capas.');
    else status.replaceChildren(h('b', null, plural(c.done, 'capa pronta', 'capas prontas')), `, ${plural(c.outputs, 'imagem', 'imagens')} para enviar à loja.`);
    const total = Math.max(1, c.items + c.errors);
    bar.style.width = `${Math.round(((c.done + c.errors) / total) * 100)}%`;
    progress.setAttribute('aria-valuemax', String(total)); progress.setAttribute('aria-valuenow', String(c.done + c.errors));
    progress.classList.toggle('is-done', summary.status === 'done');

    const ready = summary.status === 'done' && c.outputs > 0;
    actions.replaceChildren(
      h('button', { class: 'btn', type: 'button', disabled: !ready, onclick: openFolder }, icon('folder'), 'Abrir pasta'),
      stampButton(c.outputs ? `Baixar ZIP (${plural(c.outputs, 'imagem', 'imagens')})` : 'Baixar ZIP', 'download', { href: ready ? `/api/batches/${id}/zip` : null, download: ready ? '' : null, disabled: !ready }));

    const kit = ctx.state.kit;
    const phrase = summary.label && summary.label !== 'auto' ? summary.label : 'auto';
    put(controls,
      h('div', { class: 'control' }, h('span', { class: 'field-label' }, 'Plataforma'),
        seg([['auto', 'Pelo nome'], ['PS4', 'PS4'], ['PS5', 'PS5'], ['both', 'PS4 e PS5']], summary.platformMode, v => patchBatch({ platformMode: v }), 'Plataforma de todas as capas')),
      h('div', { class: 'control' }, h('span', { class: 'field-label' }, 'Frase'),
        seg([['auto', 'Padrão'], ...LABEL_KEYS.map(k => [k, phraseName(kit, k)])], phrase, v => patchBatch({ label: v }), 'Frase do selo de todas as capas')),
      summary.modified && h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: resetChoices }, icon('undo'), 'Desfazer escolhas'),
      phrase === 'auto' && h('p', { class: 'control-hint' }, `Padrão do kit: ${phrasesLine(kit, kit.output.phrase)}.`));
    renderNotes(); renderFilters();
  }

  async function openFolder() {
    try { await api(`/api/batches/${id}/open`, { method: 'POST' }); ctx.toast(`A pasta com as imagens prontas foi aberta no ${FILE_MANAGER}.`); }
    catch (e) { ctx.toast(e.message, { tone: 'error' }); }
  }
  // Platforms and phrases go back to what the file names and the kit decide;
  // covers taken out of the batch come back.
  async function resetChoices() {
    const result = await patchBatch({ reset: true });
    if (result) ctx.toast('Escolhas desfeitas: cada capa voltou à plataforma do nome do arquivo e à frase padrão do kit.');
  }

  function renderNotes() {
    const c = summary.counts, list = [];
    const fallback = ctx.state.kit.output.fallback;
    if (c.fallback && summary.platformMode === 'auto') {
      const other = fallback.length === 2 ? null : fallback[0] === 'PS4' ? 'PS5' : 'PS4';
      list.push(h('div', { class: 'note' },
        h('p', null, `${plural(c.fallback, 'capa não tem', 'capas não têm')} PS4 ou PS5 no nome e ${c.fallback === 1 ? 'saiu' : 'saíram'} como ${orderLabel(fallback)}, o padrão do kit.`),
        other && h('button', { class: 'btn btn-small', type: 'button', onclick: () => patchBatch({ fallbackPlatforms: [other] }) }, `Trocar para ${other}`),
        fallback.length === 2
          ? [h('button', { class: 'btn btn-small', type: 'button', onclick: () => patchBatch({ fallbackPlatforms: ['PS4'] }) }, 'Só PS4'), h('button', { class: 'btn btn-small', type: 'button', onclick: () => patchBatch({ fallbackPlatforms: ['PS5'] }) }, 'Só PS5')]
          : h('button', { class: 'btn btn-small', type: 'button', onclick: () => patchBatch({ fallbackPlatforms: ['PS4', 'PS5'] }) }, 'Fazer PS4 e PS5')));
    }
    if (c.stale) list.push(h('div', { class: 'note note-info' },
      h('p', null, `O kit da loja mudou depois que ${c.stale === 1 ? 'uma capa foi carimbada' : `${c.stale} capas foram carimbadas`}.`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => api(`/api/batches/${id}/reapply`, { method: 'POST' }).catch(e => ctx.toast(e.message, { tone: 'error' })) }, icon('refresh'), 'Aplicar o kit atual')));
    if (c.flagged) list.push(h('div', { class: 'note' },
      h('p', null, `${plural(c.flagged, 'capa parece', 'capas parecem')} já ter o selo. Confira para não carimbar duas vezes.`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => setFilter('check') }, 'Mostrar')));
    if (c.errors) list.push(h('div', { class: 'note note-error' },
      h('p', null, `${plural(c.errors, 'arquivo não abriu', 'arquivos não abriram')}: ${c.errors === 1 ? 'a imagem está corrompida' : 'as imagens estão corrompidas'} ou em formato sem suporte.`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => setFilter('errors') }, 'Mostrar')));
    for (const e of summary.ingest.errors ?? []) list.push(h('div', { class: 'note note-error' }, h('p', null, `${e.file}: ${e.error}`)));
    if (summary.ingest.ignored) list.push(h('p', { class: 'note-line' },
      `${plural(summary.ingest.ignored, 'arquivo foi ignorado', 'arquivos foram ignorados')} por não ${summary.ingest.ignored === 1 ? 'ser imagem' : 'serem imagens'}${summary.ingest.ignoredSample?.length ? ` (${summary.ingest.ignoredSample.map(fileName).join(', ')}${summary.ingest.ignored > summary.ingest.ignoredSample.length ? '…' : ''})` : ''}.`));
    if (!ctx.state.kit.logo) list.push(h('div', { class: 'note note-info' },
      h('p', null, 'O kit ainda não tem a logo da loja, então estas capas saíram só com o selo.'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.addLogo() }, 'Adicionar logo')));
    notes.replaceChildren(...list);
  }

  function renderFilters() {
    const all = [...items.values()];
    const check = all.filter(needsCheck).length, errors = all.filter(i => i.status === 'error' && !i.excluded).length;
    if (filter === 'check' && !check) filter = 'all';
    if (filter === 'errors' && !errors) filter = 'all';
    const option = (key, text, n) => h('button', { type: 'button', 'aria-pressed': String(filter === key), onclick: () => setFilter(key) }, `${text} `, h('span', { class: 'num' }, `(${n})`));
    filters.hidden = !check && !errors;
    put(filters, option('all', 'Todas', all.length), check ? option('check', 'Para conferir', check) : null, errors ? option('errors', 'Não abriram', errors) : null);
  }
  function setFilter(next) { filter = next; renderFilters(); for (const item of items.values()) applyFilter(item); }
  const matches = item => filter === 'all' || (filter === 'check' && needsCheck(item)) || (filter === 'errors' && item.status === 'error' && !item.excluded);
  function applyFilter(item) { const el = cards.get(item.id); if (el) el.hidden = !matches(item); }
  const visible = () => [...items.values()].filter(matches).map(i => i.id);

  // --- cards ----------------------------------------------------------------
  function fillCard(el, item, previous) {
    el.dataset.status = item.status;
    el.classList.toggle('is-excluded', !!item.excluded);
    const done = item.status === 'done' && item.outputs?.length;
    const img = done ? h('img', { src: thumb(item, item.outputs[0].platform), alt: `Capa carimbada: ${fileName(item.source)}`, loading: 'lazy', decoding: 'async' })
      : item.rev > 0 && item.status !== 'error' ? h('img', { src: thumb(item, 'orig'), alt: '', loading: 'lazy' }) : null;
    const state = item.excluded ? 'Fora do lote' : item.status === 'queued' ? 'Na fila' : item.status === 'working' ? 'Carimbando…' : item.status === 'error' ? 'Não abriu' : null;
    const mat = h('div', { class: 'cover-mat', onclick: () => inspect(item.id) }, img, state && h('span', { class: 'cover-state' }, state));
    const chips = ['PS4', 'PS5'].map(p => h('button', {
      class: 'chip', type: 'button', dataset: { platform: p }, 'aria-pressed': String(item.platforms?.includes(p)),
      'aria-label': `${p}: ${item.platforms?.includes(p) ? 'gerar' : 'não gerar'} imagem`, disabled: item.excluded || item.status === 'error',
      onclick: e => { e.stopPropagation(); togglePlatform(item, p); },
      onmouseenter: () => { const out = item.outputs?.find(o => o.platform === p); const im = mat.querySelector('img'); if (out && im) im.src = thumb(item, p); },
      onmouseleave: () => { const im = mat.querySelector('img'); if (done && im) im.src = thumb(item, item.outputs[0].platform); },
    }, p));
    const flag = !item.excluded && item.flags?.find(f => CHECK_FLAGS.includes(f.code));
    el.replaceChildren(mat, h('div', { class: 'cover-meta' },
      h('span', { class: 'cover-name', title: item.source }, fileName(item.source)),
      item.status !== 'error' && h('div', { class: 'cover-chips' }, chips, h('span', { class: 'cover-src' }, [PLATFORM_SOURCE_SHORT[item.platformSource], item.labelSource && item.labelSource !== 'padrão' && item.labels && phraseName(ctx.state.kit, Object.values(item.labels)[0]).toLocaleLowerCase('pt-BR')].filter(Boolean).join(', '))),
      flag && h('p', { class: 'cover-flag' }, icon('alert'), SHORT_FLAG[flag.code] ?? flag.text),
      item.status === 'error' && h('p', { class: 'cover-error' }, item.error)));
    if (done && previous && previous.status !== 'done') {
      el.classList.add('is-new');
      el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
    }
  }
  function updateCard(item, previous) {
    let el = cards.get(item.id);
    if (!el) {
      el = h('article', { class: 'cover', tabindex: '0', onkeydown: e => { if (e.key === 'Enter' && e.target === el) inspect(item.id); } });
      cards.set(item.id, el); grid.append(el);
    }
    fillCard(el, item, previous);
    applyFilter(item);
  }
  async function togglePlatform(item, platform) {
    const next = item.platforms.includes(platform) ? item.platforms.filter(p => p !== platform) : [...item.platforms, platform];
    if (!next.length) return ctx.toast('Cada capa precisa sair em pelo menos uma plataforma.');
    await patchItem(item, { platforms: next });
  }
  function inspect(itemId) {
    const ids = visible();
    inspector = openInspector(ctx, {
      batchId: id, ids, index: Math.max(0, ids.indexOf(itemId)), getItem: key => items.get(key), batchLabel: () => summary?.label,
      patch: patchItem, onClose: () => { inspector = null; cards.get(ids[0])?.focus?.({ preventScroll: true }); },
    });
  }

  // --- live updates ---------------------------------------------------------
  const close = stream(`/api/batches/${id}/events`, {
    snapshot: data => {
      const { items: list, ...rest } = data;
      summary = rest;
      for (const item of list) { const previous = items.get(item.id); items.set(item.id, item); updateCard(item, previous); }
      renderHead();
    },
    item: item => { const previous = items.get(item.id); items.set(item.id, item); updateCard(item, previous); inspector?.refresh(item); renderFilters(); },
    batch: data => { summary = { ...summary, ...data }; renderHead(); },
    kit: kit => { ctx.setKit(kit); api(`/api/batches/${id}`).then(data => { const { items: list, ...rest } = data; summary = rest; for (const item of list) { items.set(item.id, item); updateCard(item); } renderHead(); }).catch(() => {}); },
    removed: () => { location.hash = '#/'; },
  });
  return () => { close(); inspector?.close(); };
}
