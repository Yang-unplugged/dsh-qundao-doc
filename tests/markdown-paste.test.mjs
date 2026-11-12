import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {Table,TableRow,TableCell,TableHeader} from '@tiptap/extension-table';
import {looksLikeMarkdown,markdownToHTML,createMarkdownPasteHandler} from '../src/markdown-paste.js';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true});
for(const name of ['window','document','navigator','Element','Node','DOMParser','MutationObserver'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;

test('检测纯文本与 Markdown',()=>{
  assert.equal(looksLikeMarkdown('今天天气不错，我们出去走走吧。'),false);
  assert.equal(looksLikeMarkdown('- 只有一条列表'),false);
  assert.equal(looksLikeMarkdown('## 标题\n正文'),true);
  assert.equal(looksLikeMarkdown('- a\n- b'),true);
  assert.equal(looksLikeMarkdown('普通一句 **加粗** 的话'),true);
  assert.equal(looksLikeMarkdown('```js\nconst a=1\n```'),true);
});

test('Markdown 转 HTML：标题/列表/任务/代码/表格/引用',()=>{
  const html=markdownToHTML('## 标题\n\n- a\n- b\n\n1. x\n2. y\n\n- [ ] 待办\n- [x] 完成\n\n> 引用\n\n```js\nconst a=1\n```\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n\n---\n\n### 三');
  assert.match(html,/<h2>标题<\/h2>/);
  assert.match(html,/<ul>/);
  assert.match(html,/<ol>/);
  assert.match(html,/<ul data-type="taskList">/);
  assert.match(html,/<li data-type="taskItem"/);
  assert.match(html,/data-checked="true"/);
  assert.match(html,/<blockquote>/);
  assert.match(html,/<pre><code class="language-js">/);
  assert.match(html,/<table>/);
  assert.match(html,/<th>/);
  assert.match(html,/<hr>/);
  assert.match(html,/<h3>三<\/h3>/);
});

test('转换时清理脚本与不安全链接',()=>{
  const html=markdownToHTML('<script>alert(1)</script>\n\n[点我](javascript:alert(1))\n\n[正常](https://a.com)');
  assert.doesNotMatch(html,/<script/i);
  assert.match(html,/<a href="https:\/\/a.com">正常<\/a>/);
  assert.doesNotMatch(html,/href="javascript:/i);
});

test('粘贴事件把 Markdown 插入为富文本，纯文本保持原样',()=>{
  const element=document.createElement('div');document.body.append(element);
  const editor=new Editor({element,extensions:[StarterKit,TaskList,TaskItem,Table,TableRow,TableCell,TableHeader]});
  const handler=createMarkdownPasteHandler(editor);
  let prevented=false;
  const event={clipboardData:{getData:()=>'## 标题\n\n- a\n- b'},preventDefault(){prevented=true},stopPropagation(){}};
  handler(event);
  assert.equal(prevented,true);
  const json=JSON.stringify(editor.getJSON());
  assert.match(json,/"type":"heading","attrs":\{"level":2/);
  assert.match(json,/"type":"bulletList"/);
  prevented=false;
  handler({clipboardData:{getData:()=>'这是一段普通文字'},preventDefault(){prevented=true},stopPropagation(){}});
  assert.equal(prevented,false);
  editor.destroy();
});
