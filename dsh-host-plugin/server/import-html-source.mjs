// This preserves raw HTML as an editable code block. It does NOT convert old DSH
// schemas or interpret HTML. The input file is only read, never changed.
import fs from 'node:fs';
import path from 'node:path';
import { DocumentStore, MAX_CONTENT_BYTES } from './store.mjs';
const [source, destination, title] = process.argv.slice(2);
if (!source || !destination) { console.error('Usage: node server/import-html-source.mjs SOURCE.html DATA_DIR [TITLE]'); process.exitCode = 1; }
else {
  let store;
  try {
    if (fs.statSync(source).size > MAX_CONTENT_BYTES / 2) throw Error('HTML source exceeds 4 MiB import limit');
    const html = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(source));
    store = new DocumentStore(destination);
    const document = store.create({ title: title || path.basename(source), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original HTML source, preserved as code. This is not a rendered migration.' }] }, { type: 'codeBlock', attrs: { language: 'html' }, ...(html ? { content: [{ type: 'text', text: html }] } : {}) }] } });
    console.log(JSON.stringify({ id: document.id, warning: 'Source archived as text; old backup/version migration is not supported.' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; } finally { store?.close(); }
}
