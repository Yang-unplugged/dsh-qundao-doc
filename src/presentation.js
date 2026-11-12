/** Local read-only presentation. Never changes document content or editor state. */
export function openLocalPresentation(editor, {title='文档演示',mode='slides'}={}) {
  if(!['slides','scroll'].includes(mode))throw new Error('Unsupported presentation mode');
  const previous=document.activeElement, overlay=document.createElement('section');
  overlay.className='local-presentation';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',title);
  const style=document.createElement('style');style.textContent=`.local-presentation{position:fixed;inset:0;background:#fff;z-index:10000;color:#1f2329;display:flex;flex-direction:column;font:16px/1.8 system-ui,sans-serif}.local-presentation header{display:flex;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid #e5e7eb;flex-shrink:0}.local-presentation header strong{margin-right:auto}.local-presentation button{border:1px solid #dfe2e7;background:#fff;border-radius:6px;padding:6px 12px;color:#333;cursor:pointer}.local-presentation button:focus-visible{outline:2px solid #3370ff}.local-presentation button:disabled{opacity:.4;cursor:default}.local-presentation main{overflow:auto;flex:1;padding:40px max(24px,calc((100vw - 960px)/2));font-size:20px}.local-presentation main h1{font-size:38px}.local-presentation main h2{font-size:30px}.local-presentation main img,.local-presentation main video{max-width:100%;height:auto}.local-presentation main pre{white-space:pre-wrap;font-size:16px;background:#f5f6f7;padding:20px;border-radius:8px}.local-presentation main table{border-collapse:collapse;width:100%}.local-presentation main td,.local-presentation main th{border:1px solid #ccd1da;padding:8px}.local-presentation [data-slide][hidden]{display:none}.local-presentation aside[data-callout]{padding:18px;border:1px solid #b3c9ff;background:#edf3ff;border-radius:8px}.local-presentation [data-notice]{font-size:12px;color:#8f959e}.local-presentation footer{text-align:center;padding:10px;border-top:1px solid #eee;font-size:12px;color:#8f959e}`;
  const header=document.createElement('header'),label=document.createElement('strong'),notice=document.createElement('span');label.textContent=title;notice.dataset.notice='';
  const make=(text,aria,fn)=>{const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',aria);b.onclick=fn;return b};
  let index=0,closed=false;const main=document.createElement('main'),footer=document.createElement('footer');
  main.setAttribute('tabindex','0');const source=editor.view.dom.cloneNode(true);source.removeAttribute('contenteditable');source.removeAttribute('tabindex');source.className='';
  source.querySelectorAll('[contenteditable]').forEach(el=>el.removeAttribute('contenteditable'));
  source.querySelectorAll('button,select,textarea,.column-resize-handle,[data-editor-control]').forEach(el=>el.remove());
  source.querySelectorAll('input').forEach(el=>{if(el.type==='checkbox')el.disabled=true;else el.remove()});
  const slides=[];let slide=document.createElement('section');slide.dataset.slide='';
  for(const node of [...source.childNodes]){if(node.nodeType===1&&/H[12]/.test(node.tagName)&&slide.childNodes.length){slides.push(slide);slide=document.createElement('section');slide.dataset.slide=''}slide.append(node)}
  if(slide.childNodes.length||!slides.length)slides.push(slide);
  slides.forEach(s=>main.append(s));
  const render=()=>{slides.forEach((s,i)=>{s.hidden=mode==='slides'&&i!==index});back.disabled=mode==='scroll'||index===0;next.disabled=mode==='scroll'||index===slides.length-1;footer.textContent=mode==='slides'?`${index+1} / ${slides.length} · ← → 切换 · Esc 退出`:'滚动阅读 · Esc 退出';main.scrollTop=0};
  const go=delta=>{index=Math.max(0,Math.min(slides.length-1,index+delta));render()};
  function close(){if(closed)return;closed=true;document.removeEventListener('keydown',onKey,true);overlay.remove();if(document.fullscreenElement===overlay)Promise.resolve(document.exitFullscreen?.()).catch(()=>{});previous?.focus?.()}
  const back=make('上一页','上一页',()=>go(-1)),next=make('下一页','下一页',()=>go(1));
  const toggle=make(mode==='slides'?'滚动模式':'分页模式','切换演示模式',()=>{mode=mode==='slides'?'scroll':'slides';toggle.textContent=mode==='slides'?'滚动模式':'分页模式';render()});
  const fullscreen=make('全屏','进入全屏',async()=>{try{if(!overlay.requestFullscreen)throw new Error('unavailable');await overlay.requestFullscreen();notice.textContent=''}catch{notice.textContent='全屏不可用，仍可在窗口内演示'}});
  const exit=make('退出','退出演示',close);
  function onKey(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}else if(mode==='slides'&&['ArrowRight','PageDown','ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();go(['ArrowRight','PageDown'].includes(event.key)?1:-1)}else if(event.key==='Tab'){const focusable=[...overlay.querySelectorAll('button:not([disabled]),main')];const current=focusable.indexOf(document.activeElement);if(event.shiftKey&&current<=0){event.preventDefault();focusable.at(-1).focus()}else if(!event.shiftKey&&(current===focusable.length-1||current<0)){event.preventDefault();focusable[0].focus()}}}
  header.append(label,notice,back,next,toggle,fullscreen,exit);overlay.append(style,header,main,footer);document.body.append(overlay);document.addEventListener('keydown',onKey,true);render();exit.focus();return {close,element:overlay};
}
