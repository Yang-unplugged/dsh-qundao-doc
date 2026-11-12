import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {LocalImage,MediaAttachment,validateMediaJSON,validateMediaAttrs,validateImageAttrs} from '../src/media.js';
const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true,url:'http://localhost'});
for(const name of ['window','document','navigator','HTMLElement','Node','Element','MutationObserver','DOMParser'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
const source='/api/assets/'+'a'.repeat(64),valid={src:source,mime:'audio/wav',name:'声音.wav',size:44};
test.after(()=>dom.window.close());
test('media import validator rejects malformed fields and unsafe image sources',()=>{
 assert.equal(validateMediaAttrs(valid),true);
 for(const patch of [{mime:null},{mime:22},{mime:'text/html'},{name:null},{name:{}},{name:'x'.repeat(181)},{name:'../bad'},{size:-1},{size:1.5},{size:Number.MAX_SAFE_INTEGER},{src:'javascript:alert(1)'},{src:'https://example.com/a.mp3'}])assert.throws(()=>validateMediaJSON({type:'doc',content:[{type:'mediaAttachment',attrs:{...valid,...patch}}]}));
 for(const src of [null,{},'javascript:alert(1)','https://example.com/x.png','data:image/svg+xml;base64,PHN2Zz4='])assert.throws(()=>validateImageAttrs({src}));
 assert.equal(validateImageAttrs({src:source,alt:'本地图片',title:null}),true);assert.throws(()=>validateImageAttrs({src:source,alt:{bad:true}}));
});
test('defensive NodeViews display invalid-node errors without throw or resource acquisition and can recover',async()=>{
 let acquired=0;window.dshResolveAssetURL=async()=>{acquired++;return 'blob:test'};
 const e=new Editor({element:document.createElement('div'),extensions:[StarterKit,LocalImage,MediaAttachment],content:{type:'doc',content:[{type:'mediaAttachment',attrs:{...valid,mime:null}},{type:'image',attrs:{src:null}}]}});
 assert.ok(e.view.dom.textContent.includes('附件媒体类型无效'));assert.ok(e.view.dom.textContent.includes('图片必须'));assert.equal(acquired,0);assert.ok(e.getHTML().includes('无效的本地附件'));
 e.commands.setContent({type:'doc',content:[{type:'mediaAttachment',attrs:valid}]});await new Promise(r=>setTimeout(r,10));assert.ok(e.view.dom.querySelector('audio[controls]'));assert.equal(acquired,1);e.destroy();delete window.dshResolveAssetURL;
});
