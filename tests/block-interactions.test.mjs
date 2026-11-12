import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Columns, Column, StructuredControls } from '../src/advanced.js';
import { annotationExtensions, listLocalComments, listTextSuggestions } from '../src/annotations.js';
import { getBlockAtPosition, createBlockMoveTransaction, moveBlock, moveBlockBy, resolveBlockDrop, integrateBlockInteractions } from '../src/block-interactions.js';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'MutationObserver', 'DOMParser']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0); globalThis.cancelAnimationFrame = clearTimeout;
const rect = (top, bottom, left = 300, right = 800) => ({ top, bottom, left, right, width: right - left, height: bottom - top });
dom.window.Range.prototype.getClientRects = () => [rect(100, 125)];
dom.window.Range.prototype.getBoundingClientRect = () => rect(100, 125);
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.scrollBy = () => {};
const editors = [], modules = [];
function make(content = '<p>one</p><p>two longer</p><p>three</p>') {
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader, Columns, Column, StructuredControls, ...annotationExtensions], content });
  // Match an initialized editor after StarterKit's trailing-paragraph normalization.
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  editors.push(editor); return editor;
}
const p = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const listItem = (text, children = []) => ({ type: 'listItem', content: [p(text), ...children] });
const positions = (editor, type) => { const result = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === type) result.push(pos); }); return result; };
const texts = editor => { const result = []; editor.state.doc.forEach(node => result.push(node.textContent)); return result; };
function mount(editor, options = {}) {
  editor.view.dom.getBoundingClientRect = () => rect(95, 245);
  function layout() {
    editor.state.doc.forEach((node, pos, index) => { const element = editor.view.nodeDOM(pos); element.getBoundingClientRect = () => rect(100 + index * 50, 130 + index * 50); });
  }
  layout(); editor.on('transaction', layout);
  const ui = integrateBlockInteractions({ editor, ...options }); modules.push(ui);
  editor.view.focus(); editor.commands.setTextSelection(1); ui.refresh();
  const controls = document.querySelectorAll('.dsh-block-controls');
  return { ui, controls: controls[controls.length - 1], grip: controls[controls.length - 1].querySelector('.dsh-block-drag') };
}
function pointer(target, name, x, y, pointerId = 1) {
  const event = new window.MouseEvent(name, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId }); target.dispatchEvent(event); return event;
}
function begin(grip) { pointer(grip, 'pointerdown', 280, 110); pointer(document, 'pointermove', 350, 233); }
test.after(() => { modules.forEach(module => module.destroy()); editors.forEach(editor => editor.destroy()); dom.window.close(); });

test('atomic root reorder preserves node identity, inline marks, selection and single undo/redo', () => {
  const e = make('<p><strong>one</strong></p><h2>two longer</h2><p>three</p>');
  e.commands.setTextSelection({ from: 2, to: 4 }); const original = e.getJSON(), first = e.state.doc.firstChild;
  const transaction = createBlockMoveTransaction(e.state, 0, 2);
  assert.equal(transaction.steps.length, 1); assert.equal(transaction.getMeta('dshBlockMove').to, 19);
  assert.equal(moveBlock(e, { from: 0, toIndex: 2 }), true);
  assert.deepEqual(texts(e), ['two longer', 'three', 'one']); assert.equal(e.state.doc.lastChild, first);
  assert.equal(e.state.selection.from, 21); assert.equal(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to), 'ne');
  e.state.doc.check(); assert.equal(e.commands.undo(), true); assert.deepEqual(e.getJSON(), original);
  assert.equal(e.commands.redo(), true); assert.deepEqual(texts(e), ['two longer', 'three', 'one']);
});

