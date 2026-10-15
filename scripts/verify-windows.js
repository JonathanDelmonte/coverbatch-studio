import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readZip, writeZip, safeName } from '../lib/zip.js';
import { sha256 } from '../lib/files.js';

// Checks a release the way the client uses it, in a fresh folder with an accented
// name and only the bundled runtime:
//   1. portable ZIP: the .exe starts the program hidden; a second launch reuses it;
//   2. installer: silent install, run, silent uninstall that leaves nothing behind.
// --com-registro also checks the Start menu/Desktop shortcuts and the entry in
// Settings > Apps (created and removed again within the run).
if (process.platform !== 'win32') throw new Error('Execute a verificação em Windows.');
const run = promisify(execFile);
const args = process.argv.slice(2);
const branded = args.includes('--private-profile');
const withRegistry = args.includes('--com-registro');
const archive = path.resolve(args.find(a => a.endsWith('.zip')) || (branded ? 'outputs/Criador-de-capas-Kabban-Windows-x64-PRIVADO.zip' : 'outputs/CoverBatch-Studio-Windows-x64.zip'));
const installer = path.resolve(args.find(a => a.endsWith('.exe')) || (branded ? 'outputs/Instalar-Criador-de-capas-Kabban-PRIVADO.exe' : 'outputs/Instalar-CoverBatch-Studio.exe'));
const folder = branded ? 'Criador de capas Kabban' : 'CoverBatch Studio';
await fs.mkdir(path.resolve('work'), { recursive: true });
const stage = await fs.mkdtemp(path.resolve('work/Cliente São Paulo-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = file => fs.stat(file).then(() => true, () => false);

console.log('Extraindo o ZIP portátil em uma pasta nova…');
const found = new Map(); let manifest;
await readZip(archive, async (name, bytes) => {
  const safe = safeName(name);
  assert.ok(safe.startsWith(folder + '/'));
  assert.ok(!/(^|\/)(\.local-data|dados-locais|work|outputs)(\/|$)/.test(safe));
  assert.ok(!found.has(safe)); found.set(safe, { sha256: sha256(bytes), bytes: bytes.length });
  const file = path.resolve(stage, safe); assert.ok(file.startsWith(stage + path.sep));
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  if (safe === folder + '/distribuicao.json') manifest = JSON.parse(bytes);
});
assert.equal(manifest.privateDataIncluded, branded);
assert.equal(found.size, manifest.files.length + 1);
for (const f of manifest.files) { const actual = found.get(folder + '/' + f.file); assert.equal(actual.sha256, f.sha256); assert.equal(actual.bytes, f.bytes); }

const env = home => ({ ...process.env, PATH: path.join(process.env.SystemRoot, 'System32'), NODE_PATH: '', NODE_OPTIONS: '', PORT: '', COVERBATCH_DATA_DIR: '', COVERBATCH_PROFILE_DIR: '', COVERBATCH_LAUNCHER_HOME: home });
const started = (exe, argv, home) => { const child = spawn(exe, argv, { env: env(home), windowsHide: true, stdio: 'ignore' }); return { child, exited: new Promise(r => child.once('exit', code => r(code))) }; };
async function address(home, launcher) {
  for (let i = 0; i < 300; i++) {
    const url = await fs.readFile(path.join(home, 'endereco.txt'), 'utf8').then(s => s.trim(), () => '');
    if (url.startsWith('http://127.0.0.1:')) return url;
    if (launcher.child.exitCode !== null) throw new Error(`O lançador terminou sem abrir: ${await fs.readFile(path.join(home, 'erro.txt'), 'utf8').catch(() => '?')}`);
    await sleep(100);
  }
  throw new Error('O lançador não ficou pronto em 30 s.');
}
async function stamp(url) {
  const session = await fetch(url + '/api/session').then(r => r.json());
  assert.equal((await fetch(url + '/api/health').then(r => r.json())).version, manifest.version);
  const headers = { 'x-local-token': session.token };
  if (branded) assert.ok(session.profile?.title && session.kit.logo, 'perfil privado instalou o kit');
  else if (!session.kit.logo) {
    const logo = new FormData();
    logo.append('file', new Blob([await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="10" y="10" width="100" height="20" fill="#fff"/></svg>')).png().toBuffer()]), 'TESTE-logo.png');
    assert.equal((await fetch(url + '/api/kit/logo', { method: 'PUT', headers, body: logo })).status, 200);
  }
  const base = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#225f83' } }).jpeg({ quality: 94 }).toBuffer();
  const zip = path.join(stage, `entrada-${Date.now()}.zip`);
  await writeZip(zip, [{ name: 'PS4/demo.jpg', bytes: base }, { name: 'PS5/demo.jpg', bytes: base }]);
  const form = new FormData();
  form.append('files', new Blob([await fs.readFile(zip)]), 'entrada.zip');
  form.append('paths', JSON.stringify(['entrada.zip'])); form.append('title', 'entrada.zip');
  const created = await fetch(url + '/api/batches', { method: 'POST', headers, body: form }).then(r => r.json());
  let batch;
  for (let i = 0; i < 400; i++) { batch = await fetch(`${url}/api/batches/${created.id}`).then(r => r.json()); if (batch.status === 'done') break; await sleep(50); }
  assert.equal(batch.counts.outputs, 2);
  const images = new Map(), out = path.join(stage, `saida-${Date.now()}.zip`);
  await fs.writeFile(out, Buffer.from(await (await fetch(`${url}/api/batches/${created.id}/zip`)).arrayBuffer()));
  await readZip(out, async (name, bytes) => images.set(name, bytes));
  assert.deepEqual([...images.keys()].sort(), ['demo-ps4.jpg', 'demo-ps5.jpg']);
  // The official stickers: PS4 has a blue block and a white pill, PS5 a white block and a black pill.
  for (const [name, bytes] of images) {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [block, pill] = [at(110, 1360), at(705, 1397)]; // inside the platform block; right end of the pill
    if (name.includes('ps5')) assert.ok(block.every(c => c > 225) && pill.every(c => c < 40), `selo PS5 oficial no canto inferior esquerdo (${block} / ${pill})`);
    else assert.ok(block[2] > 150 && block[0] < 80 && pill.every(c => c > 225), `selo PS4 oficial no canto inferior esquerdo (${block} / ${pill})`);
  }
  return headers;
}
async function close(url, headers, launcher) {
  await fetch(url + '/api/shutdown', { method: 'POST', headers });
  const code = await Promise.race([launcher.exited, sleep(15_000).then(() => 'timeout')]);
  assert.equal(code, 0, 'o lançador termina junto com o programa');
}

const root = path.join(stage, folder);
const exe = path.join(root, manifest.launcherName);
console.log(`Portátil: ${manifest.launcherName}`);
const homeA = path.join(stage, 'estado-portatil');
const portable = started(exe, ['/teste'], homeA);
const urlA = await address(homeA, portable);
const again = started(exe, ['/teste'], homeA);
assert.equal(await again.exited, 0, 'segunda abertura reaproveita o programa aberto');
await close(urlA, await stamp(urlA), portable);

console.log(`Instalador: ${path.basename(installer)} (${((await fs.stat(installer)).size / 1048576).toFixed(1)} MB)`);
const target = path.join(stage, 'Programas', folder);
const setup = started(installer, ['/silencioso', `/destino=${target}`, ...(withRegistry ? ['/registrar', '/atalho-area-de-trabalho'] : [])], path.join(stage, 'estado-instalador'));
assert.equal(await setup.exited, 0, 'instalação silenciosa');
for (const f of [manifest.launcherName, 'app/scripts/launcher.js', 'runtime/node.exe', 'distribuicao.json', 'LEIA-ME.txt', 'Como instalar.html']) assert.ok(await exists(path.join(target, f)), `instalado: ${f}`);
const installedExe = path.join(target, manifest.launcherName);
// PowerShell with UTF-8 output: reg.exe prints accented paths in the OEM codepage.
const ps = async command => (await run('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`])).stdout.trim();
const registeredFolder = () => ps(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${manifest.productId}' -ErrorAction SilentlyContinue).InstallLocation`);
const shortcuts = withRegistry ? [path.join(await ps("[Environment]::GetFolderPath('DesktopDirectory')"), `${folder}.lnk`), path.join(await ps("[Environment]::GetFolderPath('Programs')"), `${folder}.lnk`)] : [];
const homeB = path.join(stage, 'estado-instalado');
try {
  if (withRegistry) {
    assert.equal(await registeredFolder(), target, 'entrada em Configurações > Aplicativos');
    for (const lnk of shortcuts) assert.ok(await exists(lnk), `atalho criado: ${lnk}`);
  }
  const installed = started(installedExe, ['/teste'], homeB);
  const urlB = await address(homeB, installed);
  await close(urlB, await stamp(urlB), installed);
} finally {
  // Always uninstall, so a failed check never leaves shortcuts or registry entries behind.
  const removal = started(installedExe, ['/desinstalar', '/silencioso'], homeB);
  assert.equal(await removal.exited, 0, 'desinstalação silenciosa');
}
for (let i = 0; i < 80 && await exists(target); i++) await sleep(100);
assert.ok(!(await exists(target)), 'pasta do programa removida');
if (withRegistry) {
  assert.equal(await registeredFolder(), '', 'entrada removida');
  for (const lnk of shortcuts) assert.ok(!(await exists(lnk)), `atalho removido: ${lnk}`);
}

const result = { version: manifest.version, node: manifest.node, zipSha256: sha256(await fs.readFile(archive)), installerSha256: sha256(await fs.readFile(installer)), filesVerified: found.size, noGlobalNodeOrNpm: true, portableExe: true, reopenSameInstance: true, stampedOutputs: 2, silentInstall: true, installedRun: true, uninstallClean: true, shortcutsAndSettingsEntry: withRegistry, privateDataIncluded: branded };
await fs.mkdir(path.resolve('outputs'), { recursive: true });
await fs.writeFile(branded ? 'outputs/verificacao-pacote-kabban.json' : 'outputs/verificacao-pacote-windows.json', JSON.stringify(result, null, 2));
console.log('VALIDAÇÃO WINDOWS OK:', JSON.stringify(result));
// Passed: the test folder (extracted ZIP, installed copy) is not needed any more.
await fs.rm(stage, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
