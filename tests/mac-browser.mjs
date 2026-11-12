import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createServer} from '../server/index.mjs';
const require=createRequire(import.meta.url);const {chromium}=require('@playwright/test');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-browser-'));const {server,store}=createServer({dataDir});
const content=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const first=store.create({title:'中文验收 A',content:content('原始内容')});
store.create({title:'中文验收 B',content:content('另一篇文档内容')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const result={environment:'Mac Google Chrome, standalone not DSH',checks:[]};
try{
 await page.goto(base);await page.locator('#documents button').filter({hasText:'中文验收 A'}).click();
 const body=page.locator('.tiptap');await body.click();await page.keyboard.press('Meta+ArrowDown');await page.keyboard.type('。中文追加');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'),{},{timeout:10000});
 assert.ok(JSON.stringify(store.get(first.id).content).includes('中文追加'));result.checks.push('UI Chinese typing persists to backend');
 await page.reload();await page.locator('#documents button').filter({hasText:'中文验收 A'}).click();await page.waitForFunction(()=>document.querySelector('.tiptap')?.textContent.includes('中文追加'));result.checks.push('Reload restores saved content');
 // Two pages start at identical revision; the second must not overwrite first.
 const other=await browser.newPage();await other.goto(base);await other.locator('#documents button').filter({hasText:'中文验收 A'}).click();
 await body.click();await page.keyboard.press('Meta+ArrowDown');await page.keyboard.type(' FIRST');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));
 await other.locator('.tiptap').click();await other.keyboard.press('Meta+ArrowDown');await other.keyboard.type(' SECOND');await other.waitForFunction(()=>document.querySelector('#status').textContent.includes('冲突'),{},{timeout:10000});
 assert.ok(JSON.stringify(store.get(first.id).content).includes('FIRST'));assert.ok(!JSON.stringify(store.get(first.id).content).includes('SECOND'));result.checks.push('Conflicting second page preserves server revision and reports conflict');
 await other.close();await page.screenshot({path:new URL('../docs/mac-browser.png',import.meta.url).pathname,fullPage:true});assert.deepEqual(errors,[]);result.checks.push('No uncaught browser errors');
 fs.writeFileSync(new URL('../docs/browser-acceptance.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});}
