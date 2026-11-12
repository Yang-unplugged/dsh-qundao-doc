/** Literal in-document text search. Text does not span paragraphs or inline atoms. */
export function findTextMatches(doc, query, {caseSensitive=false,limit=5000}={}) {
  if(typeof query!=='string'||!query.length||query.length>1000)return [];
  const results=[],needle=caseSensitive?query:query.toLocaleLowerCase();
  doc.descendants((node,pos)=>{if(results.length>=limit)return false;if(!node.isTextblock)return true;
    let text='';node.forEach(child=>{text+=child.isText?child.text:'\ufffc'.repeat(child.nodeSize)});
    const haystack=caseSensitive?text:text.toLocaleLowerCase();
    // Case conversions that change UTF-16 length cannot safely map back to document positions.
    if(haystack.length!==text.length||needle.length!==query.length)return false;
    let offset=0;while(results.length<limit){const at=haystack.indexOf(needle,offset);if(at<0)break;if(!text.slice(at,at+query.length).includes('\ufffc'))results.push({from:pos+1+at,to:pos+1+at+query.length});offset=at+Math.max(1,query.length)}return false;
  });return results;
}
export function replaceTextMatches(editor,query,replacement,{caseSensitive=false,index=null}={}) {
  if(!editor.isEditable||typeof replacement!=='string'||replacement.length>10000||/[\r\n]/.test(replacement))return false;
  const matches=findTextMatches(editor.state.doc,query,{caseSensitive});if(!matches.length)return false;
  const selected=index===null?matches:(Number.isInteger(index)&&matches[index]?[matches[index]]:[]);if(!selected.length)return false;
  const tr=editor.state.tr;for(const range of [...selected].reverse())tr.insertText(replacement,range.from,range.to);editor.view.dispatch(tr);return selected.length;
}
export function openFindReplace(editor){
  const existing=document.querySelector('.local-find-replace');if(existing){existing.querySelector('input').focus();return {close:()=>existing.remove()}}
  const box=document.createElement('section');box.className='local-find-replace';box.setAttribute('role','dialog');box.setAttribute('aria-label','查找与替换');box.style.cssText='position:fixed;right:24px;top:80px;width:300px;padding:16px;background:white;border:1px solid #ddd;border-radius:8px;box-shadow:0 8px 30px #0002;z-index:2000;font:14px system-ui;color:#222';
  const heading=document.createElement('strong');heading.textContent='查找与替换';const query=document.createElement('input'),replacement=document.createElement('input');query.placeholder='查找文字';query.setAttribute('aria-label','查找文字');replacement.placeholder='替换为';replacement.setAttribute('aria-label','替换文字');for(const input of [query,replacement])input.style.cssText='display:block;width:100%;box-sizing:border-box;margin-top:10px;padding:8px;border:1px solid #ddd';
  const label=document.createElement('label'),caseInput=document.createElement('input');caseInput.type='checkbox';label.append(caseInput,document.createTextNode(' 区分大小写'));label.style.cssText='display:block;margin:10px 0';const status=document.createElement('p');status.setAttribute('role','status');let index=0,closed=false;
  const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.style.cssText='margin:3px;padding:6px 8px';b.onclick=fn;return b};
  const matches=()=>findTextMatches(editor.state.doc,query.value,{caseSensitive:caseInput.checked});
  const update=(select=false)=>{const all=matches();index=Math.min(index,Math.max(0,all.length-1));status.textContent=all.length?`${index+1} / ${all.length}${all.length===5000?'（最多显示5000项）':''}`:'没有匹配项';if(select&&all[index])editor.commands.setTextSelection(all[index]);replace.disabled=replaceAll.disabled=!editor.isEditable||!all.length};
  const previous=button('上一个',()=>{const n=matches().length;if(n){index=(index-1+n)%n;update(true)}}),next=button('下一个',()=>{const n=matches().length;if(n){index=(index+1)%n;update(true)}});
  const doReplace=all=>{const count=replaceTextMatches(editor,query.value,replacement.value,{caseSensitive:caseInput.checked,index:all?null:index});if(count===false)status.textContent='未替换：请检查只读状态或输入（不支持换行）';else{update();status.textContent=`已替换 ${count} 处；可撤销`}};
  const replace=button('替换此处',()=>doReplace(false)),replaceAll=button('全部替换',()=>doReplace(true));
  const previousFocus=document.activeElement;function close(){if(closed)return;closed=true;editor.off('update',onUpdate);document.removeEventListener('keydown',onKey,true);box.remove();previousFocus?.focus?.()}
  const onUpdate=()=>update(),onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}};
  query.oninput=()=>{index=0;update(true)};caseInput.onchange=()=>{index=0;update(true)};query.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();next.click()}};
  box.append(heading,query,replacement,label,status,previous,next,replace,replaceAll,button('关闭',close));document.body.append(box);editor.on('update',onUpdate);document.addEventListener('keydown',onKey,true);update();query.focus();return {close};
}
