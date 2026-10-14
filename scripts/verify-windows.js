import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readZip, writeZip, safeName } from '../lib/zip.js';
import { hash } from '../lib/store.js';

if(process.platform!=='win32')throw new Error('Execute a verificação em Windows.');
const run=promisify(execFile);
const archive=path.resolve(process.argv[2]||'outputs/CoverBatch-Studio-Windows-x64.zip');
const branded=process.argv.includes('--private-profile');
const folder=branded?'Criador de capas Kabban':'CoverBatch Studio';
const stage=await fs.mkdtemp(path.resolve('work/Cliente São Paulo-'));
const found=new Map();let manifest;
console.log('Extraindo o ZIP de entrega em uma pasta nova…');
await readZip(archive,async(name,bytes)=>{
  const safe=safeName(name);
  assert.ok(safe.startsWith(folder+'/'));
  assert.ok(!/(^|\/)(\.local-data|dados-locais|work|outputs)(\/|$)/.test(safe));
  assert.ok(!found.has(safe));found.set(safe,{sha256:hash(bytes),bytes:bytes.length});
  const file=path.resolve(stage,safe);assert.ok(file.startsWith(stage+path.sep));
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
  if(safe===folder+'/distribuicao.json')manifest=JSON.parse(bytes);
});
assert.equal(manifest.privateDataIncluded,branded);
assert.equal(found.size,manifest.files.length+1);
for(const f of manifest.files){const actual=found.get(folder+'/'+f.file);assert.equal(actual.sha256,f.sha256);assert.equal(actual.bytes,f.bytes);}
const root=path.join(stage,folder);
const env={...process.env,PATH:path.join(process.env.SystemRoot,'System32'),NODE_PATH:'',NODE_OPTIONS:'',PORT:'',COVERBATCH_DATA_DIR:'',COVERBATCH_PROFILE_DIR:'',COVERBATCH_NO_BROWSER:'1'};
const batch=path.join(root,manifest.launcherName);
let output='',url,child;
const launch=()=>spawn(path.join(process.env.SystemRoot,'System32','cmd.exe'),['/d','/c',`"${batch}"`],{cwd:root,env,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore','pipe','pipe']});
try{
  child=launch();
  child.stdout.on('data',b=>output+=b.toString('utf8'));child.stderr.on('data',b=>output+=b.toString('utf8'));
  const until=Date.now()+20_000;
  while(Date.now()<until){url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)break;if(child.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
  assert.ok(url,output||'O lançador não ficou pronto.');
  console.log('Inicialização por CMD com runtime incluído:',url);
  const health=await fetch(url+'/api/health').then(r=>r.json());assert.equal(health.version,manifest.version);
  const state=await fetch(url+'/api/state').then(r=>r.json());assert.equal(state.products.length,0);assert.equal(state.assets.length,branded?3:0);assert.equal(state.templates.length,branded?2:0);
  if(branded){
    assert.equal(state.profile.title,'Criador de capas para loja Kabban');
    assert.equal(state.profile.defaultTemplates.length,2);
    for(const name of ['developer-logo.svg','reference.jpg'])assert.equal((await fetch(url+'/api/profile/'+name)).status,200);
    assert.ok(!JSON.stringify(state).includes('C:/Users/'));assert.ok(!JSON.stringify(state).includes('C:\\\\Users\\\\'));
    assert.deepEqual(state.templates.map(t=>t.platform).sort(),['PS4','PS5']);
    assert.ok(state.templates.every(t=>t.layers.some(l=>l.role==='banner')&&t.layers.some(l=>l.role==='logo')));
  }
  const privateState=JSON.parse(await fs.readFile(path.join(root,'dados-locais/project.json'),'utf8').catch(()=>Buffer.from('{}')));
  assert.ok(!privateState.products||privateState.products.length===0);
  const second=launch();let secondOutput='';second.stdout.on('data',b=>secondOutput+=b.toString('utf8'));second.stderr.on('data',b=>secondOutput+=b.toString('utf8'));
  const secondExit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{second.kill();reject(new Error('Segunda abertura não reusou a sessão.'));},10_000);second.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(secondExit,0);assert.ok(secondOutput.includes('já está aberto'));assert.ok(secondOutput.includes(url));
  const request=async(route,method='GET',body)=>{
    const options={method,headers:{'x-local-token':state.token}};
    if(body instanceof FormData)options.body=body;else if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
    const response=await fetch(url+route,options);const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result;
  };
  const base=await sharp({create:{width:160,height:240,channels:3,background:'#225f83'}}).jpeg({quality:94}).toBuffer();
  const zip=path.join(stage,'entrada-sintetica.zip');
  await writeZip(zip,[
    {name:'capas-limpas-da-previa/demo.jpg',bytes:base},
    {name:'catalogo.json',bytes:Buffer.from(JSON.stringify(['PS4','PS5'].map((p,i)=>({id:String(i+1),slug:'demo-'+p.toLowerCase(),nome:'Demo '+p,plataforma:p,imagens:[]}))))},
    {name:'capas-limpas-manifesto.json',bytes:Buffer.from(JSON.stringify([{arquivo:'capas-limpas-da-previa/demo.jpg',sha256:hash(base),produtos_slugs:['demo-ps4','demo-ps5']}]))},
  ]);
  const input=new FormData();input.append('files',new Blob([await fs.readFile(zip)]),'entrada.zip');
  const imported=await request('/api/import','POST',input);let progress;
  do{progress=await request('/api/import/'+imported.id);if(!progress.complete)await new Promise(r=>setTimeout(r,50));}while(!progress.complete);
  assert.equal(progress.errors.length,0);assert.equal(progress.totalProducts,2);
  const layers=new FormData();
  const sticker=await sharp(Buffer.from('<svg width="60" height="20"><rect x="2" y="2" width="56" height="16" fill="white"/></svg>')).png().toBuffer();
  const logo=await sharp(Buffer.from('<svg width="20" height="20"><circle cx="10" cy="10" r="8" fill="white"/></svg>')).png().toBuffer();
  layers.append('files',new Blob([sticker]),'TESTE-faixa.png');layers.append('files',new Blob([logo]),'TESTE-logo.png');
  const uploaded=await request('/api/layers','POST',layers);assert.equal(uploaded.errors.length,0);
  const products=(await request('/api/state')).products;
  for(const p of products){
    const template=branded?state.templates.find(t=>t.platform===p.platform):{id:'template-'+p.platform,name:'TESTE '+p.platform,platform:p.platform,availability:'other',layers:[{assetId:uploaded.added[0].id,anchor:'bottom-left',width:.4,marginX:.05,marginY:.04,opacity:p.platform==='PS4'?1:.6},{assetId:uploaded.added[1].id,anchor:'bottom-right',width:.1,marginX:.05,marginY:.04,opacity:1}]};
    if(!branded)await request('/api/templates/'+template.id,'PUT',template);
    await request('/api/products','PATCH',{keys:[p.key],changes:{templateId:template.id,availability:template.availability,selected:true}});
    const preview=await request('/api/preview','POST',{key:p.key});assert.equal(preview.width,160);assert.equal(preview.height,240);
    const review=await request('/api/products','PATCH',{keys:[p.key],changes:{reviewed:true}});assert.equal(review.skipped.length,0);
  }
  const exported=await request('/api/export','POST',{});let job;
  do{job=await request('/api/jobs/'+exported.id);if(!job.complete)await new Promise(r=>setTimeout(r,50));}while(!job.complete);
  assert.equal(job.results.filter(r=>r.status==='ok').length,2);
  const download=await fetch(url+`/api/jobs/${job.id}/download/lote.zip`);assert.equal(download.status,200);
  const resultZip=path.join(stage,'saida-sintetica.zip');await fs.writeFile(resultZip,Buffer.from(await download.arrayBuffer()));
  let exportedManifest;const images=new Map();
  await readZip(resultZip,async(name,bytes)=>{if(name==='export-manifest.json')exportedManifest=JSON.parse(bytes);if(name.endsWith('.jpg')){assert.equal((await sharp(bytes).metadata()).width,160);images.set(name,hash(bytes));}});
  assert.equal(exportedManifest.produtos.length,2);assert.notEqual(exportedManifest.produtos[0].sha256,exportedManifest.produtos[1].sha256);
  for(const row of exportedManifest.produtos){assert.ok(row.arquivo.includes('--'+row.id+'.jpg'));assert.equal(row.sha256,images.get(row.arquivo));}
  const result={version:manifest.version,node:manifest.node,zipSha256:hash(await fs.readFile(archive)),filesVerified:found.size,cleanInstallation:true,noGlobalNodeOrNpm:true,firstRunNoProducts:true,presetTemplates:branded?2:0,presetPNGs:branded?3:0,ownLocalData:true,doubleClickCMD:true,reopenSameInstance:true,platforms:['PS4','PS5'],exportedProducts:2,manifestHashesVerified:true,privateDataIncluded:branded};
  await fs.writeFile(branded?'outputs/verificacao-pacote-kabban.json':'outputs/verificacao-pacote-windows.json',JSON.stringify(result,null,2));
  await request('/api/shutdown','POST',{});
  if(child.exitCode===null)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('A instância de teste não encerrou.')),5000);child.once('exit',code=>{clearTimeout(timer);assert.equal(code,0);resolve();});});
  console.log('VALIDAÇÃO WINDOWS OK:',JSON.stringify(result));
}finally{
  if(child?.pid&&child.exitCode===null)await run(path.join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F']).catch(()=>{});
  child?.stdout.destroy();child?.stderr.destroy();child?.unref();
}
