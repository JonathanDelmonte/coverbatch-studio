import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256 as hash } from '../lib/files.js';
import { projectRoot, freshStage, copyApplication, copyProfile, verifiedDownload, thirdPartyNotices, renderGuide } from './package-common.js';
import { readTarGz, machO, icns, infoPlist, writeMacZip } from './macos-app.js';

// The macOS app, built on Windows or anywhere else: one universal .app (Apple
// silicon and Intel) in a ZIP, next to a link to Applications so the person can
// drag it there. Unsigned: the first opening is confirmed once in macOS.
const run = promisify(execFile);
const exists = file => stat(file).then(() => true, () => false);

export async function buildMacos({ profileRoot, offline = false } = {}) {
  const npmScript = process.env.npm_execpath;
  if (!npmScript) throw new Error('Execute este empacotador com npm run package:macos.');
  const config = JSON.parse(await readFile(path.join(projectRoot, 'packaging/macos.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const work = path.join(projectRoot, 'work');
  await mkdir(work, { recursive: true });
  const stage = await freshStage('macos');
  const branded = !!profileRoot;
  const name = branded ? 'Criador de capas Kabban' : 'CoverBatch Studio';
  const executable = branded ? 'criador-de-capas' : 'coverbatch-studio';
  const identifier = branded ? 'com.zirtuno.criador-de-capas-kabban' : 'com.zirtuno.coverbatch-studio';
  const top = path.join(stage, name), bundle = path.join(top, `${name}.app`), contents = path.join(bundle, 'Contents');
  const resources = path.join(contents, 'Resources'), appRoot = path.join(resources, 'app'), runtime = path.join(resources, 'runtime');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(runtime, { recursive: true });

  // Official Node.js for each processor, checked against the pinned SHA-256.
  for (const [arch, { file, sha256 }] of Object.entries(config.runtimes)) {
    const archive = await verifiedDownload(config.nodeDownloadBase + file, path.join(work, 'downloads', file), sha256, { offline });
    const folder = file.replace(/\.tar\.gz$/, '');
    const files = await readTarGz(archive, [`${folder}/bin/node`, `${folder}/LICENSE`]);
    const node = files.get(`${folder}/bin/node`), license = files.get(`${folder}/LICENSE`);
    if (!node || !license) throw new Error(`Runtime ou licença não encontrados em ${file}.`);
    if (machO(node) !== arch) throw new Error(`${file}: o executável não é para ${arch}.`);
    await writeFile(path.join(runtime, `node-${arch}`), node);
    await writeFile(path.join(runtime, 'LICENSE.txt'), license);
  }

  await copyApplication(appRoot);
  if (branded) await copyProfile(profileRoot, path.join(resources, 'perfil'));

  // Production dependencies for macOS, one clean install per processor; the Intel
  // install only contributes its build of Sharp and libvips.
  const npm = (cwd, cpu) => run(process.execPath, [npmScript, 'ci', '--omit=dev', '--include=optional', '--ignore-scripts', '--no-fund', '--no-audit',
    '--os=darwin', `--cpu=${cpu}`, '--cache', path.join(work, 'npm-cache'), ...(offline ? ['--offline'] : [])], { cwd, maxBuffer: 4_000_000 });
  console.log('Instalando dependências para macOS (Apple silicon)…');
  await npm(appRoot, 'arm64');
  const intel = path.join(stage, 'intel');
  await mkdir(intel);
  for (const file of ['package.json', 'package-lock.json']) await cp(path.join(projectRoot, file), path.join(intel, file));
  console.log('Instalando dependências para macOS (Intel)…');
  await npm(intel, 'x64');
  for (const dir of ['sharp-darwin-x64', 'sharp-libvips-darwin-x64']) await cp(path.join(intel, 'node_modules/@img', dir), path.join(appRoot, 'node_modules/@img', dir), { recursive: true });
  // npm's command shims are not needed to run the app (and are Windows files here).
  await rm(path.join(appRoot, 'node_modules/.bin'), { recursive: true, force: true });
  for (const arch of ['arm64', 'x64']) {
    // sharp requires '@img/sharp-darwin-<arch>/sharp.node', mapped by that package to lib/*.node.
    const addons = path.join(appRoot, `node_modules/@img/sharp-darwin-${arch}/lib`);
    const addon = (await readdir(addons).catch(() => [])).find(f => f.endsWith('.node'));
    if (!addon || machO(await readFile(path.join(addons, addon))) !== arch) throw new Error(`Sharp para macOS ${arch} ausente ou inválido.`);
    const libs = path.join(appRoot, `node_modules/@img/sharp-libvips-darwin-${arch}/lib`);
    const dylib = (await readdir(libs)).find(f => f.endsWith('.dylib'));
    if (!dylib || machO(await readFile(path.join(libs, dylib))) !== arch) throw new Error(`libvips para macOS ${arch} ausente ou inválida.`);
  }
  for (const foreign of ['sharp-win32-x64', 'sharp-libvips-win32-x64', 'sharp-linux-x64']) {
    if (await exists(path.join(appRoot, 'node_modules/@img', foreign))) throw new Error(`Binário de outro sistema no pacote do macOS: ${foreign}.`);
  }
  const sharpVersion = JSON.parse(await readFile(path.join(appRoot, 'node_modules/sharp/package.json'), 'utf8')).version;

  // The bundle: launcher script, Info.plist, icon and notices.
  if (!/^[\p{L}\p{N} ._-]+$/u.test(name)) throw new Error('Nome do app com caracteres não permitidos no lançador.');
  const launcher = (await readFile(path.join(projectRoot, 'packaging/macos/launcher.sh'), 'utf8')).replace(/\r\n/g, '\n').replaceAll('__NAME__', name);
  await writeFile(path.join(contents, 'MacOS', executable), launcher);
  await writeFile(path.join(contents, 'Info.plist'), infoPlist({ name, executable, identifier, version: pkg.version, minimumSystem: config.minimumSystem, copyright: '© ZIRTUNO' }));
  await writeFile(path.join(contents, 'PkgInfo'), 'APPL????');
  const icon = name => readFile(path.join(projectRoot, 'assets', name), 'utf8');
  await writeFile(path.join(resources, 'AppIcon.icns'), await icns(await icon('icon-macos.svg'), { smallSvg: await icon('icon-macos-small.svg') }));
  await writeFile(path.join(resources, 'THIRD-PARTY-NOTICES.txt'), thirdPartyNotices(`${config.nodeVersion} (macOS)`));

  // Next to the app in the ZIP: the illustrated guide, the text guide and a link
  // to Applications. The illustrated guide also goes to outputs/, to send ahead.
  const assetName = branded ? 'Criador-de-capas-Kabban-macOS-PRIVADO.zip' : config.assetName;
  const readme = (await readFile(path.join(projectRoot, 'packaging/LEIA-ME-macOS.txt'), 'utf8')).replace(/\r\n/g, '\n').replaceAll('__NAME__', name);
  await writeFile(path.join(top, 'LEIA-ME.txt'), `${name} ${pkg.version}\n\n${branded ? 'PACOTE PRIVADO: contém as marcas da Kabban. Compartilhe só com a loja.\n\n' : ''}${readme}`);
  const guide = await renderGuide({ os: 'mac', name, version: pkg.version, zip: assetName, minMac: config.minimumSystem.replace(/\.0$/, '') });
  await writeFile(path.join(top, 'Como instalar.html'), guide);

  const files = [];
  async function collect(dir, prefix = '') {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${relative}`);
      if (item.isDirectory()) await collect(path.join(dir, item.name), `${relative}/`);
      else if (item.isFile()) {
        if (/(^|\/)(\.local-data|dados-locais|work|outputs)(\/|$)/.test(relative)) throw new Error('Diretório privado no pacote.');
        const full = path.join(dir, item.name), bytes = await readFile(full);
        const executableFile = relative === `${name}.app/Contents/MacOS/${executable}` || /^[^/]+\.app\/Contents\/Resources\/runtime\/node-(arm64|x64)$/.test(relative);
        files.push({ file: relative, bytes: bytes.length, sha256: hash(bytes), mode: executableFile ? 0o755 : 0o644, full });
      }
    }
  }
  await collect(top);
  const manifest = {
    version: pkg.version, platform: 'darwin-universal', minimumSystem: config.minimumSystem, node: config.nodeVersion, sharp: sharpVersion,
    privateDataIncluded: branded, name, executable, identifier, nodeSource: config.nodeDownloadBase, runtimes: config.runtimes,
    files: files.map(({ full: _f, ...f }) => f),
  };
  const manifestFile = path.join(resources, 'distribuicao.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

  const output = path.join(projectRoot, 'outputs');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, assetName.replace(/-macOS(-PRIVADO)?\.zip$/, '-como-instalar-macOS.html')), guide);
  const zipFile = path.join(output, assetName);
  await writeMacZip(zipFile, [
    ...files.map(f => ({ name: `${name}/${f.file}`, path: f.full, mode: f.mode })),
    { name: `${name}/${name}.app/Contents/Resources/distribuicao.json`, path: manifestFile },
    { name: `${name}/Aplicativos`, symlink: '/Applications' },
  ]);
  const zipHash = hash(await readFile(zipFile));
  await writeFile(path.join(output, assetName.replace('.zip', '.sha256')), `${zipHash}  ${assetName}\n`);
  const report = { version: pkg.version, zip: assetName, sha256: zipHash, bytes: (await stat(zipFile)).size, files: files.length + 2, node: config.nodeVersion, sharp: sharpVersion, minimumSystem: config.minimumSystem, stage: top, privateDataIncluded: branded };
  await writeFile(path.join(output, branded ? 'macos-build-kabban.json' : 'macos-build.json'), JSON.stringify(report, null, 2));
  console.log(`Pacote macOS pronto: ${zipFile}\n${files.length + 2} entradas; app universal (Apple silicon e Intel), macOS ${config.minimumSystem} ou mais novo; ${branded ? 'perfil privado incluído, sem lotes ou capas' : 'sem dados de loja'}.\nSHA256 ${zipHash}`);
  return { zipFile, top, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--profile-dir');
  await buildMacos({ profileRoot: at >= 0 ? args[at + 1] : undefined, offline: args.includes('--offline') });
}
