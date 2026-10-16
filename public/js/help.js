import { h, icon, fill } from './dom.js';
import { api } from './api.js';
import { IS_MAC, MOD_KEY, FILE_MANAGER, phraseName } from './util.js';

// Everything the program does, in the order the person meets it. Platform words
// (Finder or Explorador, Cmd or Ctrl) follow the computer it runs on.
export function openHelp(ctx) {
  const dialog = document.getElementById('helpSheet');
  const { kit, system, profile, version } = ctx.state;
  const mac = system ? system.platform === 'darwin' : IS_MAC;
  const name = profile?.title || 'Criador de capas';
  const kbd = text => h('span', { class: 'kbd' }, text);
  const combo = (...keys) => h('span', { class: 'keys' }, keys.flatMap((k, i) => (i ? [' + ', kbd(k)] : [kbd(k)])));
  const phrases = kit.output.phrase.PS4 === kit.output.phrase.PS5
    ? `${phraseName(kit, kit.output.phrase.PS4).toLocaleLowerCase('pt-BR')} nas duas plataformas`
    : `${phraseName(kit, kit.output.phrase.PS4).toLocaleLowerCase('pt-BR')} no PS4 e ${phraseName(kit, kit.output.phrase.PS5).toLocaleLowerCase('pt-BR')} no PS5`;
  const section = (title, ...body) => h('section', { class: 'help-section' }, h('h3', null, title), ...body);
  const example = (file, result) => h('li', null, h('span', { class: 'help-file' }, file), h('span', { class: 'help-result' }, result));
  const sticker = (platform, key) => h('img', { class: 'help-sticker', src: `/api/kit/sticker.png?platform=${platform}&label=${key}&h=56&v=${kit.revision}`, alt: `${platform}: ${phraseName(kit, key)}`, width: '191', height: '28' });
  const fallback = kit.output.fallback.length === 2 ? 'PS4 e PS5' : kit.output.fallback[0];

  const body = h('div', { class: 'sheet-body' },
    section('Em três passos',
      h('ol', { class: 'help-steps' },
        h('li', null, h('b', null, 'Solte as capas. '), 'Arraste para a janela um ZIP, uma pasta ou as imagens, ou use "Escolher arquivos". Também dá para colar uma imagem com ', combo(MOD_KEY, 'V'), '.'),
        h('li', null, h('b', null, 'Confira. '), 'Cada capa aparece com o selo no canto inferior esquerdo e a logo da loja no direito. Clique numa capa para ver o antes e o depois em tamanho grande.'),
        h('li', null, h('b', null, 'Baixe. '), `"Baixar ZIP" junta todas as imagens prontas na pasta Downloads. "Abrir pasta" mostra os arquivos no ${FILE_MANAGER}.`))),

    section('PS4 ou PS5',
      h('p', null, 'O programa procura PS4 ou PS5 no nome do arquivo, depois no nome da pasta e por fim no nome do ZIP.'),
      h('ul', { class: 'help-examples' },
        example('fc-27-ps4.jpg', 'PS4'),
        example('pasta PS5 (com as capas dentro)', 'PS5'),
        example('fc-27-ps4-ps5.jpg', 'duas imagens, PS4 e PS5'),
        example('fc-27.jpg (sem plataforma no nome)', `${fallback}, com aviso`)),
      h('p', null, 'Em cada capa, os botões PS4 e PS5 ligam ou desligam aquela versão. No topo do lote, "Plataforma" troca todas de uma vez.')),

    section('Frase do selo',
      h('div', { class: 'help-stickers' }, [['PS4', 'immediate'], ['PS5', 'access'], ['PS4', 'preorder']].map(([p, key]) => sticker(p, key))),
      h('p', null, `Envio imediato, Acesso imediato e Pré-venda. Cada plataforma tem a sua frase padrão: hoje, ${phrases} (muda em Kit da loja, Imagens finais).`),
      h('p', null, 'No topo do lote, "Frase" troca a de todas as capas. Na capa aberta em tamanho grande, dá para escolher só para ela.')),

    section('Formato e enquadramento',
      h('p', null, '"Formato", no topo do lote, escolhe como as imagens saem: Original (a capa inteira, no formato da imagem enviada; as da PlayStation Store são quadradas) ou um formato fixo: Retrato 4:5 (1200 × 1500), Quadrada 1:1, Retrato 3:4, Retrato 2:3, Paisagem 16:9 ou Story 9:16. O padrão fica no Kit da loja, em Imagens finais.'),
      h('p', null, '"Encaixe" decide o que acontece quando a arte tem outro formato: Preencher ocupa a capa toda e recorta o que sobra; Capa inteira mostra a arte toda e completa a capa com um fundo desfocado feito da própria arte.'),
      h('p', null, 'Título cortado? Abra a capa e clique em "Ajustar enquadramento" (ou dê dois cliques na imagem). Arraste a arte, aproxime ou afaste com a roda do mouse, o gesto de pinça ou o zoom e veja o selo e a logo onde vão ficar. "Aplicar" refaz só aquela capa.')),

    section('Avisos',
      h('p', null, h('span', { class: 'help-dot is-amber' }), 'Amarelo pede uma conferida: capa que parece já ter o selo (para não carimbar duas vezes), resolução baixa, ou capa sem plataforma no nome.'),
      h('p', null, h('span', { class: 'help-dot is-red' }), 'Vermelho é um arquivo que não abriu: imagem corrompida ou em formato sem suporte. As outras capas seguem normalmente.'),
      h('p', null, h('span', { class: 'help-dot' }), 'Cinza avisa que o kit mudou depois que o lote foi carimbado: "Aplicar o kit atual" refaz as imagens.')),

    section('Desfazer e restaurar',
      h('p', null, '"Desfazer escolhas", no topo do lote, devolve tudo ao automático: plataformas pelo nome e frase padrão do kit. Capas tiradas do lote voltam.'),
      h('p', null, '"Desfazer escolhas" não mexe nos enquadramentos ajustados à mão. "Desfazer ajustes desta capa", na capa aberta, volta tudo dela ao automático, inclusive o enquadramento.'),
      h('p', null, 'No Kit da loja, cada parte alterada ganha o botão "Restaurar original", e "Restaurar tudo", no fim do painel, volta ao kit que veio instalado. Logo depois de restaurar, "Desfazer" traz as suas alterações de volta.')),

    section('Kit da loja',
      h('p', null, 'A logo, os seis selos (PS4 e PS5 com as três frases), as cores, a posição e o tamanho de cada um e o formato das imagens finais. O que muda ali vale para os próximos lotes e é salvo na hora.'),
      h('p', null, 'A logo vai alinhada pelo centro do selo, com o mesmo peso visual seja ela larga ou quadrada. Em capas claras ela ganha uma sombra suave para não sumir.')),

    section('Seus arquivos',
      h('p', null, 'Tudo é feito neste computador: nenhuma capa vai para a internet. Os arquivos que você solta nunca são alterados; as imagens prontas são cópias novas.'),
      h('p', null, 'Os lotes ficam guardados até você excluir (no lote, "Excluir este lote").'),
      system?.dataDir && h('p', { class: 'help-path' }, system.dataDir),
      system?.dataDir && h('div', null, h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
        try { await api('/api/data/open', { method: 'POST' }); } catch (e) { ctx.toast(e.message, { tone: 'error' }); }
      } }, icon('folder'), 'Abrir a pasta dos dados'))),

    section('Fechar o programa',
      h('p', null, `Feche a janela. O ${name} termina sozinho alguns segundos depois. Um lote que estava sendo carimbado continua de onde parou na próxima vez.`),
      mac && h('p', null, 'Para abrir de novo, use o Launchpad, a pasta Aplicativos ou o Spotlight (', combo('⌘', 'Espaço'), ').'),
      !mac && h('p', null, 'Para abrir de novo, use o atalho na Área de Trabalho ou no menu Iniciar.')),

    section('Atalhos',
      h('dl', { class: 'help-keys' },
        h('dt', null, combo(MOD_KEY, 'V')), h('dd', null, 'Cola uma imagem copiada'),
        h('dt', null, kbd('←'), ' ', kbd('→')), h('dd', null, 'Capa anterior e próxima, com uma capa aberta'),
        h('dt', null, kbd('←'), ' ', kbd('↑'), ' ', kbd('→'), ' ', kbd('↓')), h('dd', null, 'Movem a arte, ao ajustar o enquadramento (com Shift, mais longe)'),
        h('dt', null, kbd('+'), ' ', kbd('−')), h('dd', null, 'Zoom da arte, ao ajustar o enquadramento'),
        h('dt', null, kbd('Esc')), h('dd', null, 'Fecha o painel aberto'),
        h('dt', null, kbd('?')), h('dd', null, 'Abre esta ajuda'))),

    h('p', { class: 'help-version' }, `${name}, versão ${version}.`));

  fill(dialog, h('div', { class: 'sheet-head' },
    h('h2', { id: 'helpTitle' }, 'Ajuda'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('close'))), body);
  dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
  if (!dialog.open) dialog.showModal();
}
