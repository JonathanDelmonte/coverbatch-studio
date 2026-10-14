import { mkdir, mkdtemp, readFile, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { readZip, writeZip } from '../lib/zip.js';
import { hash } from '../lib/store.js';

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const applicationFiles = ['server.js', 'package.json', 'package-lock.json', 'lib/store.js', 'lib/render.js', 'lib/importer.js', 'lib/zip.js', 'public/app.js', 'public/styles.css', 'public/index.html', 'scripts/launcher.js'];
export async function buildWindows({ nodeZip, offline = false } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Empacote em um Windows x64 para incluir os binários corretos do Sharp.');
  const npmScript = process.env.npm_execpath;
  if (!npmScript) throw new Error('Execute este empacotador com npm run package:windows.');
  const config = JSON.parse(await readFile(path.join(projectRoot, 'packaging/windows.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const work = path.join(projectRoot, 'work'); await mkdir(work, {recursive:true});
  const stage = await mkdtemp(path.join(work, 'windows-build-'));
  const root = path.join(stage, 'CoverBatch Studio'); const appRoot = path.join(root, 'app');
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
  for(const file of applicationFiles){const destination=path.join(appRoot,file);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(projectRoot,file),destination);}
  console.log('Instalando dependências de produção em uma pasta limpa…');
  const npmArgs=[npmScript,'ci','--omit=dev','--include=optional','--ignore-scripts','--no-fund','--no-audit','--cache',path.join(work,'npm-cache')];
  if(offline)npmArgs.push('--offline');
  await run(process.execPath,npmArgs,{cwd:appRoot,maxBuffer:2_000_000});
  // The native image library must load with the bundled runtime before packaging.
  const {stdout:sharpVersion}=await run(path.join(root,'runtime/node.exe'),['--input-type=module','-e',"import sharp from 'sharp'; const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer(); if(!bytes.length)throw Error('Sharp failed'); console.log(sharp.versions.sharp);"],{cwd:appRoot});
  const cmd='@echo off\r\ntitle CoverBatch Studio\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nif not exist "%~dp0runtime\\node.exe" (\r\n  echo Extraia o ZIP inteiro antes de abrir. A pasta runtime esta ausente.\r\n  pause\r\n  exit /b 1\r\n)\r\nif not exist "%~dp0app\\scripts\\launcher.js" (\r\n  echo Extraia o ZIP inteiro antes de abrir. A pasta app esta ausente.\r\n  pause\r\n  exit /b 1\r\n)\r\nset "COVERBATCH_PORTABLE_ROOT=%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0app\\scripts\\launcher.js"\r\nif errorlevel 1 pause\r\n';
  await writeFile(path.join(root,'Abrir CoverBatch Studio.cmd'),cmd);
  const guide=(await readFile(path.join(projectRoot,'GUIA-CLIENTE.md'),'utf8')).replace(/^#+ /gm,'').replaceAll('**','').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1 ($2)');
  await writeFile(path.join(root,'LEIA-ME.txt'),'COVERBATCH STUDIO '+pkg.version+'\r\n\r\n'+guide.replaceAll('\n','\r\n'));
  await writeFile(path.join(root,'THIRD-PARTY-NOTICES.txt'),'Node.js '+config.nodeVersion+' — licença e avisos em runtime/LICENSE.txt.\r\nDependências JavaScript e Sharp — licenças preservadas nos respectivos diretórios em app/node_modules.\r\nCódigo da ferramenta: https://github.com/JonathanDelmonte/coverbatch-studio\r\n');
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
  const manifest={version:pkg.version,platform:'win32-x64',node:config.nodeVersion,sharp:sharpVersion.trim(),privateDataIncluded:false,nodeSource:config.nodeDownload,nodeZipSha256:config.nodeZipSha256,files:files.map(({full,...f})=>f)};
  await writeFile(path.join(root,'distribuicao.json'),JSON.stringify(manifest,null,2));
  const output=path.join(projectRoot,'outputs');await mkdir(output,{recursive:true});
  const zipFile=path.join(output,config.assetName);
  await writeZip(zipFile,[...files.map(f=>({name:'CoverBatch Studio/'+f.file,path:f.full})),{name:'CoverBatch Studio/distribuicao.json',path:path.join(root,'distribuicao.json')}]);
  const zipHash=hash(await readFile(zipFile));
  await writeFile(path.join(output,'CoverBatch-Studio-Windows-x64.sha256'),`${zipHash}  ${config.assetName}\n`);
  await writeFile(path.join(output,'windows-build.json'),JSON.stringify({version:pkg.version,zip:path.basename(zipFile),sha256:zipHash,bytes:(await stat(zipFile)).size,files:files.length+1,node:config.nodeVersion,sharp:sharpVersion.trim(),stage:root,privateDataIncluded:false},null,2));
  console.log(`Pacote Windows pronto: ${zipFile}\n${files.length+1} arquivos; sem dados de loja.\nSHA256 ${zipHash}`);
  return {zipFile,root,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),index=args.indexOf('--node-zip');
  await buildWindows({nodeZip:index>=0?args[index+1]:undefined,offline:args.includes('--offline')});
}
