import test from 'node:test';
import assert from 'node:assert/strict';
import { closeHistory } from '@tiptap/pm/history';
import { openTestApp, paragraph as p, doc } from './helpers/ui-parity-app.mjs';

// Model transactions are deliberate: this is not native typing/IME or pixel-layout evidence.
test('current editor structural parity through actual HTTP and disk persistence', async t => {
  const app = await openTestApp();
  const { editor, $, store, first, second } = app;
  const reset = content => { app.setContent(content); editor.view.dispatch(closeHistory(editor.state.tr)); };
  const positions = type => { const result=[]; editor.state.doc.descendants((node,pos)=>{if(node.type.name===type) result.push(pos);}); return result; };
  try {
    await t.test('Chinese, emoji and literal markup survive insertion, soft break, undo and redo', async () => {
      reset(doc(p('起点')));
      const before = editor.getJSON();
      editor.commands.setTextSelection(3);
      editor.view.dispatch(editor.state.tr.insertText('中文🧪 <script>不执行</script>'));
      const typed = editor.getJSON();
      assert.ok(editor.getText().includes('中文🧪 <script>不执行</script>'));
      assert.equal($('.tiptap script'), null);
      assert.equal(editor.commands.undo(), true); assert.deepEqual(editor.getJSON(), before);
      assert.equal(editor.commands.redo(), true); assert.deepEqual(editor.getJSON(), typed);
      editor.commands.setHardBreak(); editor.commands.insertContent('下一行');
      assert.ok(editor.getJSON().content[0].content.some(node=>node.type==='hardBreak'));
      await app.saved();
    });

    await t.test('nested list indent/outdent preserves all text and supports isolated undo', () => {
      reset(doc(p('第一项'),p('第二项'),p('第三项')));
      editor.commands.selectAll(); assert.equal(editor.commands.toggleBulletList(), true);
      editor.commands.setTextSelection(positions('paragraph')[1]+1);
      editor.view.dispatch(closeHistory(editor.state.tr));
      const before = editor.getJSON();
      assert.equal(editor.commands.sinkListItem('listItem'), true);
      const nested = editor.getJSON();
      assert.equal(positions('bulletList').length, 2);
      assert.ok(editor.getText().includes('第三项'));
      assert.equal(editor.commands.undo(), true); assert.deepEqual(editor.getJSON(), before);
      assert.equal(editor.commands.redo(), true); assert.deepEqual(editor.getJSON(), nested);
      assert.equal(editor.commands.liftListItem('listItem'), true);
      assert.equal(positions('bulletList').length, 1);
      assert.equal(editor.getJSON().content[0].content.length, 3);
    });

    await t.test('callout colors/icon and nested task content preserve adjacent blocks', () => {
      reset(doc(p('前文'), {type:'callout',attrs:{icon:'📌',color:'green',textColor:'#112233',borderColor:'#445566',backgroundColor:'#ddeeff'},content:[p('重点'),{type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[p('完成项')]}]}]}, p('后文')));
      const callout = positions('callout')[0];
      editor.commands.setTextSelection(callout+2);
      assert.equal(editor.commands.updateAttributes('callout',{icon:'✅',backgroundColor:'#ffeecc'}), true);
      const json = editor.getJSON();
      assert.equal(json.content[0].content[0].text, '前文');
      assert.equal(json.content.at(-1).content[0].text, '后文');
      assert.equal(json.content[1].attrs.icon, '✅');
      assert.equal(json.content[1].content[1].content[0].attrs.checked, true);
      assert.equal($('.tiptap aside').style.borderColor, 'rgb(68, 85, 102)');
    });

    await t.test('code conversion preserves literal text, language and wrap without HTML interpretation', () => {
      const literal='const value = "中文 🧪 <script>";\n  next(value);';
      reset(doc({type:'codeBlock',attrs:{language:'javascript',wrap:true},content:[{type:'text',text:literal}]},p('代码之后')));
      editor.commands.setTextSelection(1);
      assert.equal(editor.getAttributes('codeBlock').language, 'javascript');
      assert.equal($('.tiptap pre').dataset.wrap, 'true');
      assert.equal($('.tiptap pre code').textContent, literal);
      assert.equal($('.tiptap script'), null);
      assert.ok($('.tiptap pre .hljs-keyword'));
      editor.view.dispatch(closeHistory(editor.state.tr));
      const original = editor.getJSON();
      editor.commands.updateAttributes('codeBlock',{language:'plaintext',wrap:false});
      assert.equal(editor.commands.undo(), true); assert.deepEqual(editor.getJSON(), original);
    });

    await t.test('table cell selection, merge/split, dimensions and cell alignment remain valid', () => {
      reset(doc(p('')));
      assert.equal(editor.commands.insertTable({rows:2,cols:2,withHeaderRow:false}), true);
      let cells=positions('tableCell');
      editor.commands.setTextSelection(cells[0]+2); editor.commands.insertContent('左上');
      cells=positions('tableCell'); editor.commands.setTextSelection(cells[1]+2); editor.commands.insertContent('右上');
      cells=positions('tableCell'); editor.commands.setCellSelection({anchorCell:cells[0],headCell:cells[1]});
      assert.equal(editor.state.selection.toJSON().type, 'cell');
      assert.equal(editor.commands.mergeCells(), true);
      assert.equal(editor.commands.setCellAttribute('verticalAlign','middle'), true);
      assert.equal(editor.commands.splitCell(), true);
      assert.ok(editor.getText().includes('左上')); assert.ok(editor.getText().includes('右上'));
      assert.equal(editor.commands.addRowAfter(), true);
      assert.equal(editor.commands.addColumnAfter(), true);
      const table=editor.getJSON().content.find(node=>node.type==='table');
      assert.equal(table.content.length, 3); assert.equal(table.content[0].content.length, 3);
      assert.doesNotThrow(()=>editor.state.doc.check());
    });

    await t.test('cross-block selection applies format without deleting text and undo restores structure', () => {
      reset(doc(p('alpha'),p('bravo')));
      const before=editor.getJSON();
      editor.commands.setTextSelection({from:2,to:10});
      assert.equal(editor.state.selection.empty, false);
      assert.equal(editor.commands.toggleBold(), true);
      assert.equal(editor.getText(), 'alpha\n\nbravo');
      assert.equal(editor.getJSON().content.length, 2);
      assert.ok(editor.getJSON().content.every(node=>node.content.some(text=>text.marks?.some(mark=>mark.type==='bold'))));
      assert.equal(editor.commands.undo(), true); assert.deepEqual(editor.getJSON(), before);
      assert.ok(editor.state.selection.from>=1&&editor.state.selection.to<=editor.state.doc.content.size);
    });

    await t.test('mixed content saves over actual HTTP then survives document switch/reopen exactly', async () => {
      reset(doc(
        {type:'heading',attrs:{level:9},content:[{type:'text',text:'完整保存验收'}]},
        {type:'bulletList',content:[{type:'listItem',content:[p('父项'),{type:'bulletList',content:[{type:'listItem',content:[p('子项')]}]}]}]},
        {type:'callout',attrs:{icon:'📌',color:'blue',textColor:'#112233',borderColor:'#445566',backgroundColor:'#ddeeff'},content:[p('提示')]},
        {type:'codeBlock',attrs:{language:'javascript',wrap:true},content:[{type:'text',text:'const safe = "中文🧪";\n  keep();'}]},
        {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{verticalAlign:'middle'},content:[p('A1')]},{type:'tableCell',content:[p('B1')]}]}]},
        p('末尾')
      ));
      const expected=JSON.parse(JSON.stringify(editor.getJSON()));
      await app.saved(); assert.deepEqual(store.get(first.id).content, expected);
      await app.choose(second.title); assert.equal(editor.getText(), '第二份独立文档');
      await app.choose(first.title); assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON())), expected);
      assert.equal(editor.can().undo(), false, 'history from other documents must not leak');
      assert.ok(app.requests.some(request=>request.method==='PUT'&&request.url===`/api/documents/${first.id}`));
      assert.ok(app.requests.filter(request=>request.method==='PUT').every(request=>request.body.content.type==='doc'));
    });

  } finally { await app.close(); }
});
