#!/usr/bin/env node
/**
 * 打一个「纯编辑器」版 HTML：给想法成稿内嵌用。
 * - 和 build-host 一样把 CSS/JS 合成单文件，但不带文档库的启动流程；
 * - 去掉 KaTeX 字体（稿件里不会有公式，省 ~1.5MB）；
 * - 传输桥走 window.top（嵌在别人的 iframe 里时 window.parent 不是宿主页）。
 * 产物：dist-embed.html，并同步到想法成稿的 vendor 目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'dist/assets');
const names = fs.readdirSync(assets);

let css = fs.readFileSync(path.join(assets, names.find((n) => n.startsWith('index-') && n.endsWith('.css'))), 'utf8');
// 字体只内联非 KaTeX 的（KaTeX 字体占了绝大部分体积）
css = css.replace(/url\(([^)]+)\)/g, (all, url) => {
  const name = path.basename(url.replace(/["']/g, ''));
  if (!names.includes(name) || name.startsWith('KaTeX_')) return all;
  const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }[path.extname(name)] || 'application/octet-stream';
  return `url(data:${mime};base64,${fs.readFileSync(path.join(assets, name)).toString('base64')})`;
});

const js = fs.readFileSync(path.join(assets, names.find((n) => n.startsWith('index-') && n.endsWith('.js'))), 'utf8');
const assetBridge = fs.readFileSync(path.join(root, 'integration/asset-bridge.js'), 'utf8');

// 传输桥：嵌在宿主 iframe 里时，宿主页是 window.top
const transportBridge = `(function(){
  let hostWindow=window.parent;
  try{if(window.top&&window.top.__DSH_TRANSPORT__)hostWindow=window.top}catch{}
  const hostTransport=hostWindow.__DSH_TRANSPORT__;
  const hostFetch=typeof hostTransport?.fetch==='function'?hostTransport.fetch.bind(hostTransport):hostWindow.fetch.bind(hostWindow);
  window.fetch=async function(input,options){
    options=options||{};
    const target=typeof input==='string'?input:input.url;
    if(!target.startsWith('/api/'))throw new Error('Unsupported local resource');
    const body=options.body?JSON.parse(options.body):undefined;
    return hostFetch('api/writing-canvas.act',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:target,method:options.method||'GET',body})});
  };
})();`;

const html = '<!doctype html><meta charset="utf-8"><style>' + css + '</style><div id="app"></div>'
  + '<script>window.__DSH_EMBED__=true;' + transportBridge + assetBridge + '</script>'
  + '<script type="module">' + js.replace(/<\/script/gi, '<\\/script') + '</script>';

const outFile = path.join(root, 'dist-embed.html');
fs.writeFileSync(outFile, html);

const vendorDir = process.env.DOCS_VENDOR_DIR || '';
if (vendorDir) {
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(path.join(vendorDir, 'docs-editor.html'), html);
}
console.log(JSON.stringify({ outFile, bytes: html.length, vendor: vendorDir ? path.join(vendorDir, 'docs-editor.html') : null }));
