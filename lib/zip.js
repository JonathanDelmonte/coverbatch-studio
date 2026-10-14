import yauzl from 'yauzl';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';

export function safeName(name) {
  const n = String(name).replaceAll('\\', '/');
  if (n.startsWith('/') || /^[a-z]:/i.test(n) || n.split('/').includes('..') || n.includes('\0')) throw new Error('Caminho inseguro no ZIP.');
  return n;
}

// Process one bounded entry at a time. Never extract user paths to the filesystem.
export async function readZip(file, onEntry) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (e, z) => e ? reject(e) : resolve(z)));
  let count = 0, total = 0;
  await new Promise((resolve, reject) => {
    let stopped = false;
    const fail = e => { if (!stopped) { stopped = true; zip.close(); reject(e); } };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', async entry => {
      try {
        const name = safeName(entry.fileName);
        if (++count > 12000 || (total += entry.uncompressedSize) > 2_000_000_000 || entry.uncompressedSize > 100_000_000) throw new Error('ZIP excede os limites de importação (12 mil entradas / 2 GB / 100 MB por arquivo).');
        if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) throw new Error('Links simbólicos não são aceitos.');
        if (!name.endsWith('/')) {
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (e, s) => e ? rej(e) : res(s)));
          const chunks = []; let bytes = 0;
          for await (const chunk of stream) { if ((bytes += chunk.length) > 100_000_000) throw new Error('Arquivo muito grande.'); chunks.push(chunk); }
          await onEntry(name, Buffer.concat(chunks));
        }
        if (!stopped) zip.readEntry();
      } catch (e) { fail(e); }
    });
    zip.readEntry();
  });
}

export async function writeZip(file, entries) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(file);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve); output.on('error', reject);
    archive.on('error', reject); archive.on('warning', reject);
    archive.pipe(output);
    for (const e of entries) {
      const opts = { name: safeName(e.name), date: new Date('2000-01-01T00:00:00Z') };
      if (e.path) archive.file(e.path, opts); else archive.append(e.bytes, opts);
    }
    archive.finalize().catch(reject);
  });
}
