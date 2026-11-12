import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DocumentStore, restoreBackup, validateState, DEFAULT_METADATA } from '../server/store.mjs';
import { createServer } from '../server/index.mjs';
const content = text => ({ type: 'doc', attrs: { localComments: [{ id: 'one', text: '保留属性' }] }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const setup = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-metadata-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
function open(t) { const dir = setup(t); const store = new DocumentStore(dir); t.after(() => store.close()); return { dir, store }; }
function legacy(state) { const old = structuredClone(state); old.version = 1; delete old.assets; for (const r of old.records) for (const d of [r.document, ...r.history]) { delete d.metadata; delete d.namedVersions; } return old; }
function writeState(dir, state) { const payload = JSON.stringify(state); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ schemaVersion: 1, payload, sha256: createHash('sha256').update(payload).digest('hex') })); }

test('metadata merges, persists, conflicts, survives content restore and preserves local annotations', t => {
  const { dir, store } = open(t); const doc = store.create({ title: '文档', content: content('v1') });
  assert.deepEqual(doc.metadata, DEFAULT_METADATA);
  let current = store.updateMetadata(doc.id, { expectedRevision: 1, metadata: { folder: '项目/计划', favorite: true, pinned: true, icon: '📄', cover: '#aabbcc' } });
  assert.equal(current.revision, 2);
  assert.throws(() => store.updateMetadata(doc.id, { expectedRevision: 1, metadata: { favorite: false } }), { code: 'CONFLICT' });
  current = store.updateMetadata(doc.id, { expectedRevision: 2, metadata: { icon: '📌' } });
  assert.equal(current.metadata.folder, '项目/计划');
  current = store.update(doc.id, { title: 'v2', content: content('v2'), expectedRevision: 3 });
  current = store.restore(doc.id, { revision: 1, expectedRevision: 4 });
  assert.deepEqual(current.content, doc.content); assert.equal(current.metadata.icon, '📌');
  store.close(); const reopened = new DocumentStore(dir); t.after(() => reopened.close()); assert.deepEqual(reopened.get(doc.id), current);
});

test('named versions reference immutable historical content, rename with revision lock and survive restore', t => {
  const { store } = open(t); const doc = store.create({ title: 'one', content: content('one') });
  let current = store.nameVersion(doc.id, { expectedRevision: 1, revision: 1, name: '  初稿  ' });
  assert.equal(current.revision, 2); assert.equal(current.namedVersions[0].name, '初稿');
  assert.deepEqual(store.history(doc.id).at(-1).namedVersions, []);
  assert.throws(() => store.nameVersion(doc.id, { expectedRevision: 1, revision: 1, name: 'stale' }), { code: 'CONFLICT' });
  current = store.nameVersion(doc.id, { expectedRevision: 2, revision: 1, name: '基线' });
  assert.equal(current.namedVersions.length, 1);
  current = store.restore(doc.id, { expectedRevision: 3, revision: 1 });
  assert.equal(current.namedVersions[0].name, '基线');
  assert.deepEqual(store.namedVersions(doc.id), current.namedVersions);
  assert.throws(() => store.nameVersion(doc.id, { expectedRevision: 4, revision: 9, name: 'future' }), { code: 'NOT_FOUND' });
  assert.throws(() => store.nameVersion(doc.id, { expectedRevision: 4, revision: 1, name: ' ' }));
  assert.throws(() => store.nameVersion(doc.id, { expectedRevision: 4, revision: 1, name: 'x'.repeat(101) }));
  store.setDeleted(doc.id, 4, true);
  assert.throws(() => store.nameVersion(doc.id, { expectedRevision: 5, revision: 1, name: 'trash' }), { code: 'DELETED' });
  assert.throws(() => store.updateMetadata(doc.id, { expectedRevision: 5, metadata: { favorite: true } }), { code: 'DELETED' });
});

test('metadata validation rejects unsafe or mistyped values without committing', t => {
  const { store } = open(t); const doc = store.create({ title: 'safe', content: content('safe') });
  for (const metadata of [null, [], { unknown: 1 }, { favorite: 'true' }, { pinned: 1 }, { folder: '../private' }, { folder: 'one//two' }, { folder: '/root' }, { folder: 'back\\slash' }, { folder: ' spaced ' }, { folder: 'x'.repeat(201) }, { icon: 'x'.repeat(33) }, { icon: '\u0000' }, { cover: 'url(https://evil.test)' }, { cover: '#fff' }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => store.updateMetadata(doc.id, { expectedRevision: 1, metadata }));
    assert.equal(store.get(doc.id).revision, 1);
  }
});

