import {DocumentStore,StoreError} from './server/store.mjs';
import{MAX_ASSET_BYTES}from'./server/assets.mjs';
import{homedir}from'node:os';import{join,isAbsolute}from'node:path';
export const inject=['connection'];
export function apply(ctx,config={}){
const dir=config.dataDir||join(homedir(),'.dsh','qundao-doc');if(!isAbsolute(dir))throw Error('Absolute dataDir required');const store=new DocumentStore(dir);
const run=async req=>{try{if(!req.headers.get('content-type')?.includes('application/json'))throw new StoreError('JSON required');const raw=await req.text();if(Buffer.byteLength(raw)>Math.ceil(MAX_ASSET_BYTES/3)*4+65536)throw new StoreError('Request too large');const {method='GET',path:requestPath,body={}}=JSON.parse(raw);if(typeof requestPath!=='string'||!requestPath.startsWith('/api/')||requestPath.includes('\\'))throw new StoreError('Invalid path');const url=new URL(requestPath,'http://dsh-local');if(url.origin!=='http://dsh-local'||url.hash||[...url.searchParams].some(([k,v])=>k!=='includeDeleted'||!['true','false'].includes(v))||(url.search&&url.pathname!=='/api/documents'))throw new StoreError('Invalid query');const path=url.pathname;let data;if(path==='/api/assets'&&method==='POST')data={asset:store.uploadAsset(body)};else if(/^\/api\/assets\/[0-9a-f]{64}$/.test(path)&&method==='GET'){const{asset,bytes}=store.getAsset(path.split('/').pop());data={asset,dataBase64:bytes.toString('base64')}}else if(path==='/api/backup'&&method==='GET')data=store.backup();else if(path==='/api/documents'&&method==='GET')data={documents:store.list()};else if(path==='/api/documents'&&method==='POST')data={document:store.create(body)};else{const m=/^\/api\/documents\/([0-9a-f-]{36})(?:\/(history|restore|undelete|metadata|named-versions))?$/.exec(path||'');if(!m)throw new StoreError('Unknown route','NOT_FOUND',404);const[,id,action]=m;if(method==='GET'&&!action)data={document:store.get(id)};else if(method==='GET'&&action==='history')data={history:store.history(id)};else if(method==='GET'&&action==='named-versions')data={namedVersions:store.namedVersions(id)};else if(method==='POST'&&action==='named-versions')data={document:store.nameVersion(id,body)};else if(method==='PATCH'&&action==='metadata')data={document:store.updateMetadata(id,body)};else if(method==='PUT'&&!action)data={document:store.update(id,body)};else if(method==='DELETE'&&!action)data={document:store.setDeleted(id,body.expectedRevision,true)};else if(method==='POST'&&action==='undelete')data={document:store.setDeleted(id,body.expectedRevision,false)};else if(method==='POST'&&action==='restore')data={document:store.restore(id,body)};else throw new StoreError('Unknown operation','NOT_FOUND',404)}return Response.json(data)}catch(e){return Response.json({error:e instanceof StoreError?e.message:'Storage operation failed',code:e.code||'STORAGE_ERROR'},{status:e.status||500})}};
// Own cleanup before registering any host resources. A synchronous registration
// failure must not leave a lock behind and block the next activation attempt.
let closed=false;
const close=()=>{process.removeListener('exit',close);if(closed)return;store.close();closed=true};
try{
ctx.effect(()=>{process.once('exit',close);return close},'qundao-doc close');
ctx.effect(()=>ctx.connection.fetch.register({path:'/api/qundao-doc.act',methods:['POST'],requestBody:'buffered',fetch:run}),'qundao-doc API');
}catch(error){close();throw error}

}

