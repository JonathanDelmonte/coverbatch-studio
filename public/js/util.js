export const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export function size(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`;
}

export function when(iso) {
  const date = new Date(iso), now = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return `hoje, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `ontem, ${time}`;
  return `${date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}, ${time}`;
}

export const displayTitle = title => String(title || 'Lote').replace(/\.zip$/i, '');
export const fileName = source => String(source).split('/').pop();

export function debounce(fn, ms) {
  let timer;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  run.flush = (...args) => { clearTimeout(timer); return fn(...args); };
  return run;
}

export const PLATFORM_SOURCE = {
  nome: 'pelo nome do arquivo', pasta: 'pela pasta', lote: 'pelo nome do ZIP', padrão: 'padrão do kit', manual: 'escolhida aqui', todas: 'escolhida para o lote',
};
// Short form for the cards in the grid.
export const PLATFORM_SOURCE_SHORT = { nome: 'pelo nome', pasta: 'pela pasta', lote: 'pelo ZIP', padrão: 'padrão', manual: 'escolhida', todas: 'do lote' };
export const LABEL_KEYS = ['immediate', 'access', 'preorder'];
export const LABEL_NAMES = { immediate: 'Envio imediato', access: 'Acesso imediato', preorder: 'Pré-venda' };
// The phrase as the store wrote it in the kit, in sentence case for the interface.
export function phraseName(kit, key) {
  const label = kit?.sticker?.labels?.[key];
  if (!label) return LABEL_NAMES[key] ?? key;
  const text = [label.regular, label.bold].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}
// "Envio imediato no PS4 e Acesso imediato no PS5", or one phrase for both.
export function phrasesLine(kit, labels) {
  const entries = Object.entries(labels ?? {});
  if (!entries.length) return '';
  if (new Set(entries.map(([, key]) => key)).size === 1) return phraseName(kit, entries[0][1]);
  return entries.map(([p, key]) => `${phraseName(kit, key)} no ${p}`).join(' e ');
}

// The client works on a MacBook: shortcuts and the file manager follow the system.
export const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const FILE_MANAGER = IS_MAC ? 'Finder' : 'Explorador de Arquivos';
