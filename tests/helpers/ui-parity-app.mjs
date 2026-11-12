import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from '../../server/index.mjs';

export const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
export const doc = (...content) => ({ type: 'doc', content });
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFor(check, description = 'condition', timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await wait(20); }
  throw new Error(`Timed out waiting for ${description}`);
}

/** Actual app + actual localhost API + isolated disk storage. Geometry is synthetic. */
export async function openTestApp() {
  const root = path.resolve(import.meta.dirname, '../..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ui-parity-'));
  const { server, store } = createServer({ dataDir: path.join(temporary, 'data') });
  const first = store.create({ title: '交互测试 A', content: doc(paragraph('初始测试内容')) });
  const second = store.create({ title: '交互测试 B', content: doc(paragraph('第二份独立文档')) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: origin, pretendToBeVisual: true });
  const prior = new Map();
  const put = (key, value) => {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const name of ['window','document','navigator','HTMLElement','Node','Element','MutationObserver','DOMParser','localStorage','sessionStorage','location','FileReader','Event','KeyboardEvent','MouseEvent','InputEvent','Range']) put(name, dom.window[name]);
  put('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  put('innerWidth', 1440); put('innerHeight', 1000);
  put('requestAnimationFrame', fn => setTimeout(fn, 0)); put('cancelAnimationFrame', clearTimeout);
  const dialogs = [];
  put('confirm', () => true); put('prompt', message => { dialogs.push(message); return null; }); put('alert', message => dialogs.push(message));
  const rectangle = { x: 300, y: 200, left: 300, right: 700, top: 200, bottom: 230, width: 400, height: 30, toJSON() { return this; } };
  dom.window.Range.prototype.getClientRects = () => [rectangle];
  dom.window.Range.prototype.getBoundingClientRect = () => rectangle;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => rectangle;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.scrollBy = () => {};
  const nativeFetch = globalThis.fetch;
  const requests = [];
  put('fetch', async (url, options = {}) => {
    const target = new URL(url, origin);
    if (target.origin !== origin) throw new Error(`QA forbids external fetch: ${target.origin}`);
    requests.push({ url: target.pathname, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    return nativeFetch(target, options);
  });
  const output = path.join(temporary, 'application.mjs');
  try {
  await build({ entryPoints: [path.join(root, 'src/main.js')], outfile: output, bundle: true, platform: 'browser', format: 'esm', loader: { '.css': 'empty' } });
  await import(pathToFileURL(output).href);
  const $ = selector => document.querySelector(selector);
  await waitFor(() => window.dshEditor?.isEditable && $('#documents button') && $('#title')?.value && $('#status')?.textContent.includes('已保存'), 'initial document opening');
  const editor = window.dshEditor;
  const choose = async title => {
    const button = [...document.querySelectorAll('#documents button')].find(button => button.textContent.includes(title));
    if (!button) throw new Error(`Missing fixture document ${title}`);
    await button.onclick();
    await waitFor(() => $('#title').value === title && editor.isEditable, `open ${title}`);
  };
  await choose(first.title);
  return {
    dom, editor, store, first, second, requests, dialogs, $, choose,
    setContent(content) { editor.commands.setContent(content); editor.commands.setTextSelection(1); },
    async saved(id = first.id) { await waitFor(() => !$('#status').classList.contains('error') && $('#status').textContent.includes('已保存') && JSON.stringify(store.get(id).content) === JSON.stringify(editor.getJSON()), 'saved editor content'); },
    async close() {
      await wait(750);
      editor.destroy(); dom.window.close();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(temporary, { recursive: true, force: true });
      for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
  } catch (error) {
    error.message += `; status=${document.querySelector('#status')?.textContent}; requests=${JSON.stringify(requests)}`;
    window.dshEditor?.destroy(); dom.window.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, {recursive:true,force:true});
    for (const [key,descriptor] of prior) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }
    throw error;
  }
}
