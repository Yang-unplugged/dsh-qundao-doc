import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { annotationExtensions, listLocalComments, listTextSuggestions, LOCAL_AUTHOR, validateAnnotationsJSON } from '../src/annotations.js';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const name of ['window','document','navigator','HTMLElement','Node','Element','MutationObserver','DOMParser']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0); globalThis.cancelAnimationFrame = clearTimeout;
const editors = [];
const make = (content = '<p>alpha bravo charlie</p>') => { const e = new Editor({ element: document.createElement('div'), extensions: [StarterKit, ...annotationExtensions], content }); editors.push(e); return e; };
test.after(() => { editors.forEach(e => e.destroy()); dom.window.close(); });

test('anchored comment, overlap, replies, resolve, JSON roundtrip, orphan retention and undo', () => {
  const e = make(); e.commands.setTextSelection({ from: 7, to: 12 });
  assert.equal(e.commands.addLocalComment('<img src=x onerror=alert(1)> javascript:alert(1)'), true);
  let [a] = listLocalComments(e); assert.equal(a.quote, 'bravo'); assert.equal(a.entries[0].author, LOCAL_AUTHOR);
  e.commands.setTextSelection({ from: 10, to: 15 }); assert.equal(e.commands.addLocalComment('overlap'), true);
  const b = listLocalComments(e)[1];
  assert.equal(e.commands.replyLocalComment(a.id, 'reply'), true);
  assert.equal(e.commands.resolveLocalComment(a.id), true);
  assert.equal(e.commands.replyLocalComment(a.id, 'blocked'), false);
  assert.equal(e.commands.resolveLocalComment(a.id, false), true);
  e.commands.insertContentAt(1, 'new ');
  a = listLocalComments(e)[0]; assert.equal(a.quote, 'bravo'); assert.equal(a.ranges[0].from, 11); assert.equal(a.entries.length, 2);
  const copy = make(JSON.parse(JSON.stringify(e.getJSON()))); assert.deepEqual(copy.getJSON(), e.getJSON());
  assert.equal(listLocalComments(copy)[0].entries[0].body, '<img src=x onerror=alert(1)> javascript:alert(1)');
  assert.equal(copy.view.dom.querySelector('img'), null);
  assert.equal(e.commands.deleteLocalComment(a.id), true); assert.equal(listLocalComments(e)[0].id, b.id); assert.equal(listLocalComments(e)[0].quote, 'vo ch');
  e.commands.undo(); assert.equal(listLocalComments(e).length, 2);
  e.commands.deleteRange({ from: 1, to: e.state.doc.content.size - 1 });
  assert.equal(listLocalComments(e)[0].orphaned, true); assert.equal(listLocalComments(e)[0].entries.length, 2);
});

test('comment validation, can dry-run and readonly guards', () => {
  const e = make(); assert.equal(e.commands.addLocalComment('empty selection'), false);
  e.commands.setTextSelection({ from: 1, to: 6 }); assert.equal(e.commands.addLocalComment('  '), false);
  const before = e.getJSON(); assert.equal(e.can().addLocalComment('okay'), true); assert.deepEqual(e.getJSON(), before);
  e.commands.addLocalComment('okay'); const id = listLocalComments(e)[0].id; e.setEditable(false);
  for (const result of [e.commands.addLocalComment('no'),e.commands.replyLocalComment(id,'no'),e.commands.resolveLocalComment(id),e.commands.deleteLocalComment(id),e.commands.proposeTextChange('no')]) assert.equal(result, false);
});

test('explicit insertion/replacement/deletion suggestions persist, accept/reject, undo and safe text rendering', () => {
  const e = make(); e.commands.setTextSelection({ from: 7, to: 12 });
  assert.equal(e.commands.proposeTextChange('<img src=x onerror=alert(1)>'), true);
  let [s] = listTextSuggestions(e); assert.equal(s.before, 'bravo'); assert.equal(e.view.dom.querySelector('img'), null);
  assert.equal(e.view.dom.querySelector('ins').textContent, '<img src=x onerror=alert(1)>');
  const copy = make(JSON.parse(JSON.stringify(e.getJSON()))); assert.deepEqual(listTextSuggestions(copy), listTextSuggestions(e));
  assert.equal(e.commands.rejectTextSuggestion(s.id,s.pos), true); assert.equal(e.getText(), 'alpha bravo charlie');
  assert.equal(e.commands.undo(), true); assert.equal(listTextSuggestions(e).length, 1);
  s = listTextSuggestions(e)[0]; assert.equal(e.commands.acceptTextSuggestion(s.id,s.pos), true); assert.equal(e.getText(), 'alpha <img src=x onerror=alert(1)> charlie');
  const i = make('<p>one</p>'); i.commands.setTextSelection(4); assert.equal(i.commands.proposeTextChange(' two'), true); s = listTextSuggestions(i)[0]; i.commands.acceptTextSuggestion(s.id,s.pos); assert.equal(i.getText(), 'one two');
  i.commands.setTextSelection({from:1,to:4}); assert.equal(i.commands.proposeTextChange(''), true); s=listTextSuggestions(i)[0]; i.commands.acceptTextSuggestion(s.id,s.pos); assert.equal(i.getText(), ' two');
});

