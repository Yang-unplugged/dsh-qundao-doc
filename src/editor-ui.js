import {icon} from './icons.js';
import {vendorIcon} from './icons-vendor.js';
import {installTableTools} from './table-tools.js';
import {moveBlockBy} from './block-interactions.js';
import {Selection} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';

export function floatingPosition(anchor,size,viewport,{preferAbove=false,gap=8,padding=8,top=70,bottom=36}={}) {
  const left=Math.max(padding,Math.min(anchor.left,viewport.width-size.width-padding));
  const above=anchor.top-size.height-gap,below=anchor.bottom+gap;
  const fitsAbove=above>=top,fitsBelow=below+size.height<=viewport.height-bottom;
  const y=preferAbove?(fitsAbove?above:below):(fitsBelow?below:above);
  return {left,top:Math.max(top,Math.min(y,Math.max(top,viewport.height-bottom-size.height)))};
}
export function validEditorLink(value) {
  if(!/^(https?:\/\/|mailto:)/i.test(value)||/[\u0000-\u0020]/.test(value))return false;
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?!!url.hostname:url.protocol==='mailto:'&&!!url.pathname;} catch{return false;}
}
export function tableDimensions(rows,cols){return Number.isInteger(rows)&&Number.isInteger(cols)&&rows>=1&&rows<=20&&cols>=1&&cols<=10;}
const colors=['#1f2329','#8f959e','#d83931','#de7802','#b89400','#2ea121','#3370ff','#7f3bf5'];
const fills=['#ffffff','#f2f3f5','#fce3e2','#ffeed5','#fff7c2','#d9f5d6','#e1eaff','#ece2fe'];
const borders=['#ffffff','#dee0e3','#f98e8b','#ffba6b','#ffe47a','#8fdb83','#82a7fc','#b58bfa'];
const $=selector=>document.querySelector(selector);
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}

