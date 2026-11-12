import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_LIBRARY_ASSET_BYTES = 200 * 1024 * 1024;
export const ASSET_ID = /^[0-9a-f]{64}$/;
const fail = message => { throw new StoreError(message); };
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'video/ogg', 'video/mp4', 'audio/mp4', 'video/webm', 'audio/webm', 'application/octet-stream']);
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export function decodeAsset(dataBase64) {
  if (typeof dataBase64 !== 'string' || !dataBase64.length || dataBase64.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 || dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(dataBase64)) fail('Invalid or oversized base64 asset');
  const bytes = Buffer.from(dataBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES || bytes.toString('base64') !== dataBase64) fail('Asset must contain 1 byte–20 MiB of canonical base64 data');
  return bytes;
}
export function validateAssetMetadata(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset) || !ASSET_ID.test(asset.id)) fail('Invalid asset ID');
  if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(asset.name) || ['.', '..'].includes(asset.name)) fail('Invalid asset filename');
  if (!mimeTypes.has(asset.mime)) fail('Unsupported asset MIME type');
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES) fail('Invalid asset size');
  if (typeof asset.createdAt !== 'string' || !Number.isFinite(Date.parse(asset.createdAt))) fail('Invalid asset timestamp');
  if (Object.keys(asset).some(key => !['id', 'name', 'mime', 'size', 'createdAt', 'dataBase64'].includes(key))) fail('Unknown asset field');
}
export function sniffAsset(bytes, mime) {
  const begins = signature => bytes.subarray(0, signature.length).equals(signature);
  const ascii = (offset, length) => bytes.toString('ascii', offset, offset + length);
  let valid = false;
  switch (mime) {
    case 'application/octet-stream': valid = true; break;
    case 'image/png': valid = bytes.length >= 33 && begins(Buffer.from('89504e470d0a1a0a','hex')) && ascii(12,4) === 'IHDR'; break;
    case 'image/jpeg': valid = bytes.length >= 4 && begins(Buffer.from([255,216,255])) && bytes.at(-2) === 255 && bytes.at(-1) === 217; break;
    case 'image/gif': valid = bytes.length >= 14 && ['GIF87a','GIF89a'].includes(ascii(0,6)); break;
    case 'image/webp': valid = bytes.length >= 20 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP'; break;
    case 'application/pdf': valid = bytes.length >= 8 && ascii(0,5) === '%PDF-'; break;
    case 'audio/wav': valid = bytes.length >= 44 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WAVE'; break;
    case 'audio/mpeg': valid = bytes.length >= 10 && (ascii(0,3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0 && (bytes[2] & 0xf0) !== 0xf0)); break;
    case 'audio/ogg': case 'video/ogg': valid = bytes.length >= 28 && ascii(0,4) === 'OggS' && bytes[4] === 0; break;
    case 'video/mp4': case 'audio/mp4': valid = bytes.length >= 24 && ascii(4,4) === 'ftyp' && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length; break;
    case 'video/webm': case 'audio/webm': valid = bytes.length >= 16 && begins(Buffer.from('1a45dfa3','hex')) && bytes.subarray(0, Math.min(4096, bytes.length)).includes(Buffer.from('webm')); break;
  }
  if (!valid) fail('Asset signature does not match its MIME type');
}
export function validateAssetBytes(asset, bytes) {
  validateAssetMetadata(asset);
  if (bytes.length !== asset.size || hashBytes(bytes) !== asset.id) fail('Asset size or SHA-256 mismatch');
  sniffAsset(bytes, asset.mime);
}
export function validateAssetList(assets, requireBytes = false) {
  if (!Array.isArray(assets) || assets.length > 10000) fail('Invalid asset manifest');
  const ids = new Set(); let total = 0;
  for (const asset of assets) {
    validateAssetMetadata(asset);
    if (ids.has(asset.id)) fail('Duplicate asset ID'); ids.add(asset.id);
    total += asset.size; if (total > MAX_LIBRARY_ASSET_BYTES) fail('Asset library exceeds 200 MiB');
    if (requireBytes) validateAssetBytes(asset, decodeAsset(asset.dataBase64));
    else if (Object.hasOwn(asset, 'dataBase64')) fail('Asset bytes belong in backups, not the live manifest');
  }
}
export function readAssetFile(directory, asset) {
  let fd;
  try {
    fd = fs.openSync(path.join(directory, asset.id), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== asset.size) fail('Asset file is missing or corrupt');
    const bytes = fs.readFileSync(fd); validateAssetBytes(asset, bytes); return bytes;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function writeAssetFile(directory, asset, bytes) {
  validateAssetBytes(asset, bytes);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, asset.id);
  if (fs.existsSync(destination)) { readAssetFile(directory, asset); return; }
  const temporary = path.join(directory, `.asset-${randomUUID()}.tmp`); let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, destination);
    const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); }
}
