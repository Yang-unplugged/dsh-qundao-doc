import {createEditorUI, floatingPosition} from './editor-ui';
import {integrateBlockInteractions} from './block-interactions';
import {openFindReplace} from './find-replace';
import {openImageCrop} from './image-tools';
import {openLocalPresentation} from './presentation';
import {Editor} from '@tiptap/core';
import {annotationExtensions,validateAnnotationsJSON} from './annotations';
import {vendorIcon} from './icons-vendor.js';
import {installMarkdownPaste} from './markdown-paste.js';
import {Columns,Column,StructuredControls} from './advanced';
import {EditorState} from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import {TextStyle, Color} from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import {Table,TableRow,TableCell,TableHeader} from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {LocalImage,MediaAttachment,supportedUploadMimes,readFileBase64,isLocalAssetURL,resolveAssetURL,releaseAssetURL,validateMediaJSON} from './media';
import {LocalCanvas,isValidScene,refreshCanvasControls} from './canvas';
import {createLowlight,common} from 'lowlight';
import {HeadingNine,Callout,Formula,TrailingParagraphAfterAtom} from './extensions';
import 'katex/dist/katex.min.css';
import './style.css';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RASTER_DATA=/^data:image\/(?:png|jpeg|gif|webp);base64,/i;
function readAsDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('读取图片失败'));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file)})}
async function shrinkImage(dataUrl,maxSide=1600){
 if(!RASTER_DATA.test(dataUrl))return dataUrl;
 if(dataUrl.length<120000)return dataUrl;
 const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('图片解码失败'));el.src=dataUrl});
 const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
 return canvas.toDataURL('image/webp',0.9);
}
async function uploadPastedImage(dataUrl,name){
 try{
  const mime=/^data:(image\/[a-z0-9.+-]+);/i.exec(dataUrl)?.[1]||'image/png';
  const base64=dataUrl.slice(dataUrl.indexOf(',')+1);
  if(!base64)return null;
  const {asset}=await api('/assets','POST',{name:name||'粘贴的图片',mime,dataBase64:base64});
  return asset?.url&&/^\/api\/assets\/[0-9a-f]{64}$/.test(asset.url)?asset.url:null;
 }catch{return null}
}
/* 嵌入模式下粘贴图片：先落成资料库资源（body 里只留短 URL）；
   资源库不可用时退化成压缩后的小图内嵌，避免把整段 base64 塞进每次保存。 */
