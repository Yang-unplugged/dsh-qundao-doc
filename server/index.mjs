import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentStore, StoreError, MAX_CONTENT_BYTES } from './store.mjs';
import { MAX_ASSET_BYTES } from './assets.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); };
async function body(request, limit = MAX_CONTENT_BYTES + 65536) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new StoreError('Use application/json', 'CONTENT_TYPE', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new StoreError('Request is too large', 'TOO_LARGE', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new StoreError('Invalid JSON request'); }
}
function sendAsset(request, response, store, id) {
  const { asset, bytes } = store.getAsset(id);
  const inline = /^(image|audio|video)\//.test(asset.mime);
  const encodedName = encodeURIComponent(asset.name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const headers = {
    'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodedName}`,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes', 'ETag': `"${asset.id}"`,
  };
  let start = 0, end = bytes.length - 1, status = 200;
  const range = request.headers.range;
  if (range && (!request.headers['if-range'] || request.headers['if-range'] === headers.ETag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) { const count = Number(match[2]); start = Math.max(0, bytes.length - count); if (!Number.isSafeInteger(count) || count <= 0) start = bytes.length; }
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
    } else start = bytes.length;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': '0' }); response.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  response.writeHead(status, headers); response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
}
export function createServer({ dataDir = process.env.DATA_DIR || path.join(root, '.local-data'), staticDir = path.join(root, 'dist') } = {}) {
  const store = new DocumentStore(dataDir);
  const server = http.createServer(async (request, response) => {
    try {
      const port = server.address()?.port;
      const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!allowed.has(request.headers.host)) throw new StoreError('Invalid Host', 'FORBIDDEN', 403);
      if (request.headers.origin && ![...allowed].map(host => `http://${host}`).includes(request.headers.origin)) throw new StoreError('Cross-origin access denied', 'FORBIDDEN', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new StoreError('Cross-site access denied', 'FORBIDDEN', 403);
      const url = new URL(request.url, 'http://127.0.0.1');
      const method = request.method;
      if (url.pathname === '/api/assets' && method === 'POST') return json(response, 201, { asset: store.uploadAsset(await body(request, Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 65536)) });
      const assetMatch = /^\/api\/assets\/([0-9a-f]{64})$/.exec(url.pathname);
      if (assetMatch && ['GET', 'HEAD'].includes(method)) return sendAsset(request, response, store, assetMatch[1]);
      if (url.pathname === '/api/backup' && method === 'GET') return json(response, 200, store.backup());
      if (url.pathname === '/api/documents') {
        if (method === 'GET') return json(response, 200, { documents: store.list() });
        if (method === 'POST') return json(response, 201, { document: store.create(await body(request)) });
      }
      const match = /^\/api\/documents\/([0-9a-f-]{36})(?:\/(history|restore|undelete|metadata|named-versions))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) return json(response, 200, { document: store.get(id) });
        if (method === 'GET' && action === 'named-versions') return json(response, 200, { namedVersions: store.namedVersions(id) });
        if (method === 'POST' && action === 'named-versions') return json(response, 200, { document: store.nameVersion(id, await body(request)) });
        if (method === 'PATCH' && action === 'metadata') return json(response, 200, { document: store.updateMetadata(id, await body(request)) });
        if (method === 'GET' && action === 'history') return json(response, 200, { history: store.history(id) });
        if (method === 'PUT' && !action) return json(response, 200, { document: store.update(id, await body(request)) });
        if (method === 'DELETE' && !action) return json(response, 200, { document: store.setDeleted(id, (await body(request)).expectedRevision, true) });
        if (method === 'POST' && action === 'undelete') return json(response, 200, { document: store.setDeleted(id, (await body(request)).expectedRevision, false) });
        if (method === 'POST' && action === 'restore') return json(response, 200, { document: store.restore(id, await body(request)) });
      }
      if (url.pathname.startsWith('/api/')) throw new StoreError('API route not found', 'NOT_FOUND', 404);
      if (method !== 'GET' && method !== 'HEAD') throw new StoreError('Method not allowed', 'METHOD', 405);
      let relative;
      try { relative = decodeURIComponent(url.pathname); } catch { throw new StoreError('Invalid path'); }
      let file = path.resolve(staticDir, `.${relative}`);
      const base = path.resolve(staticDir);
      if (!file.startsWith(base + path.sep) && file !== base) throw new StoreError('Invalid path', 'FORBIDDEN', 403);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
      if (!fs.existsSync(file)) throw new StoreError('Build the frontend with npm run build first', 'NOT_BUILT', 503);
      if (!fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep)) throw new StoreError('Invalid static target', 'FORBIDDEN', 403);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      if (method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
    } catch (error) { json(response, error.status || 500, { error: error instanceof StoreError ? error.message : 'Storage operation failed; reload before retrying.', code: error.code && error instanceof StoreError ? error.code : 'STORAGE_ERROR' }); }
  });
  server.on('close', () => store.close());
  return { server, store };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log(`Local documents: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}
