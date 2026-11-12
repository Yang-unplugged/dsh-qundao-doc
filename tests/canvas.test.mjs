import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {LocalCanvas,emptyScene,normalizeScene,isValidScene,applySceneAction,renderSceneSVG,refreshCanvasControls} from '../src/canvas.js';
const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true,url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','DOMParser','getComputedStyle'])Object.defineProperty(globalThis,key,{value:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key],configurable:true});
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
const make=()=>new Editor({element:document.body.appendChild(document.createElement('div')),extensions:[StarterKit,LocalCanvas],content:{type:'doc',content:[{type:'localCanvas',attrs:{scene:emptyScene()}}]}});
test('Scene validation bounds imports and excludes unsafe attributes, IDs and dangling edges',()=>{
 const input={version:1,shapes:[{id:'safe',type:'rect',text:'<script>alert(1)</script>',width:Infinity,height:-9,x:9999,y:-50,fill:'url(javascript:evil)',onload:'evil'},{id:'safe',type:'rect'},{id:'<bad>',type:'rect'},{id:'x',type:'iframe'}],edges:[{id:'edge',from:'safe',to:'unknown'}]};
 const scene=normalizeScene(input);assert.equal(isValidScene(input),false);assert.equal(isValidScene({edges:scene.edges,shapes:scene.shapes,version:1}),true);assert.equal(isValidScene({...scene,unexpected:true}),false);assert.equal(scene.shapes.length,1);assert.equal(scene.shapes[0].x,660);assert.equal(scene.shapes[0].y,0);assert.equal(scene.shapes[0].height,30);assert.equal(scene.shapes[0].fill,'#e8efff');assert.equal(scene.edges.length,0);assert.equal(scene.shapes[0].onload,undefined);assert.deepEqual(normalizeScene({version:3,shapes:[]}),emptyScene());
 const svg=renderSceneSVG(scene);assert.equal(svg.querySelector('script'),null);assert.equal(svg.querySelector('title').textContent,'<script>alert(1)</script>');
 const huge=normalizeScene({version:1,shapes:Array.from({length:200},(_,i)=>({id:'s'+i,type:'rect',text:'a'.repeat(1000)})),edges:[]});assert.equal(huge.shapes.length,100);assert.equal(huge.shapes[0].text.length,500);
});
test('Immutable shape geometry, child branch, connectors and cascading deletion',()=>{
 const original=emptyScene();let scene=applySceneAction(original,{type:'add',shape:'diamond'});assert.equal(original.shapes.length,0);
 scene=applySceneAction(scene,{type:'child',id:'s1'});assert.equal(scene.shapes.length,2);assert.equal(scene.edges.length,1);assert.equal(scene.shapes[1].text,'子主题');
 scene=applySceneAction(scene,{type:'connect',from:'s1',to:'s2'});assert.equal(scene.edges.length,1);
 scene=applySceneAction(scene,{type:'update',id:'s2',patch:{x:9000,y:9000,width:999,height:999,id:'unsafe'}});assert.equal(scene.shapes[1].x,400);assert.equal(scene.shapes[1].y,240);assert.equal(scene.shapes[1].id,'s2');
 scene=applySceneAction(scene,{type:'delete',id:'s1'});assert.equal(scene.shapes.length,1);assert.equal(scene.edges.length,0);
});
test('Real Tiptap scene transactions, undo/redo, JSON reload and safe SVG HTML',()=>{
 const editor=make();assert.equal(editor.commands.canvasAction(0,{type:'add',shape:'rect'}),true);assert.equal(editor.commands.canvasAction(0,{type:'update',id:'s1',patch:{text:'业务 <img src=x onerror=evil>',width:200,x:60}}),true);
 assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].width,200);editor.commands.undo();assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].width,140);editor.commands.redo();assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].width,200);
 editor.commands.canvasAction(0,{type:'child',id:'s1'});const json=JSON.parse(JSON.stringify(editor.getJSON()));const html=editor.getHTML();assert.match(html,/<svg/);assert.doesNotMatch(html,/<img/);assert.equal(document.querySelectorAll('.local-canvas svg [data-shape-id]').length,2);
 const reopened=make();reopened.commands.setContent(json);assert.deepEqual(JSON.parse(JSON.stringify(reopened.getJSON())),json);assert.equal(reopened.getJSON().content[0].attrs.scene.edges.length,1);
 const htmlEditor=make();htmlEditor.commands.setContent(html);assert.deepEqual(htmlEditor.getJSON().content[0].attrs.scene,json.content[0].attrs.scene);
 reopened.setEditable(false);assert.equal(reopened.commands.canvasAction(0,{type:'delete',id:'s1'}),false);assert.equal(reopened.commands.insertLocalCanvas(),false);assert.ok([...reopened.view.dom.querySelectorAll('.local-canvas button')].every(b=>b.disabled));
 htmlEditor.destroy();reopened.destroy();editor.destroy();
});
test('NodeView synthetic controls edit text, select by keyboard, move and delete with undo',()=>{
 const editor=make();const view=editor.view.dom.querySelector('.local-canvas');[...view.querySelectorAll('button')].find(b=>b.textContent==='矩形').click();
 let shape=view.querySelector('[data-shape-id]');shape.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const text=view.querySelector('textarea');assert.ok(text);text.value='测试主题';text.dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].text,'测试主题');
 shape=view.querySelector('[data-shape-id]');shape.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,50);
 [...view.querySelectorAll('button')].find(b=>b.textContent==='添加子主题').click();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,2);
 [...view.querySelectorAll('button')].find(b=>b.textContent==='删除所选').click();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,1);assert.equal(editor.getJSON().content[0].attrs.scene.edges.length,0);editor.commands.undo();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,2);editor.destroy();
});
test('Synthetic pointer movement commits once on release; cancellation and read-only do not mutate',()=>{
 const editor=make();editor.commands.canvasAction(0,{type:'add',shape:'ellipse'});const view=editor.view.dom.querySelector('.local-canvas');
 const pointer=(el,type,x,y)=>el.dispatchEvent(new window.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true}));
 const begin=()=>{const svg=view.querySelector('svg');svg.getBoundingClientRect=()=>({width:800,height:480,left:0,top:0});pointer(svg.querySelector('[data-shape-id]'),'pointerdown',100,100)};
 begin();pointer(window,'pointermove',160,180);assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,40);pointer(window,'pointerup',160,180);assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,100);assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].y,120);editor.commands.undo();assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,40);editor.commands.redo();
 begin();pointer(window,'pointermove',300,300);pointer(window,'pointercancel',300,300);assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,100);
 editor.setEditable(false);begin();pointer(window,'pointermove',300,300);pointer(window,'pointerup',300,300);assert.equal(editor.getJSON().content[0].attrs.scene.shapes[0].x,100);editor.destroy();
});
test('Control identity survives focus transactions and input blur commits so first clicks are not lost',()=>{
 const editor=make();const view=editor.view.dom.querySelector('.local-canvas');const rectangle=[...view.querySelectorAll('button')].find(b=>b.textContent==='矩形');
 rectangle.dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true}));editor.view.dispatch(editor.state.tr.setMeta('canvas-test-focus',true));assert.ok(rectangle.isConnected);assert.equal([...view.querySelectorAll('button')].find(b=>b.textContent==='矩形'),rectangle);rectangle.click();
 const ellipse=[...view.querySelectorAll('button')].find(b=>b.textContent==='椭圆');ellipse.click();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,2);
 view.querySelector('[data-shape-id]').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const text=view.querySelector('textarea');const child=[...view.querySelectorAll('button')].find(b=>b.textContent==='添加子主题');
 child.dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true}));text.value='编辑后点子主题';text.dispatchEvent(new window.Event('change',{bubbles:true}));assert.ok(child.isConnected);assert.equal(view.querySelector('textarea'),text);child.click();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,3);
 editor.setEditable(false);assert.ok([...editor.view.dom.querySelectorAll('.local-canvas button')].every(b=>b.disabled));editor.setEditable(true);assert.equal([...editor.view.dom.querySelectorAll('.local-canvas button')].find(b=>b.textContent==='矩形').disabled,false);editor.destroy();
});

test('Explicit silent read-only refresh changes controls without document, history or update writes',()=>{
 const editor=make();editor.commands.canvasAction(0,{type:'add',shape:'rect'});const before=JSON.stringify(editor.getJSON());const state=editor.state;let transactions=0,updates=0;editor.on('transaction',()=>transactions++);editor.on('update',()=>updates++);
 editor.setEditable(false,false);refreshCanvasControls(editor);assert.ok([...editor.view.dom.querySelectorAll('.local-canvas button')].every(b=>b.disabled));
 editor.setEditable(true,false);refreshCanvasControls(editor);assert.equal([...editor.view.dom.querySelectorAll('.local-canvas button')].find(b=>b.textContent==='矩形').disabled,false);assert.equal(JSON.stringify(editor.getJSON()),before);assert.equal(editor.state,state);assert.equal(transactions,0);assert.equal(updates,0);editor.commands.undo();assert.equal(editor.getJSON().content[0].attrs.scene.shapes.length,0);editor.destroy();refreshCanvasControls(editor);
});
