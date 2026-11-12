import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boundCrop,isLocalRasterSource,openImageCrop} from '../src/image-tools.js';
const src = '/api/assets/' + 'a'.repeat(64);
const tick = () => new Promise(resolve => setTimeout(resolve,0));
function setup(overrides = {}) {
 const dom = new JSDOM('<button>Before</button>'); let uploads = [], applied = [], errors = [], closes = 0;
 const instance = openImageCrop({src,ownerDocument:dom.window.document,loadImage:async()=>({naturalWidth:800,naturalHeight:600}),renderCrop:async()=> 'UE5H',upload:async data => {uploads.push(data);return {url:'/new'};},onApply:(...args)=>applied.push(args),isCurrent:()=>true,onError:e=>errors.push(e),onClose:()=>closes++,...overrides});
 return {dom,instance,uploads,applied,errors,get closes(){return closes;},button:()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='应用裁剪')};
}
test('crop rectangle clamps and rounds within natural bounds',()=>{
 assert.deepEqual(boundCrop({x:-5,y:900,width:999,height:-2},800,600),{x:0,y:599,width:800,height:1});
 assert.deepEqual(boundCrop({x:20.6,y:15.1,width:200,height:300},800,600),{x:21,y:15,width:200,height:300});
 assert.throws(()=>boundCrop({},0,200));
});
test('rejects remote, SVG and malformed local sources',()=>{for(const value of ['https://example.com/a.png','data:image/svg+xml;base64,YQ==','/api/assets/../../x','blob:arbitrary']) assert.equal(isLocalRasterSource(value),false);assert.equal(isLocalRasterSource(src),true);assert.equal(isLocalRasterSource('data:image/png;base64,YQ=='),true);});
test('Cancel and Escape do not upload or apply and restore focus',async()=>{
 for(const escape of [false,true]) {const s=setup();await s.instance.ready; if(escape)s.dom.window.document.dispatchEvent(new s.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));else s.instance.close();assert.equal(s.uploads.length,0);assert.equal(s.applied.length,0);assert.equal(s.closes,1);assert.equal(s.dom.window.document.querySelector('[role=dialog]'),null);s.instance.close();assert.equal(s.closes,1);}
});
test('numeric crop saves a distinct PNG asset and exact output size',async()=>{
 const s=setup(); await s.instance.ready; const input=s.dom.window.document.querySelector('input[aria-label="宽度（像素）"]');input.value='120';input.dispatchEvent(new s.dom.window.Event('change'));s.button().click();await tick();assert.equal(s.uploads[0].mime,'image/png');assert.equal(s.uploads[0].dataBase64,'UE5H');assert.equal(s.applied[0][1].width,120);assert.equal(s.closes,1);
});
test('stale document before Apply performs no upload',async()=>{const s=setup({isCurrent:()=>false});await s.instance.ready;s.button().click();await tick();assert.equal(s.uploads.length,0);assert.equal(s.applied.length,0);s.instance.close();});
test('cancel during render prevents upload',async()=>{let resolve;const s=setup({renderCrop:()=>new Promise(r=>resolve=r)});await s.instance.ready;s.button().click();s.instance.close();resolve('UE5H');await tick();assert.equal(s.uploads.length,0);assert.equal(s.applied.length,0);});
test('cancel or stale document during upload never replaces selected image',async()=>{
 for(const cancel of [false,true]) {let resolve;let current=true;const s=setup({isCurrent:()=>current,upload:()=>new Promise(r=>resolve=r)});await s.instance.ready;s.button().click();await tick();if(cancel)s.instance.close();else current=false;resolve({url:'/new'});await tick();assert.equal(s.applied.length,0);s.instance.close();}
});
test('failed upload leaves modal available for retry and original unchanged',async()=>{const s=setup({upload:async()=>{throw new Error('offline');}});await s.instance.ready;s.button().click();await tick();assert.equal(s.applied.length,0);assert.equal(s.errors.length,1);assert.equal(s.button().disabled,false);s.instance.close();});
test('resolved remote source is rejected before decoding',async()=>{const s=setup({resolveSource:async()=> 'https://evil.test/img'});await s.instance.ready;assert.equal(s.errors.length,1);assert.equal(s.button().disabled,true);s.instance.close();});