test('move is separated from both earlier and later typing in undo history', () => {
  const e = make(); const original = e.getJSON();
  e.commands.insertContentAt(2, 'X'); const typed = e.getJSON();
  moveBlock(e, { from: 0, toIndex: 1 }); const moved = e.getJSON();
  e.commands.insertContentAt(2, 'Y'); assert.notDeepEqual(e.getJSON(), moved);
  e.commands.undo(); assert.deepEqual(e.getJSON(), moved);
  e.commands.undo(); assert.deepEqual(e.getJSON(), typed);
  e.commands.undo(); assert.deepEqual(e.getJSON(), original);
});

test('boundary, stale-document, readonly and invalid calls cannot mutate content', () => {
  const e = make(), before = e.getJSON(), stale = e.state.doc;
  for (const options of [{ from: 0, toIndex: 0 }, { from: 0, toIndex: -1 }, { from: 0, toIndex: 3 }, { from: 1, toIndex: 1 }, { from: 0, toIndex: 1.5 }]) assert.equal(moveBlock(e, options), false);
  assert.equal(moveBlock(e, { from: 0, toIndex: 1, canEdit: () => false }), false);
  assert.equal(moveBlockBy(e, 2), false); assert.deepEqual(e.getJSON(), before);
  e.commands.insertContentAt(2, 'X'); const changed = e.getJSON();
  assert.equal(moveBlock(e, { from: 0, toIndex: 1, expectedDoc: stale }), false); assert.deepEqual(e.getJSON(), changed);
  e.setEditable(false); assert.equal(moveBlock(e, { from: 0, toIndex: 1 }), false); assert.equal(moveBlockBy(e, 1), false);
  const singleton = make('<p>only</p>'); assert.equal(moveBlock(singleton, { from: 0, toIndex: 1 }), false);
});

test('list text selects an entire item and nested items only reorder inside their exact parent', () => {
  const e = make({ type: 'doc', content: [p('before'), { type: 'bulletList', content: [listItem('A', [{ type: 'bulletList', content: [listItem('nested 1'), listItem('nested 2')] }]), listItem('B')] }, p('after')] });
  const listPositions = positions(e, 'listItem'), nested = listPositions[1];
  const source = getBlockAtPosition(e.state.doc, nested + 2);
  assert.equal(source.pos, nested); assert.equal(source.parent.type.name, 'bulletList'); assert.equal(source.parent.childCount, 2);
  const before = e.getJSON(); e.commands.setTextSelection(nested + 2);
  assert.equal(moveBlockBy(e, 1), true);
  assert.equal(e.getJSON().content[1].content[0].content[1].content[0].content[0].content[0].text, 'nested 2');
  assert.equal(e.getJSON().content[1].content[1].content[0].content[0].text, 'B');
  e.state.doc.check(); e.commands.undo(); assert.deepEqual(e.getJSON(), before);
  const paragraph = nested + 1;
  assert.equal(createBlockMoveTransaction(e.state, paragraph, 1), null, 'required paragraphs are not independently moved');
});

test('task items retain checked/folded attributes and children after reorder', () => {
  const e = make({ type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true, collapsed: true }, content: [p('done'), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('child')] }] }] },
    { type: 'taskItem', attrs: { checked: false }, content: [p('open')] },
  ] }] });
  const first = e.state.doc.firstChild.firstChild, before = e.getJSON();
  assert.equal(moveBlock(e, { from: 1, toIndex: 1 }), true);
  assert.equal(e.state.doc.firstChild.lastChild, first); assert.equal(e.state.doc.firstChild.lastChild.attrs.checked, true);
  assert.equal(e.state.doc.firstChild.lastChild.attrs.collapsed, true); e.state.doc.check();
  e.commands.undo(); assert.deepEqual(e.getJSON(), before);
});