function hasClipboardImages(event){
 const data=event.clipboardData;
 if(!data)return false;
 if([...(data.files||[])].some(file=>/^image\/(png|jpeg|gif|webp)$/i.test(file.type)))return true;
 return /src="data:image\/(?:png|jpeg|gif|webp);base64,/i.test(data.getData('text/html')||'');
}
async function pasteEmbedImages(editor,event){
 const data=event.clipboardData;
 if(!data)return false;
 const files=[...(data.files||[])].filter(file=>/^image\/(png|jpeg|gif|webp)$/i.test(file.type));
 const html=data.getData('text/html')||'';
 const inline=[...html.matchAll(/src="(data:image\/(?:png|jpeg|gif|webp);base64,[^"]+)"/gi)].map(m=>m[1]);
 if(!files.length&&!inline.length)return false;
 event.preventDefault();
 const sources=[];
 for(const file of files)sources.push({dataUrl:await readAsDataURL(file),name:file.name||'粘贴的图片'});
 for(const url of inline)sources.push({dataUrl:url,name:'粘贴的图片'});
 const results=[];
 for(const source of sources){
  let dataUrl=source.dataUrl;
  try{dataUrl=await shrinkImage(dataUrl)}catch{}
  const url=await uploadPastedImage(dataUrl,source.name);
  results.push(url||dataUrl);
 }
 if(!results.length)return true;
 const nodes=[];
 for(const src of results){nodes.push({type:'image',attrs:{src,alt:''}});nodes.push({type:'paragraph'})}
 try{editor.chain().focus().insertContent(nodes).run()}catch{}
 return true;
}
let drawerEpoch=0;
let savePromise=null, navigating=false, active=null, docs=[], dirty=false, saving=false, timer, loading=false, readonly=false, slash=null, slashIndex=0;
const lowlight=createLowlight(common);
const empty={type:'doc',content:[{type:'paragraph'}]};
// 嵌入模式：宿主（想法成稿）把这段版面当纯编辑器用，内容只走 postMessage，不落文档库
const EMBED=Boolean(window.__DSH_EMBED__);
const WRAP_ICON=vendorIcon('wrapText',{size:14});
const SEARCH_ICON=vendorIcon('search',{size:13});
const TRASH_ICON=vendorIcon('trash',{size:14});
const PLUS_ICON=vendorIcon('plus',{size:12});
const OUTLINE_ICON=vendorIcon('outlineToggle',{size:16});
/* ---------- 窗口左上角安全区（macOS 红绿灯 / 宿主折叠按钮） ---------- */
(function setupWindowSafeTop(){
  const html=document.documentElement;
  const params=new URLSearchParams(location.search);
  const gutter=params.get('gutter');
  if(gutter)html.dataset.gutter=gutter;
  const detect=()=>{
    try{
      const frame=window.frameElement;
      if(!frame)return 0;
      const rect=frame.getBoundingClientRect();
      // 只有贴住窗口左上角、会被宿主窗口按钮盖住时才让位
      if(rect.left>96||rect.top>50)return 0;
      return Math.round(Math.min(56,Math.max(34,40-rect.top)));
    }catch{return 0}
  };
  const apply=offset=>{
    const value=Math.max(0,Math.min(96,Math.round(offset||0)));
    html.style.setProperty('--dsh-safe-top',value+'px');
    html.classList.toggle('has-safe-top',value>0);
  };
  if(params.has('safeTop'))apply(Number(params.get('safeTop'))||0);
  else{
    apply(detect());
    if(window.frameElement){
      try{window.parent.addEventListener('resize',()=>apply(detect()))}catch{}
      setInterval(()=>apply(detect()),800);
    }
  }
  window.__dshApplySafeTop=apply;
})();
$('#app').innerHTML=`<aside class="sidebar"><div class="side-head"><b class="side-title">群岛文档</b><button id="new" class="new-doc">${PLUS_ICON}新建</button></div><label class="side-search">${SEARCH_ICON}<input id="search" placeholder="搜索" aria-label="搜索文档"></label><div class="section-label">我的文档</div><nav id="documents"></nav><div class="side-bottom"><button id="trash" class="side-foot-item">${TRASH_ICON}回收站</button><div class="sidebar-foot">仅本地存储</div></div></aside><section class="workspace"><header><span class="breadcrumb"><b id="crumb">未命名文档</b></span><span class="header-spacer"></span><span id="status" role="status">载入中</span><button id="retry" class="text-button" hidden>重试保存</button><button id="more" class="icon-button" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作" title="更多操作"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="3.2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.8" cy="8" r="1.3"/></svg></button></header><div id="doc-menu" class="doc-menu" role="menu" aria-label="更多操作" hidden><div class="menu-section">文档</div><button type="button" id="history" role="menuitem">历史记录</button><div id="doc-actions"></div></div><div id="toolbar" role="toolbar" aria-label="文本格式"></div><button type="button" id="outline-show" class="outline-show" aria-label="展开目录" title="展开目录" hidden></button><div class="content-layout"><nav id="outline" class="outline" aria-label="文档目录"><div class="outline-head"><button type="button" id="outline-toggle" class="outline-toggle" aria-label="收起目录" title="收起目录"></button></div><div id="outline-list" class="outline-list"></div></nav><main class="paper"><div id="document-cover" hidden></div><input id="title" aria-label="文档标题" placeholder="未命名文档"><div id="doc-meta" class="doc-meta"><span id="doc-updated"></span></div><div class="editor-surface"><div id="editor"></div></div></main></div><footer><span id="counts"></span></footer></section><div id="slash" class="popup" hidden></div><div id="bubble" class="popup bubble" hidden></div><div id="drawer" hidden></div><input id="import" type="file" accept="application/json" hidden><input id="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><input id="attachment" type="file" hidden>`;
async function api(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Object.assign(new Error(j.error?.message||j.error||'请求失败'),{status:r.status});return j}
function status(t,error=false){$('#status').textContent=t;$('#status').classList.toggle('error',error);$('#retry').hidden=!error||!dirty}
const codeBlockBridge={language:null,toast:null};
const CODE_LANGUAGE_LABELS={plaintext:'纯文本',javascript:'JavaScript',typescript:'TypeScript',jsx:'JSX',tsx:'TSX',html:'HTML',css:'CSS',json:'JSON',python:'Python',bash:'Shell',sql:'SQL',markdown:'Markdown',java:'Java',go:'Go',rust:'Rust',c:'C',cpp:'C++',yaml:'YAML'};
function codeBlockView({node,getPos,editor}){
  let current=node;
  const dom=document.createElement('div');dom.className='code-block';
  const head=document.createElement('div');head.className='code-block-head';head.contentEditable='false';
  const lang=document.createElement('button');lang.type='button';lang.className='code-block-lang';
  const wrap=document.createElement('button');wrap.type='button';wrap.className='code-block-tool';wrap.setAttribute('aria-label','自动换行');wrap.innerHTML=WRAP_ICON;
  const copy=document.createElement('button');copy.type='button';copy.className='code-block-tool';copy.setAttribute('aria-label','复制代码');copy.title='复制代码';copy.innerHTML=vendorIcon('copyCode',{size:14});
  const pre=document.createElement('pre'),code=document.createElement('code');
  pre.append(code);head.append(lang,wrap,copy);dom.append(head,pre);
  const refresh=()=>{
    const language=current.attrs.language||'plaintext';
    lang.textContent=CODE_LANGUAGE_LABELS[language]||language;
    lang.title='选择代码语言';
    wrap.title=current.attrs.wrap?'取消自动换行':'自动换行';
    wrap.classList.toggle('active',!!current.attrs.wrap);
    dom.classList.toggle('is-wrap',!!current.attrs.wrap);
    pre.dataset.wrap=String(!!current.attrs.wrap);
  };
  lang.addEventListener('mousedown',event=>event.preventDefault());
  lang.addEventListener('click',()=>{const pos=typeof getPos==='function'?getPos():null;if(pos===null)return;codeBlockBridge.language?.({trigger:lang,pos})});
  wrap.addEventListener('mousedown',event=>event.preventDefault());
  wrap.addEventListener('click',()=>{const pos=typeof getPos==='function'?getPos():null;if(pos===null)return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,wrap:!current.attrs.wrap}))});
  copy.addEventListener('mousedown',event=>event.preventDefault());
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(current.textContent);codeBlockBridge.toast?.('代码已复制')}catch{codeBlockBridge.toast?.('无法访问剪贴板，请选中代码后复制')}});
  refresh();
  return {
    dom,contentDOM:code,
    update(updated){if(updated.type!==current.type)return false;current=updated;refresh();return true},
    ignoreMutation(mutation){return head.contains(mutation.target)||mutation.type==='selection'},
    stopEvent(event){return head.contains(event.target)}
  };
}
const editor=new Editor({element:$('#editor'),extensions:[...annotationExtensions,Columns,Column,StructuredControls,StarterKit.configure({heading:false,codeBlock:false,link:{openOnClick:false,autolink:true,protocols:['http','https','mailto'],isAllowedUri:(url,ctx)=>/^(https?:|mailto:)/i.test(url)&&ctx.defaultValidate(url)}}),HeadingNine,TaskList,TaskItem.configure({nested:true,HTMLAttributes:{'data-type':'taskItem'}}),Highlight.configure({multicolor:true}),TextStyle,Color,TextAlign.configure({types:['heading','paragraph']}),Table.configure({resizable:true}),TableRow,TableHeader,TableCell,CodeBlockLowlight.extend({addAttributes(){return {...this.parent?.(),wrap:{default:false,parseHTML:e=>e.dataset.wrap==='true',renderHTML:a=>({'data-wrap':String(a.wrap)})}}},addNodeView(){return codeBlockView}}).configure({lowlight,defaultLanguage:'plaintext'}),LocalImage,MediaAttachment,LocalCanvas,Callout,Formula,TrailingParagraphAfterAtom],content:empty,onUpdate(){if(!loading){dirty=true;scheduleSave()}refresh();updateSlash()},onSelectionUpdate(){refresh();updateSlash()},editorProps:{attributes:{'aria-label':'文档正文','spellcheck':'false'},handlePaste(view,event){if(!EMBED||!hasClipboardImages(event))return false;pasteEmbedImages(editor,event);return true},handleKeyDown(view,event){if(event.isComposing)return false;if(slash){if(event.key==='Escape'){slash=null;$('#slash').hidden=true;return true}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const count=filtered().length;slashIndex=count?(slashIndex+(event.key==='ArrowDown'?1:-1)+count)%count:0;renderSlash();return true}if(event.key==='Enter'){event.preventDefault();runSlash(filtered()[slashIndex]);return true}}return false}}});
window.dshEditor=editor;
const commands=[['正文','text zhengwen',()=>editor.chain().focus().setParagraph().run()],...[1,2,3,4,5,6,7,8,9].map(n=>['标题 '+n,'h'+n+' biaoti',()=>editor.chain().focus().toggleHeading({level:n}).run()]),['无序列表','bullet ul wxlb',()=>editor.chain().focus().toggleBulletList().run()],['有序列表','ordered ol yxlb',()=>editor.chain().focus().toggleOrderedList().run()],['任务列表','task todo rwlb',()=>editor.chain().focus().toggleTaskList().run()],['高亮块','callout glk',()=>editor.chain().focus().wrapIn('callout').run()],['代码块','code dm',()=>editor.chain().focus().toggleCodeBlock().run()],['引用','quote yy',()=>editor.chain().focus().toggleBlockquote().run()],['分割线','divider fgx',()=>editor.chain().focus().setHorizontalRule().run()],['表格','table bg',()=>editorUI.tablePicker()],['公式','formula gs',()=>editorUI.valuePanel('插入公式',null,{label:'LaTeX 公式',value:'E=mc^2',validate:v=>v.trim()?null:'请输入公式',onApply:latex=>editor.chain().focus().insertContent({type:'formula',attrs:{latex}}).run()})],['双栏','columns fenlan fl',()=>editor.chain().focus().insertColumns().run()],['图片','image tp',()=>$('#image').click()],['音视频或附件','media audio video attachment fj',()=>$('#attachment').click()],['本地画板','canvas drawing huaban hb',()=>editor.chain().focus().insertLocalCanvas().run()]];
const commandMeta=[['基础','textBody'],['基础','h1'],['基础','h2'],['基础','h3'],['基础','h4'],['其他标题','headingMore'],['其他标题','headingMore'],['其他标题','headingMore'],['其他标题','headingMore'],['其他标题','headingMore'],['列表','bulletList'],['列表','orderedList'],['列表','taskList'],['内容块','calloutColor'],['内容块','codeBlock'],['内容块','quote'],['内容块','divider'],['内容块','tableColor'],['内容块','formula'],['内容块','columns'],['媒体','image'],['媒体','attachment'],['媒体','whiteboardColor']];
function filtered(){return commands.filter(c=>(c[0]+' '+c[1]).toLowerCase().includes(slash?.query.toLowerCase()||''))}
function updateSlash(){const {$from,empty:selEmpty}=editor.state.selection;const before=$from.parent.textBetween(0,$from.parentOffset);const m=before.match(/(?:^|\s)\/([^\s/]*)$/);if(!readonly&&selEmpty&&m&&!editor.isActive('codeBlock')){slash={from:$from.pos-m[1].length-1,to:$from.pos,query:m[1]};slashIndex=0;renderSlash()}else{slash=null;$('#slash').hidden=true}}
function renderSlash(){
  const el=$('#slash');el.hidden=false;$('#bubble').hidden=true;
  const list=filtered();const query=slash?.query||'';
  let html='<div class="slash-head"><span class="slash-head-icon">'+vendorIcon('search',{size:13})+'</span><span class="slash-query">'+(query?'/ '+esc(query):'/ 输入关键词')+'</span><span class="slash-hint">Esc</span></div>';
  if(!list.length)html+='<p class="slash-empty">没有匹配内容，请换个关键词</p>';
  else{
    html+='<div class="slash-list">';let group='';
    list.forEach((item,index)=>{
      const meta=commandMeta[commands.indexOf(item)]||['',"paragraph"];
      if(meta[0]!==group){group=meta[0];if(group)html+='<div class="slash-group">'+esc(group)+'</div>'}
      html+='<button type="button" class="slash-item'+(index===slashIndex?' selected':'')+'" data-cmd="'+index+'"><span class="slash-item-icon">'+vendorIcon(meta[1],{size:16})+'</span><span class="slash-item-label">'+esc(item[0])+'</span><small>'+esc(item[1].split(' ')[0])+'</small></button>';
    });
    html+='</div>';
  }
  el.innerHTML=html;
  el.querySelectorAll('button').forEach(button=>button.onmousedown=event=>{event.preventDefault();runSlash(list[+button.dataset.cmd])});
  const caret=editor.view.coordsAtPos(editor.state.selection.from),box=el.getBoundingClientRect();
  const point=floatingPosition(caret,box,{width:innerWidth,height:innerHeight});
  el.style.left=point.left+'px';el.style.top=point.top+'px';
  const selected=el.querySelector('.selected');
  if(selected){
    const list=selected.parentElement;
    if(list){const sr=selected.getBoundingClientRect(),lr=list.getBoundingClientRect();if(sr.top<lr.top||sr.bottom>lr.bottom)list.scrollTop+=(sr.top+sr.height/2)-(lr.top+lr.height/2)}
  }
}
function runSlash(c){if(!c||!canEdit())return;const range=slash;slash=null;$('#slash').hidden=true;if(range)editor.chain().focus().deleteRange(range).run();c[2]()}
function canEdit(){return !readonly&&!navigating&&editor.isEditable}
const btn=(label,title,fn,allowRead=false)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.onmousedown=e=>e.preventDefault();b.onclick=()=>{if(!navigating&&(allowRead||canEdit()))fn()};return b};
codeBlockBridge.language=({trigger,pos})=>{const target={pos,node:editor.state.doc.nodeAt(pos),element:editor.view.nodeDOM(pos)};editorUI.codeLanguage(trigger,target)};
codeBlockBridge.toast=text=>editorUI.feedback(text);
function postToHost(payload){try{window.parent.postMessage({__dshRichEditor:true,...payload},'*')}catch{}}
if(EMBED){
  document.body.classList.add('is-embed');
  active={id:'embed',revision:0,title:'',content:empty,metadata:{}};
  window.addEventListener('message',event=>{
    const data=event.data;
    if(!data||data.__dshRichEditor!==true||event.source!==window.parent)return;
    if(data.type==='load'){
      loading=true;
      try{editor.commands.setContent(data.html||'<p></p>',{emitUpdate:false})}finally{loading=false}
      dirty=false;postToHost({type:'loaded'});
    }else if(data.type==='save'){
      postToHost({type:'content',html:editor.getHTML(),requestId:data.requestId||null});
    }else if(data.type==='focus'){
      try{editor.commands.focus('end')}catch{}
    }
  });
}
const editorUI=createEditorUI({editor,canEdit,getDocumentId:()=>active?.id,commands,lowlight,onInsert:insertAfterBlock,onCrop:cropCurrentImage,onCover:async()=>{const src=editor.getAttributes('image').src;if(!isLocalAssetURL(src)){status('仅本地图片可设为封面');return}try{await mutateDocument('/metadata',{metadata:{cover:src}},'PATCH')}catch(e){status(e.message,true)}},showDrawer});
function insertAfterBlock(target){if(!canEdit())return;if(target&&editor.state.doc.nodeAt(target.pos)!==target.node)return;let pos=editor.state.selection.from;if(target){const empty=target.node.type.name==='paragraph'&&!target.node.content.size;if(empty)pos=target.pos+1;else{const after=target.pos+target.node.nodeSize;const item=['listItem','taskItem'].includes(target.node.type.name);const content=item?{type:target.node.type.name,...(target.node.type.name==='taskItem'?{attrs:{checked:false}}:{}),content:[{type:'paragraph'}]}:{type:'paragraph'};pos=after+(item?2:1);if(!editor.chain().focus().insertContentAt(after,content).setTextSelection(pos).run())return}}editor.commands.setTextSelection(pos);slash={from:pos,to:pos,query:''};renderSlash()}
function blockTypeIcon(block){
  const node=block?.node,name=node?.type?.name||block?.type||'paragraph';
  if(name==='heading'){const level=Math.min(4,Math.max(1,node.attrs.level||1));return vendorIcon('h'+level,{size:16})}
  const map={paragraph:'blockStyle',heading:'h1',bulletList:'bulletList',orderedList:'orderedList',taskList:'taskList',listItem:'bulletList',taskItem:'taskList',blockquote:'quote',callout:'callout',table:'tableMono',tableRow:'tableMono',tableCell:'tableMono',codeBlock:'codeBlock',image:'image',mediaAttachment:'attachment',localCanvas:'whiteboard',formula:'formula',columns:'columns'};
  if(map[name])return vendorIcon(map[name],{size:16});
  return vendorIcon('blockStyle',{size:16});
}
const markdownPaste=installMarkdownPaste(editor);
const blockInteractions=integrateBlockInteractions({editor,canEdit,onInsert:insertAfterBlock,onInsertMenu:target=>editorUI.openBlockMenu(target,{mode:'insert'}),onMenu:target=>editorUI.openBlockMenu(target),iconForBlock:blockTypeIcon});
function positionHandle(){blockInteractions.refresh()}
function blockMenu(target){editorUI.openBlockMenu(target)}
function refresh(){if(!editor)return;$('#counts').textContent=editor.getText().replace(/\s/g,'').length+' 字';renderOutline();editorUI.refresh();positionHandle()}
let outlineHeadings=[],outlineRaf=0,outlineColumnCollapsed=false;
try{outlineColumnCollapsed=localStorage.getItem('dsh-outline:collapsed')==='1'}catch{}
const outlineCollapsed=new Set();
function outlineKey(item){return item.level+'|'+item.text.slice(0,80)}
function collectOutline(){const items=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading'&&node.attrs.level<=4)items.push({level:node.attrs.level,text:node.textContent||'空标题',pos});return true});return items}
let outlineSignature='';
function renderOutline(){
  const nav=$('#outline'),list=$('#outline-list');if(!nav||!list)return;
  const items=collectOutline();outlineHeadings=items;
  nav.hidden=!items.length;applyOutlineColumn();
  if(!items.length){list.replaceChildren();outlineSignature='';return}
  const docTitle=$('#title').value||'未命名文档';
  const signature=docTitle+'|'+JSON.stringify(items.map(item=>[item.level,item.text]))+'|'+[...outlineCollapsed].sort().join(',')+'|'+String(outlineColumnCollapsed);
  if(signature===outlineSignature&&list.childElementCount){markOutlineActive();return}
  outlineSignature=signature;
  const rows=[];const stack=[];
  items.forEach(item=>{
    while(stack.length&&stack[stack.length-1].level>=item.level)stack.pop();
    const key=outlineKey(item);const ancestors=stack.map(s=>s.key);item.key=key;item.ancestors=ancestors;
    item.hidden=ancestors.some(k=>outlineCollapsed.has(k));
    item.hasChildren=(items[items.indexOf(item)+1]?.level||0)>item.level;
    stack.push(item);rows.push(item);
  });
  list.innerHTML=`<div class="outline-row outline-title" data-key="__title__" data-pos="-1"><span class="outline-caret-spacer"></span><button type="button" class="outline-link">${esc(docTitle)}</button></div>`+rows.map(item=>`<div class="outline-row level-${item.level}${item.hidden?' is-hidden':''}${outlineCollapsed.has(item.key)?' is-collapsed':''}" data-key="${esc(item.key)}" data-pos="${item.pos}" style="--depth:${item.level-1}">`
    +(item.hasChildren?`<button type="button" class="outline-caret" aria-label="折叠小节" title="折叠小节">${vendorIcon('chevronDown',{size:12})}</button>`:'<span class="outline-caret-spacer"></span>')
    +`<button type="button" class="outline-link">${esc(item.text)}</button></div>`).join('');
  list.querySelectorAll('.outline-row').forEach(row=>{
    const pos=+row.dataset.pos,key=row.dataset.key;
    row.querySelector('.outline-link').onclick=()=>{try{if(pos<0){$('.content-layout').scrollTo({top:0,behavior:'smooth'});return}editor.commands.setTextSelection(pos+1);editor.commands.focus();const dom=editor.view.nodeDOM(pos);const container=$('.content-layout');if(dom&&container){const dr=dom.getBoundingClientRect(),cr=container.getBoundingClientRect();container.scrollTo({top:Math.max(0,container.scrollTop+(dr.top-cr.top)-140),behavior:'smooth'})}}catch{}};
    row.querySelector('.outline-caret')?.addEventListener('click',()=>{if(outlineCollapsed.has(key))outlineCollapsed.delete(key);else outlineCollapsed.add(key);renderOutline();});
  });
  markOutlineActive();
}
function markOutlineActive(){
  const rows=[...document.querySelectorAll('#outline-list .outline-row')];if(!rows.length)return;
  const container=$('.content-layout');const top=container.getBoundingClientRect().top+96;
  let activeKey=null;
  for(const heading of outlineHeadings){let dom;try{dom=editor.view.nodeDOM(heading.pos)}catch{}
    if(!dom||!dom.getBoundingClientRect)continue;
    if(dom.getBoundingClientRect().top<=top)activeKey=outlineKey(heading);else break}
  for(const row of rows)row.classList.toggle('active',row.dataset.key===activeKey&&!row.classList.contains('is-hidden'));
  const active=rows.find(r=>r.classList.contains('active'));
  const list=$('#outline-list');
  if(active&&list&&list.scrollHeight>list.clientHeight+2){
    const ar=active.getBoundingClientRect(),lr=list.getBoundingClientRect();
    if(ar.top<lr.top+2||ar.bottom>lr.bottom-2){
      const delta=(ar.top+ar.height/2)-(lr.top+lr.height/2);
      list.scrollTop+=delta;
    }
  }
}
function scheduleOutlineActive(){cancelAnimationFrame(outlineRaf);outlineRaf=requestAnimationFrame(markOutlineActive)}
function applyOutlineColumn(){
  const workspace=document.querySelector('.workspace');if(!workspace)return;
  workspace.classList.toggle('outline-collapsed',outlineColumnCollapsed);
  const show=$('#outline-show');if(show){show.hidden=true;show.innerHTML= OUTLINE_ICON}
  const toggle=$('#outline-toggle');if(toggle){toggle.innerHTML=OUTLINE_ICON;toggle.classList.toggle('is-collapsed',outlineColumnCollapsed)}
}
function formatUpdated(iso){
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const now=new Date(),diff=now-d,hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(diff<60000)return '刚刚';
  if(diff<3600000)return Math.floor(diff/60000)+' 分钟前';
  if(d.toDateString()===now.toDateString())return '今天 '+hm;
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(d.toDateString()===yesterday.toDateString())return '昨天 '+hm;
  if(d.getFullYear()===now.getFullYear())return (d.getMonth()+1)+'月'+d.getDate()+'日';
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
}
function renderDocMeta(){
  const node=$('#doc-updated'),wrap=$('#doc-meta');if(!node||!wrap)return;
  if(!active?.updatedAt){node.textContent='';wrap.hidden=true;return}
  wrap.hidden=false;
  node.textContent='最近修改 '+formatUpdated(active.updatedAt);
  node.title=new Date(active.updatedAt).toLocaleString('zh-CN');
}
$('#outline-toggle').onclick=()=>{outlineColumnCollapsed=!outlineColumnCollapsed;try{localStorage.setItem('dsh-outline:collapsed',outlineColumnCollapsed?'1':'0')}catch{}applyOutlineColumn();scheduleOutlineActive();positionHandle()};

$('.content-layout').addEventListener('scroll',scheduleOutlineActive,{passive:true});
window.addEventListener('resize',scheduleOutlineActive);
if(typeof ResizeObserver==='function'){
  const layoutObserver=new ResizeObserver(()=>{positionHandle();scheduleOutlineActive()});
  layoutObserver.observe(document.querySelector('.content-layout'));
  layoutObserver.observe(document.querySelector('.paper'));
}
let draftOwner;try{draftOwner=sessionStorage.getItem('dsh-tab');if(!draftOwner){draftOwner=crypto.randomUUID();sessionStorage.setItem('dsh-tab',draftOwner)}}catch{draftOwner=String(Date.now())+Math.random()}
let cacheWarning=false;
function draftKey(id){return 'dsh-draft:'+location.origin+':'+id+':'+draftOwner}
function cacheDraft(){if(!active)return;try{localStorage.setItem(draftKey(active.id),JSON.stringify({title:$('#title').value,content:editor.getJSON(),baseRevision:active.revision,documentId:active.id,owner:draftOwner,updatedAt:new Date().toISOString()}))}catch{cacheWarning=true}}
function scheduleSave(){if(EMBED){postToHost({type:'dirty'});return}cacheDraft();status(cacheWarning?'浏览器草稿不可用 · 请勿关闭页面':'有更改 · 等待保存');clearTimeout(timer);timer=setTimeout(save,600)}
async function save(){clearTimeout(timer);if(savePromise){await savePromise;if(dirty&&!$('#status').classList.contains('error'))return save();return}if(!active||!dirty||loading)return;
 savePromise=(async()=>{saving=true;while(dirty&&active){const id=active.id,title=$('#title').value||'未命名文档',content=editor.getJSON(),expectedRevision=active.revision;dirty=false;status('正在保存…');try{validateDocumentExtras(content);const {document:d}=await api('/documents/'+id,'PUT',{title,content,expectedRevision});active=d;status('已保存到本地');renderDocMeta();if(!dirty){try{localStorage.removeItem(draftKey(id))}catch{}}else cacheDraft();await listDocs()}catch(e){dirty=true;status(e.status===409?'版本冲突：先导出当前文档，再重新载入':e.message,true);break}}saving=false})().finally(()=>{savePromise=null});await savePromise;
}
async function listDocs(){({documents:docs}=await api('/documents'));renderDocs()}
const DOC_ICON=vendorIcon('doc',{size:15});
function renderDocs(){const q=$('#search').value.toLowerCase();$('#documents').innerHTML=docs.filter(d=>!d.deletedAt&&d.title.toLowerCase().includes(q)).sort((a,b)=>(Number(b.metadata?.pinned)||0)-(Number(a.metadata?.pinned)||0)).map(d=>`<button data-id="${esc(d.id)}" class="${active?.id===d.id?'active':''}"><span class="doc-icon">${DOC_ICON}</span><span class="doc-title">${d.metadata?.favorite?'★ ':''}${esc(d.title)}</span><span class="doc-more" data-more role="button" tabindex="-1" aria-label="文档操作">${vendorIcon('more',{size:14})}</span></button>`).join('');$('#documents').querySelectorAll('button').forEach(b=>b.onclick=()=>openDoc(b.dataset.id))}

/* ---------- 文档列表：右键 / ⋯ 菜单 ---------- */
const docCtx=document.createElement('div');docCtx.id='doc-context-menu';docCtx.className='doc-context-menu';docCtx.hidden=true;docCtx.setAttribute('role','menu');document.body.append(docCtx);
let docCtxTarget=null;
function closeDocCtx(){docCtx.hidden=true;docCtxTarget=null}
function openDocCtx(doc,x,y){
  docCtxTarget=doc;docCtx.replaceChildren();
  const add=(label,fn,danger)=>{const b=document.createElement('button');b.type='button';b.className='doc-ctx-item'+(danger?' danger':'');b.textContent=label;b.setAttribute('role','menuitem');b.onmousedown=e=>e.preventDefault();b.onclick=async()=>{closeDocCtx();try{await fn()}catch(e){status(e.message,true)}};docCtx.append(b)};
  add('打开',()=>openDoc(doc.id));
  add('重命名',()=>startRenameDoc(doc));
  add('复制一份',()=>duplicateDoc(doc));
  add(doc.metadata?.pinned?'取消置顶':'置顶',()=>toggleDocFlag(doc,'pinned'));
  add(doc.metadata?.favorite?'取消收藏':'收藏',()=>toggleDocFlag(doc,'favorite'));
  const hr=document.createElement('hr');docCtx.append(hr);
  add('删除到回收站',()=>deleteDocById(doc),true);
  docCtx.hidden=false;
  docCtx.style.left=Math.min(x,innerWidth-docCtx.offsetWidth-8)+'px';
  docCtx.style.top=Math.min(y,innerHeight-docCtx.offsetHeight-8)+'px';
}
function startRenameDoc(doc){
  const row=$(`#documents [data-id="${doc.id}"]`);if(!row)return;
  const span=row.querySelector('.doc-title');if(!span)return;
  const input=document.createElement('input');input.className='doc-rename-input';input.value=doc.title;input.maxLength=200;
  span.replaceWith(input);input.focus();input.select();let settled=false;
  const finish=async commit=>{
    if(settled)return;settled=true;
    const name=input.value.trim();
    if(!commit||!name||name===doc.title){renderDocs();return}
    try{
      const {document:d}=await api('/documents/'+doc.id);
      const {document:saved}=await api('/documents/'+doc.id,'PUT',{title:name,content:d.content,expectedRevision:d.revision});
      if(active?.id===doc.id){active=saved;$('#title').value=saved.title;$('#crumb').textContent=saved.title;try{renderDocMeta()}catch{}}
      await listDocs();
    }catch(e){status(e.message,true)}
    renderDocs();
  };
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}});
  input.addEventListener('blur',()=>finish(true));
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('pointerdown',e=>e.stopPropagation());
}
async function duplicateDoc(doc){
  const {document:d}=await api('/documents/'+doc.id);
  const {document:copy}=await api('/documents','POST',{title:d.title+' 副本',content:d.content,metadata:{...d.metadata}});
  await listDocs();await openDoc(copy.id);
}
async function toggleDocFlag(doc,key){
  const {document:d}=await api('/documents/'+doc.id);
  const metadata={...d.metadata,[key]:!d.metadata?.[key]};
  const {document:saved}=await api('/documents/'+doc.id+'/metadata','PATCH',{metadata,expectedRevision:d.revision});
  if(active?.id===doc.id){active=saved;try{applyDocumentMetadata()}catch{}}
  await listDocs();renderDocs();
}
async function deleteDocById(doc){
  if(navigating)return;
  if(!confirm('移到回收站？可以稍后从回收站恢复。'))return;
  if(active?.id===doc.id){
    navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;
    try{
      await save();
      await api('/documents/'+doc.id,'DELETE',{expectedRevision:active.revision});
      active=null;await listDocs();navigating=false;
      const next=docs.find(d=>!d.deletedAt);
      if(next)await openDoc(next.id);else await $('#new').onclick();
    }finally{navigating=false;try{editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}catch{}}
    return;
  }
  await api('/documents/'+doc.id,'DELETE',{expectedRevision:doc.revision});
  await listDocs();renderDocs();
}
$('#documents').addEventListener('contextmenu',event=>{
  const row=event.target.closest('[data-id]');if(!row)return;
  event.preventDefault();
  const doc=docs.find(d=>d.id===row.dataset.id);
  if(doc)openDocCtx(doc,event.clientX,event.clientY);
});
$('#documents').addEventListener('click',event=>{
  const more=event.target.closest('[data-more]');if(!more)return;
  event.preventDefault();event.stopPropagation();
  const row=more.closest('[data-id]');const doc=row&&docs.find(d=>d.id===row.dataset.id);
  if(!doc)return;
  const r=more.getBoundingClientRect();
  openDocCtx(doc,Math.max(8,r.right-176),r.bottom+6);
},true);
document.addEventListener('pointerdown',event=>{if(!docCtx.hidden&&!docCtx.contains(event.target)&&!event.target.closest('[data-more]'))closeDocCtx()},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!docCtx.hidden)closeDocCtx()});
window.addEventListener('blur',closeDocCtx);
async function openDoc(id){if(navigating)return;drawerEpoch++;navigating=true;editorUI.closeAll();$('#drawer').hidden=true;$('#toolbar').hidden=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;try{await save();if(dirty)return;loading=true;const {document:d}=await api('/documents/'+id);if(d.deletedAt)throw new Error('文档已在回收站，请先恢复');validateDocumentExtras(d.content.doc||d.content);editor.schema.nodeFromJSON(d.content.doc||d.content).check();active=d;applyDocumentMetadata();let content=d.content.doc||d.content,title=d.title;let recovered=false;try{const draft=JSON.parse(localStorage.getItem(draftKey(id))||'null');if(draft&&confirm('发现未保存草稿，恢复到编辑器？若版本冲突，请导出后人工合并。')){validateDocumentExtras(draft.content);editor.schema.nodeFromJSON(draft.content).check();content=draft.content;title=draft.title;recovered=true;if(draft.baseRevision!==d.revision){active={...d,revision:draft.baseRevision}}}}catch{}
$('#title').value=title;$('#crumb').textContent=title;editor.commands.loadAnnotatedContent(content,{emitUpdate:false});editor.view.updateState(EditorState.create({doc:editor.state.doc,schema:editor.schema,plugins:editor.state.plugins}));dirty=recovered;status(recovered?'已恢复未保存草稿':'已保存到本地');renderDocMeta();renderDocs();refresh();}catch(e){status(e.message,true)}finally{loading=false;navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly;if(dirty&&!$('#status').classList.contains('error'))scheduleSave()}}
// The entire paper writing surface accepts a click, including empty margins.
// Never steal clicks from existing content, selections, inputs, or block controls.
$('.paper').addEventListener('click',event=>{if(!canEdit())return;if(event.target.matches('.paper,.editor-surface,#editor,.editor-surface .tiptap'))editor.commands.focus(editor.isEmpty?'start':'end')});
$('#title').oninput=()=>{if(!canEdit())return;dirty=true;$('#crumb').textContent=$('#title').value;scheduleSave()};$('#search').oninput=renderDocs;$('#retry').onclick=save;$('#new').onclick=async()=>{if(navigating)return;navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;await save();if(dirty){navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly;return}try{const {document:d}=await api('/documents','POST',{title:'未命名文档',content:empty});await listDocs();navigating=false;await openDoc(d.id)}catch(e){status(e.message,true)}finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}};

