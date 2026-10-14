import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { Store, hash } from './lib/store.js';
import { importFiles, exportTemplates, importTemplates } from './lib/importer.js';
import { compose, encode, readiness, validateTemplate, runJob, newJob } from './lib/render.js';

export async function createApp(dataRoot) {
  const store = await new Store(dataRoot).init();
  const packageInfo = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));
  const app = express(); const token = randomBytes(24).toString('hex');
  const jobs = new Map(); const imports = new Map(); let importing = false;
  const upload = multer({ dest: path.join(store.root, 'temp'), limits: { fileSize: 600_000_000, files: 2000, fieldSize: 2_000_000 } });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Bind to loopback and reject DNS rebinding / cross-origin browser access.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'Acesso apenas pelo localhost.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return res.status(403).json({ error: 'Origem não permitida.' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/') && req.method !== 'GET' && req.headers['x-local-token'] !== token) return res.status(403).json({ error: 'Reabra a interface local para renovar a sessão.' });
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
  app.get('/api/health', (_req, res) => res.json({ app: 'coverbatch-studio', version: packageInfo.version, instanceId: hash(store.root.toLowerCase()).slice(0, 24) }));
  app.post('/api/shutdown', async (_req, res) => {
    const stop = app.get('coverbatch.stop');
    if (typeof stop !== 'function') return res.status(409).json({ error: 'Encerre esta instância pela janela do programa.' });
    await store.writes;
    res.once('finish', () => stop());
    res.json({ ok: true });
  });
  app.get('/api/state', (_req, res) => res.json({ ...store.publicState(), token, readiness: Object.fromEntries(store.state.products.map(p => [p.key, readiness(store, p)])) }));
  app.get('/api/assets/:id', (req, res) => {
    const a = store.asset(req.params.id); res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type({ png: 'png', jpeg: 'jpg', webp: 'webp' }[a.format] || 'application/octet-stream').sendFile(store.assetPath(a.id), { dotfiles: 'allow' });
  });
  const cleanup = async files => { for (const f of files) await unlink(f.path).catch(() => {}); };
  app.post('/api/import', upload.array('files'), async (req, res) => {
    if (importing) { await cleanup(req.files); return res.status(409).json({ error: 'Aguarde a importação em andamento.' }); }
    if (!req.files?.length) throw new Error('Selecione um ZIP ou imagens.');
    const id = randomUUID(), report = { id, complete: false }; imports.set(id, report); importing = true;
    res.status(202).json({ id });
    (async () => {
      try { await importFiles(store, req.files.map(f => ({ name: f.originalname, path: f.path })), report); }
      catch (e) { report.error = e.message; report.phase = 'Falha na importação'; }
      finally { report.complete = true; importing = false; await cleanup(req.files); }
    })();
  });
  app.get('/api/import/:id', (req, res) => { const r = imports.get(req.params.id); if (!r) return res.status(404).json({ error: 'Importação não encontrada.' }); res.json(r); });
  app.post('/api/layers', upload.array('files', 20), async (req, res) => {
    const added = [], errors = [];
    try { for (const f of req.files || []) { try { added.push(await store.addAsset(await readFile(f.path), f.originalname, 'layer', undefined, { allowOpaque: req.body.allowOpaque === 'true' })); } catch (e) { errors.push(e.message); } } await store.save(); }
    finally { await cleanup(req.files || []); }
    res.json({ added, errors });
  });
  app.put('/api/templates/:id', async (req, res) => {
    const t = { ...req.body, id: req.params.id };
    validateTemplate(store, t);
    const i = store.state.templates.findIndex(x => x.id === t.id);
    if (i === -1) store.state.templates.push(t); else store.state.templates[i] = t;
    for (const p of store.state.products.filter(p => p.templateId === t.id)) p.reviewed = false;
    await store.save(); res.json(t);
  });
  app.delete('/api/templates/:id', async (req, res) => {
    store.state.templates = store.state.templates.filter(t => t.id !== req.params.id);
    for (const p of store.state.products.filter(p => p.templateId === req.params.id)) { p.templateId = null; p.reviewed = false; }
    await store.save(); res.json({ ok: true });
  });
  app.patch('/api/products', async (req, res) => {
    const { keys, changes } = req.body;
    if (!Array.isArray(keys) || !changes || keys.length > 3000) throw new Error('Seleção inválida.');
    const allowed = ['selected', 'templateId', 'availability', 'baseId', 'baseApproved', 'reviewed', 'override', 'id', 'slug', 'name', 'platform'];
    const skipped = [];
    for (const p of store.state.products.filter(p => keys.includes(p.key))) {
      const c = Object.fromEntries(Object.entries(changes).filter(([k]) => allowed.includes(k)));
      if (c.templateId) {
        const t = store.state.templates.find(t => t.id === c.templateId);
        if (!t || t.platform !== (c.platform ?? p.platform)) { skipped.push({ key: p.key, error: 'Plataforma incompatível.' }); continue; }
      }
      if (c.baseId) { const a = store.asset(c.baseId); if (['reference', 'layer'].includes(a.kind)) throw new Error('Referências e camadas não podem ser bases.'); c.baseApproved = false; c.reviewed = false; p.baseChoices = [...new Set([...p.baseChoices, a.id])]; }
      if (Object.keys(c).some(k => !['selected', 'reviewed'].includes(k))) c.reviewed = false;
      if (c.reviewed === true) { const { reviewed: _r, ...rest } = c; const test = { ...p, ...rest, reviewed: true }; const reason = readiness(store, test); if (reason) { skipped.push({ key: p.key, error: reason }); continue; } }
      Object.assign(p, c);
    }
    await store.save(); res.json({ ok: true, skipped });
  });
  app.put('/api/preferences', async (req, res) => { store.state.preferences = { ...store.state.preferences, ...req.body }; await store.save(); res.json(store.state.preferences); });
  app.post('/api/preview', async (req, res) => {
    const p = store.state.products.find(p => p.key === req.body.key); if (!p) throw new Error('Selecione um produto.');
    const view = { ...p, override: req.body.override || p.override };
    const composed = await compose(store, view, { template: req.body.template, original: !!req.body.original });
    // Exactly the same encoder as export, including the configured byte budget.
    let encoded, pending = null;
    try { encoded = await encode(composed, { ...store.state.preferences, ...req.body.preferences }); }
    catch (e) { if (!e.pending) throw e; pending = e.message; encoded = await encode(composed, { ...store.state.preferences, ...req.body.preferences, maxKB: 0 }); }
    res.json({ image: `data:image/${encoded.format};base64,${encoded.bytes.toString('base64')}`, width: encoded.width, height: encoded.height, bytes: encoded.size, quality: encoded.quality, warnings: encoded.warnings, pending, geometry: encoded.geometry });
  });
  app.post('/api/export', async (req, res) => {
    if ([...jobs.values()].some(j => !j.complete)) return res.status(409).json({ error: 'Aguarde o lote em andamento.' });
    const keys = req.body.keys || store.state.products.filter(p => p.selected).map(p => p.key);
    if (!Array.isArray(keys) || !keys.length || keys.length > 3000) throw new Error('Selecione pelo menos um produto (máximo 3 mil).');
    const job = newJob(); jobs.set(job.id, job);
    const prefs = { ...store.state.preferences, ...req.body.preferences };
    res.status(202).json({ id: job.id });
    runJob(store, job, [...new Set(keys)], prefs).catch(e => { job.error = e.message; job.complete = true; });
  });
  app.get('/api/jobs/:id', async (req, res) => {
    let j = jobs.get(req.params.id);
    if (!j && /^[a-f0-9-]{36}$/.test(req.params.id)) { try { j = JSON.parse(await readFile(path.join(store.root, 'jobs', req.params.id, 'job.json'), 'utf8')); jobs.set(j.id, j); } catch {} }
    if (!j) return res.status(404).json({ error: 'Lote não encontrado.' }); res.json(j);
  });
  app.get('/api/jobs/:id/download/:file', (req, res) => {
    const j = jobs.get(req.params.id); if (!j?.complete || j.error) return res.status(404).json({ error: 'Lote ainda indisponível.' });
    const file = req.params.file;
    if (file !== 'lote.zip' && !j.results.some(r => r.status === 'ok' && r.file === file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.download(path.join(store.root, 'jobs', j.id, file), file === 'lote.zip' ? `coverbatch-${j.id.slice(0, 8)}.zip` : file, { dotfiles: 'allow' });
  });
  app.get('/api/templates-export', async (_req, res) => {
    const file = path.join(store.root, 'temp', `${randomUUID()}.zip`); await exportTemplates(store, file);
    res.download(file, 'coverbatch-modelos.zip', { dotfiles: 'allow' }, () => { unlink(file).catch(() => {}); });
  });
  app.post('/api/templates-import', upload.single('file'), async (req, res) => {
    if (!req.file) throw new Error('Escolha o ZIP de modelos.');
    try { await importTemplates(store, req.file.path); res.json({ ok: true }); } finally { await cleanup([req.file]); }
  });
  app.use((err, _req, res, _next) => { if (!res.headersSent) res.status(400).json({ error: err.message || 'Falha local.' }); });
  return { app, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 para executar o CoverBatch Studio.');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const { app } = await createApp(process.env.COVERBATCH_DATA_DIR || path.join(root, '.local-data'));
  const port = Number(process.env.PORT || 4317);
  const server = app.listen(port, '127.0.0.1', () => console.log(`CoverBatch Studio pronto: http://127.0.0.1:${port}\nDados privados: .local-data (somente neste computador).\nPressione Ctrl+C para encerrar.`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Porta ${port} em uso. Encerre outra instância ou defina PORT.` : e.message); process.exitCode = 1; });
}
