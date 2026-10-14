import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import http from 'node:http';
import {launch} from '../scripts/launcher.js';

test('lançador evita porta ocupada, usa dados próprios e reabre a mesma sessão',async()=>{
  const root=await mkdtemp(path.resolve('work/launcher-'));
  const occupied=http.createServer((_req,res)=>res.end('Outro programa')).listen(0,'127.0.0.1');
  await new Promise(r=>occupied.once('listening',r));
  const port=occupied.address().port;
  const opened=[];
  let launched;
  try{
    launched=await launch({dataRoot:path.join(root,'cliente A'),firstPort:port,portCount:5,browser:url=>opened.push(url)});
    assert.notEqual(launched.url,`http://127.0.0.1:${port}`);
    const health=await fetch(launched.url+'/api/health').then(r=>r.json());assert.equal(health.instanceId,launched.instanceId);
    assert.equal((await fetch(launched.url+'/api/state').then(r=>r.json())).products.length,0);
    const again=await launch({dataRoot:path.join(root,'cliente A'),firstPort:port,portCount:5,browser:url=>opened.push(url)});
    assert.equal(again.reused,true);assert.equal(again.url,launched.url);assert.equal(opened.length,2);
    const state=await fetch(launched.url+'/api/state').then(r=>r.json());
    const closed=new Promise(r=>launched.server.once('close',r));
    const stopped=await fetch(launched.url+'/api/shutdown',{method:'POST',headers:{'x-local-token':state.token}});
    assert.equal(stopped.status,200);await closed;assert.equal(launched.server.listening,false);
  }finally{if(launched?.server)await new Promise(r=>launched.server.close(r));await new Promise(r=>occupied.close(r));}
});
