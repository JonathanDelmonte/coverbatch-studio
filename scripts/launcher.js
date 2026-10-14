import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp } from '../server.js';
import { hash } from '../lib/store.js';

export function openBrowser(url) {
  if (process.env.COVERBATCH_NO_BROWSER === '1') return;
  // The URL is generated locally; no file names or imported data reach the shell.
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', 'start', '', url], { stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => console.log(`Abra este endereço no navegador: ${url}`));
  child.unref();
}

export async function launch({ dataRoot, firstPort = 4317, portCount = 20, browser = openBrowser } = {}) {
  const root = path.resolve(dataRoot);
  const instanceId = hash(root.toLowerCase()).slice(0, 24);
  if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort + portCount > 65535) throw new Error('Porta local inválida.');
  // Reopen this installation only. A different installation can have other data.
  for (let port = firstPort; port < firstPort + portCount; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(250) });
      const health = await response.json();
      if (health.app === 'coverbatch-studio' && health.instanceId === instanceId) {
        const url = `http://127.0.0.1:${port}`; browser(url);
        console.log(`O CoverBatch Studio já está aberto: ${url}`);
        return { reused: true, url, instanceId };
      }
    } catch { /* This port is free or belongs to another local program. */ }
  }
  const { app, store } = await createApp(root);
  for (let port = firstPort; port < firstPort + portCount; port++) {
    try {
      const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port, '127.0.0.1');
        candidate.once('listening', () => resolve(candidate));
        candidate.once('error', reject);
      });
      const url = `http://127.0.0.1:${port}`;
      app.set('coverbatch.stop', () => server.close());
      console.log(`\nCoverBatch Studio pronto!\n${url}\n\nSeus arquivos ficam somente neste computador.\nMantenha esta janela aberta durante o uso.\nPara encerrar, feche esta janela ou pressione Ctrl+C.\n`);
      browser(url);
      return { server, store, url, reused: false, instanceId };
    } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('Não há uma porta local disponível. Encerre outra instância e tente novamente.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Esta versão requer Node.js 24. Use o pacote portátil para Windows.');
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dataRoot = process.env.COVERBATCH_DATA_DIR || (process.env.COVERBATCH_PORTABLE_ROOT ? path.join(process.env.COVERBATCH_PORTABLE_ROOT, 'dados-locais') : path.join(projectRoot, '.local-data'));
    await launch({ dataRoot, firstPort: Number(process.env.PORT || 4317) });
  } catch (e) {
    console.error(`Não foi possível abrir o CoverBatch Studio.\n${e.message}\n`);
    process.exitCode = 1;
  }
}
