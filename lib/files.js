import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`Arquivo de dados ilegível: ${file}. Preserve-o e restaure um backup.`, { cause: e }); }
}

// Write to a temporary file and rename over the target, so a crash never leaves a
// half-written JSON. Windows antivirus/indexers may briefly lock the target.
export async function writeAtomic(file, contents) {
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, contents);
  for (let attempt = 0; ; attempt++) {
    try { await rename(temp, file); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 6) { await unlink(temp).catch(() => {}); throw e; }
      await sleep(40 * (attempt + 1));
    }
  }
}
export const writeJSON = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2));
