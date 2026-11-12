import test from 'node:test';
import assert from 'node:assert/strict';
import { listLocalComments } from '../src/annotations.js';
import { openTestApp, paragraph as p, doc } from './helpers/ui-parity-app.mjs';

test('integrated block keyboard movement preserves schema, annotations and saved state', async t => {
  const app=await openTestApp(),{editor,$,first,second}=app;
  const key=direction=>{const event=new window.KeyboardEvent('keydown',{key:direction==='up'?'ArrowUp':'ArrowDown',altKey:true,shiftKey:true,bubbles:true,cancelable:true});editor.view.dom.dispatchEvent(event);return event;};
  const focus=pos=>{editor.commands.setTextSelection(pos);editor.view.focus();};
  const positions=type=>{const found=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name===type)found.push(pos)});return found};
  try {
    await t.test('root reorder through installed keyboard handler retains anchored comments and undo',()=>{
      app.setContent(doc(p('首段文字'),{type:'callout',attrs:{icon:'📌'},content:[p('提示块')]},p('最后一段')));
      editor.commands.setTextSelection({from:1,to:3});editor.commands.addLocalComment('跟随块移动');editor.view.focus();
      const before=editor.getJSON(),quote=listLocalComments(editor)[0].quote;
      assert.equal(key('down').defaultPrevented,true);
      assert.equal(editor.getJSON().content[0].type,'callout');assert.equal(editor.getJSON().content[1].content[0].text,'首段');
      assert.equal(listLocalComments(editor)[0].quote,quote);assert.equal(listLocalComments(editor)[0].orphaned,false);
      const moved=editor.getJSON();assert.equal(editor.commands.undo(),true);assert.deepEqual(editor.getJSON(),before);assert.equal(editor.commands.redo(),true);assert.deepEqual(editor.getJSON(),moved);
      assert.doesNotThrow(()=>editor.state.doc.check());
    });
    await t.test('nested list keyboard reorder moves the entire item and its children',()=>{
      const item=(text,children=[])=>({type:'listItem',content:[p(text),...children]});
      app.setContent(doc({type:'bulletList',content:[item('第一项'),item('第二项',[{type:'bulletList',content:[item('随行子项')]}]),item('第三项')]},p('列表之后')));
      focus(positions('listItem')[1]+2);assert.equal(key('up').defaultPrevented,true);
      const list=editor.getJSON().content[0];assert.equal(list.content[0].content[0].content[0].text,'第二项');assert.equal(list.content[0].content[1].content[0].content[0].content[0].text,'随行子项');assert.equal(list.content[1].content[0].content[0].text,'第一项');assert.doesNotThrow(()=>editor.state.doc.check());
    });
    await t.test('cursor inside table moves the whole table without reordering cells',()=>{
      app.setContent(doc(p('之前'),{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[p('A1')]},{type:'tableCell',content:[p('B1')]}]}]},p('之后')));
      const before=editor.getJSON().content[1];focus(positions('tableCell')[0]+2);assert.equal(key('down').defaultPrevented,true);
      assert.deepEqual(editor.getJSON().content[2],before);assert.equal(editor.getJSON().content[1].content[0].text,'之后');assert.doesNotThrow(()=>editor.state.doc.check());
    });
    await t.test('final structure survives API save/reopen',async()=>{
      await app.saved();const expected=JSON.parse(JSON.stringify(editor.getJSON()));await app.choose(second.title);await app.choose(first.title);assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON())),expected);assert.equal(editor.can().undo(),false);
    });
  } finally {await app.close()}
});