export function createEditorUI({editor,canEdit,getDocumentId,commands,lowlight,onInsert,onCrop,onCover,showDrawer}){
  const bubble=$('#bubble'),legacy=$('#toolbar');legacy.hidden=true;
  function menuIcon(name,size=22){return vendorIcon(name,{size})}
  function rowIcon(name,size=18){return name.startsWith('move')?icon(name,{size}):vendorIcon(name,{size})}
  bubble.setAttribute('role','toolbar');bubble.setAttribute('aria-label','选区文本格式');
  const pop=el('div','editor-popover popup');pop.id='editor-popover';pop.hidden=true;pop.setAttribute('role','dialog');document.body.append(pop);
  const listFold=el('button','list-fold');listFold.type='button';listFold.innerHTML=vendorIcon('chevronDown',{size:12});listFold.title='折叠/展开子级';listFold.setAttribute('aria-label','折叠或展开子级');listFold.hidden=true;document.body.append(listFold);
  let foldTarget=null;
  editor.view.dom.addEventListener('pointermove',event=>{
    if(!canEdit()){listFold.hidden=true;foldTarget=null;return}
    const li=event.target.closest?.('li');
    const hasChildren=!!li?.querySelector(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol');
    if(!li||!hasChildren){listFold.hidden=true;foldTarget=null;return}
    const cs=getComputedStyle(li);const lr=li.getBoundingClientRect();
    const folded=li.getAttribute('data-collapsed')==='true';
    foldTarget=li;listFold.hidden=false;listFold.classList.toggle('is-folded',folded);
    listFold.style.left=`${Math.round(lr.left+(parseFloat(cs.paddingLeft)||0)-20)}px`;
    listFold.style.top=`${Math.round(lr.top+(parseFloat(cs.paddingTop)||0)+1)}px`;
  });
  listFold.addEventListener('mousedown',event=>event.preventDefault());
  listFold.addEventListener('click',()=>{
    if(!foldTarget||!canEdit())return;
    try{const pos=editor.view.posAtDOM(foldTarget,0);editor.chain().focus().setTextSelection(pos).toggleListFold().run();}catch{}
    listFold.hidden=true;foldTarget=null;
  });
  const context=el('div','block-context');context.id='contextual';context.hidden=true;context.setAttribute('role','toolbar');context.setAttribute('aria-label','当前内容块工具');document.body.append(context);
  const notice=el('div','editor-notice');notice.setAttribute('role','status');notice.hidden=true;document.body.append(notice);
  const tableTools=installTableTools({editor,canEdit});
  let panel=null,contextTarget=null,contextKey='',suppressBubble=false,noticeTimer,disposed=false;
  const feedback=message=>{notice.textContent=message;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,3200)};
  const snapshot=()=>({id:getDocumentId(),doc:editor.state.doc,selection:editor.state.selection});
  const current=s=>canEdit()&&s.id===getDocumentId()&&s.doc===editor.state.doc;
  function restore(s){if(!current(s)){feedback('原文已变化，请重新选择后操作');return false;}editor.view.dispatch(editor.state.tr.setSelection(s.selection));return true;}
  function button(label,title,fn,{read=false,preserve=true}={}){const b=el('button','',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);if(preserve)b.onmousedown=e=>e.preventDefault();b.onclick=()=>{if(read||canEdit())fn(b)};return b;}
  function closePanel(focus=false){const previous=panel?.trigger;panel=null;pop.hidden=true;pop.replaceChildren();if(focus){if(previous?.isConnected)previous.focus();else editor.commands.focus();}}
  function position(node,anchor,preferAbove=false){const size=node.getBoundingClientRect();const p=floatingPosition(anchor,size,{width:innerWidth,height:innerHeight},{preferAbove});node.style.left=p.left+'px';node.style.top=p.top+'px';}
  function selectionRect(){try{const s=editor.state.selection,a=editor.view.coordsAtPos(s.from),b=editor.view.coordsAtPos(s.to);return {left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)}}catch{return {left:innerWidth/2,top:110,bottom:120}}}
  function openPanel(title,trigger,build){if(!canEdit())return;const s=snapshot();closePanel();pop.classList.remove('block-popover');panel={snapshot:s,trigger,anchor:trigger?.getBoundingClientRect?.()||selectionRect()};pop.hidden=false;pop.setAttribute('aria-label',title);pop.replaceChildren();const head=el('div','popover-heading');head.append(el('strong','',title),button('×','关闭'+title,()=>closePanel(true)));pop.append(head);const body=el('div','popover-body');pop.append(body);const apply=fn=>{if(!restore(s))return;closePanel();editor.view.focus();fn();refresh();};build(body,apply,s);position(pop,panel?.anchor||selectionRect());return body;}
  function menu(title,trigger,items){return openPanel(title,trigger,(body,apply)=>{body.classList.add('menu-items');for(const [label,fn,active] of items){const b=button(label,label,()=>apply(fn));if(active)b.classList.add('selected');body.append(b)}})}
  function blockGlyph(){
    if(editor.isActive('heading')){const level=editor.getAttributes('heading').level;if(level>=1&&level<=4)return vendorIcon('h'+level,{size:20});return vendorIcon('headingMore',{size:20});}
    if(editor.isActive('bulletList'))return vendorIcon('bulletList',{size:20});
    if(editor.isActive('orderedList'))return vendorIcon('orderedList',{size:20});
    if(editor.isActive('taskList'))return vendorIcon('taskList',{size:20});
    if(editor.isActive('codeBlock'))return vendorIcon('codeBlock',{size:20});
    if(editor.isActive('blockquote'))return vendorIcon('quote',{size:20});
    if(editor.isActive('callout'))return vendorIcon('callout',{size:20});
    return vendorIcon('blockStyle',{size:20});
  }
  function currentBlockIcon(){
    if(editor.isActive('heading')){const level=editor.getAttributes('heading').level;return level>=1&&level<=4?'h'+level:'h4'}
    if(editor.isActive('bulletList'))return 'bulletList';
    if(editor.isActive('orderedList'))return 'orderedList';
    if(editor.isActive('taskList'))return 'taskList';
    if(editor.isActive('codeBlock'))return 'codeBlock';
    if(editor.isActive('callout'))return 'callout';
    if(editor.isActive('blockquote'))return 'quote';
    return 'paragraph';
  }
  function currentAlignIcon(){if(editor.isActive({textAlign:'center'}))return 'alignCenter';if(editor.isActive({textAlign:'right'}))return 'alignRight';return 'alignLeft'}
  function typeRow(parent,label,iconName,fn,active){
    const item=button('',label,fn);item.className='type-row'+(active?' selected':'');
    item.innerHTML=`<span class="menu-icon">${menuIcon(iconName,18)}</span><span class="type-label">${latestLabel(label)}</span>`;
    parent.append(item);return item;
  }
  function latestLabel(label){return label}
  function moreHeadingsRow(parent,trigger,apply){
    const item=button('','其他标题',()=>openPanel('其他标题',trigger,(body,apply2)=>{
      for(const level of [5,6,7,8,9])typeRow(body,'标题 '+level,'h4',()=>apply2(()=>editor.chain().focus().setHeading({level}).run()),editor.isActive('heading',{level}));
    }));
    item.className='type-row';item.innerHTML=`<span class="menu-icon">${vendorIcon('chevronDown',{size:12})}</span><span class="type-label">其他标题</span>`;
    parent.append(item);return item;
  }
  function formatMenu(trigger){
    openPanel('文字与块类型',trigger,(body,apply)=>{
      const list=el('div','menu-items type-menu');
      typeRow(list,'正文','textBody',()=>apply(()=>editor.chain().focus().setParagraph().run()),editor.isActive('paragraph'));
      for(const level of [1,2,3,4])typeRow(list,'标题 '+level,'h'+level,()=>apply(()=>editor.chain().focus().setHeading({level}).run()),editor.isActive('heading',{level}));
      moreHeadingsRow(list,trigger,apply);
      list.append(el('hr'));
      for(const [label,iconName,fn,active] of [
        ['无序列表','bulletList',()=>editor.chain().focus().toggleBulletList().run(),editor.isActive('bulletList')],
        ['有序列表','orderedList',()=>editor.chain().focus().toggleOrderedList().run(),editor.isActive('orderedList')],
        ['任务列表','taskList',()=>editor.chain().focus().toggleTaskList().run(),editor.isActive('taskList')],
        ['高亮块','callout',()=>insertCallout(),editor.isActive('callout')],
        ['代码块','codeBlock',()=>editor.chain().focus().toggleCodeBlock().run(),editor.isActive('codeBlock')],
        ['引用','quote',()=>editor.chain().focus().toggleBlockquote().run(),editor.isActive('blockquote')]
      ])typeRow(list,label,iconName,()=>apply(fn),active);
      body.append(list);
    });
  }
  function alignment(trigger){menu('缩进与对齐',trigger,[...['left','center','right'].map((align,i)=>[['左对齐','居中对齐','右对齐'][i],()=>editor.chain().focus().setTextAlign(align).run(),editor.isActive({textAlign:align})]),['增加列表缩进',()=>editor.chain().focus().sinkListItem(editor.isActive('taskItem')?'taskItem':'listItem').run()],['减少列表缩进',()=>editor.chain().focus().liftListItem(editor.isActive('taskItem')?'taskItem':'listItem').run()]]);}
  function palette(body,title,values,selected,apply){const group=el('div','palette-group');group.append(el('div','palette-label',title));const row=el('div','palette-row');for(const color of values){const b=button(title+' '+color,title+' '+color,()=>apply(color));b.className='color-swatch'+(selected?.toLowerCase()===color?' selected':'');b.style.setProperty('--swatch',color);b.setAttribute('aria-pressed',String(selected?.toLowerCase()===color));row.append(b)}group.append(row);body.append(group);}
  function colorPanel(trigger){openPanel('文字颜色与背景',trigger,(body,apply)=>{palette(body,'字体颜色',colors,editor.getAttributes('textStyle').color,value=>apply(()=>editor.chain().focus().setColor(value).run()));palette(body,'背景颜色',fills,editor.getAttributes('highlight').color,value=>apply(()=>editor.chain().focus().setHighlight({color:value}).run()));body.append(button('恢复默认','恢复默认颜色',()=>apply(()=>editor.chain().focus().unsetColor().unsetHighlight().run())));});}
  function field(body,label,id,value='',type='text'){const wrap=el('label','panel-field',label),input=el('input');input.id=id;input.type=type;input.value=value;wrap.append(input);body.append(wrap);return input;}
  function linkPanel(trigger){openPanel('编辑链接',trigger,(body,apply)=>{const input=field(body,'链接地址','link-url','');input.id='link-url';input.value=editor.getAttributes('link').href||'';input.placeholder='https://example.com';const error=el('p','field-error');error.setAttribute('role','alert');body.append(error);const row=el('div','panel-actions');const save=button('应用链接','应用链接',()=>{const value=input.value.trim();if(!validEditorLink(value)){error.textContent='请输入有效的 http://、https:// 或 mailto: 链接';input.setAttribute('aria-invalid','true');return;}apply(()=>editor.chain().focus().extendMarkRange('link').setLink({href:value}).run())});save.id='save-link';save.className='primary';row.append(button('移除链接','移除链接',()=>apply(()=>editor.chain().focus().extendMarkRange('link').unsetLink().run())),save);body.append(row);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save.click()}};input.focus();});}
  function tablePicker(trigger){openPanel('插入表格',trigger,(body,apply)=>{let rows=3,cols=3;const summary=el('div','table-summary');summary.append(el('span','','选择行列'));const size=el('strong');size.setAttribute('aria-live','polite');summary.append(size);body.append(summary);const grid=el('div','table-picker');grid.id='table-picker';grid.setAttribute('role','grid');grid.setAttribute('aria-label','表格尺寸，方向键选择，回车插入');const cells=[];const paint=(syncInputs=true)=>{size.textContent=cols+' × '+rows;for(const b of cells){const selected=+b.dataset.row<=rows&&+b.dataset.col<=cols;b.classList.toggle('selected',selected);b.setAttribute('aria-selected',String(selected));b.tabIndex=+b.dataset.row===Math.min(rows,9)&&+b.dataset.col===Math.min(cols,9)?0:-1}if(syncInputs){rowInput.value=rows;colInput.value=cols;}};const insert=()=>{const r=Number(rowInput.value),c=Number(colInput.value);if(!tableDimensions(r,c)){error.textContent='行数为 1–20，列数为 1–10，请输入整数';return;}apply(()=>editor.chain().focus().insertTable({rows:r,cols:c,withHeaderRow:true}).run());};for(let r=1;r<=9;r++)for(let c=1;c<=9;c++){const b=button('',c+' 列 '+r+' 行',()=>{rows=r;cols=c;paint();insert()});b.dataset.row=r;b.dataset.col=c;b.setAttribute('role','gridcell');b.onpointerenter=()=>{rows=r;cols=c;paint()};b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();cols=Math.max(1,Math.min(9,cols+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)));rows=Math.max(1,Math.min(9,rows+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)));paint();cells[(rows-1)*9+cols-1].focus();}else if(e.key==='Enter'){e.preventDefault();insert()}};cells.push(b);grid.append(b)}body.append(grid);const dimensions=el('div','table-dimensions');body.append(dimensions);const rowInput=field(dimensions,'行数','table-rows',rows,'number'),colInput=field(dimensions,'列数','table-cols',cols,'number');rowInput.min=colInput.min=1;rowInput.max=20;colInput.max=10;const error=el('p','field-error');error.setAttribute('role','alert');body.append(error);const confirm=button('插入表格','插入所选尺寸表格',insert);confirm.id='insert-table';confirm.className='primary';body.append(confirm);const syncDimensions=()=>{const r=Number(rowInput.value),c=Number(colInput.value);if(tableDimensions(r,c)){rows=r;cols=c;paint(false);error.textContent=''}else{size.textContent='—';for(const cell of cells){cell.classList.remove('selected');cell.setAttribute('aria-selected','false')}}};rowInput.oninput=colInput.oninput=syncDimensions;paint();cells[20].focus();});}
  function valuePanel(title,trigger,{label=title,value='',type='text',placeholder='',validate,onApply}){openPanel(title,trigger,(body,apply)=>{const input=field(body,label,'context-value',value,type);input.placeholder=placeholder;const error=el('p','field-error');error.setAttribute('role','alert');body.append(error);const save=button('应用','应用'+title,()=>{const message=validate?.(input.value);if(message){error.textContent=message;return}apply(()=>onApply(input.value))});save.className='primary';body.append(save);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save.click()}};input.focus();input.select();});}
  const typeIcon=el('span','format-icon');typeIcon.dataset.icon='type';
  const typeButton=button('','块类型',formatMenu);typeButton.className='format-button format-type';typeButton.append(typeIcon,el('i','format-caret'));
  const alignIcon=el('span','format-icon');alignIcon.dataset.icon='align';
  const alignButton=button('','缩进与对齐',alignment);alignButton.className='format-button';alignButton.append(alignIcon,el('i','format-caret'));
  bubble.append(typeButton,el('i','toolbar-divider'),alignButton,el('i','toolbar-divider'));
  const markButtons=[];
  for(const [iconName,title,command,name] of [['bold','粗体','toggleBold','bold'],['strike','删除线','toggleStrike','strike'],['italic','斜体','toggleItalic','italic'],['underline','下划线','toggleUnderline','underline']]){
    const mark=button('',title,()=>editor.chain().focus()[command]().run());mark.classList.add('format-button');mark.innerHTML=vendorIcon(iconName,{size:20});markButtons.push([mark,name]);bubble.append(mark);
  }
  const linkButton=button('','超链接',linkPanel);linkButton.className='format-button';linkButton.dataset.icon='link';linkButton.innerHTML=vendorIcon('link',{size:20});bubble.append(linkButton);
  const codeMark=button('','行内代码',()=>editor.chain().focus().toggleCode().run());codeMark.className='format-button';codeMark.dataset.icon='code';codeMark.innerHTML=vendorIcon('code',{size:20});markButtons.push([codeMark,'code']);bubble.append(codeMark);
  bubble.append(el('i','toolbar-divider'));
  const colorButton=button('','文字颜色与背景',colorPanel);colorButton.className='format-button format-color';colorButton.dataset.icon='textColor';colorButton.innerHTML=vendorIcon('textColor',{size:20})+'<i class="format-caret"></i>';bubble.append(colorButton);
  const tableSep=el('i','toolbar-divider');tableSep.hidden=true;bubble.append(tableSep);
  const tableGroup=el('span','format-table-group');tableGroup.hidden=true;
  const tBtn=(iconName,title,fn)=>{const b=button('',title,fn);b.className='format-button';b.innerHTML=vendorIcon(iconName,{size:20});b.hidden=true;tableGroup.append(b);return b};
  const mergeBtn=tBtn('mergeCells','合并选中单元格',()=>editor.chain().focus().mergeCells().run());
  const splitBtn=tBtn('splitCells','拆分单元格',()=>editor.chain().focus().splitCell().run());
  const cellColorBtn=tBtn('blockColor','单元格底色',b=>cellColorPanel(b));
  const deleteRowBtn=tBtn('deleteRow','删除选中的行',()=>editor.chain().focus().deleteRow().run());
  const deleteColBtn=tBtn('deleteColumn','删除选中的列',()=>editor.chain().focus().deleteColumn().run());
  bubble.append(tableGroup);
  const calloutSep=el('i','toolbar-divider');calloutSep.hidden=true;bubble.append(calloutSep);
  const calloutGroup=el('span','format-callout-group');calloutGroup.hidden=true;
  const cBtn=(iconName,title,fn)=>{const b=button('',title,fn);b.className='format-button';b.innerHTML=vendorIcon(iconName,{size:20});calloutGroup.append(b);return b};
  cBtn('callout','高亮块图标',b=>calloutIcon(b));
  cBtn('blockColor','高亮块颜色',b=>calloutColors(b));
  cBtn('textBody','转为正文',()=>editor.chain().focus().lift('callout').run());
  bubble.append(calloutGroup);
  bubble.append(el('i','toolbar-divider'));
  const moreButton=button('','更多格式',trigger=>menu('更多格式',trigger,[['清除文本格式',()=>editor.chain().focus().unsetAllMarks().run()],['撤销',()=>editor.chain().focus().undo().run()],['重做',()=>editor.chain().focus().redo().run()]]));moreButton.className='format-button';moreButton.dataset.icon='more';moreButton.innerHTML=vendorIcon('more',{size:20});bubble.append(moreButton);
  function targetFor(name){const {$from}=editor.state.selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type.name===name)return {pos:$from.before(d),node:$from.node(d),element:editor.view.nodeDOM($from.before(d))};const {from}=editor.state.selection,node=editor.state.doc.nodeAt(from);if(node?.type.name===name)return {pos:from,node,element:editor.view.nodeDOM(from)};return null;}
  function selectTarget(t){if(!t||editor.state.doc.nodeAt(t.pos)!==t.node||!canEdit())return false;if(t.node.isAtom&&t.node.type.spec.selectable!==false)editor.commands.setNodeSelection(t.pos);else editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(Math.min(t.pos+1,editor.state.doc.content.size)))));return true;}
  function updateTarget(t,attrs){if(!canEdit()||editor.state.doc.nodeAt(t.pos)!==t.node)return;editor.view.dispatch(editor.state.tr.setNodeMarkup(t.pos,undefined,{...t.node.attrs,...attrs}));}
  function codeLanguage(trigger,target=targetFor('codeBlock')){if(!target||!selectTarget(target))return;openPanel('代码语言',trigger,(body,apply)=>{const input=field(body,'搜索语言','language-search');input.placeholder='例如 javascript';const list=el('div');list.id='language-results';body.append(button('自动检测此段代码','自动检测代码语言',()=>apply(()=>updateTarget(target,{language:lowlight.highlightAuto(target.node.textContent).data?.language||'plaintext'}))),list);const render=()=>{list.replaceChildren();for(const language of ['plaintext',...lowlight.listLanguages()].filter(name=>name.toLowerCase().includes(input.value.toLowerCase()))){const b=button(language,'代码语言 '+language,()=>apply(()=>updateTarget(target,{language})));if(language===target.node.attrs.language)b.classList.add('selected');list.append(b)}if(!list.children.length)list.append(el('p','muted','没有匹配的语言'))};input.oninput=render;render();input.focus();});}
  function insertCallout(){
    if(editor.isActive('heading'))editor.chain().focus().setParagraph().run();
    editor.chain().focus().wrapIn('callout').run();
  }
  function calloutColors(trigger,target=targetFor('callout')){
    if(!target||!selectTarget(target))return;
    openPanel('高亮块颜色',trigger,(body,apply)=>{
      const presets=[['blue','蓝','#f2f7ff','#d8e6ff'],['green','绿','#effaf3','#c9ecd8'],['yellow','黄','#fffaeb','#f4e4ad'],['orange','橙','#fff6ec','#f6dcc0'],['red','红','#fff4f2','#f8d5cd'],['purple','紫','#f8f4ff','#e3d8fb'],['gray','灰','#f7f8fa','#e4e7ec']];
      const group=el('div','palette-group');group.append(el('div','palette-label','预设颜色'));
      const row=el('div','palette-row');
      for(const [token,label,bg,border] of presets){
        const b=button('',label+'高亮块',()=>apply(()=>updateTarget(target,{color:token,textColor:null,borderColor:null,backgroundColor:null})));
        b.className='callout-preset'+(target.node.attrs.color===token&&!target.node.attrs.backgroundColor?' selected':'');
        b.style.setProperty('--chip-bg',bg);b.style.setProperty('--chip-border',border);
        b.setAttribute('aria-pressed',String(b.classList.contains('selected')));
        row.append(b);
      }
      group.append(row);body.append(group);
      for(const [name,attr,values] of [['字体颜色','textColor',colors],['边框颜色','borderColor',borders],['填充颜色','backgroundColor',fills]])palette(body,name,values,target.node.attrs[attr],value=>apply(()=>updateTarget(target,{[attr]:value})));
      body.append(button('恢复默认','恢复高亮块默认样式',()=>apply(()=>updateTarget(target,{color:'blue',textColor:null,borderColor:null,backgroundColor:null}))));
    });
  }
  function calloutIcon(trigger,target=targetFor('callout')){if(!target||!selectTarget(target))return;openPanel('高亮块图标',trigger,(body,apply)=>{const icons=el('div','emoji-grid');for(const icon of ['💡','📌','✅','⚠️','🔖','📝','🎯','🚀','💬','❤️','⭐','🔥'])icons.append(button(icon,'使用图标 '+icon,()=>apply(()=>updateTarget(target,{icon}))));body.append(icons);const input=field(body,'自定义图标','callout-icon',target.node.attrs.icon||'');input.maxLength=8;body.append(button('应用图标','应用高亮块图标',()=>apply(()=>updateTarget(target,{icon:input.value.trim().slice(0,8)}))),button('移除图标','移除高亮块图标',()=>apply(()=>updateTarget(target,{icon:''}))));});}
  function buildContext(target){context.replaceChildren();const name=target?.node.type.name;if(!target)return;const add=(label,title,fn)=>context.append(button(label,title,b=>{if(selectTarget(target))fn(b)}));
    if(name==='callout'){
      if(!editor.state.selection.empty)return;
      const cBtn=(iconName,title,fn)=>{const b=button('',title,fn);b.className='context-icon';b.innerHTML=`<span class="ctx-ico">${vendorIcon(iconName,{size:16})}</span>`;context.append(b);return b};
      cBtn('callout','高亮块图标',b=>calloutIcon(b,target));
      cBtn('blockColor','高亮块颜色',b=>calloutColors(b,target));
      cBtn('textBody','转为正文',()=>editor.chain().focus().lift('callout').run());
    }
    else if(name==='table'){
      const ctxBtn=(iconName,title,fn,label='')=>{const b=button('',title,fn);b.className='context-icon';b.innerHTML=`<span class="ctx-ico">${vendorIcon(iconName,{size:16})}</span>${label?`<span class="ctx-label">${label}</span>`:''}`;context.append(b);return b};
      ctxBtn('addBelow','在下方插入行',()=>editor.chain().focus().addRowAfter().run(),'行');
      ctxBtn('plus','在右侧插入列',()=>editor.chain().focus().addColumnAfter().run(),'列');
      context.append(el('i','context-sep'));
      ctxBtn('mergeCells','合并选中单元格',()=>editor.chain().focus().mergeCells().run(),'合并');
      ctxBtn('splitCells','拆分单元格',()=>editor.chain().focus().splitCell().run(),'拆分');
      ctxBtn('blockColor','单元格底色',b=>cellColorPanel(b),'底色');
      context.append(el('i','context-sep'));
      const settings=button('','表格设置',b=>menu('表格设置',b,[
        ['删除当前行',()=>editor.chain().focus().deleteRow().run()],
        ['删除当前列',()=>editor.chain().focus().deleteColumn().run()],
        ['切换标题行',()=>editor.chain().focus().toggleHeaderRow().run()],
        ['切换标题列',()=>editor.chain().focus().toggleHeaderColumn().run()],
        ['顶端对齐',()=>editor.chain().focus().setCellAttribute('verticalAlign','top').run()],
        ['垂直居中',()=>editor.chain().focus().setCellAttribute('verticalAlign','middle').run()],
        ['底端对齐',()=>editor.chain().focus().setCellAttribute('verticalAlign','bottom').run()]
      ]));
      settings.className='context-icon';settings.innerHTML=`<span class="ctx-ico">${vendorIcon('tableMono',{size:16})}</span><i class="context-caret"></i>`;context.append(settings);
      const remove=button('','删除表格',()=>editor.chain().focus().deleteTable().run());remove.className='context-icon danger';remove.innerHTML=`<span class="ctx-ico">${vendorIcon('trash',{size:16})}</span>`;context.append(remove);
    }
    else if(name==='image'){context.append(button('裁剪','裁剪当前图片',onCrop),button('设为封面','将当前图片设为文档封面',onCover),button('图片描述','编辑图片描述',b=>valuePanel('图片描述',b,{value:target.node.attrs.alt||'',onApply:alt=>updateTarget(target,{alt})})));}
    else if(name==='columns'){for(const width of [30,50,70])context.append(button(width+' / '+(100-width),'左栏宽度 '+width+'%',()=>editor.chain().focus().setColumnWidth(width).run()));context.append(button('移至另一栏','将当前块移至另一栏',()=>editor.chain().focus().moveBlockToOtherColumn().run()),button('取消分栏','取消分栏并保留内容',()=>editor.chain().focus().unwrapColumns().run()));}
  }
  function refreshContext(){if(editor.state.selection instanceof CellSelection){context.hidden=true;return}if(!canEdit()||!editor.isFocused){if(!context.contains(document.activeElement)&&!panel)context.hidden=true;return;}let target;for(const name of ['codeBlock','callout','image','table','columns','listItem','taskItem']){target=targetFor(name);if(target)break;}const previousTarget=contextTarget;contextTarget=target;if(!target){context.hidden=true;return;}const selNow=editor.state.selection;const selMode=selNow instanceof CellSelection?(selNow.isRowSelection?.()?'row':selNow.isColSelection?.()?'col':'cells'):'text';
    const key=target.pos+':'+target.node.type.name+':'+selMode+':'+JSON.stringify(target.node.attrs);if(key!==contextKey||target.node!==previousTarget?.node){contextKey=key;buildContext(target)}const dom=target.element?.nodeType===1?target.element:null;const rect=dom?.getBoundingClientRect()||selectionRect();context.hidden=rect.bottom<75||rect.top>innerHeight-30||!context.children.length;if(context.hidden)return;if(target.node.type.name==='codeBlock'){context.style.width=Math.min(rect.width-14,innerWidth-24)+'px';const size=context.getBoundingClientRect();const p=floatingPosition({...rect,bottom:rect.top+4},size,{width:innerWidth,height:innerHeight},{gap:0});context.style.left=Math.max(8,rect.left+7)+'px';context.style.top=p.top+'px';}else{context.style.width='';position(context,rect,true)}}
  function refresh(){if(disposed||editor.isDestroyed)return;legacy.hidden=true;if(panel&&(!canEdit()||panel.snapshot.id!==getDocumentId()||panel.snapshot.doc!==editor.state.doc))closePanel();const selection=editor.state.selection;const inputFocused=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||document.activeElement?.closest?.('#drawer');const cellSelection=selection instanceof CellSelection;bubble.hidden=!canEdit()||selection.empty||suppressBubble||inputFocused||!$('#slash').hidden||!editor.isFocused&& !bubble.contains(document.activeElement)&&!panel;if(!bubble.hidden){typeIcon.innerHTML=blockGlyph();alignIcon.innerHTML=vendorIcon(currentAlignIcon(),{size:20});for(const [b,name] of markButtons){const active=editor.isActive(name);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}if(cellSelection){
    const rowSel=typeof selection.isRowSelection==='function'&&selection.isRowSelection();
    const colSel=typeof selection.isColSelection==='function'&&selection.isColSelection();
    tableSep.hidden=false;tableGroup.hidden=false;
    mergeBtn.hidden=!rowSel&&!colSel?false:true;splitBtn.hidden=mergeBtn.hidden;
    cellColorBtn.hidden=false;
    deleteRowBtn.hidden=!rowSel;deleteColBtn.hidden=!colSel;
  }else{tableSep.hidden=true;tableGroup.hidden=true}
  const inCallout=editor.isActive('callout');
  calloutSep.hidden=!inCallout;calloutGroup.hidden=!inCallout;
  const rect=selectionRect();if(rect.bottom<75||rect.top>innerHeight-30)bubble.hidden=true;else position(bubble,rect,true);}refreshContext();}
  function closeAll(){closePanel();bubble.hidden=context.hidden=true;suppressBubble=true;}
  function cellColorPanel(trigger){
    openPanel('单元格底色',trigger,(body,apply)=>{
      const grid=el('div','cell-color-grid');
      const tokens=[['gray','浅灰','#f2f3f5'],['blue','浅蓝','#e1eaff'],['green','浅绿','#d9f5d6'],['yellow','浅黄','#fff7c2'],['orange','浅橙','#ffeed5'],['red','浅红','#fde2e2'],['purple','浅紫','#ece2fe'],[null,'清除','']];
      for(const [token,label,color] of tokens){
        const b=button('',label,()=>apply(()=>editor.chain().focus().setCellAttribute('cellBg',token).run()));
        b.className='cell-color-swatch'+(token?'':' is-clear');
        if(color){const dot=el('span','cell-color-dot');dot.style.background=color;b.append(dot)}
        b.append(el('span','cell-color-label',label));
        grid.append(b);
      }
      body.append(grid);
    });
  }
  function openBlockMenu(target, options={}){
    const insertMode=options.mode==='insert';
    if(!canEdit())return;
    const t=target||(()=>{const {$from}=editor.state.selection;return $from.depth?{pos:$from.before(1),node:$from.node(1)}:null})();
    if(!t||!selectTarget(t))return;
    const trigger={getBoundingClientRect:()=>t.rect||editor.view.nodeDOM(t.pos)?.getBoundingClientRect()||selectionRect()};
    openPanel(insertMode?'插入内容':'内容块操作',trigger,(body,apply)=>{
      body.classList.add('block-menu');
      const popover=document.querySelector('#editor-popover');
      popover?.classList.add('block-popover');
      const grid=el('div','block-type-grid');
      const tile=(label,iconName,fn,active)=>{const b=button('',label,()=>apply(fn));b.className='type-tile'+(active?' selected':'');b.innerHTML=menuIcon(iconName,22);grid.append(b)};
      tile('一级标题','h1',()=>editor.chain().focus().setHeading({level:1}).run(),editor.isActive('heading',{level:1}));
      tile('二级标题','h2',()=>editor.chain().focus().setHeading({level:2}).run(),editor.isActive('heading',{level:2}));
      tile('三级标题','h3',()=>editor.chain().focus().setHeading({level:3}).run(),editor.isActive('heading',{level:3}));
      tile('四级标题','h4',()=>editor.chain().focus().setHeading({level:4}).run(),editor.isActive('heading',{level:4}));
      tile('有序列表','orderedList',()=>editor.chain().focus().toggleOrderedList().run(),editor.isActive('orderedList'));
      tile('无序列表','bulletList',()=>editor.chain().focus().toggleBulletList().run(),editor.isActive('bulletList'));
      tile('任务列表','taskList',()=>editor.chain().focus().toggleTaskList().run(),editor.isActive('taskList'));
      tile('代码块','codeBlock',()=>editor.chain().focus().toggleCodeBlock().run(),editor.isActive('codeBlock'));
      tile('引用','quote',()=>editor.chain().focus().toggleBlockquote().run(),editor.isActive('blockquote'));
      tile('高亮块','callout',()=>insertCallout(),editor.isActive('callout'));
      tile('分割线','divider',()=>editor.chain().focus().setHorizontalRule().run(),false);
      tile('表格','tableMono',()=>tablePicker(),false);
      body.append(grid);
      body.append(el('div','block-menu-section','常用'));
      const list=el('div','block-menu-list');
      const item=(label,iconName,fn,active,size=22)=>{const b=button('',label,()=>apply(fn));b.className='block-menu-item'+(active?' selected':'');b.innerHTML=`<span class="block-menu-icon">${menuIcon(iconName,size)}</span><span class="block-menu-label">${label}</span>`;list.append(b);return b};
      item('任务','taskColor',()=>editor.chain().focus().toggleTaskList().run(),editor.isActive('taskList'));
      item('图片','image',()=>$('#image').click(),false);
      item('视频或文件','attachment',()=>$('#attachment').click(),false);
      item('表格','tableColor',()=>tablePicker(),false);
      item('分栏','columns',()=>editor.chain().focus().insertColumns().run(),editor.isActive('columns'));
      item('高亮块','calloutColor',()=>insertCallout(),editor.isActive('callout'));
      item('公式','formula',()=>valuePanel('插入公式',null,{label:'LaTeX 公式',value:'E=mc^2',validate:v=>v.trim()?null:'请输入公式',onApply:latex=>editor.chain().focus().insertContent({type:'formula',attrs:{latex}}).run()}),false);
      body.append(list);
      if(!insertMode){
        body.append(el('hr'));        const row=(label,iconName,fn,chevron=false)=>{const b=button('',label,fn);b.className='menu-row';b.innerHTML=`<span class="menu-icon">${rowIcon(iconName,18)}</span><span class="menu-row-label">${label}</span>`+(chevron?`<span class="menu-chevron">${icon('chevronRight',{size:12})}</span>`:'');body.append(b);return b};        row('缩进和对齐','indentAlign',b=>alignment(b),true);        row('颜色','blockColor',b=>colorPanel(b),true);        body.append(el('hr'));        row('复制块','copy',()=>apply(()=>editor.chain().focus().insertContentAt(t.pos+t.node.nodeSize,t.node.toJSON()).run()));        row('剪切块','cut',()=>apply(()=>{try{navigator.clipboard?.writeText(t.node.textContent)}catch{}editor.chain().focus().deleteRange({from:t.pos,to:t.pos+t.node.nodeSize}).run()}));        row('删除块','trash',()=>apply(()=>editor.chain().focus().deleteRange({from:t.pos,to:t.pos+t.node.nodeSize}).run()));        body.append(el('hr'));        row('向上移动','moveUp',()=>apply(()=>moveBlock(t,-1)));        row('向下移动','moveDown',()=>apply(()=>moveBlock(t,1)));        row('在下方添加','addBelow',()=>apply(()=>onInsert(t)));      }
    });
  }
  function moveBlock(t,direction){moveBlockBy(editor,direction,{from:t.pos,canEdit});}

  const onPointer=e=>{if(!pop.contains(e.target)&&!bubble.contains(e.target)&&!context.contains(e.target)){closePanel();if(!editor.view.dom.contains(e.target))bubble.hidden=true;}if(editor.view.dom.contains(e.target))suppressBubble=false;};
  const onKey=e=>{if(e.key==='Escape'){if(!pop.hidden){e.preventDefault();closePanel(true)}bubble.hidden=true;suppressBubble=true;}if(e.altKey&&e.key==='F10'&&editor.isFocused&&!editor.state.selection.empty){e.preventDefault();suppressBubble=false;refresh();typeButton.focus()}};
  const onSelection=()=>{suppressBubble=false;refresh()};
  const onScroll=()=>{closePanel();refresh();tableTools.hide()};
  const onBlur=()=>setTimeout(refresh,0);
  let contextMenuEl=null;
  function closeContextMenu(){if(contextMenuEl){contextMenuEl.remove();contextMenuEl=null}}
  function openContextMenu(x,y,items){
    closeContextMenu();
    const box=el('div','editor-context-menu');box.setAttribute('role','menu');
    for(const item of items){
      if(item==='-'){box.append(el('hr'));continue}
      const [label,fn]=item;const b=button(label,label,()=>{closeContextMenu();if(canEdit())fn()});b.className='ctx-item';box.append(b);
    }
    document.body.append(box);
    const rect=box.getBoundingClientRect();
    box.style.left=Math.min(x,innerWidth-rect.width-8)+'px';
    box.style.top=Math.min(y,innerHeight-rect.height-8)+'px';
    contextMenuEl=box;
  }
  editor.view.dom.addEventListener('contextmenu',event=>{
    const cell=event.target.closest?.('td,th');if(!cell||!canEdit())return;
    event.preventDefault();
    openContextMenu(event.clientX,event.clientY,[
      ['在上方插入行',()=>editor.chain().focus().addRowBefore().run()],
      ['在下方插入行',()=>editor.chain().focus().addRowAfter().run()],
      ['在左侧插入列',()=>editor.chain().focus().addColumnBefore().run()],
      ['在右侧插入列',()=>editor.chain().focus().addColumnAfter().run()],
      '-',
      ['删除行',()=>editor.chain().focus().deleteRow().run()],
      ['删除列',()=>editor.chain().focus().deleteColumn().run()],
      '-',
      ['合并单元格',()=>editor.chain().focus().mergeCells().run()],
      ['拆分单元格',()=>editor.chain().focus().splitCell().run()],
      '-',
      ['删除表格',()=>editor.chain().focus().deleteTable().run()]
    ]);
  });
  document.addEventListener('pointerdown',event=>{if(contextMenuEl&&!contextMenuEl.contains(event.target))closeContextMenu()},true);
  window.addEventListener('blur',closeContextMenu);
  document.addEventListener('pointerdown',onPointer);document.addEventListener('keydown',onKey);$('.content-layout')?.addEventListener('scroll',onScroll);window.addEventListener('resize',onScroll);editor.on('selectionUpdate',onSelection);editor.on('transaction',refresh);editor.on('focus',refresh);editor.on('blur',onBlur);
  return {refresh,refreshContext,closeAll,openBlockMenu,tablePicker,linkPanel,colorPanel,codeLanguage,calloutColors,calloutIcon,valuePanel,feedback,destroy(){disposed=true;tableTools.destroy();listFold.remove();closeAll();pop.remove();context.remove();notice.remove();clearTimeout(noticeTimer);document.removeEventListener('pointerdown',onPointer);document.removeEventListener('keydown',onKey);$('.content-layout')?.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);editor.off('selectionUpdate',onSelection);editor.off('transaction',refresh);editor.off('focus',refresh);editor.off('blur',onBlur)}};
}
