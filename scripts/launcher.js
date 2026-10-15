import path from 'node:path';
import { fstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp } from '../server.js';
import { sha256 } from '../lib/files.js';

export function openBrowser(url) {
  if (process.env.COVERBATCH_NO_BROWSER === '1') return;
  // The URL is generated locally; no file names or imported data reach the shell.
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', 'start', '', url], { stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => console.log(`Abra este endereço no navegador: ${url}`));
  child.unref();
}

// lifetime 'console': runs until the console window closes (the .cmd and `npm start`).
// lifetime 'window': started hidden by the Windows launcher; stops `closeDelayMs` after
// the last app window closes, or if no window ever connects within `firstWindowMs`.
export async function launch({ dataRoot, profileRoot, firstPort = 4317, portCount = 20, browser = openBrowser, lifetime = 'console', firstWindowMs = 120_000, closeDelayMs = 8_000, onStop } = {}) {
  const root = path.resolve(dataRoot);
  const instanceId = sha256(root.toLowerCase()).slice(0, 24);
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
  const created = await createApp(root, { profileRoot });
  const { app } = created;
  for (let port = firstPort; port < firstPort + portCount; port++) {
    try {
      const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port, '127.0.0.1');
        candidate.once('listening', () => resolve(candidate));
        candidate.once('error', reject);
      });
      const url = `http://127.0.0.1:${port}`;
      // Live progress streams keep connections open; close them so the process exits.
      let stopping = null;
      const stop = () => stopping ??= (async () => {
        await created.batches.flush().catch(() => {});
        server.close(); server.closeAllConnections();
        onStop?.();
      })();
      app.set('coverbatch.stop', stop);
      if (lifetime === 'window') {
        let timer = setTimeout(stop, firstWindowMs);
        app.on('presence', open => { clearTimeout(timer); if (open === 0) timer = setTimeout(stop, closeDelayMs); });
      }
      console.log(`\nCoverBatch Studio pronto!\n${url}\n\nSuas capas ficam somente neste computador.\nMantenha esta janela aberta durante o uso.\nPara encerrar, feche esta janela ou pressione Ctrl+C.\n`);
      browser(url);
      return { server, ...created, url, reused: false, instanceId, stop };
    } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('Não há uma porta local disponível. Encerre outra instância e tente novamente.');
}

// Real paths on both sides: Node resolves symlinks for import.meta.url, and the app
// may be reached through one (a linked folder on the Mac, a junction in tests).
const main = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (main && process.env.COVERBATCH_DETACH === '1' && process.platform !== 'win32') {
  // The macOS app: the engine leaves the launcher script's process group (setsid),
  // so it keeps running after the script ends, however macOS treats the script.
  const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, COVERBATCH_DETACH: '0' } });
  child.unref();
} else if (main) {
  try {
    // Node 22 is the runtime of the macOS app (it still runs on macOS 11); Windows ships 24.
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Esta versão requer Node.js 22 ou mais recente. Use o pacote pronto para Windows ou macOS.');
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    // Development flags: --data <dir>, --profile <dir>, --port <n>, --no-browser.
    const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const portable = process.env.COVERBATCH_PORTABLE_ROOT;
    const dataRoot = flag('--data') || process.env.COVERBATCH_DATA_DIR || (portable ? path.join(portable, 'dados-locais') : path.join(projectRoot, '.local-data'));
    const profileRoot = flag('--profile') || process.env.COVERBATCH_PROFILE_DIR || (portable ? path.join(portable, 'perfil') : undefined);
    const lifetime = process.env.COVERBATCH_LIFETIME === 'window' ? 'window' : 'console';
    const seconds = (name, fallback) => Number(process.env[name] || fallback) * 1000;
    const result = await launch({
      dataRoot, profileRoot, firstPort: Number(flag('--port') || process.env.PORT || 4317), browser: args.includes('--no-browser') ? () => {} : openBrowser,
      lifetime, firstWindowMs: seconds('COVERBATCH_FIRST_WINDOW_SECONDS', 120), closeDelayMs: seconds('COVERBATCH_CLOSE_SECONDS', 8),
      onStop: lifetime === 'window' ? () => setTimeout(() => process.exit(0), 200) : undefined,
    });
    // The Windows launcher holds our stdin (a pipe) open for as long as it lives: if it
    // is closed or killed, this process stops too, so no server is ever left behind.
    // Started from the macOS app, stdin is /dev/null and only the windows count.
    // Mode bits instead of isFIFO(): Node on Windows lacks the S_IFIFO constant, though libuv reports it.
    const piped = (() => { try { return (fstatSync(0).mode & 0o170000) === 0o010000; } catch { return false; } })();
    if (lifetime === 'window' && !result.reused && piped) {
      process.stdin.on('end', result.stop); process.stdin.on('error', result.stop); process.stdin.resume();
    }
  } catch (e) {
    console.error(`Não foi possível abrir o CoverBatch Studio.\n${e.message}\n`);
    process.exitCode = 1;
  }
}
