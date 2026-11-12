import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MAX_LIBRARY_ASSET_BYTES, hashBytes, decodeAsset, validateAssetBytes, validateAssetList, readAssetFile, writeAssetFile } from './assets.mjs';

export class StoreError extends Error {
  constructor(message, code = 'INVALID_INPUT', status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (message, code, status) => { throw new StoreError(message, code, status); };
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
export function validateContent(content) {
  if (!content || content.type !== 'doc' || !Array.isArray(content.content)) fail('Content must be a document JSON tree');
  let values = 0;
  function checkValue(value, depth = 0) {
    if (++values > 500000 || depth > 128) fail('Document attributes are too complex');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Unsafe object key');
      if (['href', 'src', 'url'].includes(key) && child !== null) {
        if (typeof child !== 'string' || /[\u0000-\u0020\u007f]/.test(child)) fail('Invalid URL');
        if (!/^(https?:\/\/|mailto:|tel:|#[^/]|\/(?!\/)|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(child)) fail('Unsafe URL protocol');
      }
      checkValue(child, depth + 1);
    }
  }
  checkValue(content);
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) fail('Document exceeds 8 MiB');
  let nodes = 0;
  function walk(node, depth) {
    if (++nodes > 100000 || depth > 64) fail('Document is too complex');
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(node.type)) fail('Invalid document node');
    if (node.text !== undefined && typeof node.text !== 'string') fail('Invalid text');
    if (node.attrs !== undefined && (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs))) fail('Invalid attributes');
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(m => !m || typeof m.type !== 'string'))) fail('Invalid marks');
    if (node.content !== undefined) { if (!Array.isArray(node.content)) fail('Invalid child content'); node.content.forEach(n => walk(n, depth + 1)); }
  }
  walk(content, 0);
}
function validateTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || /[\u0000-\u001f]/.test(title)) fail('Title must be 1–300 characters without control characters');
}
export const DEFAULT_METADATA = Object.freeze({ folder: '', favorite: false, pinned: false, icon: '', cover: '' });
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export function validateMetadata(metadata, partial = false) {
  if (!plainObject(metadata)) fail('Metadata must be an object');
  for (const key of Object.keys(metadata)) if (!Object.hasOwn(DEFAULT_METADATA, key)) fail('Unknown metadata field');
  if (!partial && Object.keys(DEFAULT_METADATA).some(key => !Object.hasOwn(metadata, key))) fail('Incomplete metadata');
  for (const [key, value] of Object.entries(metadata)) {
    if (['favorite', 'pinned'].includes(key)) { if (typeof value !== 'boolean') fail('Favorite and pinned must be boolean'); continue; }
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail('Invalid metadata text');
    if (key === 'folder' && (value.length > 200 || (value && value.split('/').some(part => !part.trim() || part !== part.trim() || ['.', '..'].includes(part))) || value.includes('\\'))) fail('Invalid folder path');
    if (key === 'icon' && value.length > 32) fail('Icon must be at most 32 characters');
    if (key === 'cover' && value !== '' && !/^#[0-9a-f]{6}$/i.test(value) && !/^\/api\/assets\/[0-9a-f]{64}$/.test(value)) fail('Cover must be empty, a six-digit hex color or a local image asset URL');
  }
}
function validateNamedVersions(versions, revision) {
  if (!Array.isArray(versions) || versions.length > 1000) fail('Invalid named versions');
  const seen = new Set();
  for (const version of versions) {
    if (!plainObject(version) || Object.keys(version).some(key => !['revision', 'name', 'createdAt'].includes(key)) || !Number.isSafeInteger(version.revision) || version.revision < 1 || version.revision >= revision || seen.has(version.revision)) fail('Invalid named version reference');
    seen.add(version.revision);
    if (typeof version.name !== 'string' || !version.name.trim() || version.name.length > 100 || /[\u0000-\u001f\u007f]/.test(version.name)) fail('Version name must be 1–100 characters');
    if (typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))) fail('Invalid named version timestamp');
  }
}
function validateDocument(doc, version = 2) {
  if (!doc || !/^[0-9a-f-]{36}$/.test(doc.id) || !Number.isSafeInteger(doc.revision) || doc.revision < 1) fail('Invalid document metadata');
  for (const key of ['createdAt', 'updatedAt']) if (typeof doc[key] !== 'string' || !Number.isFinite(Date.parse(doc[key]))) fail('Invalid document timestamp');
  if (doc.deletedAt !== null && (typeof doc.deletedAt !== 'string' || !Number.isFinite(Date.parse(doc.deletedAt)))) fail('Invalid deletion timestamp');
  validateTitle(doc.title); validateContent(doc.content);
  if (version >= 2) { validateMetadata(doc.metadata); validateNamedVersions(doc.namedVersions, doc.revision); }
}
export function validateState(state, { backup = false } = {}) {
  if (!state || state.format !== 'dsh-documents-next' || ![1, 2, 3].includes(state.version) || !Array.isArray(state.records)) fail('Unsupported backup format');
  if (state.version === 3) validateAssetList(state.assets, backup);
  else if (Object.hasOwn(state, 'assets')) fail('Legacy state cannot contain unvalidated assets');
  const ids = new Set();
  for (const record of state.records) {
    if (!record || typeof record !== 'object') fail('Invalid record');
    validateDocument(record.document, state.version);
    if (state.version === 3) validateAssetReferences(record.document, state.assets);
    if (ids.has(record.document.id)) fail('Duplicate document ID'); ids.add(record.document.id);
    if (!Array.isArray(record.history) || record.history.length !== record.document.revision) fail('Broken history');
    record.history.forEach((doc, i) => { validateDocument(doc, state.version); if (state.version === 3) validateAssetReferences(doc, state.assets); if (doc.id !== record.document.id || doc.revision !== i + 1) fail('Broken version chain'); });
    if (JSON.stringify(record.history.at(-1)) !== JSON.stringify(record.document)) fail('Current document does not match latest history');
  }
  return state;
}
function validateAssetReferences(document, assets) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  function walk(value) {
    if (typeof value === 'string' && value.startsWith('/api/assets/')) {
      const id = value.slice('/api/assets/'.length);
      if (!byId.has(id)) fail('Document references a missing local asset');
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['src', 'href', 'url', 'cover'].includes(key) || (child && typeof child === 'object')) walk(child);
      }
    }
  }
  walk(document.content); walk({ cover: document.metadata?.cover });
  if (document.metadata?.cover.startsWith('/api/assets/') && !byId.get(document.metadata.cover.slice('/api/assets/'.length))?.mime.startsWith('image/')) fail('Cover asset must be a raster image');
}
function upgradeState(state, options = {}) {
  validateState(state, options);
  if (state.version === 3) return state;
  const upgraded = clone(state); upgraded.version = 3; upgraded.assets = [];
  if (state.version === 1) for (const record of upgraded.records) {
    for (const doc of [...record.history, record.document]) {
      if (Object.hasOwn(doc, 'metadata') || Object.hasOwn(doc, 'namedVersions')) fail('Legacy document contains unsupported v2 fields');
      doc.metadata = { ...DEFAULT_METADATA }; doc.namedVersions = [];
    }
  }
  return validateState(upgraded, options);
}
function pack(state) {
  const payload = JSON.stringify(state);
  return JSON.stringify({ schemaVersion: 1, sha256: createHash('sha256').update(payload).digest('hex'), payload });
}
function unpack(raw) {
  const envelope = JSON.parse(raw);
  if (envelope.schemaVersion !== 1 || typeof envelope.payload !== 'string' || envelope.sha256 !== createHash('sha256').update(envelope.payload).digest('hex')) fail('Storage checksum mismatch');
  return upgradeState(JSON.parse(envelope.payload));
}
export class DocumentStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.lockPath = path.join(this.directory, '.lock');
    try { this.lock = fs.openSync(this.lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') fail('Data directory is locked. Stop its owner before manual recovery.', 'LOCKED', 423); throw error; }
    fs.writeFileSync(this.lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    this.file = path.join(this.directory, 'state.json');
    this.assetDirectory = path.join(this.directory, 'assets');
    try {
      this.state = fs.existsSync(this.file) ? unpack(fs.readFileSync(this.file, 'utf8')) : { format: 'dsh-documents-next', version: 3, records: [], assets: [] };
      if (fs.existsSync(this.assetDirectory) && (!fs.lstatSync(this.assetDirectory).isDirectory() || fs.lstatSync(this.assetDirectory).isSymbolicLink())) fail('Asset directory must be a real directory');
      for (const asset of this.state.assets) readAssetFile(this.assetDirectory, asset);
      if (!fs.existsSync(this.file)) this.persist(this.state);
    } catch (error) { this.close(); fail(`Cannot open data; no existing data was overwritten: ${error.message}`, 'CORRUPT_STORAGE', 500); }
  }
  assertOpen() { if (this.lock === null) fail('Store is closed', 'CLOSED', 503); }
  persist(state) {
    this.assertOpen();
    const temporary = path.join(this.directory, `.state-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, pack(state)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.file);
      // Rename is the commit point. Directory sync failure is reported as uncertain and
      // the caller must reopen/read instead of retrying the same expected revision.
      this.state = state;
      const dir = fs.openSync(this.directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } catch (error) { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); throw error; }
  }
  list() { this.assertOpen(); return clone(this.state.records.map(r => r.document).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  record(id, state = this.state) { this.assertOpen(); const record = state.records.find(r => r.document.id === id); if (!record) fail('Document not found', 'NOT_FOUND', 404); return record; }
  get(id) { return clone(this.record(id).document); }
  history(id) { return clone(this.record(id).history).reverse(); }
  create({ title, content, metadata = {} }) {
    validateTitle(title); validateContent(content); validateMetadata(metadata, true);
    const now = new Date().toISOString();
    const document = { id: randomUUID(), title: title.trim(), content: clone(content), revision: 1, createdAt: now, updatedAt: now, deletedAt: null, metadata: { ...DEFAULT_METADATA, ...clone(metadata) }, namedVersions: [] };
    validateAssetReferences(document, this.state.assets);
    const state = clone(this.state); state.records.push({ document, history: [document] }); this.persist(state); return clone(document);
  }
  change(id, expectedRevision, change) {
    const current = this.record(id).document;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('expectedRevision is required');
    if (expectedRevision !== current.revision) fail('This document has changed. Reload before saving.', 'CONFLICT', 409);
    const state = clone(this.state); const record = this.record(id, state);
    const document = { ...current, ...change(clone(current)), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    validateDocument(document); validateAssetReferences(document, state.assets); record.document = document; record.history.push(document); this.persist(state); return clone(document);
  }
  update(id, { title, content, expectedRevision }) {
    validateTitle(title); validateContent(content);
    return this.change(id, expectedRevision, current => { if (current.deletedAt) fail('Restore deleted document first', 'DELETED', 409); return { title: title.trim(), content: clone(content) }; });
  }
  updateMetadata(id, { metadata, expectedRevision }) {
    validateMetadata(metadata, true);
    return this.change(id, expectedRevision, current => {
      if (current.deletedAt) fail('Restore deleted document first', 'DELETED', 409);
      return { metadata: { ...current.metadata, ...clone(metadata) } };
    });
  }
  namedVersions(id) { return clone(this.record(id).document.namedVersions); }
  nameVersion(id, { revision, name, expectedRevision }) {
    return this.change(id, expectedRevision, current => {
      if (current.deletedAt) fail('Restore deleted document first', 'DELETED', 409);
      if (!Number.isSafeInteger(revision) || revision < 1 || revision > current.revision) fail('Version not found', 'NOT_FOUND', 404);
      const item = { revision, name: typeof name === 'string' ? name.trim() : name, createdAt: new Date().toISOString() };
      const namedVersions = current.namedVersions.filter(version => version.revision !== revision);
      namedVersions.push(item); validateNamedVersions(namedVersions, current.revision + 1);
      return { namedVersions };
    });
  }
  setDeleted(id, expectedRevision, deleted) { return this.change(id, expectedRevision, () => ({ deletedAt: deleted ? new Date().toISOString() : null })); }
  restore(id, { revision, expectedRevision }) {
    const previous = this.record(id).history.find(d => d.revision === revision);
    if (!previous) fail('Version not found', 'NOT_FOUND', 404);
    return this.change(id, expectedRevision, current => { if (current.deletedAt) fail('Restore deleted document first', 'DELETED', 409); return { title: previous.title, content: clone(previous.content) }; });
  }
  uploadAsset({ name, mime, dataBase64 }) {
    this.assertOpen(); const bytes = decodeAsset(dataBase64);
    const asset = { id: hashBytes(bytes), name, mime, size: bytes.length, createdAt: new Date().toISOString() };
    validateAssetBytes(asset, bytes);
    const existing = this.state.assets.find(item => item.id === asset.id);
    if (existing) {
      // A hash has one immutable descriptor; never switch its MIME based on a later upload.
      readAssetFile(this.assetDirectory, existing);
      if (existing.mime !== mime) fail('Identical bytes already stored with a different MIME type');
      return { ...clone(existing), url: '/api/assets/' + existing.id };
    }
    if (this.state.assets.reduce((sum, item) => sum + item.size, 0) + asset.size > MAX_LIBRARY_ASSET_BYTES || this.state.assets.length >= 10000) fail('Asset library limit reached');
    writeAssetFile(this.assetDirectory, asset, bytes);
    const state = clone(this.state); state.assets.push(asset); this.persist(state);
    return { ...clone(asset), url: '/api/assets/' + asset.id };
  }
  getAsset(id) {
    this.assertOpen(); const asset = this.state.assets.find(item => item.id === id);
    if (!asset) fail('Asset not found', 'NOT_FOUND', 404);
    return { asset: clone(asset), bytes: readAssetFile(this.assetDirectory, asset) };
  }
  backup() {
    this.assertOpen(); const backup = clone(this.state);
    backup.assets = backup.assets.map(asset => ({ ...asset, dataBase64: readAssetFile(this.assetDirectory, asset).toString('base64') }));
    return backup;
  }
  close() { if (this.lock !== null && this.lock !== undefined) { fs.closeSync(this.lock); this.lock = null; fs.rmSync(this.lockPath, { force: true }); } }
}
export function restoreBackup(backup, destination) {
  const migrated = upgradeState(backup, { backup: true });
  const directory = path.resolve(destination);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) fail('Restore destination must be empty');
  const store = new DocumentStore(directory);
  try {
    const state = clone(migrated);
    for (const asset of state.assets) { writeAssetFile(store.assetDirectory, asset, decodeAsset(asset.dataBase64)); delete asset.dataBase64; }
    store.persist(state);
  } finally { store.close(); }
  return directory;
}
