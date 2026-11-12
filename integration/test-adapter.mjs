import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-adapter-'));
fs.cpSync(path.join(root,'server'),path.join(tmp,'server'),{recursive:true});fs.copyFileSync(path.join(root,'integration/adapter.mjs'),path.join(tmp,'adapter.mjs'));
const cleanups=[];let handler;const ctx={connection:{fetch:{register(spec){handler=spec.fetch;assert.equal(spec.path,'/api/qundao-doc.act');return()=>{}}}},effect(fn){const clean=fn();if(typeof clean==='function')cleanups.push(clean)}};
const {apply}=await import(pathToFileURL(path.join(tmp,'adapter.mjs')));apply(ctx,{dataDir:path.join(tmp,'data')});
const call=async(method,p,body)=>{const response=await handler(new Request('http://host/api/qundao-doc.act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,path:p,body})}));return{status:response.status,data:await response.json()}};
try{
 const create=await call('POST','/api/documents',{title:'宿主验收',content:{type:'doc',content:[{type:'paragraph'}]}});assert.equal(create.status,200);const id=create.data.document.id;
 const meta=await call('PATCH',`/api/documents/${id}/metadata`,{expectedRevision:1,metadata:{folder:'验证',favorite:true}});assert.equal(meta.data.document.revision,2);
 const named=await call('POST',`/api/documents/${id}/named-versions`,{expectedRevision:2,revision:1,name:'起点'});assert.equal(named.status,200);
 const del=await call('DELETE',`/api/documents/${id}`,{expectedRevision:named.data.document.revision});assert.ok(del.data.document.deletedAt);
 const list=await call('GET','/api/documents?includeDeleted=true');assert.equal(list.status,200);assert.equal(list.data.documents.length,1);
 const restore=await call('POST',`/api/documents/${id}/undelete`,{expectedRevision:del.data.document.revision});assert.equal(restore.data.document.deletedAt,null);
 assert.equal((await call('POST','/api/unknown',{})).status,404);
 for(const cleanup of cleanups.reverse())cleanup();assert.equal(fs.existsSync(path.join(tmp,'data','.lock')),false);
 // Fault injection uses the actual adapter and actual disk-backed DocumentStore.
 const listenersBefore=process.listenerCount('exit');
 for(const failureAt of ['route','cleanup-effect','route-effect']){
  const dir=path.join(tmp,'failure-'+failureAt),pending=[];
  const injected=new Error('injected '+failureAt+' failure');let effects=0;
  const broken={connection:{fetch:{register(){throw injected}}},effect(fn){
   effects++;
   if(failureAt==='cleanup-effect'&&effects===1)throw injected;
   if(failureAt==='route-effect'&&effects===2)throw injected;
   const cleanup=fn();if(typeof cleanup==='function')pending.push(cleanup);
  }};
  assert.throws(()=>apply(broken,{dataDir:dir}),error=>error===injected);
  assert.equal(fs.existsSync(path.join(dir,'.lock')),false,failureAt+' releases lock');
  assert.equal(process.listenerCount('exit'),listenersBefore,failureAt+' releases exit listener');
  // Cordis may dispose effects after apply throws: this must remain harmless.
  for(const cleanup of pending){cleanup();cleanup()}
  const recovered=[];
  apply({connection:{fetch:{register(){return()=>{}}}},effect(fn){const c=fn();if(typeof c==='function')recovered.push(c)}},{dataDir:dir});
  assert.ok(fs.existsSync(path.join(dir,'.lock')),failureAt+' permits reactivation');
  for(const cleanup of recovered.reverse()){cleanup();cleanup()}
  assert.equal(fs.existsSync(path.join(dir,'.lock')),false);
  assert.equal(process.listenerCount('exit'),listenersBefore);
 }
 console.log('Host adapter API checks passed; route registration, cleanup-effect and route-effect failures release locks/listeners; reactivation and repeated disposal pass');
}finally{for(const cleanup of cleanups)cleanup();fs.rmSync(tmp,{recursive:true,force:true})}
