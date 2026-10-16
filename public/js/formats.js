import { h } from './dom.js';
import { FORMATS, FORMAT_KEYS } from './framing.js';

export { FORMATS, FORMAT_KEYS };
// How a fit reads inside a sentence: "Padrão do kit: …; arte preenchendo a capa."
export const FIT_PHRASES = { cover: 'arte preenchendo a capa', contain: 'arte inteira com fundo desfocado' };
export const FIT_OPTIONS = [['cover', 'Preencher'], ['contain', 'Capa inteira']];
export const formatSize = key => (FORMATS[key]?.width ? `${FORMATS[key].width} × ${FORMATS[key].height}` : '');

// The proportion of a format drawn as a small frame; Original gets a dashed one.
export function ratioIcon(key) {
  const f = FORMATS[key];
  return h('span', { class: `ratio${f?.width ? '' : ' is-free'}`, style: f?.width ? { '--ar': `${f.width} / ${f.height}` } : null, 'aria-hidden': 'true' });
}

// Choices for seg(): every format with its shape, after an optional "auto" one.
export function formatOptions(auto) {
  return [...(auto ? [['auto', auto]] : []), ...FORMAT_KEYS.map(key => [key, [ratioIcon(key), FORMATS[key].short]])];
}

// The formats as tiles with shape, name and size, for the Kit da loja.
export function formatGrid(value, onChange) {
  return h('div', { class: 'format-grid', role: 'group', 'aria-label': 'Formato da imagem' }, FORMAT_KEYS.map(key => h('button', {
    type: 'button', 'aria-pressed': String(key === value), onclick: () => { if (key !== value) onChange(key); },
    // Name and size are separate blocks; spoken as one phrase, with a pause between them.
    'aria-label': `${FORMATS[key].name}, ${formatSize(key) || 'sem recorte'}`,
  }, ratioIcon(key), h('span', { class: 'format-name' }, FORMATS[key].name), h('span', { class: 'format-size num' }, formatSize(key) || 'Sem recorte'))));
}
