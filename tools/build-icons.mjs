import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'assets/feishu-icons');
// name: [pack, file, mode, norm]
const MAP = {
  textBody:['menu','text-body','mono','h'], h1:['menu','heading-1','mono','h'], h2:['menu','heading-2','mono','h'],
  h3:['menu','heading-3','mono','h'], h4:['menu','heading-4','mono','h'], headingMore:['menu','heading-more','mono','h'],
  bulletList:['menu','unordered-list','mono','h'], orderedList:['menu','ordered-list','mono','h'], taskList:['menu','task','mono','h'],
  codeBlock:['menu','code-block','mono','h'], quote:['menu','quote','mono','h'], callout:['menu','callout','mono','h'],
  divider:['menu','divider','mono','max'], tableMono:['menu','table','mono','h'],
  bold:['toolbar','bold','mono','h'], italic:['toolbar','italic','mono','h'], underline:['toolbar','underline','mono','h'],
  strike:['toolbar','strikethrough','mono','h'], link:['toolbar','link','mono','h'], code:['toolbar','code','mono','h'],
  textColor:['toolbar','text-color','color','h'], alignLeft:['toolbar','align-left','mono','h'], chevronDown:['toolbar','chevron-down','mono','max'],
  blockStyle:['live','block-style','mono','h'], alignCenter:['live','align-center','mono','h'], alignRight:['live','align-right','mono','h'],
  more:['live','doc-more','mono','max'], plus:['menu','plus','mono','h'], drag:['live','drag-handle','mono','h'],
  history:['live','history','mono','h'], search:['live','search','mono','h'], doc:['live','document-tab','mono','h'],
  trash:['live','delete','mono','h'], cut:['live','cut','mono','h'], copy:['live','copy','mono','h'],
  copyCode:['live','copy-code','mono','h'], addBelow:['live','add-below','mono','h'],
  indentIncrease:['live','indent-increase','mono','h'], indentDecrease:['live','indent-decrease','mono','h'],
  indentAlign:['live','indent-align','mono','h'], blockColor:['live','block-color','mono','h'], wrapText:['live','wrap-text','mono','h'],
  mergeCells:['live','merge-cells','mono','h'], splitCells:['live','split-cells','mono','h'],
  deleteRow:['live','delete-row','mono','h'], deleteColumn:['live','delete-column','mono','h'],
  outlineToggle:['live','outline-toggle','mono','max'], whiteboard:['live','whiteboard','mono','h'],
  taskColor:['menu','task-color','color','h'], image:['menu','image','color','h'], attachment:['menu','attachment','color','h'],
  tableColor:['menu','table','color','h'], columns:['menu','columns','color','h'], calloutColor:['menu','callout-color','color','h'],
  formula:['menu','formula','color','h'], whiteboardColor:['live-color','whiteboard','color','h'],
};
const clean = s => s.replace(/<\?xml[^>]*\?>/g,'').replace(/<title[^>]*>.*?<\/title>/g,'')
  .replace(/\srole="img"/g,'').replace(/\saria-labelledby="[^"]*"/g,'')
  .replace(/\swidth="[^"]*"/g,'').replace(/\sheight="[^"]*"/g,'').replace(/\sxmlns="[^"]*"/g,'');
const readIcon = (pack,file,mode) => {
  let s = clean(fs.readFileSync(path.join(SRC,pack,file+'.svg'),'utf8')).trim();
  if (!s.startsWith('<svg')) throw new Error('bad svg '+pack+'/'+file);
  if (mode==='mono') s = s.replace(/style="[^"]*"/g,'').replace(/fill="(?!none|currentColor)[^"]*"/g,'fill="currentColor"');
  return s;
};
const items = Object.entries(MAP).map(([n,[pack,file,mode,norm]])=>({n,pack,file,norm,svg:readIcon(pack,file,mode)}));
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage();
await page.setContent('<div id="x">'+items.map(i=>`<div data-k="${i.n}">${i.svg.replace('<svg','<svg width="400" height="400"')}</div>`).join('')+'</div>');
const boxes = await page.evaluate(()=>{const o={};for(const d of document.querySelectorAll('[data-k]')){const s=d.querySelector('svg');const b=s.getBBox();o[d.dataset.k]={x:b.x,y:b.y,w:b.width,h:b.height}}return o});
await browser.close();
const r = v => Math.round(v*1000)/1000;
const data = {};
for (const it of items) {
  const b = boxes[it.n]; if (!b || !(b.w>0) || !(b.h>0)) throw new Error('empty bbox '+it.n);
  const pad = Math.max(b.w,b.h)*0.035;
  const x=r(b.x-pad), y=r(b.y-pad), w=r(b.w+pad*2), h=r(b.h+pad*2);
  data[it.n] = { svg: it.svg.replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${w} ${h}"`), aspect:r(b.w/b.h), norm:it.norm, src:`${it.pack}/${it.file}.svg` };
}
const out = `/* 自动生成：node tools/build-icons.mjs
 * 来源：assets/feishu-icons（toolbar-svg-assets / feishu-menu-svg-assets / feishu-live-icons-svg，
 * 由用户提供的复刻资产，非飞书官方源文件）。mono 图标用 currentColor，color 图标保留采样色。
 */
const DATA = ${JSON.stringify(data)};

export const VENDOR_META = Object.fromEntries(Object.entries(DATA).map(([k,v])=>[k,v.src]));

export function vendorIcon(name, { size = 20 } = {}) {
  const d = DATA[name];
  if (!d) throw new Error('[icons-vendor] 未知图标：' + name);
  let w, h;
  if (d.norm === 'w') { w = size; h = size / d.aspect; }
  else if (d.norm === 'max') { if (d.aspect >= 1) { w = size; h = size / d.aspect; } else { h = size; w = size * d.aspect; } }
  else { h = size; w = size * d.aspect; }
  return d.svg.replace('<svg', \`<svg width="\${Math.round(w*100)/100}" height="\${Math.round(h*100)/100}"\`);
}
`;
fs.writeFileSync(path.join(ROOT,'src/icons-vendor.js'), out);
console.log('icons:', items.length, 'module bytes:', out.length);
