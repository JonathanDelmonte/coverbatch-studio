import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readJSON, writeJSON } from './files.js';

// A private edition ships a "perfil" folder next to the app: profile.json, the
// store kit (kit.zip, or templates.zip from v0.x) and the developer's logo.
export async function seedProfile(root, kit, profileRoot) {
  const target = path.join(root, 'profile');
  const installed = await readJSON(path.join(target, 'profile.json'), null);
  if (!profileRoot) return installed;
  const dir = path.resolve(profileRoot);
  const meta = await readJSON(path.join(dir, 'profile.json'), null);
  if (!meta) return installed;
  if (meta.version !== 1 || typeof meta.id !== 'string' || typeof meta.title !== 'string') throw new Error('Perfil local inválido.');
  const exists = file => stat(path.join(dir, file)).then(() => true, () => false);
  await mkdir(target, { recursive: true });
  const hasDeveloperLogo = await exists('developer-logo.svg');
  if (hasDeveloperLogo) await copyFile(path.join(dir, 'developer-logo.svg'), path.join(target, 'developer-logo.svg'));
  const profile = { id: meta.id, title: meta.title.slice(0, 80), developer: String(meta.developer || 'ZIRTUNO').slice(0, 40), hasDeveloperLogo };
  await writeJSON(path.join(target, 'profile.json'), profile);
  let pack = null;
  for (const file of ['kit.zip', 'templates.zip']) if (await exists(file)) { pack = path.join(dir, file); break; }
  // Seed once per profile id: reopening or updating keeps the client's own edits.
  // The seeded kit becomes the "original" that every restore button returns to.
  if (kit.data.profileId !== meta.id) {
    if (pack) await kit.importZip(pack);
    kit.data.profileId = meta.id;
    await kit.save();
    if (pack) await kit.saveOriginal();
  } else if (pack && !(await stat(path.join(kit.originalDir, 'kit.json')).then(() => true, () => false))) {
    await kit.adoptOriginalFrom(pack);
  }
  return profile;
}
