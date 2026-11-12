import test from 'node:test';
import assert from 'node:assert/strict';
import {floatingPosition,validEditorLink,tableDimensions} from '../src/editor-ui.js';
import {openTestApp,doc,paragraph as p,wait} from './helpers/ui-parity-app.mjs';

test('floating panels flip and stay within a narrow viewport',()=>{
  const size={width:280,height:170},viewport={width:320,height:640};
  let position=floatingPosition({left:290,top:600,bottom:620},size,viewport);
  assert.deepEqual(position,{left:32,top:422});
  position=floatingPosition({left:-20,top:75,bottom:95},size,viewport,{preferAbove:true});
  assert.deepEqual(position,{left:8,top:103});
  position=floatingPosition({left:12,top:190,bottom:210},{width:300,height:800},viewport);
  assert.equal(position.top,70);
});
test('link and table validation reject executable or invalid input',()=>{
  for(const value of ['https://example.com/path','http://localhost:3000','mailto:hello@example.com'])assert.equal(validEditorLink(value),true);
  for(const value of ['javascript:alert(1)','data:text/html,hello','file:///tmp/test','https://','https://bad host','https://example.com\nfoo'])assert.equal(validEditorLink(value),false);
  assert.equal(tableDimensions(20,10),true);for(const values of [[0,1],[1,11],[21,1],[2.5,2],[NaN,2]])assert.equal(tableDimensions(...values),false);
});
test('local panels preserve selections and reject stale and read-only operations',async t=>{
 const app=await openTestApp();const {editor,$}=app;
 const button=(scope,label)=>[...document.querySelectorAll(scope+' button')].find(b=>b.getAttribute('aria-label')===label);
 const select=(from,to)=>{editor.commands.setTextSelection({from,to});editor.view.focus();};
 try{
  await t.test('link form validates and applies to original selection without native dialogs',()=>{
    app.setContent(doc(p('alpha bravo')));select(1,6);
    button('#bubble','超链接').click();$('#link-url').value='javascript:alert(1)';$('#save-link').click();
    assert.match($('.field-error').textContent,/有效/);assert.equal(editor.isActive('link'),false);
    $('#link-url').value='https://example.com';$('#save-link').click();
    assert.equal(editor.getJSON().content[0].content[0].marks.find(m=>m.type==='link').attrs.href,'https://example.com');
    assert.equal(editor.getText(),'alpha bravo');assert.equal(app.dialogs.length,0);
  });
  await t.test('color picker preserves selected text and cancels after document edits',()=>{
    app.setContent(doc(p('alpha bravo')));select(1,6);
    button('#bubble','文字颜色与背景').click();button('#editor-popover','字体颜色 #3370ff').click();
    assert.equal(editor.getJSON().content[0].content[0].marks.find(m=>m.type==='textStyle').attrs.color,'#3370ff');
    button('#bubble','文字颜色与背景').click();const stale=button('#editor-popover','字体颜色 #d83931');editor.commands.insertContent('X');const before=editor.getJSON();stale.click();assert.deepEqual(editor.getJSON(),before);assert.equal($('#editor-popover').hidden,true);
  });
  await app.saved();
 }finally{await app.close()}
});
