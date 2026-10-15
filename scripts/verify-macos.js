import { mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile, chmod, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import yauzl from 'yauzl';
import { machO } from './macos-app.js';
import { projectRoot } from './package-common.js';

// Checks the macOS ZIP without a Mac: its structure (permissions, link to
// Applications, Mach-O binaries for both processors, Info.plist, icon), then runs
// the app's real launcher script under Git Bash, with stand-ins for open, sysctl,
// xattr and osascript, against the real engine of this checkout.
const args = process.argv.slice(2);
const privateBuild = args.includes('--private-profile');
const config = JSON.parse(await readFile(path.join(projectRoot, 'packaging/macos.json'), 'utf8'));
const zipFile = path.join(projectRoot, 'outputs', privateBuild ? 'Criador-de-capas-Kabban-macOS-PRIVADO.zip' : config.assetName);
const name = privateBuild ? 'Criador de capas Kabban' : 'CoverBatch Studio';
const executable = privateBuild ? 'criador-de-capas' : 'coverbatch-studio';
const ok = text => console.log(`ok  ${text}`);

// --- 1. The ZIP as Archive Utility will see it ----------------------------------
const entries = new Map();
const wanted = name => /Contents\/(Info\.plist|PkgInfo|MacOS\/|Resources\/(AppIcon\.icns|distribuicao\.json|runtime\/node-|perfil\/))|\.node$|\.dylib$|LEIA-ME\.txt$|Como instalar\.html$/.test(name);
await new Promise((resolve, reject) => yauzl.open(zipFile, { lazyEntries: true }, (error, zip) => {
  if (error) return reject(error);
  zip.on('error', reject); zip.on('end', resolve);
  zip.on('entry', entry => {
    const info = { mode: (entry.externalFileAttributes >>> 16) & 0o177777, madeBy: entry.versionMadeBy >> 8, size: entry.uncompressedSize };
    entries.set(entry.fileName, info);
    if (!wanted(entry.fileName) || entry.fileName.endsWith('/')) return zip.readEntry();
    zip.openReadStream(entry, async (e, stream) => {
      if (e) return reject(e);
      const chunks = []; for await (const c of stream) chunks.push(c);
      info.bytes = Buffer.concat(chunks);
      zip.readEntry();
    });
  });
  zip.readEntry();
}));
const app = `${name}/${name}.app/Contents`;
const get = file => { const e = entries.get(file); assert.ok(e, `falta ${file}`); return e; };
for (const [file, e] of entries) {
  assert.equal(e.madeBy, 3, `${file}: permissões Unix no ZIP`);
  assert.ok(!/\.(exe|dll|cmd|ps1)$/i.test(file), `${file}: arquivo do Windows no pacote do Mac`);
  assert.ok(!/(^|\/)(dados|dados-locais|\.local-data|work|outputs|batches)\//.test(file), `${file}: dados privados no pacote`);
}
ok(`${entries.size} entradas, todas com permissões Unix e sem arquivos do Windows`);
assert.equal(get(`${app}/MacOS/${executable}`).mode, 0o100755);
for (const arch of ['arm64', 'x64']) {
  const node = get(`${app}/Resources/runtime/node-${arch}`);
  assert.equal(node.mode, 0o100755, `node-${arch} executável`);
  assert.equal(machO(node.bytes), arch, `node-${arch} é Mach-O ${arch}`);
  const addon = [...entries.keys()].find(f => f.startsWith(`${app}/Resources/app/node_modules/@img/sharp-darwin-${arch}/lib/`) && f.endsWith('.node'));
  assert.equal(machO(get(addon).bytes), arch, `Sharp ${arch}`);
  const dylib = [...entries.keys()].find(f => f.startsWith(`${app}/Resources/app/node_modules/@img/sharp-libvips-darwin-${arch}/lib/`) && f.endsWith('.dylib'));
  assert.equal(machO(get(dylib).bytes), arch, `libvips ${arch}`);
}
ok('Node.js e Sharp para Apple silicon e Intel, executáveis marcados');
const link = get(`${name}/Aplicativos`);
assert.equal(link.mode & 0o170000, 0o120000, 'atalho Aplicativos é um link simbólico');
ok('atalho para Aplicativos ao lado do app');
const plist = get(`${app}/Info.plist`).bytes.toString('utf8');
for (const [key, value] of [['CFBundleExecutable', executable], ['CFBundlePackageType', 'APPL'], ['CFBundleIconFile', 'AppIcon'], ['LSMinimumSystemVersion', config.minimumSystem], ['CFBundleDisplayName', name]]) {
  assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>${value.replace(/[.]/g, '\\.')}</string>`), `Info.plist ${key}`);
}
assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/);
assert.equal(get(`${app}/PkgInfo`).bytes.toString('ascii'), 'APPL????');
const icon = get(`${app}/Resources/AppIcon.icns`).bytes;
assert.equal(icon.subarray(0, 4).toString('ascii'), 'icns'); assert.equal(icon.readUInt32BE(4), icon.length);
ok('Info.plist, PkgInfo e ícone .icns válidos');
const launcher = get(`${app}/MacOS/${executable}`).bytes.toString('utf8');
assert.ok(!launcher.includes('\r'), 'lançador com quebras de linha Unix'); assert.ok(launcher.startsWith('#!/bin/bash\n'));
assert.ok(!launcher.includes('__NAME__') && launcher.includes(`NAME="${name}"`));
const readme = get(`${name}/LEIA-ME.txt`).bytes.toString('utf8');
assert.ok(!readme.includes('__NAME__') && readme.includes(name));
const manifest = JSON.parse(get(`${app}/Resources/distribuicao.json`).bytes.toString('utf8'));
assert.equal(manifest.privateDataIncluded, privateBuild); assert.equal(manifest.node, config.nodeVersion);
const profileFiles = [...entries.keys()].filter(f => f.startsWith(`${app}/Resources/perfil/`));
if (privateBuild) assert.ok(profileFiles.some(f => f.endsWith('profile.json')) && profileFiles.some(f => /kit\.zip$|templates\.zip$/.test(f)), 'perfil privado incluído');
else assert.equal(profileFiles.length, 0, 'sem perfil de loja no pacote público');
ok(`lançador, guia e manifesto conferidos (${privateBuild ? 'com' : 'sem'} perfil privado)`);

// --- 2. The launcher script, run for real -------------------------------------
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const posix = p => (process.platform === 'win32' ? p.replace(/^([a-z]):/i, (_, d) => `/${d.toLowerCase()}`).replaceAll('\\', '/') : p);
const work = await mkdtemp(path.join(projectRoot, 'work', 'macos-verify-'));
const stubs = path.join(work, 'bin'), calls = path.join(work, 'calls'), home = path.join(work, 'home');
await mkdir(stubs, { recursive: true }); await mkdir(calls); await mkdir(home);
const stub = async (cmd, body) => { await writeFile(path.join(stubs, cmd), `#!/bin/bash\n${body}\n`); await chmod(path.join(stubs, cmd), 0o755); };
await stub('sysctl', 'echo "${FAKE_ARM64:-0}"');
await stub('xattr', `echo "$*" >> "${posix(calls)}/xattr"`);
await stub('open', `printf '%s\\n' "$@" >> "${posix(calls)}/open"; echo --- >> "${posix(calls)}/open"`);
await stub('osascript', `cat > /dev/null; printf '%s\\n---\\n' "$2" >> "${posix(calls)}/osascript"`);

// A bundle with the real launcher; its engine is this checkout (with this system's Sharp),
// reached through a junction that is removed on its own before the folder is deleted.
const junctions = [];
async function bundle(where) {
  const contents = path.join(where, `${name}.app`, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(path.join(contents, 'Resources', 'runtime'), { recursive: true });
  await writeFile(path.join(contents, 'MacOS', executable), launcher);
  await writeFile(path.join(contents, 'Resources', 'runtime', 'node-x64'), `#!/bin/bash\nexec "${posix(process.execPath)}" "$@"\n`);
  await chmod(path.join(contents, 'Resources', 'runtime', 'node-x64'), 0o755);
  junctions.push(path.join(contents, 'Resources', 'app'));
  await symlink(projectRoot, junctions.at(-1), 'junction');
  if (privateBuild) {
    await mkdir(path.join(contents, 'Resources', 'perfil'));
    for (const file of profileFiles) await writeFile(path.join(contents, 'Resources', 'perfil', path.posix.basename(file)), get(file).bytes);
  }
  return path.join(contents, 'MacOS', executable);
}
function launch(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bash, [posix(script)], {
      env: { ...process.env, HOME: posix(home), COVERBATCH_TEST_BIN: posix(stubs), COVERBATCH_CLOSE_SECONDS: '1', COVERBATCH_FIRST_WINDOW_SECONDS: '60', ...env },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; });
    child.on('error', reject); child.on('exit', code => resolve({ code, out }));
  });
}
const lines = async file => (await readFile(path.join(calls, file), 'utf8').catch(() => '')).split('---\n').filter(Boolean).map(b => b.trim().split('\n'));
const support = path.join(home, 'Library', 'Application Support', name);
let engineUrl = null;
try {
  const script = await bundle(path.join(work, 'Applications'));
  const first = await launch(script);
  assert.equal(first.code, 0, first.out);
  const [opened] = await lines('open');
  assert.match(opened?.[0] ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, 'sem Chrome: abre no navegador padrão');
  engineUrl = opened[0];
  assert.match((await readFile(path.join(calls, 'xattr'), 'utf8')), /^-dr com\.apple\.quarantine .+\.app$/m, 'remove a quarentena do próprio app');
  const session = await (await fetch(`${engineUrl}/api/session`)).json();
  if (privateBuild) { assert.ok(session.profile?.title, 'perfil da loja'); assert.ok(session.kit.logo, 'kit da loja carregado do perfil'); }
  else assert.ok(!session.profile, 'sem perfil de loja');
  await stat(path.join(support, 'dados', 'kit.json'));
  const log = await readFile(path.join(support, 'registro.txt'), 'utf8');
  assert.match(log, /^--- \d{4}-\d\d-\d\d /m);
  ok(`primeira abertura: motor em ${engineUrl}, dados em ~/Library/Application Support/${name}`);

  // A second click while it runs: same engine, and an app window when Chrome exists.
  await mkdir(path.join(home, 'Applications', 'Google Chrome.app'), { recursive: true });
  const second = await launch(script);
  assert.equal(second.code, 0, second.out);
  const opens = await lines('open');
  const chrome = opens.at(-1);
  assert.equal(chrome[0], '-na'); assert.match(chrome[1], /Google Chrome\.app$/);
  assert.ok(chrome.includes(`--app=${engineUrl}`), 'mesma sessão reaproveitada');
  assert.ok(chrome.some(a => a.startsWith('--user-data-dir=') && a.endsWith(`${name}/janela`)), 'perfil de navegador separado');
  assert.match(await readFile(path.join(support, 'registro.txt'), 'utf8'), /já está aberto/);
  ok('segunda abertura: reaproveita o motor e abre janela própria no Chrome');

  // The window closes: the engine stops by itself.
  const controller = new AbortController();
  await fetch(`${engineUrl}/api/presence`, { signal: controller.signal });
  controller.abort();
  const stopped = Date.now();
  while (Date.now() - stopped < 15000) {
    try { await fetch(`${engineUrl}/api/health`, { signal: AbortSignal.timeout(500) }); await new Promise(r => setTimeout(r, 300)); }
    catch { engineUrl = null; break; }
  }
  assert.equal(engineUrl, null, 'o motor encerra depois que a janela fecha');
  ok('fechou a janela: o motor encerra sozinho');

  // Opened straight from Downloads (App Translocation): asks to move it first.
  const translocated = await bundle(path.join(work, 'private', 'var', 'folders', 'AppTranslocation', 'X1', 'd'));
  const moved = await launch(translocated);
  assert.equal(moved.code, 0);
  assert.match((await lines('osascript')).at(-1).join('\n'), /arraste .+ para a pasta Aplicativos/);
  ok('aberto de Downloads (translocado): pede para mover para Aplicativos');

  // Apple silicon without its runtime: explains instead of failing silently.
  const missing = await launch(script, { FAKE_ARM64: '1' });
  assert.equal(missing.code, 1);
  assert.match((await lines('osascript')).at(-1).join('\n'), /Faltam arquivos/);
  ok('runtime ausente: mensagem clara');
} finally {
  // An engine left by a failed check stops by itself (no window within the first minute).
  // Junctions go first, each confirmed gone: a recursive delete must never reach the project.
  for (const junction of junctions) await rmdir(junction).catch(() => {});
  const remaining = (await Promise.all(junctions.map(j => lstat(j).then(() => j, () => null)))).filter(Boolean);
  if (remaining.length) console.log(`Pasta de teste mantida, links ainda presentes: ${work}`);
  else await rm(work, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
console.log(`\nPacote do macOS verificado: ${path.basename(zipFile)}.\nFalta abrir num Mac de verdade: a confirmação do Gatekeeper e a janela.`);
