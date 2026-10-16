import path from 'node:path';
import { mkdir, readdir, readFile, stat, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Kit } from '../lib/kit.js';
import { Batches } from '../lib/batch.js';
import { seedProfile } from '../lib/profile.js';
import { sha256 } from '../lib/files.js';
import { FITS, FORMAT_KEYS, normalizeFormat } from '../lib/framing.js';

// Runs the real pipeline on a client's covers and writes a contact sheet for a
// visual check. Results are private: they stay in work/ and outputs/.
//   npm run validate:real -- <zip-ou-pasta> [--logo logo.png|svg] [--profile pasta-do-perfil]
//     [--formato original|4x5|1x1|3x4|2x3|16x9|9x16] [--encaixe cover|contain]
const args = process.argv.slice(2);
const VALUED = ['--logo', '--profile', '--formato', '--encaixe'];
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!input) throw new Error('Uso: npm run validate:real -- "C:\\caminho\\capas.zip" [--logo logo.png] [--profile pasta] [--formato 4x5] [--encaixe contain]');
// Checked before any folder is created, so a typo leaves nothing behind.
if (flag('--formato') && !normalizeFormat(flag('--formato'))) throw new Error(`Formato desconhecido: ${flag('--formato')}. Use ${FORMAT_KEYS.join(', ')}.`);
if (flag('--encaixe') && !FITS.includes(flag('--encaixe'))) throw new Error(`Encaixe desconhecido: ${flag('--encaixe')}. Use ${FITS.join(' ou ')}.`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const data = path.resolve('work/private', `validacao-${stamp}`);
const out = path.resolve('outputs', `validacao-${stamp}`);
await mkdir(out, { recursive: true });

const kit = await new Kit(data).load();
let logoSource = 'TESTE (sintética)';
if (flag('--profile')) { await seedProfile(data, kit, flag('--profile')); logoSource = 'perfil privado'; }
else if (flag('--logo')) { await kit.setLogo(await readFile(path.resolve(flag('--logo'))), path.basename(flag('--logo'))); logoSource = path.basename(flag('--logo')); }
else await kit.setLogo(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="330" height="110"><text x="165" y="76" font-family="Arial" font-weight="700" font-size="60" letter-spacing="8" text-anchor="middle" fill="#fff">TESTE</text></svg>')).png().toBuffer(), 'TESTE.png');
// The format the store really uses (the kit's own otherwise); the kit validates both values.
if (flag('--formato') || flag('--encaixe')) await kit.update({ output: { ...(flag('--formato') && { size: flag('--formato') }), ...(flag('--encaixe') && { fit: flag('--encaixe') }) } });

const files = [];
const source = path.resolve(input);
if ((await stat(source)).isDirectory()) {
  const walk = async (dir, prefix) => { for (const e of await readdir(dir, { withFileTypes: true })) { if (e.isDirectory()) await walk(path.join(dir, e.name), `${prefix}${e.name}/`); else files.push({ path: path.join(dir, e.name), name: `${prefix}${e.name}` }); } };
  await walk(source, '');
} else files.push({ path: source, name: path.basename(source) });
// The batch removes uploaded temp files after reading them: give it copies.
await mkdir(path.join(data, 'entrada'), { recursive: true });
const copies = [];
for (const [i, f] of files.entries()) { const copy = path.join(data, 'entrada', `${i}`); await copyFile(f.path, copy); copies.push({ path: copy, name: f.name }); }

const started = Date.now();
const batches = await new Batches(data, kit).init();
const created = await batches.create({ files: copies, title: path.basename(source) });
let batch;
for (;;) { batch = batches.get(created.id); if (batches.idle(batch)) break; await new Promise(r => setTimeout(r, 100)); }
const seconds = (Date.now() - started) / 1000;
await batches.flush();

// Invariants: originals intact, every file decodes at the reported size, stamps inside the cover.
for (const item of batch.items) {
  assert.equal(sha256(await readFile(batches.pathOf(batch, 'in', item.file))), item.sha256, `original alterado: ${item.source}`);
  for (const o of item.outputs ?? []) {
    const bytes = await readFile(batches.pathOf(batch, 'out', o.name));
    const meta = await sharp(bytes).metadata(); await sharp(bytes).raw().toBuffer();
    assert.deepEqual([meta.width, meta.height], [o.width, o.height]);
    for (const box of [o.geometry.sticker, o.geometry.logo].filter(Boolean)) assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= o.width && box.top + box.height <= o.height, `fora da capa: ${o.name}`);
  }
}

// Contact sheet: every output, labelled, in a grid.
const outputs = batch.items.flatMap(i => (i.outputs ?? []).map(o => ({ ...o, flags: i.flags })));
const tile = 240, label = 40, cols = 6, rows = Math.max(1, Math.ceil(outputs.length / cols));
const composites = [];
for (const [i, o] of outputs.entries()) {
  const thumb = await sharp(batches.pathOf(batch, 'out', o.name)).resize(tile, tile, { fit: 'contain', background: '#eceef1' }).toBuffer();
  const x = (i % cols) * (tile + 16) + 16, y = Math.floor(i / cols) * (tile + label + 16) + 16;
  const warn = o.flags?.some(f => ['stamped', 'low-res'].includes(f.code));
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${label}"><text x="0" y="16" font-family="Arial" font-size="13" fill="${warn ? '#a35f00' : '#000'}">${o.name.replace(/[<&>]/g, '').slice(0, 34)}</text><text x="0" y="33" font-family="Arial" font-size="12" fill="#59616b">${o.width} × ${o.height}${warn ? ' · conferir' : ''}</text></svg>`);
  composites.push({ input: thumb, left: x, top: y }, { input: text, left: x, top: y + tile + 4 });
}
await sharp({ create: { width: cols * (tile + 16) + 16, height: rows * (tile + label + 16) + 16, channels: 3, background: '#ffffff' } })
  .composite(composites).jpeg({ quality: 88 }).toFile(path.join(out, 'folha-de-contato.jpg'));
if (outputs.length) { const { file } = await batches.zip(batch.id); await copyFile(file, path.join(out, 'capas-com-selo.zip')); }

const summary = batches.summary(batch);
const report = {
  date: new Date().toISOString(), node: process.versions.node, sharp: sharp.versions.sharp, input: path.basename(source), logo: logoSource,
  format: kit.data.output.size, fit: kit.data.output.fit, seconds,
  counts: summary.counts, ignored: batch.ingest.ignored, ingestErrors: batch.ingest.errors,
  items: batch.items.map(i => ({ source: i.source, status: i.status, platforms: i.platforms, platformSource: i.platformSource, size: i.width && [i.width, i.height], outputs: (i.outputs ?? []).map(o => o.name), flags: i.flags.map(f => f.code), error: i.error })),
};
await writeFile(path.join(out, 'relatorio.json'), JSON.stringify(report, null, 2));
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
console.log(`VALIDAÇÃO OK: ${n(summary.counts.done, 'capa pronta', 'capas prontas')}, ${n(summary.counts.outputs, 'imagem', 'imagens')}, ${n(summary.counts.errors, 'falha', 'falhas')}, ${summary.counts.flagged} para conferir, em ${seconds.toFixed(1)} s.\nFolha de contato e relatório: ${out}`);
