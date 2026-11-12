import test from 'node:test';
import assert from 'node:assert/strict';
import { floatingPosition, validEditorLink, tableDimensions } from '../src/editor-ui.js';
import { listLocalComments } from '../src/annotations.js';
import { openTestApp, paragraph as p, doc, wait } from './helpers/ui-parity-app.mjs';

test('floating toolbar positioning stays inside desktop viewport edges', () => {
  for (const anchor of [{left:-50,top:10,bottom:30},{left:1400,top:940,bottom:980},{left:400,top:400,bottom:430}]) {
    for (const preferAbove of [false,true]) {
      const point=floatingPosition(anchor,{width:360,height:220},{width:1440,height:1000},{preferAbove});
      assert.ok(point.left>=8&&point.left+360<=1432); assert.ok(point.top>=70&&point.top+220<=964);
    }
  }
});

test('link and table helpers reject unsafe values and boundary violations', () => {
  for (const link of ['https://example.test/path?q=中文','http://localhost/a','mailto:qa@example.test']) assert.equal(validEditorLink(link),true,link);
  for (const link of ['javascript:alert(1)','data:text/html,x','file:///tmp/data','//example.test','https://','mailto:','https://example.test/ bad','https://example.test/\n']) assert.equal(validEditorLink(link),false,link);
  for (const dimensions of [[1,1],[20,10],[9,9]]) assert.equal(tableDimensions(...dimensions),true);
  for (const dimensions of [[0,1],[1,0],[21,1],[1,11],[1.2,2],[NaN,1],['2',2]]) assert.equal(tableDimensions(...dimensions),false);
});

