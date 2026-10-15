import { h, icon, fill } from './dom.js';
import { size, fileName, phraseName, phrasesLine, LABEL_KEYS, PLATFORM_SOURCE } from './util.js';

// One cover at full size: original and stamped result under a draggable divider.
export function openInspector(ctx, { batchId, ids, index, getItem, batchLabel, patch, onClose }) {
  const dialog = document.getElementById('inspector');
  let position = index, platform = null, split = 50;

  const keys = e => {
    if (e.target.closest('input[type="radio"]')) return;
    if (e.key === 'ArrowRight' && e.target.type !== 'range') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft' && e.target.type !== 'range') { e.preventDefault(); go(-1); }
  };
  const closed = () => { dialog.removeEventListener('keydown', keys); dialog.removeEventListener('close', closed); dialog.removeEventListener('click', backdrop); onClose?.(); };
  const backdrop = e => { if (e.target === dialog) dialog.close(); };
  function go(step) {
    const next = position + step;
    if (next < 0 || next >= ids.length) return;
    position = next; platform = null; render();
  }

  function compare(item, output) {
    const before = h('img', { class: 'compare-before', src: `/api/batches/${batchId}/items/${item.id}/thumb/orig?v=${item.rev}`, alt: 'Capa original', draggable: false });
    const after = h('img', { src: `/api/batches/${batchId}/items/${item.id}/output/${output.platform}?v=${item.rev}`, alt: `Capa com selo ${output.platform}`, draggable: false });
    const range = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(split), 'aria-label': 'Comparar original e resultado' });
    const box = h('div', { class: 'compare', style: { '--ratio': `${item.width} / ${item.height}`, '--pos': `${split}%` } },
      after, before, h('span', { class: 'compare-handle', 'aria-hidden': 'true' }),
      h('span', { class: 'compare-tag is-before' }, 'Original'), h('span', { class: 'compare-tag is-after' }, 'Com selo'), range);
    const set = value => { split = Math.min(100, Math.max(0, value)); box.style.setProperty('--pos', `${split}%`); range.value = String(Math.round(split)); };
    range.addEventListener('input', () => set(Number(range.value)));
    box.addEventListener('pointerdown', e => {
      if (e.target === range) return;
      box.setPointerCapture(e.pointerId);
      const move = ev => { const r = box.getBoundingClientRect(); set(((ev.clientX - r.left) / r.width) * 100); };
      move(e);
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', () => box.removeEventListener('pointermove', move), { once: true });
    });
    return box;
  }

  function render() {
    const item = getItem(ids[position]);
    if (!item) return dialog.close();
    const outputs = item.outputs ?? [];
    if (!platform || !outputs.some(o => o.platform === platform)) platform = outputs[0]?.platform ?? null;
    const output = outputs.find(o => o.platform === platform);

    const head = h('div', { class: 'insp-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Capa anterior', disabled: position === 0, onclick: () => go(-1) }, icon('back')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Próxima capa', disabled: position === ids.length - 1, onclick: () => go(1) }, icon('next')),
      h('h2', { id: 'inspectorTitle', title: item.source }, fileName(item.source)),
      h('span', { class: 'insp-pos num' }, `${position + 1} de ${ids.length}`),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('close')));

    const stage = h('div', { class: 'insp-stage' },
      outputs.length > 1 && h('div', { class: 'insp-tabs', role: 'group', 'aria-label': 'Ver plataforma' },
        outputs.map(o => h('button', { class: 'chip', type: 'button', dataset: { platform: o.platform }, 'aria-pressed': String(o.platform === platform), onclick: () => { platform = o.platform; render(); } }, o.platform))),
      output && !item.excluded ? compare(item, output)
        : h('p', { class: 'source' }, item.status === 'error' ? item.error : item.excluded ? 'Esta capa está fora do lote.' : 'Ainda carimbando…'));

    const platforms = h('section', null, h('h3', null, 'Plataformas'),
      h('div', { class: 'row' }, ['PS4', 'PS5'].map(p => h('button', {
        class: 'chip', type: 'button', dataset: { platform: p }, 'aria-pressed': String(item.platforms?.includes(p)), disabled: item.excluded || item.status === 'error',
        onclick: () => {
          const next = item.platforms.includes(p) ? item.platforms.filter(x => x !== p) : [...item.platforms, p];
          if (!next.length) return ctx.toast('Cada capa precisa sair em pelo menos uma plataforma.');
          patch(item, { platforms: next });
        },
      }, p))),
      h('p', { class: 'hint' }, item.platformSource === 'manual' ? 'Escolhida aqui. ' : `Definida ${PLATFORM_SOURCE[item.platformSource] ?? ''}. `,
        item.platformSource === 'manual' && h('button', { class: 'link', type: 'button', onclick: () => patch(item, { platforms: null }) }, 'Voltar ao automático')));

    // "auto" follows the batch's phrase, or the kit's phrase for each platform.
    const kit = ctx.state.kit, fromBatch = batchLabel?.();
    const own = item.override?.label ?? 'auto';
    const phrases = [['auto', fromBatch && fromBatch !== 'auto' ? `Igual ao lote (${phraseName(kit, fromBatch)})` : 'Padrão do kit'], ...LABEL_KEYS.map(k => [k, phraseName(kit, k)])];
    const label = h('section', null, h('h3', null, 'Frase do selo'),
      phrases.map(([key, text]) => h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'label', value: key, checked: own === key, disabled: item.excluded || item.status === 'error', onchange: () => patch(item, { label: key === 'auto' ? null : key }) }),
        text)),
      item.labels && Object.keys(item.labels).length > 0 && h('p', { class: 'hint' }, `Nesta capa: ${phrasesLine(kit, item.labels)}.`));

    const files = outputs.length > 0 && !item.excluded && h('section', null, h('h3', null, outputs.length > 1 ? 'Imagens prontas' : 'Imagem pronta'),
      h('ul', { class: 'files' }, outputs.map(o => h('li', null,
        h('span', { class: 'name' }, o.name),
        h('span', { class: 'meta num' }, `${o.width} × ${o.height}, ${size(o.bytes)}`),
        h('a', { class: 'btn btn-small', href: `/api/batches/${batchId}/items/${item.id}/output/${o.platform}?download`, download: o.name }, icon('download'), 'Baixar')))));

    const source = h('section', null, h('h3', null, 'Arquivo de origem'),
      h('p', { class: 'source' }, item.source),
      item.sourceWidth && h('p', { class: 'source num' }, `${item.sourceWidth} × ${item.sourceHeight}, ${size(item.bytes)}`));

    const flags = item.flags?.filter(f => f.code !== 'no-logo') ?? [];
    const notes = flags.length > 0 && !item.excluded && h('section', null, h('h3', null, 'Para conferir'), h('ul', { class: 'flags' }, flags.map(f => h('li', null, f.text))));

    const adjusted = !item.excluded && (item.override?.platforms || item.override?.label);
    const foot = h('div', { class: 'insp-foot row' }, item.excluded
      ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => patch(item, { excluded: false }) }, icon('undo'), 'Devolver ao lote')
      : [adjusted && h('button', { class: 'btn btn-small', type: 'button', onclick: () => patch(item, { reset: true }) }, icon('undo'), 'Desfazer ajustes desta capa'),
        h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => patch(item, { excluded: true }) }, icon('trash'), 'Tirar do lote')]);

    fill(dialog, head, h('div', { class: 'insp-body' }, stage, h('div', { class: 'insp-panel' }, platforms, label, files, notes, source, foot)));
  }

  render();
  dialog.addEventListener('keydown', keys);
  dialog.addEventListener('close', closed);
  dialog.addEventListener('click', backdrop);
  if (!dialog.open) dialog.showModal();
  return {
    refresh(item) { if (dialog.open && item.id === ids[position]) render(); },
    close() { if (dialog.open) dialog.close(); },
  };
}
