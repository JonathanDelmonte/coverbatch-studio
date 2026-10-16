import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sha256 } from '../lib/files.js';

// What the Windows and macOS packages share: the files of the app, the private
// profile (an explicit allowlist) and the official runtimes, checked by hash.
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One build folder per kind in work/builds: the previous one goes when a new build starts.
export async function freshStage(kind) {
  const dir = path.join(projectRoot, 'work', 'builds');
  await mkdir(dir, { recursive: true });
  for (const old of await readdir(dir)) if (old.startsWith(`${kind}-`)) await rm(path.join(dir, old), { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  return mkdtemp(path.join(dir, `${kind}-`));
}

// Everything the app needs at runtime, listed from the folders themselves.
export async function applicationFiles() {
  const files = ['server.js', 'package.json', 'package-lock.json', 'scripts/launcher.js'];
  async function walk(dir) {
    for (const item of (await readdir(path.join(projectRoot, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${dir}/${item.name}`;
      if (item.isDirectory()) await walk(relative); else if (item.isFile()) files.push(relative);
    }
  }
  for (const dir of ['lib', 'public', 'assets']) await walk(dir);
  await assertNoToolTraces(files);
  return files;
}

// Nothing of the tools the app was developed with travels to the client: their
// instruction files and folders, or a mention of them in the app's own files.
const TOOL_FILES = /(^|\/)(\.claude|\.cursor|\.copilot|\.aider[^/]*|CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|\.cursorrules)(\/|$)/i;
const TOOL_WORDS = /\b(claude|anthropic|openai|chatgpt|copilot|gemini)\b|co-authored-by/i;
const TEXT_FILE = /\.(c?js|mjs|json|css|html?|svg|md|txt|xml)$/i;
export async function assertNoToolTraces(files) {
  for (const file of files) {
    if (TOOL_FILES.test(file)) throw new Error(`Arquivo de ferramenta de IA no pacote: ${file}`);
    if (TEXT_FILE.test(file) && TOOL_WORDS.test(await readFile(path.join(projectRoot, file), 'utf8'))) throw new Error(`Menção a ferramenta de IA no pacote: ${file}`);
  }
}

export async function copyApplication(destination) {
  for (const file of await applicationFiles()) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(projectRoot, file), target);
  }
}

// Only these files of a private profile travel: never batches, covers or session state.
export const PROFILE_FILES = ['profile.json', 'kit.zip', 'templates.zip', 'developer-logo.svg'];
export async function copyProfile(profileRoot, destination) {
  const source = path.resolve(profileRoot);
  const present = file => stat(path.join(source, file)).then(() => true, () => false);
  if (!await present('profile.json')) throw new Error('profile.json ausente no perfil privado.');
  if (!await present('kit.zip') && !await present('templates.zip')) throw new Error('O perfil privado precisa de kit.zip (exportado pelo app) ou templates.zip.');
  await mkdir(destination, { recursive: true });
  for (const file of PROFILE_FILES) if (await present(file)) await copyFile(path.join(source, file), path.join(destination, file));
  return JSON.parse(await readFile(path.join(source, 'profile.json'), 'utf8'));
}

// Downloads once into work/downloads; the pinned SHA-256 decides, never the server.
export async function verifiedDownload(url, file, expected, { offline = false } = {}) {
  const present = await stat(file).then(() => true, () => false);
  if (!present) {
    if (offline) throw new Error(`${path.basename(file)} não está em ${path.dirname(file)} (modo offline).`);
    await mkdir(path.dirname(file), { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download oficial falhou (${url}): HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  }
  if (sha256(await readFile(file)) !== expected) throw new Error(`Hash de ${path.basename(file)} diferente do checksum oficial. O pacote não será criado.`);
  return file;
}

// The illustrated install guide (packaging/como-instalar.html) for one system and edition.
export async function renderGuide({ os, name, version, zip = '', installer = '', minMac = '11' }) {
  const html = await readFile(path.join(projectRoot, 'packaging/como-instalar.html'), 'utf8');
  const icon = await readFile(path.join(projectRoot, 'assets', os === 'mac' ? 'icon-macos.svg' : 'icon.svg'));
  const values = { __OS__: os, __NAME__: name, __VERSION__: version, __ZIP__: zip, __INSTALLER__: installer, __MINMAC__: minMac, __ICON__: `data:image/svg+xml;base64,${icon.toString('base64')}` };
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return html.replace(/__[A-Z]+__/g, key => (key in values ? escape(values[key]) : key));
}

export const thirdPartyNotices = (runtime, eol = '\n') => [
  `Node.js ${runtime} — licença e avisos em ${runtime.includes('macOS') ? 'runtime/LICENSE.txt (dentro do app)' : 'runtime/LICENSE.txt'}.`,
  'Dependências JavaScript, Sharp e opentype.js — licenças preservadas nos respectivos diretórios em app/node_modules.',
  'Fontes Open Sans (app/assets/fonts/OFL.txt) e Archivo (app/public/fonts/OFL-Archivo.txt) — SIL Open Font License 1.1.',
  'Logotipos PS4 e PS5: marcas da Sony Interactive Entertainment, usados só para identificar a plataforma de cada jogo.',
  'Código da ferramenta: https://github.com/ZIRTUNO/coverbatch-studio', '',
].join(eol);
