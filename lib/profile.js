import { readFile, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { importTemplates } from './importer.js';

export async function seedProfile(store, profileRoot) {
  if (!profileRoot) return;
  const directory = path.resolve(profileRoot);
  let profile;
  try { profile = JSON.parse(await readFile(path.join(directory, 'profile.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (profile.version !== 1 || typeof profile.id !== 'string' || typeof profile.title !== 'string') throw new Error('Perfil local inválido.');
  // Only seed a new profile. Reopening/updating preserves the client's edits.
  if (store.state.profile?.id === profile.id) return;
  const destination = path.join(store.root, 'profile');
  await mkdir(destination, { recursive: true });
  for (const file of ['developer-logo.svg', 'reference.jpg']) {
    try { await stat(path.join(directory, file)); await copyFile(path.join(directory, file), path.join(destination, file)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const existing = [...store.state.templates];
  await importTemplates(store, path.join(directory, 'templates.zip'));
  const defaults = store.state.templates.slice(existing.length).map(t => {
    const match = existing.find(e => e.platform === t.platform && e.name === t.name);
    return match ? {...t,id:match.id} : t;
  });
  store.state.templates = store.state.templates.filter(t => !existing.some(e => e.id !== t.id && e.platform === t.platform && e.name === t.name));
  for (const preset of defaults) {
    const index = store.state.templates.findIndex(t => t.id === preset.id);
    if (index >= 0) store.state.templates[index] = preset;
  }
  for (const p of store.state.products) if (defaults.some(t => t.id === p.templateId)) p.reviewed = false;
  store.state.profile = { id: profile.id, title: profile.title, developer: profile.developer || 'ZIRTUNO', hasDeveloperLogo: !!profile.hasDeveloperLogo, hasReference: !!profile.hasReference, defaultTemplates: defaults };
  await store.save();
}
