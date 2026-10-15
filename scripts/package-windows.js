import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { readZip, writeZip } from '../lib/zip.js';
import { sha256 as hash } from '../lib/files.js';
import { prepareExeBuild, compileLauncher, compileSetup } from './windows-exe.js';
import { projectRoot, copyApplication, copyProfile, thirdPartyNotices, renderGuide } from './package-common.js';

const run = promisify(execFile);
export async function buildWindows({ nodeZip, offline = false, profileRoot } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Empacote em um Windows x64 para incluir os binários corretos do Sharp.');
  const npmScript = process.env.npm_execpath;
  if (!npmScript) throw new Error('Execute este empacotador com npm run package:windows.');
  const config = JSON.parse(await readFile(path.join(projectRoot, 'packaging/windows.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const work = path.join(projectRoot, 'work'); await mkdir(work, {recursive:true});
  const stage = await mkdtemp(path.join(work, 'windows-build-'));
  const branded = !!profileRoot;
  const folderName = branded ? 'Criador de capas Kabban' : 'CoverBatch Studio';
  const launcherName = `${folderName}.exe`;
  const consoleLauncher = 'app/suporte/abrir-com-console.cmd';
  const product = { name: folderName, folder: folderName, id: branded ? 'CriadorDeCapasKabban' : 'CoverBatchStudio', exe: launcherName, version: pkg.version, publisher: 'ZIRTUNO', url: 'https://github.com/ZIRTUNO/coverbatch-studio' };
  const root = path.join(stage, folderName); const appRoot = path.join(root, 'app');
  await mkdir(appRoot,{recursive:true}); await mkdir(path.join(root,'runtime'),{recursive:true});
  let runtimeArchive = nodeZip ? path.resolve(nodeZip) : path.join(work, 'downloads', config.nodeZip);
  if (!nodeZip) {
    try { await stat(runtimeArchive); }
    catch {
      await mkdir(path.dirname(runtimeArchive),{recursive:true});
      const response = await fetch(config.nodeDownload);
      if (!response.ok) throw new Error(`Download oficial do Node falhou: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body),createWriteStream(runtimeArchive));
    }
  }
  if(hash(await readFile(runtimeArchive))!==config.nodeZipSha256)throw new Error('Hash do runtime diferente do checksum oficial. O pacote não será criado.');
  let runtimeFound=false,licenseFound=false;
  await readZip(runtimeArchive,async(name,bytes)=>{
    const local=path.posix.basename(name);
    if(local==='node.exe'&&name.split('/').length===2){await writeFile(path.join(root,'runtime/node.exe'),bytes);runtimeFound=true;}
    if(local==='LICENSE'&&name.split('/').length===2){await writeFile(path.join(root,'runtime/LICENSE.txt'),bytes);licenseFound=true;}
  });
  if(!runtimeFound||!licenseFound)throw new Error('Runtime ou licença não encontrados no ZIP oficial.');
  const {stdout:nodeVersion}=await run(path.join(root,'runtime/node.exe'),['--version']);
  if(nodeVersion.trim()!==`v${config.nodeVersion}`)throw new Error('Versão inesperada do runtime.');
  await copyApplication(appRoot);
  // Explicit allowlist (package-common.js): never batches, covers or session state.
  if (branded) await copyProfile(profileRoot, path.join(root, 'perfil'));
  console.log('Instalando dependências de produção em uma pasta limpa…');
  const npmArgs=[npmScript,'ci','--omit=dev','--include=optional','--ignore-scripts','--no-fund','--no-audit','--cache',path.join(work,'npm-cache')];
  if(offline)npmArgs.push('--offline');
  await run(process.execPath,npmArgs,{cwd:appRoot,maxBuffer:2_000_000});
  // The native image library must load with the bundled runtime before packaging.
  const {stdout:sharpVersion}=await run(path.join(root,'runtime/node.exe'),['--input-type=module','-e',"import sharp from 'sharp'; const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer(); if(!bytes.length)throw Error('Sharp failed'); console.log(sharp.versions.sharp);"],{cwd:appRoot});
  // Support launcher with a visible console (shows the engine's log); the .exe is the normal way in.
  const cmd=['@echo off','title '+folderName+' (console)','chcp 65001 >nul','set "ROOT=%~dp0..\\..\\"','cd /d "%ROOT%"',
    'if not exist "%ROOT%runtime\\node.exe" (','  echo Arquivos do programa ausentes. Instale novamente.','  pause','  exit /b 1',')',
    'set "COVERBATCH_PORTABLE_ROOT=%ROOT%"','"%ROOT%runtime\\node.exe" "%ROOT%app\\scripts\\launcher.js"','if errorlevel 1 pause',''].join('\r\n');
  await mkdir(path.join(root,'app','suporte'),{recursive:true});
  await writeFile(path.join(root,consoleLauncher),cmd);
  const guide=(await readFile(path.join(projectRoot,'packaging/LEIA-ME.txt'),'utf8')).replace(/\r\n/g,'\n');
  const clientGuide=branded ? guide.replaceAll('Instalar-CoverBatch-Studio.exe','Instalar-Criador-de-capas-Kabban-PRIVADO.exe').replaceAll('CoverBatch-Studio-Windows-x64.zip','Criador-de-capas-Kabban-Windows-x64-PRIVADO.zip').replaceAll('CoverBatch Studio','Criador de capas Kabban').replace(/^Baixe .+$/m,'Use o instalador privado recebido diretamente: ele já traz o kit da loja (selo e logo).') : guide;
  await writeFile(path.join(root,'LEIA-ME.txt'),folderName+' '+pkg.version+'\r\n\r\n'+(branded?'PACOTE PRIVADO: contém as marcas e a referência fornecidas para a Kabban. Compartilhe diretamente com o cliente.\r\n\r\n':'')+clientGuide.replaceAll('\n','\r\n'));
  await writeFile(path.join(root,'THIRD-PARTY-NOTICES.txt'),thirdPartyNotices(config.nodeVersion,'\r\n'));
  // The illustrated guide: next to the program, and in outputs/ to send with the download.
  const assetName=branded?'Criador-de-capas-Kabban-Windows-x64-PRIVADO.zip':config.assetName;
  const setupName=branded?'Instalar-Criador-de-capas-Kabban-PRIVADO.exe':'Instalar-CoverBatch-Studio.exe';
  const installGuide=await renderGuide({os:'windows',name:folderName,version:pkg.version,zip:assetName,installer:setupName});
  await writeFile(path.join(root,'Como instalar.html'),installGuide);
  // The program's .exe and the installer are compiled with the C# compiler built into Windows.
  const build=await mkdtemp(path.join(work,'exe-build-'));
  await prepareExeBuild(build,product);
  await compileLauncher(build,path.join(root,launcherName));
  const files=[];
  async function collect(dir,prefix=''){
    for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const relative=prefix+item.name;
      if(item.isSymbolicLink())throw new Error(`Link simbólico não permitido: ${relative}`);
      if(item.isDirectory())await collect(path.join(dir,item.name),relative+'/');
      else if(item.isFile()){
        if(/(^|\/)(\.local-data|dados-locais|work|outputs)(\/|$)/.test(relative))throw new Error('Diretório privado no pacote.');
        const full=path.join(dir,item.name),bytes=await readFile(full);
        files.push({file:relative,bytes:bytes.length,sha256:hash(bytes),full});
      }
    }
  }
  await collect(root);
  const manifest={version:pkg.version,platform:'win32-x64',node:config.nodeVersion,sharp:sharpVersion.trim(),privateDataIncluded:branded,folderName,productId:product.id,launcherName,consoleLauncher,nodeSource:config.nodeDownload,nodeZipSha256:config.nodeZipSha256,files:files.map(({full,...f})=>f)};
  await writeFile(path.join(root,'distribuicao.json'),JSON.stringify(manifest,null,2));
  const output=path.join(projectRoot,'outputs');await mkdir(output,{recursive:true});
  await writeFile(path.join(output,assetName.replace(/-Windows-x64(-PRIVADO)?\.zip$/,'-como-instalar-Windows.html')),installGuide);
  const zipFile=path.join(output,assetName);
  await writeZip(zipFile,[...files.map(f=>({name:folderName+'/'+f.file,path:f.full})),{name:folderName+'/distribuicao.json',path:path.join(root,'distribuicao.json')}]);
  const zipHash=hash(await readFile(zipFile));
  await writeFile(path.join(output,assetName.replace('.zip','.sha256')),`${zipHash}  ${assetName}\n`);
  // The installer carries the same files (without the top folder) as an embedded payload.
  const payload=path.join(build,'payload.zip');
  await writeZip(payload,[...files.map(f=>({name:f.file,path:f.full})),{name:'distribuicao.json',path:path.join(root,'distribuicao.json')}]);
  const setupFile=path.join(output,setupName);
  await compileSetup(build,setupFile,payload);
  const setupHash=hash(await readFile(setupFile));
  await writeFile(path.join(output,setupName.replace('.exe','.sha256')),`${setupHash}  ${setupName}\n`);
  await writeFile(path.join(output,branded?'windows-build-kabban.json':'windows-build.json'),JSON.stringify({version:pkg.version,zip:path.basename(zipFile),sha256:zipHash,bytes:(await stat(zipFile)).size,installer:setupName,installerSha256:setupHash,installerBytes:(await stat(setupFile)).size,files:files.length+1,node:config.nodeVersion,sharp:sharpVersion.trim(),stage:root,privateDataIncluded:branded},null,2));
  console.log(`Pacote Windows pronto: ${zipFile}\n${files.length+1} arquivos; ${branded?'perfil privado incluído, sem lotes ou capas':'sem dados de loja'}.\nSHA256 ${zipHash}\nInstalador: ${setupFile}\nSHA256 ${setupHash}`);
  return {zipFile,setupFile,root,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),index=args.indexOf('--node-zip');
  const profileIndex=args.indexOf('--profile-dir');
  await buildWindows({nodeZip:index>=0?args[index+1]:undefined,offline:args.includes('--offline'),profileRoot:profileIndex>=0?args[profileIndex+1]:undefined});
}
