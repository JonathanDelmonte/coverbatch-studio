import { h, icon, stampButton } from './dom.js';
import { plural, when, displayTitle, MOD_KEY } from './util.js';

function giantSelo(regular, bold) {
  return h('div', { class: 'selo selo-giant', 'aria-hidden': 'true' },
    h('span', { class: 'selo-block' }, (() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('class', 'selo-glyph');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M24 7v25m-10-10 10 10 10-10M9 33v8h30v-8');
      svg.append(path); return svg;
    })()),
    h('span', { class: 'selo-text' }, h('span', null, regular), ' ', h('b', null, bold)));
}

export function batchLine(b) {
  const c = b.counts;
  if (b.status === 'reading') return ['Lendo os arquivos…'];
  if (b.status === 'working') return [`Carimbando: ${c.done} de ${c.items} prontas.`];
  const done = `${plural(c.done, 'capa', 'capas')}, ${plural(c.outputs, 'imagem pronta', 'imagens prontas')}.`;
  return c.errors ? [done, ' ', h('span', { class: 'warn' }, `${plural(c.errors, 'arquivo não abriu', 'arquivos não abriram')}.`)] : [done];
}

export function renderHome(view, ctx) {
  const { kit, batches } = ctx.state;
  const logo = kit.logo
    ? h('img', { class: 'stage-logo', src: `/api/kit/logo.png?v=${kit.revision}`, alt: 'Logo da loja', style: { '--logo-opacity': kit.logoOpacity } })
    : h('p', { class: 'stage-logo-missing' }, 'A logo da loja entra aqui.');

  const stage = h('div', {
    class: 'stage', role: 'button', tabindex: '0', 'aria-label': 'Escolher capas para carimbar',
    onclick: () => ctx.pickFiles(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.pickFiles(); } },
  },
  h('p', { class: 'stage-intro' }, 'Arraste para cá um ZIP, uma pasta ou as imagens das capas. Cada capa sai com o selo da plataforma e a logo da loja, prontas para o produto.'),
  h('div', { class: 'stage-foot' }, giantSelo('Solte', 'aqui'), logo));

  const actions = h('div', { class: 'home-actions' },
    stampButton('Escolher arquivos', 'upload', { onclick: () => ctx.pickFiles() }),
    h('button', { class: 'btn', type: 'button', onclick: () => ctx.pickFolder() }, icon('folder'), 'Escolher pasta'),
    h('p', null, 'Também dá para colar uma imagem com ', h('span', { class: 'keys' }, h('span', { class: 'kbd' }, MOD_KEY), ' + ', h('span', { class: 'kbd' }, 'V')), '.'));

  const missingLogo = !kit.logo && h('div', { class: 'notice-logo' },
    h('p', null, 'A logo da loja ainda não foi adicionada. Até lá, as capas saem só com o selo.'),
    h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.addLogo() }, 'Adicionar logo'));

  // Until the first batch, three steps say what happens; the help has the rest.
  const firstRun = batches.length === 0 && h('section', { class: 'first-run', 'aria-labelledby': 'firstRunTitle' },
    h('h2', { id: 'firstRunTitle' }, 'Como funciona'),
    h('ol', { class: 'first-steps' },
      h('li', null, h('b', null, 'Solte as capas'), h('span', null, 'Um ZIP, uma pasta ou as imagens. PS4 ou PS5 vem do nome de cada arquivo.')),
      h('li', null, h('b', null, 'Confira'), h('span', null, 'Cada capa aparece pronta. Clique numa para ver o antes e o depois.')),
      h('li', null, h('b', null, 'Baixe'), h('span', null, 'Um ZIP com todas as imagens, prontas para os produtos da loja.'))),
    h('button', { class: 'link', type: 'button', onclick: () => ctx.openHelp() }, 'Ver a ajuda completa'));

  const history = batches.length > 0 && h('section', { class: 'history', 'aria-labelledby': 'historyTitle' },
    h('h2', { id: 'historyTitle' }, 'Lotes anteriores'),
    h('ul', { class: 'history-list' }, batches.map(b => {
      const open = () => ctx.openBatch(b.id);
      const ready = b.status === 'done' && b.counts.outputs > 0;
      return h('li', { class: 'history-row', tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
        h('div', { class: 'fan', 'aria-hidden': 'true' }, b.preview.slice(0, 3).map(p => h('img', { src: `/api/batches/${b.id}/items/${p.id}/thumb/${p.platform}?v=${p.rev}`, alt: '', loading: 'lazy' })), b.preview.length ? null : h('span')),
        h('div', { style: { 'min-width': '0' } },
          h('p', { class: 'history-name' }, displayTitle(b.title)),
          h('p', { class: 'history-meta' }, `${when(b.createdAt)}. `, batchLine(b))),
        h('a', {
          class: 'btn btn-small', href: ready ? `/api/batches/${b.id}/zip` : null, 'aria-disabled': String(!ready),
          onclick: e => e.stopPropagation(), download: '',
        }, icon('download'), 'Baixar ZIP'));
    })));

  view.replaceChildren(h('div', { class: 'home' }, stage, actions, missingLogo, firstRun, history));
}
