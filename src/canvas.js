import {Node} from '@tiptap/core';
import {closeHistory} from '@tiptap/pm/history';

const canvasRefreshers = new WeakMap();
// Silent read-only changes need an explicit UI refresh, never a document transaction.
export function refreshCanvasControls(editor) { for (const refresh of canvasRefreshers.get(editor) || []) refresh(); }

export const CANVAS_WIDTH = 800, CANVAS_HEIGHT = 480;
const types = ['rect', 'ellipse', 'diamond', 'text'];
const color = value => /^#[\da-f]{6}$/i.test(value || '') ? value : '#e8efff';
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const num = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export const emptyScene = () => ({version:1, shapes:[], edges:[]});
export function normalizeScene(input) {
  if (!input || input.version !== 1) return emptyScene();
  const ids = new Set();
  const shapes = (Array.isArray(input.shapes) ? input.shapes : []).slice(0,100).flatMap(s => {
    if (!s || !idOK(s.id) || ids.has(s.id) || !types.includes(s.type)) return [];
    ids.add(s.id);
    const width = num(s.width,140,40,400), height = num(s.height,70,30,240);
    return [{id:s.id,type:s.type,text:typeof s.text==='string'?s.text.slice(0,500):'', x:num(s.x,20,0,CANVAS_WIDTH-width),y:num(s.y,20,0,CANVAS_HEIGHT-height),width,height,fill:color(s.fill)}];
  });
  const edgeIds = new Set();
  const edges = (Array.isArray(input.edges) ? input.edges : []).slice(0,200).flatMap(e => {
    if (!e || !idOK(e.id) || edgeIds.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) return [];
    edgeIds.add(e.id);return [{id:e.id,from:e.from,to:e.to}];
  });
  return {version:1,shapes,edges};
}
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export const isValidScene = scene => {try {return canonical(scene) === canonical(normalizeScene(scene));} catch {return false;}};
function nextID(scene,prefix) { const ids = new Set([...scene.shapes,...scene.edges].map(s=>s.id));let n=1;while(ids.has(prefix+n))n++;return prefix+n; }
export function applySceneAction(input, action) {
  const scene=normalizeScene(input);const shape=scene.shapes.find(s=>s.id===action.id);
  if(action.type==='add' && scene.shapes.length<100) scene.shapes.push({id:nextID(scene,'s'),type:types.includes(action.shape)?action.shape:'rect',text:'新节点',x:40+(scene.shapes.length%5)*30,y:40+(scene.shapes.length%5)*30,width:140,height:70,fill:'#e8efff'});
  if(action.type==='update' && shape) Object.assign(shape,Object.fromEntries(Object.entries(action.patch||{}).filter(([k])=>['text','x','y','width','height','fill','type'].includes(k))));
  if(action.type==='delete') {scene.shapes=scene.shapes.filter(s=>s.id!==action.id);scene.edges=scene.edges.filter(e=>e.id!==action.id&&e.from!==action.id&&e.to!==action.id);}
  if(action.type==='connect' && scene.edges.length<200 && scene.shapes.some(s=>s.id===action.from)&&scene.shapes.some(s=>s.id===action.to)&&action.from!==action.to&&!scene.edges.some(e=>e.from===action.from&&e.to===action.to))scene.edges.push({id:nextID(scene,'e'),from:action.from,to:action.to});
  if(action.type==='child' && shape && scene.shapes.length<100 && scene.edges.length<200) {const id=nextID(scene,'s');scene.shapes.push({...shape,id,text:'子主题',x:shape.x+shape.width+50,y:shape.y+80});scene.edges.push({id:nextID(scene,'e'),from:shape.id,to:id});}
  return normalizeScene(scene);
}
const NS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs={}) {const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
export function renderSceneSVG(input,selected=null) {
  const scene=normalizeScene(input),svg=svgEl('svg',{viewBox:`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`,width:'100%',role:'group','aria-label':'本地可编辑画板'});
  svg.style.cssText='display:block;background:#fafbff;touch-action:none;max-height:480px;min-height:180px';
  for(const edge of scene.edges) {const a=scene.shapes.find(s=>s.id===edge.from),b=scene.shapes.find(s=>s.id===edge.to);const x1=a.x+a.width/2,y1=a.y+a.height/2,x2=b.x+b.width/2,y2=b.y+b.height/2;const group=svgEl('g',{'data-edge-id':edge.id,tabindex:0,role:'button','aria-label':`连线 ${a.text} 到 ${b.text}`});group.append(svgEl('line',{x1,y1,x2,y2,stroke:selected===edge.id?'#245be0':'#64748b','stroke-width':selected===edge.id?4:2}),svgEl('line',{x1,y1,x2,y2,stroke:'transparent','stroke-width':16}));svg.append(group);}
  for(const s of scene.shapes) {const g=svgEl('g',{'data-shape-id':s.id,tabindex:0,role:'button','aria-label':s.text||'空节点'});const attrs={fill:s.type==='text'?'transparent':s.fill,stroke:selected===s.id?'#245be0':'#64748b','stroke-width':selected===s.id?3:1.5};
    if(s.type==='ellipse')g.append(svgEl('ellipse',{...attrs,cx:s.x+s.width/2,cy:s.y+s.height/2,rx:s.width/2,ry:s.height/2}));
    else if(s.type==='diamond')g.append(svgEl('polygon',{...attrs,points:`${s.x+s.width/2},${s.y} ${s.x+s.width},${s.y+s.height/2} ${s.x+s.width/2},${s.y+s.height} ${s.x},${s.y+s.height/2}`}));
    else g.append(svgEl('rect',{...attrs,x:s.x,y:s.y,width:s.width,height:s.height,rx:s.type==='text'?0:8}));
    const title=svgEl('title');title.textContent=s.text;g.append(title);
    const chars=Math.max(3,Math.floor(s.width/14)),lines=s.text.split('\n').flatMap(line=>Array.from({length:Math.max(1,Math.ceil([...line].length/chars))},(_,i)=>[...line].slice(i*chars,(i+1)*chars).join('')));
    const visible=lines.slice(0,Math.max(1,Math.floor((s.height-12)/18)));const text=svgEl('text',{x:s.x+s.width/2,y:s.y+(s.height-visible.length*18)/2+14,'text-anchor':'middle','font-size':14,fill:'#172033','pointer-events':'none'});visible.forEach((line,i)=>{const span=svgEl('tspan',{x:s.x+s.width/2,dy:i?18:0});span.textContent=line+(i===visible.length-1&&lines.length>visible.length?'…':'');text.append(span)});g.append(text);svg.append(g);
  }
  return svg;
}
export const LocalCanvas = Node.create({
  name:'localCanvas',group:'block',atom:true,draggable:true,
  addAttributes(){return {scene:{default:emptyScene(),rendered:false}}},
  parseHTML(){return [{tag:'figure[data-local-canvas]',getAttrs:el=>{try{return {scene:normalizeScene(JSON.parse(el.getAttribute('data-scene')))}}catch{return {scene:emptyScene()}}}}]},
  renderHTML({node}) {const dom=document.createElement('figure');dom.setAttribute('data-local-canvas','1');const scene=normalizeScene(node.attrs.scene);dom.setAttribute('data-scene',JSON.stringify(scene));dom.append(renderSceneSVG(scene));return {dom};},
  addCommands(){return {
    insertLocalCanvas:()=>({commands,editor})=>editor.isEditable&&commands.insertContent({type:this.name,attrs:{scene:emptyScene()}}),
    canvasAction:(pos,action)=>({state,dispatch,editor})=>{if(!editor.isEditable)return false;const node=state.doc.nodeAt(pos);if(node?.type.name!==this.name)return false;const scene=applySceneAction(node.attrs.scene,action);if(JSON.stringify(scene)===JSON.stringify(node.attrs.scene))return false;if(dispatch)dispatch(closeHistory(state.tr).setNodeMarkup(pos,undefined,{...node.attrs,scene}));return true;}
  }},
  addNodeView(){return ({node,editor,getPos})=>{
    let current=node,selected=null,drag=null,svg,panelKey=null;
    const dom=document.createElement('section');dom.className='local-canvas';dom.contentEditable='false';dom.style.cssText='border:1px solid #cbd5e1;border-radius:10px;padding:10px;margin:16px 0';
    const toolbar=document.createElement('div'),stage=document.createElement('div'),panel=document.createElement('div'),hint=document.createElement('small');toolbar.style.cssText=panel.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0';hint.textContent='本地画板 · 选择节点后拖动或用方向键移动；字段可修改文字与尺寸。连线使用下方目标选择。';dom.append(toolbar,stage,panel,hint);
    const scene=()=>normalizeScene(current.attrs.scene);
    const act=action=>{const pos=getPos();if(typeof pos==='number'&&editor.isEditable)editor.commands.canvasAction(pos,action)};
    function button(parent,label,fn,disabled=false){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.canvasDisabled=String(disabled);b.disabled=disabled||!editor.isEditable;b.onclick=fn;parent.append(b);return b;}
    function draw(){svg=renderSceneSVG(scene(),selected);stage.replaceChildren(svg);svg.addEventListener('pointerdown',startDrag);svg.addEventListener('keydown',key);svg.addEventListener('click',e=>{const hit=e.target.closest('[data-shape-id],[data-edge-id]');if(!hit){selected=null;draw();controls();}});}
    function controls(){if(!toolbar.childElementCount){[['rect','矩形'],['ellipse','椭圆'],['diamond','菱形'],['text','文字']].forEach(([shape,label])=>button(toolbar,label,()=>act({type:'add',shape}),scene().shapes.length>=100));button(toolbar,'撤销',()=>editor.commands.undo(),!editor.can().undo());button(toolbar,'重做',()=>editor.commands.redo(),!editor.can().redo());}
      const key=JSON.stringify([selected,scene().shapes.map(s=>s.id)]);if(panelKey===key){for(const input of panel.querySelectorAll('[data-canvas-field]')){const s=scene().shapes.find(s=>s.id===selected);if(s&&document.activeElement!==input)input.value=s[input.dataset.canvasField];}for(const option of panel.querySelectorAll('option')){const s=scene().shapes.find(s=>s.id===option.value);if(s)option.textContent=s.text.slice(0,30)||s.id;}refreshDisabled();return;}panelKey=key;panel.replaceChildren();
      const s=scene().shapes.find(s=>s.id===selected);if(selected)button(panel,'删除所选',()=>{act({type:'delete',id:selected});selected=null;draw();controls()});if(!s)return;
      for(const [key,label] of [['text','文字'],['x','X'],['y','Y'],['width','宽'],['height','高'],['fill','颜色']]){const wrap=document.createElement('label');wrap.textContent=label+' ';const input=document.createElement(key==='text'?'textarea':'input');input.dataset.canvasField=key;input.setAttribute('aria-label','画板节点'+label);input.value=s[key];input.disabled=!editor.isEditable;if(key==='text'){input.maxLength=500;input.rows=2;}else{input.type=key==='fill'?'color':'number';input.style.width='68px';if(key!=='fill'){input.step='1';input.min=key==='width'?'40':key==='height'?'30':'0';input.max=key==='width'?'400':key==='height'?'240':key==='x'?String(800-s.width):String(480-s.height);}}input.onchange=()=>act({type:'update',id:selected,patch:{[key]:['text','fill'].includes(key)?input.value:Number(input.value)}});wrap.append(input);panel.append(wrap);}
      const select=document.createElement('select');select.setAttribute('aria-label','连线目标');select.disabled=!editor.isEditable;for(const target of scene().shapes.filter(t=>t.id!==s.id)){const option=document.createElement('option');option.value=target.id;option.textContent=target.text.slice(0,30)||target.id;select.append(option);}panel.append(select);button(panel,'连接',()=>act({type:'connect',from:s.id,to:select.value}),!select.options.length);button(panel,'添加子主题',()=>act({type:'child',id:s.id}),scene().shapes.length>=100);
    }
    function startDrag(event){const hit=event.target.closest('[data-shape-id],[data-edge-id]');if(!hit)return;selected=hit.getAttribute('data-shape-id')||hit.getAttribute('data-edge-id');const s=scene().shapes.find(s=>s.id===selected);if(!editor.isEditable||!s){draw();controls();return;}if(event.button!==0)return;event.preventDefault();const rect=svg.getBoundingClientRect();if(!rect.width||!rect.height)return;drag={id:s.id,x:s.x,y:s.y,startX:event.clientX,startY:event.clientY,scale:Math.min(rect.width/800,rect.height/480),preview:scene()};draw();controls();window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);}
    function move(event){if(!drag)return;drag.preview=applySceneAction(scene(),{type:'update',id:drag.id,patch:{x:drag.x+(event.clientX-drag.startX)/drag.scale,y:drag.y+(event.clientY-drag.startY)/drag.scale}});stage.replaceChildren(renderSceneSVG(drag.preview,selected));}
    function clear(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);}
    function end(){if(!drag)return;const s=drag.preview.shapes.find(s=>s.id===drag.id),id=drag.id;drag=null;clear();act({type:'update',id,patch:{x:s.x,y:s.y}});draw();controls();}
    function cancel(){drag=null;clear();draw();controls();}
    function key(event){const hit=event.target.closest('[data-shape-id],[data-edge-id]');if(hit)selected=hit.getAttribute('data-shape-id')||hit.getAttribute('data-edge-id');if(!selected||!editor.isEditable)return;const s=scene().shapes.find(s=>s.id===selected);if(event.key==='Enter'||event.key===' '){event.preventDefault();draw();controls();panel.querySelector('textarea')?.focus();return;}if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();act({type:'delete',id:selected});selected=null;draw();controls();return;}const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(s&&delta){event.preventDefault();act({type:'update',id:s.id,patch:{x:s.x+delta[0]*(event.shiftKey?10:1),y:s.y+delta[1]*(event.shiftKey?10:1)}});stage.querySelector(`[data-shape-id="${s.id}"]`)?.focus();}}
    function refreshDisabled(){for(const el of dom.querySelectorAll('button,input,textarea,select')){let disabled=el.dataset.canvasDisabled==='true';if(el.tagName==='BUTTON'){if(el.textContent==='撤销')disabled=!editor.can().undo();else if(el.textContent==='重做')disabled=!editor.can().redo();else if(['矩形','椭圆','菱形','文字'].includes(el.textContent))disabled=scene().shapes.length>=100;}el.disabled=!editor.isEditable||disabled;}}
    const onTransaction=()=>refreshDisabled();if(!canvasRefreshers.has(editor))canvasRefreshers.set(editor,new Set());canvasRefreshers.get(editor).add(onTransaction);editor.on('transaction',onTransaction);editor.on('update',onTransaction);draw();controls();return {dom,stopEvent:()=>true,ignoreMutation:()=>true,update(n){if(n.type.name!=='localCanvas')return false;if(n===current)return true;current=n;if(!scene().shapes.some(s=>s.id===selected)&&!scene().edges.some(e=>e.id===selected))selected=null;draw();controls();return true;},destroy(){clear();canvasRefreshers.get(editor)?.delete(onTransaction);editor.off('transaction',onTransaction);editor.off('update',onTransaction)}};
  }}
});