function showDrawer(title,html){drawerEpoch++;$('#drawer').classList.remove('annotations-drawer');$('#drawer').hidden=false;$('#drawer').innerHTML=`<button class="close" aria-label="关闭">×</button><h2>${esc(title)}</h2>${html}`;$('#drawer .close').onclick=()=>{drawerEpoch++;$('#drawer').hidden=true}}
$('#history').onclick=()=>{closeDocMenu();openHistory()};
async function openHistory(){
  if(!active||navigating)return;
  const historyId=active.id,request=++drawerEpoch;
  try{
    await save();
    if(dirty||active?.id!==historyId||navigating||request!==drawerEpoch)return;
    const data=await api('/documents/'+historyId+'/history');
    if(active?.id!==historyId||navigating||request!==drawerEpoch)return;
    renderHistory(historyId,data.history||data.versions||[]);
  }catch(e){if(active?.id===historyId&&request===drawerEpoch)status(e.message,true)}
}
function historyDay(stamp){
  const date=new Date(stamp),now=new Date();
  if(Number.isNaN(date.getTime()))return {key:'unknown',label:'未知时间'};
  const key=date.getFullYear()+'-'+(date.getMonth()+1)+'-'+date.getDate();
  if(date.toDateString()===now.toDateString())return {key,label:'今天'};
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(date.toDateString()===yesterday.toDateString())return {key,label:'昨天'};
  return {key,label:date.getFullYear()+'年'+(date.getMonth()+1)+'月'+date.getDate()+'日'};
}
function historyClock(stamp){const date=new Date(stamp);return Number.isNaN(date.getTime())?'':String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0')}
function historyText(json){
  const out=[];
  const walk=node=>{if(!node)return;if(node.type==='text'){out.push(node.text||'');return}
    const block=/^(paragraph|heading|listItem|taskItem|codeBlock|blockquote|callout|tableRow|tableCell|tableHeader|bulletList|orderedList)$/.test(node.type||'');
    if(block&&out.length&&!out[out.length-1].endsWith('\n'))out.push('\n');
    for(const child of node.content||[])walk(child);};
  walk(json);return out.join('').replace(/\n{3,}/g,'\n\n').trim();
}
function renderHistory(historyId,versions){
  const named=new Map((active?.namedVersions||[]).map(item=>[item.revision,item.name]));
  const current=active?.revision;
  const groups=[],index=new Map();
  for(const version of versions){
    const day=historyDay(version.updatedAt||version.createdAt);
    if(!index.has(day.key)){index.set(day.key,{label:day.label,items:[]});groups.push(index.get(day.key))}
    index.get(day.key).items.push(version);
  }
  const html=groups.length?groups.map(group=>`<section class="history-group"><h3>${esc(group.label)}</h3>`+group.items.map(version=>{
    const time=historyClock(version.updatedAt||version.createdAt),name=named.get(version.revision);
    return `<article class="history-item${version.revision===current?' current':''}" data-history="${version.revision}">`
      +`<span class="history-time">${esc(time)}</span>`
      +`<div class="history-body"><p class="history-title">版本 ${esc(version.revision)}${version.revision===current?'<em>当前</em>':''}${name?`<span class="history-name">${esc(name)}</span>`:''}</p>`
      +`<p class="history-snippet">${esc((historyText(version.content)||'空白文档').slice(0,120))}</p></div>`
      +`<div class="history-actions"><button type="button" data-preview-rev="${version.revision}">预览</button><button type="button" data-name-rev="${version.revision}">命名</button><button type="button" data-rev="${version.revision}" ${canEdit()?'':'disabled'}>恢复</button></div>`
      +`</article>`
  }).join('')+`</section>`).join(''):'<p class="muted">暂无历史版本</p>';
  showDrawer('历史记录',html+'<p class="history-foot">恢复某版本后，当前内容仍会保留在历史中。</p>');
  const byRevision=new Map(versions.map(version=>[version.revision,version]));
  $('#drawer').querySelectorAll('[data-preview-rev]').forEach(button=>button.onclick=()=>{
    const item=button.closest('.history-item');
    const existing=item.querySelector('.history-preview-body');
    if(existing){existing.remove();button.textContent='预览';return}
    const version=byRevision.get(+button.dataset.previewRev);if(!version)return;
    const body=document.createElement('pre');body.className='history-preview-body';
    body.textContent=historyText(version.content)||'（空白文档）';
    item.append(body);button.textContent='收起';
  });
  $('#drawer').querySelectorAll('[data-name-rev]').forEach(button=>button.onclick=async()=>{
    if(!canEdit()||active?.id!==historyId)return;
    const name=prompt('版本名称（最多100字）');
    if(!name||!canEdit()||active?.id!==historyId)return;
    try{await mutateDocument('/named-versions',{revision:+button.dataset.nameRev,name});if(active?.id===historyId)openHistory()}catch(e){status(e.message,true)}
  });
  $('#drawer').querySelectorAll('[data-rev]').forEach(button=>button.onclick=async()=>{
    if(!canEdit()||active?.id!==historyId)return;
    if(!confirm('恢复该版本？当前内容会保留在历史中。'))return;
    if(!canEdit()||active?.id!==historyId)return;
    drawerEpoch++;$('#drawer').hidden=true;navigating=true;editorUI.closeAll();editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;
    try{
      await save();
      if(dirty||active?.id!==historyId)return;
      await api('/documents/'+historyId+'/restore','POST',{revision:+button.dataset.rev,expectedRevision:active.revision});
      navigating=false;await openDoc(historyId);
    }catch(e){if(active?.id===historyId)status(e.message,true)}
    finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}
  });
}
function download(name,data,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
const docMenu=$('#doc-menu');
function closeDocMenu(){docMenu.hidden=true;$('#more').setAttribute('aria-expanded','false')}
function openDocMenu(){docMenu.hidden=false;const r=$('#more').getBoundingClientRect();docMenu.style.top=(r.bottom+6)+'px';docMenu.style.right=Math.max(8,Math.round(innerWidth-r.right))+'px';$('#more').setAttribute('aria-expanded','true')}
$('#more').onclick=e=>{e.stopPropagation();docMenu.hidden?openDocMenu():closeDocMenu()};
document.addEventListener('pointerdown',e=>{if(docMenu.hidden)return;if(docMenu.contains(e.target)||$('#more').contains(e.target))return;closeDocMenu()});
window.addEventListener('resize',closeDocMenu);$('.content-layout').addEventListener('scroll',closeDocMenu);
const docActions=$('#doc-actions');
function docMenuItem(name,fn,allowRead=false){const b=btn(name,name,async()=>{try{const result=await fn();if(result!=='keep-open')closeDocMenu()}catch(e){status(e.message,true)}},allowRead);b.setAttribute('role','menuitem');b.type='button';if(/^删除/.test(name))b.classList.add('danger');docActions.append(b)}
const docActionGroups=[
['',[['文档属性与整理',()=>showMetadata()],['查找与替换',()=>openFindReplace(editor)],['复制文档',async()=>{const {document:d}=await api('/documents','POST',{title:$('#title').value+' 副本',content:editor.getJSON()});await listDocs();await openDoc(d.id)}],['导出为 HTML（交互降级）',()=>download(($('#title').value||'文档')+'.html','<!doctype html><meta charset="utf-8"><h1>'+esc($('#title').value)+'</h1>'+editor.getHTML(),'text/html')]]],
['',[['删除到回收站',async()=>{if(!active||navigating||!confirm('移到回收站？可稍后恢复。'))return;const deleteId=active.id;navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;try{await save();if(dirty)return;await api('/documents/'+deleteId,'DELETE',{expectedRevision:active.revision});active=null;await listDocs();navigating=false;if(docs.some(d=>!d.deletedAt))await openDoc(docs.find(d=>!d.deletedAt).id);else await $('#new').onclick()}finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}}]]]
];
for(const [section,items] of docActionGroups){if(section){const h=document.createElement('div');h.className='menu-section';h.textContent=section;docActions.append(h)}for(const [name,fn] of items)docMenuItem(name,fn,/^(导出|备份|打印|滚动|分页|查找)/.test(name))}
$('#trash').onclick=async()=>{const request=++drawerEpoch;try{const data=await api('/documents?includeDeleted=true');if(request!==drawerEpoch||navigating)return;const deleted=data.documents.filter(d=>d.deletedAt);showDrawer('回收站',deleted.map(d=>`<article>${esc(d.title)} <button data-id="${esc(d.id)}" ${canEdit()?'':'disabled'}>恢复</button></article>`).join('')||'<p>回收站为空</p>');$('#drawer').querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{if(!canEdit()||b.disabled)return;const d=deleted.find(x=>x.id===b.dataset.id);b.disabled=true;try{await api('/documents/'+d.id+'/undelete','POST',{expectedRevision:d.revision});await listDocs();$('#drawer').hidden=true;drawerEpoch++}catch(e){status(e.message,true);b.disabled=false}})}catch(e){if(request===drawerEpoch)status(e.message,true)}};
$('#import').onchange=async e=>{try{if(!canEdit())return;const f=e.target.files[0];if(!f)return;const j=JSON.parse(await f.text());const content=j.content?.doc||j.content||j.doc||j;validateDocumentExtras(content);editor.schema.nodeFromJSON(content).check();if(!confirm('作为新文档导入，不覆盖已有文档？'))return;await save();if(dirty||!canEdit())return;const {document:d}=await api('/documents','POST',{title:j.title||f.name,content});await listDocs();await openDoc(d.id)}catch(e){alert('导入失败：'+e.message)}finally{e.target.value=''}};
$('#image').onchange=e=>uploadFile(e,true);$('#attachment').onchange=e=>uploadFile(e,false);
window.addEventListener('beforeunload',e=>{if(EMBED)return;if(dirty||saving){e.preventDefault();e.returnValue=''}});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&editor.view.dom.contains(document.activeElement)){e.preventDefault();openFindReplace(editor)}if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();save()}if(e.key==='Escape'){drawerEpoch++;$('#drawer').hidden=true;$('#bubble').hidden=true;$('#toolbar').hidden=true;slash=null;$('#slash').hidden=true}});
$('#toolbar').hidden=true;
(async()=>{if(EMBED){editor.setEditable(true);postToHost({type:'ready'});return}try{await listDocs();if(docs.some(d=>!d.deletedAt))await openDoc(docs.find(d=>!d.deletedAt).id);else $('#new').click()}catch(e){status('本地服务未连接：'+e.message,true)}
})();

