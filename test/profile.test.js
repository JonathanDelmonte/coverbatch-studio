import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {Store,defaultFrame,hash} from '../lib/store.js';
import {compose} from '../lib/render.js';
import {seedProfile} from '../lib/profile.js';
import {exportTemplates,importFiles} from '../lib/importer.js';
import {createApp} from '../server.js';

test('perfil portátil inclui camadas e preserva ajustes ao reabrir sem depender de caminhos externos',async()=>{
  const root=await fs.mkdtemp(path.resolve('work/profile-test-'));
  const source=await new Store(path.join(root,'source')).init();
  const bytes=await sharp(Buffer.from('<svg width="80" height="20"><rect x="1" y="1" width="78" height="18" fill="red"/></svg>')).png().toBuffer();
  const layer=await source.addAsset(bytes,'TESTE-faixa.png','layer');
  source.state.templates=['PS4','PS5'].map(platform=>({id:platform,name:'TESTE '+platform,platform,availability:'other',frame:defaultFrame(),layers:[{role:'banner',assetId:layer.id,anchor:'bottom-left',width:.5,marginX:.05,marginY:.04,opacity:1},{role:'logo',assetId:layer.id,anchor:'bottom-right',width:.1,marginX:.05,marginY:.04,opacity:1}]}));
  const profile=path.join(root,'perfil');await fs.mkdir(profile);
  await fs.writeFile(path.join(profile,'profile.json'),JSON.stringify({version:1,id:'test',title:'TESTE privado'}));
  await exportTemplates(source,path.join(profile,'templates.zip'));
  const client=await new Store(path.join(root,'client')).init();await seedProfile(client,profile);
  assert.equal(client.state.templates.length,2);assert.equal(client.state.assets.length,1);assert.equal(client.state.products.length,0);
  assert.equal(client.state.profile.defaultTemplates.length,2);
  assert.ok(!JSON.stringify(client.state).includes(root));
  assert.equal(hash(await fs.readFile(client.assetPath(client.state.assets[0].id))),hash(bytes));
  client.state.templates[0].layers[0].marginX=.09;await client.save();
  await seedProfile(client,profile);assert.equal(client.state.templates.length,2);assert.equal(client.state.templates[0].layers[0].marginX,.09);
  await seedProfile(client,path.join(root,'absent')); // generic portable package has no profile
});

test('acabamento da faixa recorta só margem do PNG e preserva alpha dos cantos e bytes originais',async()=>{
  const root=await fs.mkdtemp(path.resolve('work/layer-test-')),store=await new Store(root).init();
  const base=await store.addAsset(await sharp({create:{width:1200,height:1500,channels:4,background:'blue'}}).png().toBuffer(),'TESTE-base.png');
  const bytes=await sharp({create:{width:662,height:108,channels:3,background:'white'}}).png().toBuffer();
  const banner=await store.addAsset(bytes,'TESTE-opaca.png','layer',undefined,{allowOpaque:true});
  const template={id:'t',name:'TESTE',platform:'PS4',availability:'other',layers:[{assetId:banner.id,role:'banner',anchor:'bottom-left',width:655/1200,marginX:70/1200,marginY:53/1500,trimTop:10,rounding:.25,opacity:1}]};
  const result=await compose(store,{baseId:base.id,baseApproved:true,override:{}},{template});
  assert.deepEqual(result.geometry[0],{assetId:banner.id,width:655,height:97,left:70,top:1350,opacity:1,trimTop:10,rounding:.25,role:'banner'});
  const {data,info}=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});
  const px=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
  assert.deepEqual(px(70,1350),[0,0,255]);assert.deepEqual(px(100,1390),[255,255,255]);assert.deepEqual(px(69,1390),[0,0,255]);
  assert.equal(hash(await fs.readFile(store.assetPath(banner.id))),hash(bytes));
});

