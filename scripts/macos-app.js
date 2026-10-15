import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import archiver from 'archiver';
import sharp from 'sharp';

// Pieces of a macOS .app built on any system: no Xcode, codesign or hdiutil.

// Files of an official Node.js tarball (.tar.gz), read in memory. Handles the
// ustar prefix field and PAX/GNU long names; links and folders are skipped.
export async function readTarGz(file, wanted) {
  const tar = gunzipSync(await readFile(file));
  const found = new Map();
  let offset = 0, longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { longName = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1] ?? null; continue; }
    if (type === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if ((type === '0' || type === '\0') && wanted.includes(name)) found.set(name, Buffer.from(data));
  }
  return found;
}

// Architecture of a thin 64-bit Mach-O file: 'arm64', 'x64', or null.
export function machO(bytes) {
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf) return null;
  return { 0x0100000c: 'arm64', 0x01000007: 'x64' }[bytes.readUInt32LE(4)] ?? null;
}

// .icns with PNG payloads (macOS 10.7 and later): every size Finder and the Dock ask for.
const ICNS_TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
export async function icns(svg, { smallSvg = svg } = {}) {
  const cache = new Map();
  const png = async size => {
    // Drawn at 1024 px; 16 and 32 px use the simplified tile.
    if (!cache.has(size)) cache.set(size, await sharp(Buffer.from(size < 48 ? smallSvg : svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
    return cache.get(size);
  };
  const chunks = [];
  for (const [type, size] of ICNS_TYPES) {
    const data = await png(size), head = Buffer.alloc(8);
    head.write(type, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4);
    chunks.push(head, data);
  }
  const body = Buffer.concat(chunks), head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii'); head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// LSUIElement: the launcher is a script with no window of its own, so it stays out
// of the Dock; the program's window belongs to the browser that shows it.
export function infoPlist({ name, executable, identifier, version, minimumSystem, copyright }) {
  const strings = [
    ['CFBundleDevelopmentRegion', 'pt-BR'], ['CFBundleDisplayName', name], ['CFBundleExecutable', executable],
    ['CFBundleIconFile', 'AppIcon'], ['CFBundleIdentifier', identifier], ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', name], ['CFBundlePackageType', 'APPL'], ['CFBundleShortVersionString', version], ['CFBundleVersion', version],
    ['LSApplicationCategoryType', 'public.app-category.graphics-design'], ['LSMinimumSystemVersion', minimumSystem],
    ['NSHumanReadableCopyright', copyright],
  ];
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">', '<dict>',
    ...strings.map(([key, value]) => `\t<key>${key}</key>\n\t<string>${xml(value)}</string>`),
    '\t<key>LSUIElement</key>\n\t<true/>', '\t<key>NSHighResolutionCapable</key>\n\t<true/>',
    '</dict>', '</plist>', ''].join('\n');
}

// A ZIP that keeps Unix permissions (executables) and symlinks, as Archive
// Utility on the Mac expects. Entries: { name, path | bytes, mode } or { name, symlink }.
export async function writeMacZip(file, entries, date = new Date()) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(file);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve); output.on('error', reject);
    archive.on('error', reject); archive.on('warning', reject);
    archive.pipe(output);
    for (const e of entries) {
      if (e.symlink) { archive.symlink(e.name, e.symlink, 0o755); continue; }
      const options = { name: e.name, date, mode: e.mode ?? 0o644, store: /\.(jpe?g|png|webp|woff2|zip)$/i.test(e.name) };
      if (e.path) archive.file(e.path, options); else archive.append(e.bytes, options);
    }
    archive.finalize().catch(reject);
  });
}