test('table selections target whole tables; rows, cells and their paragraphs cannot be moved separately', () => {
  const e = make('<p>before</p><table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>after</p>');
  const table = positions(e, 'table')[0], paragraph = positions(e, 'paragraph')[1], before = e.getJSON();
  assert.equal(getBlockAtPosition(e.state.doc, paragraph + 1).pos, table);
  for (const type of ['tableRow', 'tableHeader', 'tableCell']) assert.equal(createBlockMoveTransaction(e.state, positions(e, type)[0], 1), null);
  assert.equal(createBlockMoveTransaction(e.state, paragraph, 1), null);
  e.commands.setTextSelection(paragraph + 1); assert.equal(moveBlockBy(e, 1), true);
  assert.equal(e.state.doc.child(2).type.name, 'table'); e.state.doc.check(); e.commands.undo(); assert.deepEqual(e.getJSON(), before);
});

test('columns allow only same-column sibling moves and retain required structural nodes', () => {
  const e = make({ type: 'doc', content: [{ type: 'columns', attrs: { leftWidth: 30 }, content: [
    { type: 'column', content: [p('left A'), p('left B')] }, { type: 'column', content: [p('right')] },
  ] }] });
  const before = e.getJSON(); e.commands.setTextSelection(3);
  assert.equal(moveBlockBy(e, 1), true); assert.equal(e.state.doc.firstChild.firstChild.firstChild.textContent, 'left B');
  assert.equal(e.state.doc.firstChild.lastChild.textContent, 'right'); assert.equal(e.state.doc.firstChild.attrs.leftWidth, 30);
  assert.equal(createBlockMoveTransaction(e.state, 1, 1), null); e.state.doc.check(); e.commands.undo(); assert.deepEqual(e.getJSON(), before);
});

test('existing comment metadata, anchors and text suggestions survive reorder and undo', () => {
  const e = make('<p>one bravo</p><p>second plain</p><p>third</p>');
  e.commands.setTextSelection({ from: 5, to: 10 }); e.commands.addLocalComment('keep this comment');
  const comment = listLocalComments(e)[0]; e.commands.setTextSelection({ from: 12, to: 18 }); e.commands.proposeTextChange('replacement');
  const suggestions = listTextSuggestions(e), before = e.getJSON();
  assert.equal(suggestions.length, 1); assert.equal(moveBlock(e, { from: 0, toIndex: 2 }), true);
  assert.deepEqual(e.getJSON().attrs, before.attrs); assert.equal(listLocalComments(e)[0].quote, comment.quote);
  assert.equal(listLocalComments(e)[0].orphaned, false); assert.equal(listTextSuggestions(e)[0].id, suggestions[0].id);
  assert.equal(listTextSuggestions(e)[0].after, 'replacement'); e.commands.undo(); assert.deepEqual(e.getJSON(), before);
});

test('drop geometry excludes no-ops, outside-container positions and produces sibling insertion line', () => {
  const source = { index: 0 }, containerRect = rect(95, 245), rows = [0, 1, 2].map(index => ({ index, rect: rect(100 + 50 * index, 130 + 50 * index) }));
  assert.equal(resolveBlockDrop(source, rows, { x: 350, y: 105, containerRect }), null);
  assert.equal(resolveBlockDrop(source, rows, { x: 850, y: 233, containerRect }), null);
  assert.equal(resolveBlockDrop(source, rows, { x: 350, y: 300, containerRect }), null);
  assert.deepEqual(resolveBlockDrop(source, rows, { x: 350, y: 233, containerRect }), { toIndex: 2, top: 230, left: 300, width: 500 });
});

test('hover controls expose exact callbacks without mutating selection or content', () => {
  const e = make(), calls = [], { ui, controls, grip } = mount(e, { onInsert: block => calls.push(['insert', block]), onMenu: block => calls.push(['menu', block]) });
  const before = e.getJSON(), selection = e.state.selection.toJSON();
  assert.equal(controls.hidden, false); assert.equal(controls.dataset.blockType, 'paragraph');
  controls.querySelector('.dsh-block-insert').click(); grip.click();
  assert.deepEqual(calls.map(call => call[0]), ['insert', 'menu']); assert.equal(calls[0][1].pos, 0); assert.equal(calls[0][1].to, 5);
  assert.deepEqual(e.getJSON(), before); assert.deepEqual(e.state.selection.toJSON(), selection);
  ui.destroy(); assert.equal(controls.isConnected, false);
});

