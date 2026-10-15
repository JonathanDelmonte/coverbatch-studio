const IMAGE = /\.(jpe?g|jfif|png|webp|avif|gif|tiff?)$/i;
const ZIP = /\.zip$/i;
const JUNK = /(^|\/)(__MACOSX|\.[^/]*|thumbs\.db|desktop\.ini)(\/|$)/i;

export const accepted = path => !JUNK.test(path) && (IMAGE.test(path) || ZIP.test(path));

// Folders are walked here, in the browser: the server only receives the image
// and ZIP files, each with its relative path (the folder names carry PS4/PS5).
export async function collectDrop(dataTransfer) {
  const entries = [...dataTransfer.items].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return { list: [...dataTransfer.files].map(file => ({ file, path: file.name })), roots: [...dataTransfer.files].map(f => f.name) };
  const list = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      list.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, '');
  return { list, roots: entries.map(e => e.name) };
}

export function fromInput(input) {
  const list = [...input.files].map(file => ({ file, path: file.webkitRelativePath || file.name }));
  const roots = [...new Set(list.map(e => e.path.split('/')[0]))];
  input.value = '';
  return { list, roots };
}

export function titleFor(roots, list) {
  if (roots.length === 1) return roots[0];
  const n = list.length;
  if (n === 1) return list[0].path.split('/').pop();
  return list.every(e => IMAGE.test(e.path)) ? `${n} imagens` : `${n} arquivos`;
}

// The whole window is a drop target. A depth counter avoids flicker when the
// pointer crosses child elements.
export function installDrop({ veil, count, onDrop, enabled }) {
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const hide = () => { depth = 0; veil.hidden = true; };
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e) || !enabled()) return;
    e.preventDefault();
    if (depth++ === 0) {
      const n = e.dataTransfer.items?.length ?? 0;
      count.textContent = n > 1 ? `${n} itens` : '';
      veil.hidden = false;
    }
  });
  window.addEventListener('dragover', e => { if (hasFiles(e) && enabled()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) hide(); });
  window.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    if (!enabled()) return;
    onDrop(await collectDrop(e.dataTransfer));
  });
  window.addEventListener('blur', hide);
}

export function installPaste(onPaste) {
  window.addEventListener('paste', e => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const stamp = new Date().toTimeString().slice(0, 8).replaceAll(':', '');
    const list = files.map((file, i) => ({ file, path: `imagem-colada-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` }));
    onPaste({ list, roots: ['Imagem colada'] });
  });
}