test('v3 backup roundtrip retains every metadata/label revision and validates before destination creation', t => {
  const { dir, store } = open(t); const doc = store.create({ title: 'backup', content: content('v1'), metadata: { folder: '档案' } });
  store.nameVersion(doc.id, { expectedRevision: 1, revision: 1, name: '存档' });
  const backup = store.backup(); assert.equal(backup.version, 3);
  restoreBackup(backup, path.join(dir, 'restore')); const restored = new DocumentStore(path.join(dir, 'restore')); t.after(() => restored.close()); assert.deepEqual(restored.backup(), backup);
  for (const edit of [d => { d.metadata.favorite = 'yes'; }, d => { d.namedVersions[0].revision = 999; }, d => { d.namedVersions.push(d.namedVersions[0]); }, d => { d.namedVersions[0].name = ''; }, d => { delete d.metadata; }]) {
    const bad = structuredClone(backup); edit(bad.records[0].document); bad.records[0].history[1] = structuredClone(bad.records[0].document);
    assert.throws(() => restoreBackup(bad, path.join(dir, 'invalid'))); assert.equal(fs.existsSync(path.join(dir, 'invalid')), false);
  }
  assert.throws(() => validateState({ ...backup, version: 999 }));
});

test('v1 open migrates in memory only; first edit persists v3 and legacy backup restores safely', t => {
  const { dir, store } = open(t); const doc = store.create({ title: 'legacy', content: content('legacy') }); store.update(doc.id, { title: 'second', content: content('second'), expectedRevision: 1 });
  const old = legacy(store.backup()); store.close(); writeState(dir, old);
  const originalBytes = fs.readFileSync(path.join(dir, 'state.json'));
  const migrated = new DocumentStore(dir); t.after(() => migrated.close());
  assert.deepEqual(fs.readFileSync(path.join(dir, 'state.json')), originalBytes);
  assert.equal(migrated.backup().version, 3); assert.equal(migrated.history(doc.id).length, 2); assert.deepEqual(migrated.get(doc.id).metadata, DEFAULT_METADATA);
  migrated.updateMetadata(doc.id, { expectedRevision: 2, metadata: { favorite: true } });
  assert.equal(JSON.parse(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).payload).version, 3);
  restoreBackup(old, path.join(dir, 'legacy-restored')); const copy = new DocumentStore(path.join(dir, 'legacy-restored')); t.after(() => copy.close());
  assert.equal(copy.history(doc.id).length, 2); assert.equal(copy.get(doc.id).title, 'second');
  const smuggled = structuredClone(old); smuggled.records[0].document.metadata = {}; smuggled.records[0].history[1].metadata = {};
  assert.throws(() => restoreBackup(smuggled, path.join(dir, 'smuggled')));
});