test('pointer drag shows insertion line, commits one move and supports undo', () => {
  const e = make(), before = e.getJSON(), { ui, grip, controls } = mount(e);
  begin(grip); assert.equal(controls.dataset.dragging, 'true'); assert.equal(document.querySelectorAll('.dsh-block-drop-indicator')[document.querySelectorAll('.dsh-block-drop-indicator').length - 1].hidden, false);
  assert.deepEqual(e.getJSON(), before, 'preview must not mutate document');
  pointer(document, 'pointerup', 350, 233); assert.deepEqual(texts(e), ['two longer', 'three', 'one']);
  assert.equal(controls.dataset.dragging, undefined); e.commands.undo(); assert.deepEqual(e.getJSON(), before); ui.destroy();
});

test('Escape, pointer cancellation and dropping outside leave document and history unchanged', () => {
  for (const reason of ['escape', 'pointercancel', 'outside']) {
    const e = make(), before = e.getJSON(), { ui, grip } = mount(e); begin(grip);
    if (reason === 'escape') document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (reason === 'pointercancel') pointer(document, 'pointercancel', 350, 233);
    pointer(document, 'pointerup', reason === 'outside' ? 50 : 350, 233);
    assert.deepEqual(e.getJSON(), before, reason); assert.equal(e.commands.undo(), false, reason); ui.destroy();
  }
});

test('document edits and read-mode transitions invalidate in-flight drags', () => {
  for (const reason of ['edit', 'mode', 'canEdit']) {
    const e = make(); let allowed = true; const { ui, grip, controls } = mount(e, { canEdit: () => allowed }); begin(grip);
    if (reason === 'edit') e.commands.insertContentAt(2, 'new');
    if (reason === 'mode') e.setEditable(false);
    if (reason === 'canEdit') { allowed = false; ui.refresh(); }
    const current = e.getJSON(); pointer(document, 'pointerup', 350, 233);
    assert.deepEqual(e.getJSON(), current, reason); assert.equal(controls.dataset.dragging, undefined, reason); ui.destroy();
  }
});

test('keyboard handle and Alt+Shift editor shortcuts move blocks and honor boundaries/read mode', () => {
  const e = make(), { ui, grip } = mount(e);
  grip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.deepEqual(texts(e), ['two longer', 'one', 'three']);
  e.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  assert.deepEqual(texts(e), ['one', 'two longer', 'three']);
  const before = e.getJSON(); assert.equal(ui.move(-1), false); e.setEditable(false);
  grip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.deepEqual(e.getJSON(), before); ui.destroy();
});

test('native drag fallback is internal-only, avoids copying data, and teardown cancels pending drag', () => {
  const e = make(), before = e.getJSON(), { ui, grip } = mount(e); const transferred = [];
  const transfer = { setData: (...args) => transferred.push(args), effectAllowed: '', dropEffect: '' };
  const event = name => { const value = new window.MouseEvent(name, { bubbles: true, cancelable: true, clientX: 350, clientY: 233 }); Object.defineProperty(value, 'dataTransfer', { value: transfer }); return value; };
  grip.dispatchEvent(event('dragstart')); document.dispatchEvent(event('dragover')); document.dispatchEvent(event('drop'));
  assert.deepEqual(texts(e), ['two longer', 'three', 'one']);
  assert.deepEqual(transferred, [['application/x-dsh-local-block', 'same-editor-only']]);
  e.commands.undo(); assert.deepEqual(e.getJSON(), before); begin(grip); ui.destroy(); pointer(document, 'pointerup', 350, 233);
  assert.deepEqual(e.getJSON(), before); assert.equal(grip.isConnected, false);
});