test('suggestions reject unsupported formatting, multiline, blocks, code and ambiguous copies', () => {
  const e = make('<p><strong>bold</strong> plain</p><p>next</p>');
  e.commands.setTextSelection({from:1,to:5}); assert.equal(e.commands.proposeTextChange('new'), false);
  e.commands.setTextSelection({from:6,to:11}); assert.equal(e.commands.proposeTextChange('new\nline'), false);
  e.commands.setTextSelection({from:6,to:14}); assert.equal(e.commands.proposeTextChange('new'), false);
  const c=make('<pre><code>code</code></pre>'); c.commands.setTextSelection({from:1,to:5}); assert.equal(c.commands.proposeTextChange('new'), false);
  const d=make(); d.commands.setTextSelection({from:1,to:6}); d.commands.proposeTextChange('new'); const s=listTextSuggestions(d)[0];
  d.commands.insertContentAt(d.state.doc.content.size-1,{type:'textSuggestion',attrs:{...s}}); assert.equal(listTextSuggestions(d).length,2);
  assert.equal(d.commands.acceptTextSuggestion(s.id),false); assert.equal(d.commands.acceptTextSuggestion(s.id,s.pos),true); assert.equal(listTextSuggestions(d).length,1);
});

test('anchor boundaries, editing inside quote, copied ranges share thread and document isolation', () => {
  const e=make(); e.commands.setTextSelection({from:7,to:12}); e.commands.addLocalComment('thread');
  const id=listLocalComments(e)[0].id;
  e.commands.insertContentAt(7,'X'); assert.equal(listLocalComments(e)[0].quote,'bravo');
  e.commands.insertContentAt(10,'Z'); assert.equal(listLocalComments(e)[0].quote,'brZavo');
  e.commands.insertContentAt(e.state.doc.content.size-1,{type:'text',text:'copy',marks:[{type:'commentAnchor',attrs:{ids:[id]}}]});
  e.commands.replyLocalComment(id,'shared reply'); assert.equal(listLocalComments(e).length,1); assert.ok(listLocalComments(e)[0].quote.endsWith('copy'));
  const other=make(); assert.equal(listLocalComments(other).length,0);
  e.commands.loadAnnotatedContent({type:'doc',content:[{type:'paragraph'}]}); assert.equal(listLocalComments(e).length,0);
});

test('import validation rejects malformed metadata, foreign identities, dangling anchors and oversized input', () => {
  const e=make(); e.commands.setTextSelection({from:1,to:6}); e.commands.addLocalComment('valid');
  const good=e.getJSON(); assert.equal(validateAnnotationsJSON(good),true);
  for (const comments of [42,[null],[{id:'x',resolved:false,entries:null}],Array(1001).fill(good.attrs.localComments[0])]) {
    const bad=structuredClone(good); bad.attrs.localComments=comments; assert.throws(()=>validateAnnotationsJSON(bad)); assert.equal(e.commands.loadAnnotatedContent(bad),false);
  }
  const fake=structuredClone(good); fake.attrs.localComments[0].entries[0].author='Another person'; assert.throws(()=>validateAnnotationsJSON(fake));
  const dangling=structuredClone(good); dangling.attrs.localComments=[]; assert.throws(()=>validateAnnotationsJSON(dangling));
  const badBody=structuredClone(good); badBody.attrs.localComments[0].entries[0].body='x'.repeat(10001); assert.throws(()=>validateAnnotationsJSON(badBody));
  const badSuggestion={type:'doc',content:[{type:'paragraph',content:[{type:'textSuggestion',attrs:{id:'x',before:[],after:'x'}}]}]}; assert.throws(()=>validateAnnotationsJSON(badSuggestion));
  // Even consumers bypassing validation cannot crash the comment panel helpers.
  const broken=make({type:'doc',attrs:{localComments:[null,{id:'x',entries:[]} ]},content:[{type:'paragraph'}]}); assert.deepEqual(listLocalComments(broken),[]);
  assert.deepEqual(e.getJSON(),good);
});


test('cross-document pasted anchors strip unknown thread IDs instead of producing phantom comments', () => {
  const source=make(); source.commands.setTextSelection({from:1,to:6}); source.commands.addLocalComment('source');
  const slice=source.state.doc.slice(1,6); const target=make(); let cleaned;
  target.view.someProp('transformPasted',fn=> { cleaned=fn(slice,target.view); return true; });
  assert.equal(cleaned.content.firstChild.text,'alpha'); assert.equal(cleaned.content.firstChild.marks.length,0);
  source.view.someProp('transformPasted',fn=> { cleaned=fn(slice,source.view); return true; });
  assert.equal(cleaned.content.firstChild.marks[0].type.name,'commentAnchor');
});