function chooseLanguage(){editorUI.codeLanguage()}
function showDrafts(){const prefix='dsh-draft:'+location.origin+':',entries=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key.startsWith(prefix))continue;const raw=localStorage.getItem(key);try{const draft=JSON.parse(raw);if(draft?.content)entries.push({key,raw,draft})}catch{}}}catch{status('浏览器禁止读取草稿存储',true);return}entries.sort((a,b)=>(b.draft.updatedAt||'').localeCompare(a.draft.updatedAt||''));showDrawer('浏览器恢复草稿','<p>这里包含其他标签页或已关闭标签页的未保存内容。恢复会创建独立新文档，不覆盖原文档，也不会删除原草稿。其他标签页可能仍在编辑。</p>'+entries.map(({draft},i)=>`<article><b>${esc(draft.title||'未命名草稿')}</b><p>${esc(draft.updatedAt||'未记录时间')} · 基于版本 ${esc(draft.baseRevision)}</p><div class="draft-preview">${esc(JSON.stringify(draft.content).slice(0,300))}</div><button data-recover-draft="${i}">恢复为新文档</button><button data-clear-draft="${i}">明确清除此草稿</button></article>`).join('')+(entries.length?'':'<p>没有未保存草稿</p>'));$('#drawer').querySelectorAll('[data-clear-draft]').forEach(button=>button.onclick=()=>{const item=entries[+button.dataset.clearDraft];if(!confirm('仅删除这条浏览器草稿？其他标签页可能仍在编辑。此清除无法撤销。'))return;try{if(localStorage.getItem(item.key)!==item.raw){alert('草稿已更新，本次未清除。请重新检查。');showDrafts();return}localStorage.removeItem(item.key);showDrafts()}catch{status('无法清除草稿',true)}});$('#drawer').querySelectorAll('[data-recover-draft]').forEach(button=>button.onclick=async()=>{if(navigating)return;const item=entries[+button.dataset.recoverDraft];if(!confirm('将所选草稿恢复为新文档？原文档和原草稿都保留。'))return;navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;try{await save();if(dirty)return;validateDocumentExtras(item.draft.content);editor.schema.nodeFromJSON(item.draft.content).check();const {document:d}=await api('/documents','POST',{title:(item.draft.title||'未命名文档')+' · 恢复草稿',content:item.draft.content});await listDocs();navigating=false;await openDoc(d.id)}catch(e){status('恢复草稿失败：'+e.message,true)}finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}})}

