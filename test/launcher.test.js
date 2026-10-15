import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { launch } from '../scripts/launcher.js';
import { tempDir } from './helpers.js';

test('lançador evita porta ocupada, usa dados próprios e reabre a mesma sessão', async () => {
  const root = await tempDir('launcher');
  const occupied = http.createServer((_req, res) => res.end('Outro programa')).listen(0, '127.0.0.1');
  await new Promise(r => occupied.once('listening', r));
  const port = occupied.address().port;
  const opened = [];
  let launched;
  try {
    launched = await launch({ dataRoot: path.join(root, 'cliente A'), firstPort: port, portCount: 5, browser: url => opened.push(url) });
    assert.notEqual(launched.url, `http://127.0.0.1:${port}`);
    const health = await fetch(launched.url + '/api/health').then(r => r.json()); assert.equal(health.instanceId, launched.instanceId);
    assert.equal((await fetch(launched.url + '/api/session').then(r => r.json())).batches.length, 0);
    const again = await launch({ dataRoot: path.join(root, 'cliente A'), firstPort: port, portCount: 5, browser: url => opened.push(url) });
    assert.equal(again.reused, true); assert.equal(again.url, launched.url); assert.equal(opened.length, 2);
    const state = await fetch(launched.url + '/api/session').then(r => r.json());
    const closed = new Promise(r => launched.server.once('close', r));
    const stopped = await fetch(launched.url + '/api/shutdown', { method: 'POST', headers: { 'x-local-token': state.token } });
    assert.equal(stopped.status, 200); await closed; assert.equal(launched.server.listening, false);
  } finally { if (launched?.server?.listening) await new Promise(r => launched.server.close(r)); await new Promise(r => occupied.close(r)); }
});

// The Windows launcher starts the program hidden with COVERBATCH_LIFETIME=window.
function startHidden(root, stdin = 'pipe') {
  const child = spawn(process.execPath, ['scripts/launcher.js', '--no-browser', '--data', root, '--port', '4400'], {
    env: { ...process.env, COVERBATCH_LIFETIME: 'window', COVERBATCH_FIRST_WINDOW_SECONDS: '20', COVERBATCH_CLOSE_SECONDS: '1' },
    stdio: [stdin, 'pipe', 'pipe'],
  });
  const exited = new Promise(r => child.once('exit', code => r(code)));
  const url = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', b => { out += b; const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out); if (m) resolve(m[0]); });
    child.once('exit', () => reject(new Error(out)));
  });
  return { child, exited, url };
}

test('aberto pelo lançador do Windows: fecha sozinho quando a última janela fecha', async () => {
  const { exited, url } = startHidden(await tempDir('lifetime-window'));
  const base = await url;
  const controller = new AbortController();
  const presence = await fetch(base + '/api/presence', { signal: controller.signal });
  assert.equal(presence.status, 200);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await fetch(base + '/api/health')).status, 200, 'continua aberto com a janela aberta');
  controller.abort();
  assert.equal(await exited, 0);
});

test('aberto pelo lançador do Windows: fecha junto se o lançador sumir', async () => {
  const { child, exited, url } = startHidden(await tempDir('lifetime-stdin'));
  await url;
  child.stdin.end();
  assert.equal(await exited, 0);
});

test('aberto pelo app do macOS (stdin vazio): fica aberto com a janela e fecha depois dela', async () => {
  const { exited, url } = startHidden(await tempDir('lifetime-mac'), 'ignore');
  const base = await url;
  const controller = new AbortController();
  await fetch(base + '/api/presence', { signal: controller.signal });
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await fetch(base + '/api/health')).status, 200, 'stdin vazio não encerra o programa');
  controller.abort();
  assert.equal(await exited, 0);
});
