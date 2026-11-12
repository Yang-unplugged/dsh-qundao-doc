/* 粘贴 Markdown 自动转富文本（对齐飞书：直接粘贴 Markdown 源码会渲染成文档格式） */
import {marked} from 'marked';

const STRONG = [
  /^#{1,6}[ \t]+\S/m,
  /^```/m,
  /^\|.+\|[ \t]*$/m,
  /^\s*\|?[ \t]*:?-{3,}:?[ \t]*\|/m,
  /^\s*>\s+\S/m,
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /~~[^~\n]+~~/,
  /`[^`\n]+`/,
  /\[[^\]\n]+\]\([^)\n]+\)/,
];
const SIGNALS = [
  /^#{1,6}[ \t]+\S/m,
  /^```/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^\s*>\s+\S/m,
  /^\s*\|.*\|/m,
  /^\s*([-*_])(\s*\1){2,}\s*$/m,
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /~~[^~\n]+~~/,
  /`[^`\n]+`/,
  /\[[^\]\n]+\]\([^)\n]+\)/,
  /^\s*[-*+]\s+\[[ xX]\]/m,
];
export function looksLikeMarkdown(text){
  if(typeof text!=='string')return false;
  const value=text.replace(/\r\n?/g,'\n').trim();
  if(!value||value.length>200000)return false;
  if(value.split('\n').length<2&&!/[*_`#[\]()]/.test(value))return false;
  if(STRONG.some(re=>re.test(value)))return true;
  // 连续两行以上列表标记，按 Markdown 处理
  const listLines=value.split('\n').filter(line=>/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line));
  if(listLines.length>=2)return true;
  const signals=new Set(SIGNALS.map(re=>re.source).filter((source,i)=>new RegExp(source,'m').test(value)));
  return signals.size>=2;
}

const BLOCKED=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','FORM','INPUT','TEXTAREA','SELECT','BUTTON','AUDIO','VIDEO','SOURCE']);
const SAFE_URL=/^(https?:|mailto:|#|\/)/i;

function sanitize(root){
  for(const node of [...root.querySelectorAll('*')]){
    if(BLOCKED.has(node.tagName)){node.replaceWith(document.createTextNode(''));continue}
    for(const attr of [...node.attributes]){
      const name=attr.name.toLowerCase();
      if(name.startsWith('on')||name==='style'||name==='id'){node.removeAttribute(attr.name);continue}
      if((name==='href'||name==='src')&&!SAFE_URL.test(attr.value)){node.removeAttribute(attr.name)}
      if(name==='class'&&!['CODE','PRE'].includes(node.tagName))node.removeAttribute('class');
    }
  }
}

function normalize(root){
  // 任务列表：<li><input type=checkbox> → ul[data-type=taskList] li[data-type=taskItem][data-checked]
  for(const input of [...root.querySelectorAll('input[type="checkbox"]')]){
    const li=input.closest('li');if(!li){input.remove();continue}
    const checked=input.hasAttribute('checked')||input.checked===true;
    const ul=li.parentElement;
    if(ul&&ul.tagName==='UL')ul.setAttribute('data-type','taskList');
    li.setAttribute('data-type','taskItem');
    if(checked)li.setAttribute('data-checked','true');
    input.remove();
    if(li.firstChild&&li.firstChild.nodeType===3)li.firstChild.textContent=li.firstChild.textContent.replace(/^\s+/,'');
  }
  // 远程图片没法直接落地成本地资源，降级成文字链接，避免丢信息
  for(const img of [...root.querySelectorAll('img')]){
    const src=img.getAttribute('src')||'';
    const alt=img.getAttribute('alt')||'图片';
    const a=document.createElement('a');
    a.setAttribute('href',src);a.textContent=alt||src;
    if(!SAFE_URL.test(src)){img.replaceWith(document.createTextNode(alt));continue}
    img.replaceWith(a);
  }
  return root;
}

export function markdownToHTML(text){
  const raw=marked.parse(String(text||'').replace(/\r\n?/g,'\n'),{gfm:true,breaks:false,async:false});
  const doc=new DOMParser().parseFromString(`<div id="md-root">${raw}</div>`,'text/html');
  const root=doc.getElementById('md-root');
  normalize(root);sanitize(root);
  return root.innerHTML;
}

export function createMarkdownPasteHandler(editor){
  return function handlePaste(event){
    try{
      if(!editor||editor.isDestroyed)return;
      if(editor.isActive('codeBlock'))return;
      const data=event.clipboardData;
      const text=data?.getData?.('text/plain')||'';
      if(!looksLikeMarkdown(text))return;
      event.preventDefault();event.stopPropagation();
      const html=markdownToHTML(text);
      const inserted=editor.chain().focus().insertContent(html).run();
      if(!inserted)editor.commands.insertContent(text);
    }catch{ try{event.clipboardData?.getData?.('text/plain')&&editor.commands.insertContent(event.clipboardData.getData('text/plain'))}catch{} }
  };
}

export function installMarkdownPaste(editor){
  const handler=createMarkdownPasteHandler(editor);
  const dom=editor.view.dom;
  dom.addEventListener('paste',handler,true);
  return {destroy(){dom.removeEventListener('paste',handler,true)}};
}