async function mutateDocument(path,payload,method='POST'){if(!active||navigating||readonly)return;const id=active.id;navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;try{await save();if(dirty)throw new Error('请先解决未保存内容或版本冲突');const {document:d}=await api('/documents/'+id+path,method,{...payload,expectedRevision:active.revision});active=d;applyDocumentMetadata();await listDocs();return d}finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly}}
let coverSequence=0,coverResource=null;
function applyDocumentMetadata(){const metadata=active?.metadata||{};$('.paper').style.borderTop='';const cover=$('#document-cover'),ticket=++coverSequence;if(coverResource){releaseAssetURL(coverResource.source,coverResource.url);coverResource=null}cover.replaceChildren();cover.style.background='';cover.hidden=!metadata.cover;if(/^#[0-9a-f]{6}$/i.test(metadata.cover||'')){cover.style.background=metadata.cover;return}if(isLocalAssetURL(metadata.cover)){const source=metadata.cover;resolveAssetURL(source).then(url=>{if(ticket!==coverSequence){releaseAssetURL(source,url);return}coverResource={source,url};const img=document.createElement('img');img.src=url;img.alt='文档封面';img.onerror=()=>{if(ticket===coverSequence)cover.textContent='封面图片暂不可用'};cover.append(img)}).catch(()=>{if(ticket===coverSequence)cover.textContent='封面图片暂不可用'})}else cover.hidden=true}

function showMetadata(){if(!active)return;const id=active.id,m=active.metadata||{};showDrawer('文档属性与整理',`<label>图标<input id="meta-icon" maxlength="32" value="${esc(m.icon||'')}" placeholder="例如 📘"></label><label>文件夹路径<input id="meta-folder" maxlength="200" value="${esc(m.folder||'')}" placeholder="项目 / 设计"></label><label>封面颜色<input id="meta-cover" value="${esc(m.cover||'')}" placeholder="#RRGGBB，留空取消"></label><label><input id="meta-favorite" type="checkbox" ${m.favorite?'checked':''}> 收藏</label><label><input id="meta-pinned" type="checkbox" ${m.pinned?'checked':''}> 置顶</label><button id="save-metadata" class="primary">保存属性</button><p>文件夹为本地文档的路径分类，不改变文件访问权限。</p>`);$('#save-metadata').onclick=async()=>{if(!canEdit()||active?.id!==id)return;const cover=$('#meta-cover').value.trim();if(cover&&!/^#[0-9a-f]{6}$/i.test(cover)&&!isLocalAssetURL(cover)){alert('封面使用六位十六进制颜色或本地图片资源地址');return}const metadata={icon:$('#meta-icon').value,folder:$('#meta-folder').value.split('/').map(segment=>segment.trim()).join('/'),cover,favorite:$('#meta-favorite').checked,pinned:$('#meta-pinned').checked};try{await mutateDocument('/metadata',{metadata},'PATCH');$('#drawer').hidden=true}catch(e){status(e.message,true)}}}

function validateDocumentExtras(json){validateAnnotationsJSON(json);validateMediaJSON(json);const walk=node=>{if(node.type==='localCanvas'&&!isValidScene(node.attrs?.scene))throw new Error('画板数据无效，未载入');if(node.type==='mediaAttachment'&&!isLocalAssetURL(node.attrs?.src))throw new Error('附件必须引用本地资料库资源');for(const child of node.content||[])walk(child)};walk(json)}
async function uploadFile(event,imageOnly){const input=event.target,file=input.files?.[0];input.value='';if(!file||!active||readonly||navigating)return;if(file.size>20*1024*1024){alert('每个资源最大 20 MB');return}const mime=supportedUploadMimes.has(file.type)?file.type:'application/octet-stream';if(imageOnly&&!mime.startsWith('image/')){alert('支持 PNG、JPEG、GIF、WebP 图片');return}const id=active.id;navigating=true;editor.setEditable(false,false);refreshCanvasControls(editor);$('#title').readOnly=true;try{await save();if(dirty)return;status('正在保存本地资源…');const dataBase64=await readFileBase64(file);const {asset}=await api('/assets','POST',{name:file.name,mime,dataBase64});if(active?.id!==id)throw new Error('文档已切换，资源未插入');if(!isLocalAssetURL(asset.url))throw new Error('资源服务返回了无效地址');if(imageOnly)editor.commands.setImage({src:asset.url,alt:asset.name});else editor.commands.insertContent({type:'mediaAttachment',attrs:{src:asset.url,name:asset.name,mime:asset.mime,size:asset.size}});status('资源已存入本地资料库');}catch(e){status('资源保存失败：'+e.message,true)}finally{navigating=false;editor.setEditable(!readonly,false);refreshCanvasControls(editor);$('#title').readOnly=readonly;if(dirty&&!$('#status').classList.contains('error'))scheduleSave()}}

function cropCurrentImage(){const {from}=editor.state.selection,node=editor.state.doc.nodeAt(from),id=active?.id;if(node?.type.name!=='image'||readonly||navigating)return;let held=null,closed=false;const isCurrent=()=>!closed&&active?.id===id&&!readonly&&!navigating&&editor.state.doc.nodeAt(from)===node;openImageCrop({src:node.attrs.src,name:node.attrs.alt||'裁剪图片',isCurrent,resolveSource:async source=>{const url=await resolveAssetURL(source);if(closed)releaseAssetURL(source,url);else held={source,url};return url},upload:payload=>api('/assets','POST',payload).then(result=>result.asset),onApply:asset=>{if(!isCurrent())return;editor.view.dispatch(editor.state.tr.setNodeMarkup(from,undefined,{...node.attrs,src:asset.url}))},onError:error=>status('图片裁剪未完成：'+error.message,true),onClose:()=>{closed=true;if(held){releaseAssetURL(held.source,held.url);held=null}}})}
window.addEventListener('pagehide',()=>{coverSequence++;if(coverResource){releaseAssetURL(coverResource.source,coverResource.url);coverResource=null}});