test('foto avulsa entra como base manual sem inventar plataforma nem disponibilidade',async()=>{
  const root=await fs.mkdtemp(path.resolve('work/manual-test-')),store=await new Store(path.join(root,'client')).init();
  const file=path.join(root,'TESTE-foto.jpg');await sharp({create:{width:100,height:125,channels:3,background:'blue'}}).jpeg().toFile(file);
  const result=await importFiles(store,[{name:'TESTE-foto.jpg',path:file}]);
  assert.equal(result.manualProductKeys.length,1);
  const p=store.state.products[0];assert.equal(p.baseApproved,true);assert.equal(p.platform,'');assert.equal(p.availability,null);assert.equal(p.templateId,null);assert.equal(p.reviewed,false);
});

test('duas versões avulsas reutilizam a base e não duplicam ao repetir nem alteram catálogo',async()=>{
  const root=await fs.mkdtemp(path.resolve('work/variant-test-'));
  const {app,store}=await createApp(root);
  const cover=await store.addAsset(await sharp({create:{width:80,height:100,channels:3,background:'blue'}}).png().toBuffer(),'TESTE.png');
  const layer=await store.addAsset(await sharp(Buffer.from('<svg width="20" height="10"><rect x="1" y="1" width="18" height="8" fill="red"/></svg>')).png().toBuffer(),'TESTE-faixa.png','layer');
  store.state.templates=['PS4','PS5'].map(platform=>({id:platform,name:'TESTE '+platform,platform,availability:'immediate',layers:[{assetId:layer.id,anchor:'bottom-left',width:.5,marginX:.05,marginY:.04,opacity:1},{assetId:layer.id,anchor:'bottom-right',width:.1,marginX:.05,marginY:.04,opacity:1}]}));
  const manual={key:'m',id:'local-test',slug:'teste',manualAsset:cover.id,baseId:cover.id,baseChoices:[cover.id],baseApproved:true,platform:'',reviewed:false};
  const catalog={...manual,key:'catalog',id:'123',manualAsset:undefined,platform:'PS4'};store.state.products.push(manual,catalog);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    const url=`http://127.0.0.1:${server.address().port}`;
    const {token}=await fetch(url+'/api/state').then(r=>r.json());
    const post=body=>fetch(url+'/api/manual-variants',{method:'POST',headers:{'Content-Type':'application/json','x-local-token':token},body:JSON.stringify(body)});
    assert.equal((await post({keys:['m']})).status,400);
    const result=await post({keys:['m','catalog'],availabilityConfirmed:true}).then(r=>r.json());assert.equal(result.keys.length,2);assert.deepEqual(result.skipped,['catalog']);
    const variants=store.state.products.filter(p=>result.keys.includes(p.key));assert.deepEqual(variants.map(p=>p.platform),['PS4','PS5']);assert.equal(variants[0].baseId,variants[1].baseId);assert.notEqual(variants[0].slug,variants[1].slug);assert.notEqual(variants[0].id,variants[1].id);assert.ok(variants.every(p=>p.reviewed===false));
    await post({keys:result.keys,availabilityConfirmed:true});assert.equal(store.state.products.length,3);assert.equal(catalog.slug,'teste');assert.equal(catalog.templateId,undefined);
  }finally{await new Promise(r=>server.close(r));}
});

test('a mesma imagem com outro nome reaproveita o original sem reabrir para escrita',async()=>{
  const root=await fs.mkdtemp(path.resolve('work/immutable-test-')),store=await new Store(root).init();
  const bytes=await sharp({create:{width:80,height:100,channels:3,background:'blue'}}).png().toBuffer();
  const first=await store.addAsset(bytes,'TESTE-a.png');
  const file=store.assetPath(first.id);await fs.utimes(file,new Date(1000),new Date(1000));
  const before=(await fs.stat(file)).mtimeMs;
  const second=await store.addAsset(bytes,'TESTE-b.png');
  assert.notEqual(first.id,second.id);assert.equal(first.file,second.file);assert.equal((await fs.stat(file)).mtimeMs,before);assert.equal(hash(await fs.readFile(file)),hash(bytes));
});
