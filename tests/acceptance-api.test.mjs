import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server/index.mjs';
const paragraph=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
test('independent HTTP acceptance: save, conflicting clients, restore, backup and origin gate',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-acceptance-'));const {server}=createServer({dataDir:dir});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(url,method='GET',body,headers={})=>{const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
 const created=await call('/api/documents','POST',{title:'中文验收',content:paragraph('第一版')});assert.equal(created.status,201);const id=created.data.document.id;
 const saved=await call('/api/documents/'+id,'PUT',{title:'中文验收',content:paragraph('第二版'),expectedRevision:1});assert.equal(saved.data.document.revision,2);
 const conflict=await call('/api/documents/'+id,'PUT',{title:'覆盖尝试',content:paragraph('不应保存'),expectedRevision:1});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'CONFLICT');
 const fetched=await call('/api/documents/'+id);assert.equal(fetched.data.document.content.content[0].content[0].text,'第二版');
 const restored=await call('/api/documents/'+id+'/restore','POST',{revision:1,expectedRevision:2});assert.equal(restored.data.document.revision,3);assert.equal(restored.data.document.content.content[0].content[0].text,'第一版');
 const del=await call('/api/documents/'+id,'DELETE',{expectedRevision:3});assert.ok(del.data.document.deletedAt);
 const undelete=await call('/api/documents/'+id+'/undelete','POST',{expectedRevision:4});assert.equal(undelete.data.document.deletedAt,null);
 const history=await call('/api/documents/'+id+'/history');assert.equal(history.data.history.length,5);
 const backup=await call('/api/backup');assert.equal(backup.data.records.length,1);
 const blocked=await call('/api/documents','POST',{title:'blocked',content:paragraph('x')},{Origin:'https://example.com'});assert.equal(blocked.status,403);
 const list=await call('/api/documents');assert.equal(list.data.documents.length,1);
 } finally {await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