test('HTTP metadata and naming APIs return current revision, reject races and expose backup v3', async t => {
  const dir = setup(t); const { server } = createServer({ dataDir: dir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const doc = (await (await call('/api/documents', 'POST', { title: 'HTTP', content: content('x') })).json()).document;
  const endpoint = '/api/documents/' + doc.id;
  const responses = await Promise.all([true, false].map(favorite => call(endpoint + '/metadata', 'PATCH', { expectedRevision: 1, metadata: { favorite } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const named = await call(endpoint + '/named-versions', 'POST', { expectedRevision: 2, revision: 1, name: 'HTTP 标签' }); assert.equal(named.status, 200); assert.equal((await named.json()).document.revision, 3);
  const labels = (await (await call(endpoint + '/named-versions')).json()).namedVersions; assert.equal(labels[0].name, 'HTTP 标签');
  assert.equal((await call(endpoint + '/metadata', 'PATCH', { expectedRevision: 3, metadata: { cover: 'javascript:bad' } })).status, 400);
  assert.equal((await (await call('/api/backup')).json()).version, 3);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=', 'base64');
const upload = (store, bytes = PNG, name = '像素.png', mime = 'image/png') => store.uploadAsset({ name, mime, dataBase64: bytes.toString('base64') });
test('assets persist separately, deduplicate, retain immutable descriptor and survive full backup/restore', t => {
  const { dir, store } = open(t); const asset = upload(store); assert.match(asset.id, /^[0-9a-f]{64}$/); assert.equal(asset.url, '/api/assets/' + asset.id);
  const again = upload(store, PNG, 'other.png'); assert.equal(again.name, asset.name); assert.equal(store.state.assets.length, 1);
  assert.throws(() => upload(store, PNG, 'other.bin', 'application/octet-stream'));
  const document = store.create({ title: '图片', content: { type: 'doc', content: [{ type: 'image', attrs: { src: asset.url } }] }, metadata: { cover: asset.url } });
  assert.deepEqual(store.getAsset(asset.id).bytes, PNG);
  const stored = JSON.parse(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).payload);
  assert.equal(Object.hasOwn(stored.assets[0], 'dataBase64'), false);
  const backup = store.backup(); assert.equal(backup.assets[0].dataBase64, PNG.toString('base64'));
  store.close(); const reopened = new DocumentStore(dir); t.after(() => reopened.close()); assert.deepEqual(reopened.getAsset(asset.id).bytes, PNG);
  restoreBackup(backup, path.join(dir, 'with-assets')); const copy = new DocumentStore(path.join(dir, 'with-assets')); t.after(() => copy.close());
  assert.deepEqual(copy.backup(), backup); assert.deepEqual(copy.get(document.id), document);
});

test('assets reject MIME spoofing, active inline types, unsafe names, malformed base64 and limits', async t => {
  const { store } = open(t); const { MAX_ASSET_BYTES, decodeAsset, sniffAsset } = await import('../server/assets.mjs');
  for (const [bytes, name, mime] of [[Buffer.from('<script>bad()</script>'), 'x.png', 'image/png'], [Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml'], [PNG, '../x.png', 'image/png'], [PNG, 'a\rb.png', 'image/png'], [PNG, 'a/b.png', 'image/png'], [PNG, 'x'.repeat(181), 'image/png']]) assert.throws(() => upload(store, bytes, name, mime));
  for (const dataBase64 of ['', '%%%%', 'Zg', 'Zg==\n', 'Zh==', '====', 4]) assert.throws(() => store.uploadAsset({ name: 'a.bin', mime: 'application/octet-stream', dataBase64 }));
  assert.throws(() => decodeAsset(Buffer.alloc(MAX_ASSET_BYTES + 1).toString('base64')));
  const bytes = Buffer.alloc(MAX_ASSET_BYTES, 1); assert.equal(decodeAsset(bytes.toString('base64')).length, MAX_ASSET_BYTES);
  assert.equal(store.state.assets.length, 0);
  // Header recognition is not a media decode/playback test.
  for (const mime of ['image/jpeg','image/gif','image/webp','application/pdf','audio/wav','audio/mpeg','audio/ogg','video/ogg','video/mp4','audio/mp4','video/webm','audio/webm']) assert.throws(() => sniffAsset(Buffer.from('not a valid media header'), mime));
});

test('v3 invalid or incomplete asset backups fail before touching restore destination', t => {
  const { dir, store } = open(t); const asset = upload(store);
  store.create({ title: 'linked', content: { type: 'doc', content: [{ type: 'image', attrs: { src: asset.url } }] } });
  const backup = store.backup();
  for (const modify of [b => { delete b.assets[0].dataBase64; }, b => { b.assets[0].dataBase64 = Buffer.from('bad').toString('base64'); }, b => { b.assets[0].id = '0'.repeat(64); }, b => { b.assets[0].size++; }, b => { b.assets.push(b.assets[0]); }, b => { b.assets = []; }, b => { b.assets[0].mime = 'text/html'; }]) {
    const bad = structuredClone(backup); modify(bad); const destination = path.join(dir, 'bad-assets');
    assert.throws(() => restoreBackup(bad, destination)); assert.equal(fs.existsSync(destination), false);
  }
});

test('missing/corrupt asset fails closed on read, backup, reopen; symlinks never read', t => {
  const { dir, store } = open(t); const asset = upload(store); const file = path.join(dir, 'assets', asset.id);
  fs.writeFileSync(file, Buffer.alloc(PNG.length));
  assert.throws(() => store.getAsset(asset.id)); assert.throws(() => store.backup()); store.close();
  assert.throws(() => new DocumentStore(dir), { code: 'CORRUPT_STORAGE' });
  fs.rmSync(file); fs.writeFileSync(path.join(dir, 'outside'), PNG); fs.symlinkSync(path.join(dir, 'outside'), file);
  assert.throws(() => new DocumentStore(dir), { code: 'CORRUPT_STORAGE' });
  fs.rmSync(file); assert.throws(() => new DocumentStore(dir), { code: 'CORRUPT_STORAGE' });
});

test('failed asset manifest commit does not advertise orphan bytes; retry adopts only validated bytes', t => {
  const { dir, store } = open(t); const original = store.file; store.file = path.join(dir, 'missing', 'state.json');
  assert.throws(() => upload(store)); assert.equal(store.state.assets.length, 0); assert.equal(store.backup().assets.length, 0);
  store.file = original; const asset = upload(store); assert.deepEqual(store.getAsset(asset.id).bytes, PNG); assert.equal(store.state.assets.length, 1);
});

test('document references require manifest assets and image cover; failed saves do not increment revision', t => {
  const { store } = open(t); const doc = store.create({ title: 'x', content: content('x') });
  const missing = '/api/assets/' + '0'.repeat(64);
  assert.throws(() => store.update(doc.id, { title: 'bad', expectedRevision: 1, content: { type: 'doc', content: [{ type: 'image', attrs: { src: missing } }] } }));
  assert.throws(() => store.updateMetadata(doc.id, { expectedRevision: 1, metadata: { cover: missing } }));
  const attachment = upload(store, Buffer.from('opaque text'), 'file.txt', 'application/octet-stream');
  assert.throws(() => store.updateMetadata(doc.id, { expectedRevision: 1, metadata: { cover: attachment.url } }));
  assert.equal(store.get(doc.id).revision, 1);
});

test('v2 files migrate metadata and named versions into asset-capable v3 without rewriting on open', t => {
  const { dir, store } = open(t); const doc = store.create({ title: 'v2', content: content('x'), metadata: { favorite: true } }); store.nameVersion(doc.id, { expectedRevision: 1, revision: 1, name: 'baseline' });
  const v2 = store.backup(); v2.version = 2; delete v2.assets; store.close(); writeState(dir, v2);
  const raw = fs.readFileSync(path.join(dir, 'state.json')); const reopened = new DocumentStore(dir); t.after(() => reopened.close());
  assert.deepEqual(fs.readFileSync(path.join(dir, 'state.json')), raw); assert.equal(reopened.backup().version, 3); assert.deepEqual(reopened.backup().assets, []); assert.equal(reopened.get(doc.id).namedVersions[0].name, 'baseline');
});

test('HTTP assets upload/download, MIME headers, HEAD, byte ranges, origin restrictions and backup bytes', async t => {
  const dir = setup(t); const { server } = createServer({ dataDir: dir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (name, mime, bytes, headers = {}) => fetch(base + '/api/assets', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name, mime, dataBase64: bytes.toString('base64') }) });
  const response = await post('像素.png','image/png',PNG); assert.equal(response.status, 201); const { asset } = await response.json();
  const downloaded = await fetch(base + asset.url); assert.equal(downloaded.headers.get('content-type'), 'image/png'); assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff'); assert.match(downloaded.headers.get('content-disposition'), /^inline;/); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), PNG);
  const head = await fetch(base + asset.url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), String(PNG.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const [range, start, end] of [['bytes=0-7',0,7],['bytes=8-',8,PNG.length-1],['bytes=-4',PNG.length-4,PNG.length-1]]) {
    const partial = await fetch(base + asset.url, { headers: { range } }); assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), `bytes ${start}-${end}/${PNG.length}`); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), PNG.subarray(start,end+1));
  }
  for (const range of ['bytes=99999-','bytes=5-2','bytes=0-1,3-5','bytes=-0','garbage']) assert.equal((await fetch(base + asset.url, { headers: { range } })).status, 416);
  const whole = await fetch(base + asset.url, { headers: { range: 'bytes=0-1', 'if-range': '"stale"' } }); assert.equal(whole.status, 200);
  const pdf = (await (await post('doc.pdf','application/pdf',Buffer.from('%PDF-1.7\n%%EOF'))).json()).asset;
  const pdfResponse = await fetch(base + pdf.url); assert.match(pdfResponse.headers.get('content-disposition'), /^attachment;/); assert.match(pdfResponse.headers.get('content-security-policy'), /sandbox/);
  const opaque = (await (await post('page.html','application/octet-stream',Buffer.from('<script>alert(1)</script>'))).json()).asset;
  const opaqueResponse = await fetch(base + opaque.url); assert.equal(opaqueResponse.headers.get('content-type'), 'application/octet-stream'); assert.match(opaqueResponse.headers.get('content-disposition'), /^attachment;/);
  assert.equal((await post('x','image/png',PNG,{ origin: 'https://evil.test' })).status,403);
  assert.equal((await fetch(base + '/api/assets/' + '0'.repeat(64))).status,404);
  const backup = await (await fetch(base + '/api/backup')).json(); assert.equal(backup.assets.length,3); assert.equal(backup.assets[0].dataBase64,PNG.toString('base64'));
});