test('current floating editor controls and comment panels preserve intended state', async t => {
  const app=await openTestApp(); const {editor,$,first,second}=app;
  const button=(scope,label)=>{const found=[...document.querySelectorAll(`${scope} button`)].find(item=>item.getAttribute('aria-label')===label);assert.ok(found,`missing ${scope} button ${label}`);return found;};
  const focusRange=(from,to=from)=>{editor.commands.setTextSelection({from,to});editor.view.focus();};
  const input=(selector,value)=>{const node=$(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));return node;};
  const reset=async content=>{if(!$('#drawer').hidden)$('#drawer .close').click();app.setContent(content);editor.view.focus();await wait(5);};
  const slashTable=async()=>{await reset(doc(p('/table')));focusRange(7);assert.equal($('#slash').hidden,false);const item=[...$('#slash').querySelectorAll('button')].find(item=>item.textContent.includes('表格'));assert.ok(item);item.dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true,cancelable:true}));assert.equal($('#editor-popover').hidden,false);};
  try {
    await t.test('selection toolbar applies marks to selected text without changing selection', async()=>{
      await reset(doc(p('alpha bravo')));focusRange(1,6);
      assert.equal($('#toolbar').hidden,true);assert.equal($('#bubble').hidden,false);
      const before=editor.state.selection.toJSON();button('#bubble','粗体').click();
      assert.deepEqual(editor.state.selection.toJSON(),before);assert.equal(editor.getText(),'alpha bravo');
      assert.ok(editor.getJSON().content[0].content[0].marks.some(mark=>mark.type==='bold'));
      assert.equal(button('#bubble','粗体').getAttribute('aria-pressed'),'true');
      focusRange(3);assert.equal($('#bubble').hidden,true);
    });
    await t.test('link panel validates scheme, keeps selection and closes after safe application', async()=>{
      await reset(doc(p('链接文字 other')));focusRange(1,5);
      button('#bubble','超链接').click();input('#link-url','javascript:alert(1)');$('#save-link').click();
      assert.equal($('#editor-popover').hidden,false);assert.equal($('#link-url').getAttribute('aria-invalid'),'true');assert.equal(editor.isActive('link'),false);
      input('#link-url','https://example.test/docs');$('#save-link').click();
      assert.equal($('#editor-popover').hidden,true);assert.equal(editor.getAttributes('link').href,'https://example.test/docs');
      assert.equal(editor.state.selection.from,1);assert.equal(editor.state.selection.to,5);assert.equal(editor.getText(),'链接文字 other');
    });
    await t.test('palette edits selected marks and Escape cancels without content changes', async()=>{
      await reset(doc(p('颜色文字')));focusRange(1,3);button('#bubble','文字颜色与背景').click();
      button('#editor-popover','字体颜色 #3370ff').click();assert.equal(editor.getAttributes('textStyle').color,'#3370ff');
      button('#bubble','文字颜色与背景').click();const before=editor.getJSON();document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      assert.equal($('#editor-popover').hidden,true);assert.deepEqual(editor.getJSON(),before);
    });
    await t.test('9 by 9 table picker supports keyboard sizing and real table insertion', async()=>{
      await slashTable();assert.equal($('#table-picker').querySelectorAll('[role="gridcell"]').length,81);
      let cell=$('#table-picker [tabindex="0"]');assert.equal(cell.dataset.row,'3');assert.equal(cell.dataset.col,'3');
      cell.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
      cell=$('#table-picker [tabindex="0"]');assert.equal(cell.dataset.col,'4');assert.equal(document.activeElement,cell);
      cell.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      const table=editor.getJSON().content.find(node=>node.type==='table');assert.ok(table);assert.equal(table.content.length,3);assert.equal(table.content[0].content.length,4);assert.equal($('#editor-popover').hidden,true);
    });
    await t.test('invalid custom table dimensions do not mutate content', async()=>{
      await slashTable();const before=editor.getJSON();input('#table-rows','21');input('#table-cols','2');$('#insert-table').click();
      assert.equal($('#editor-popover').hidden,false);assert.match($('#editor-popover .field-error').textContent,/1–20/);assert.deepEqual(editor.getJSON(),before);
      input('#table-rows','2');input('#table-cols','3');assert.equal($('#editor-popover .table-summary strong').textContent,'3 × 2');assert.equal($('#table-picker').querySelectorAll('[aria-selected="true"]').length,6);$('#insert-table').click();const table=editor.getJSON().content.find(node=>node.type==='table');assert.equal(table.content.length,2);assert.equal(table.content[0].content.length,3);
    });
    await t.test('stale link handler cannot apply after original content changes', async()=>{
      await reset(doc(p('original')));focusRange(1,5);button('#bubble','超链接').click();input('#link-url','https://example.test/stale');const stale=$('#save-link').onclick;
      editor.commands.insertContentAt(editor.state.doc.content.size-1,' changed');const changed=editor.getJSON();stale();
      assert.deepEqual(editor.getJSON(),changed);assert.equal($('#editor-popover').hidden,true);
    });
    await t.test('code language and wrap controls remain usable after code text changes', async()=>{
      await reset(doc({type:'codeBlock',attrs:{language:'plaintext',wrap:false},content:[{type:'text',text:'const value = 1;'}]}));focusRange(1);editor.commands.insertContent('let x = 2; ');
      document.querySelector('.code-block-lang').click();assert.ok($('#language-search'),'language panel opens after editing code');input('#language-search','java');const matches=[...$('#language-results').querySelectorAll('button')];assert.ok(matches.length);assert.ok(matches.every(item=>item.textContent.includes('java')));matches.find(item=>item.textContent==='javascript').click();
      assert.equal(editor.getAttributes('codeBlock').language,'javascript');assert.equal(editor.isFocused,true,'language apply restores editor focus');document.querySelector('.code-block-tool[aria-label="自动换行"]').click();assert.equal(editor.getAttributes('codeBlock').wrap,true);
    });
    await t.test('callout icon and independent color palettes preserve existing content', async()=>{
      await reset(doc({type:'callout',attrs:{icon:'💡',color:'blue'},content:[p('提示文字')]}));focusRange(2);
      button('#contextual','高亮块图标').click();button('#editor-popover','使用图标 ✅').click();assert.equal(editor.getAttributes('callout').icon,'✅');
      button('#contextual','高亮块颜色').click();button('#editor-popover','边框颜色 #82a7fc').click();assert.equal(editor.getAttributes('callout').borderColor,'#82a7fc');assert.equal(editor.state.doc.content.firstChild.textContent,'提示文字');
    });
  } finally {await app.close();}
});
