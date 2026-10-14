import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeZip } from '../lib/zip.js';
const root = path.resolve('.'); const entries = [];
const allowedDirs = new Set(['lib', 'public', 'test', 'scripts']);
const allowedFiles = new Set(['package.json', 'package-lock.json', 'README.md', '.gitignore', 'server.js', 'iniciar.cmd']);
async function collect(dir, prefix = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + e.name;
    if (e.isDirectory() && (!prefix ? allowedDirs.has(e.name) : true)) await collect(path.join(dir, e.name), relative + '/');
    else if (e.isFile() && (prefix ? /\.(js|css|html|md|json)$/.test(e.name) : allowedFiles.has(e.name))) entries.push({ name: `coverbatch-studio/${relative}`, path: path.join(dir, e.name) });
  }
}
await collect(root); await mkdir(path.join(root, 'outputs'), { recursive: true });
await writeZip(path.join(root, 'outputs', 'coverbatch-studio-codigo.zip'), entries);
console.log(`Código empacotado: ${entries.length} arquivos; nenhum dado local ou imagem incluído.`);
