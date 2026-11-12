/* 表格交互：行列交界处的悬浮「＋」、插入线、行高拖拽、行/列选择手柄 */
import {CellSelection} from '@tiptap/pm/tables';
import {vendorIcon} from './icons-vendor.js';

const el=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n};
const NEAR=9;

export function installTableTools({editor,canEdit}){
  const body=document.body;
  const mk=(cls,html,attrs={})=>{const b=el('button',cls);b.type='button';b.innerHTML=html;Object.entries(attrs).forEach(([k,v])=>b.setAttribute(k,v));b.hidden=true;body.append(b);return b};
  const mkLine=cls=>{const d=document.createElement('div');d.className=cls;d.setAttribute('aria-hidden','true');d.hidden=true;body.append(d);return d};
  const rowLine=mkLine('table-line table-row-line');
  const colLine=mkLine('table-line table-col-line');
  const rowPlus=mk('table-insert table-row-insert',vendorIcon('plus',{size:12}),{'aria-label':'在此插入行','title':'插入行'});
  const colPlus=mk('table-insert table-col-insert',vendorIcon('plus',{size:12}),{'aria-label':'在此插入列','title':'插入列'});
  const rowHandle=mk('table-handle table-row-handle',vendorIcon('drag',{size:12}),{'aria-label':'选择整行','title':'选择整行'});
  const colHandle=mk('table-handle table-col-handle',vendorIcon('drag',{size:12}),{'aria-label':'选择整列','title':'选择整列'});
  const nodes=[rowLine,colLine,rowPlus,colPlus,rowHandle,colHandle];
  let tableEl=null,data=null,rowIndex=-1,colIndex=-1,rowBoundary=-1,colBoundary=-1,rowEdges=[],colEdges=[],drag=null;

  const hide=()=>{nodes.forEach(n=>{n.hidden=true});tableEl=null;data=null;rowBoundary=-1;colBoundary=-1;};
  const place=(node,x,y,w,h)=>{node.hidden=false;node.style.left=`${Math.round(x)}px`;node.style.top=`${Math.round(y)}px`;if(w!==undefined)node.style.width=`${Math.round(w)}px`;if(h!==undefined)node.style.height=`${Math.round(h)}px`};

  function tableData(target){
    let found=null;
    editor.state.doc.descendants((node,pos)=>{
      if(found)return;
      if(node.type.name!=='table')return;
      const dom=editor.view.nodeDOM(pos);
      if(dom&&(dom===target||dom.contains?.(target)))found={node,pos};
    });
    if(!found)return null;
    const rows=[];
    found.node.forEach((row,rowOffset)=>{
      const rowPos=found.pos+1+rowOffset,cells=[];
      row.forEach((cell,cellOffset)=>{cells.push({pos:rowPos+1+cellOffset,node:cell})});
      rows.push({pos:rowPos,node:row,cells});
    });
    return {node:found.node,pos:found.pos,rows,el:target};
  }

  function onMove(event){
    if(!canEdit()||drag||!editor.isEditable){hide();return}
    const target=event.target;
    const inUi=target?.closest?.('.table-handle,.table-insert,.table-line,.table-row-resize');
    const table=target?.closest?.('table');
    if(!table&&!inUi&&tableEl){
      const r=tableEl.getBoundingClientRect();
      if(event.clientX>=r.left-40&&event.clientX<=r.right+40&&event.clientY>=r.top-40&&event.clientY<=r.bottom+40)return;
    }
    if(!table){if(!inUi)hide();return}
    if(tableEl!==table){tableEl=table;data=tableData(table);if(!data){hide();return}}
    if(!data)return;
    const rect=table.getBoundingClientRect();
    const x=event.clientX,y=event.clientY;

    // 行边界：首行顶边 + 每行底边
    rowEdges=[];
    [...table.rows].forEach((tr,i)=>{const rr=tr.getBoundingClientRect();if(i===0)rowEdges.push(rr.top);rowEdges.push(rr.bottom)});
    let rb=-1,rd=NEAR+1;
    rowEdges.forEach((by,i)=>{const d=Math.abs(y-by);if(d<rd){rd=d;rb=i}});
    rowBoundary=rd<=NEAR?rb:-1;

    // 列边界：所有单元格的左右边去重
    const xs=new Set();
    [...table.rows].forEach(tr=>[...tr.cells].forEach(cell=>{const r=cell.getBoundingClientRect();xs.add(Math.round(r.left));xs.add(Math.round(r.right))}));
    colEdges=[...xs].sort((a,b)=>a-b);
    let cb=-1,cd=NEAR+1;
    colEdges.forEach((cx,i)=>{const d=Math.abs(x-cx);if(d<cd){cd=d;cb=i}});
    colBoundary=cd<=NEAR?cb:-1;

    if(rowBoundary>=0){
      const by=rowEdges[rowBoundary];
      place(rowLine,rect.left,by-1,rect.width,2);rowLine.style.cursor='row-resize';
      place(rowPlus,rect.left-26,by-9,18,18);
    }else{rowLine.hidden=true;rowPlus.hidden=true}
    if(colBoundary>=0){
      const cx=colEdges[colBoundary];
      place(colLine,cx-1,rect.top,2,rect.height);colLine.style.cursor='col-resize';
      place(colPlus,cx-9,rect.top-26,18,18);
    }else{colLine.hidden=true;colPlus.hidden=true}

    // 行/列选择手柄（不在边界上时显示）
    if(rowBoundary<0){
      const tr=target.closest?.('tr');
      if(tr&&table.rows){
        rowIndex=Array.from(table.rows).indexOf(tr);
        const rr=tr.getBoundingClientRect();
        place(rowHandle,rect.left-24,rr.top+rr.height/2-10,20,20);
      }else rowHandle.hidden=true;
    }else rowHandle.hidden=true;
    if(colBoundary<0){
      const cell=target.closest?.('td,th');
      if(cell){
        colIndex=cell.cellIndex;
        const cr=cell.getBoundingClientRect();
        place(colHandle,cr.left+cr.width/2-10,rect.top-24,20,20);
      }else colHandle.hidden=true;
    }else colHandle.hidden=true;
  }

  function cellAt(rowIdx,colIdx){const row=data?.rows[rowIdx];if(!row)return null;return row.cells[Math.min(colIdx,row.cells.length-1)]||null}
  function focusCell(cell){if(!cell)return false;editor.chain().focus().setTextSelection(cell.pos+1).run();return true}

  function insertRow(){
    if(!data||rowBoundary<0)return;
    const above=rowBoundary-1; // 行边界 0 = 表格顶边
    if(above<0){const cell=cellAt(0,0);if(focusCell(cell))editor.chain().focus().addRowBefore().run()}
    else{const cell=cellAt(above,0);if(focusCell(cell))editor.chain().focus().addRowAfter().run()}
    hide();
  }
  function insertCol(){
    if(!data||colBoundary<0||!colEdges.length)return;
    const rowEl=data.el.rows[0];if(!rowEl)return;
    const cells=[...rowEl.cells];
    // 找到右边界等于当前列边界的单元格
    let index=-1;
    cells.forEach((cell,i)=>{const r=cell.getBoundingClientRect();if(Math.abs(Math.round(r.right)-colEdges[colBoundary])<=1)index=i});
    if(index<0){
      if(colBoundary===0)index=0;
      else{let best=-1,dist=1e9;cells.forEach((cell,i)=>{const r=cell.getBoundingClientRect();const d=Math.abs(Math.round(r.right)-colEdges[colBoundary]);if(d<dist){dist=d;best=i}});index=best}
    }
    const cell=data.rows[0]?.cells[index]||cellAt(0,0);
    const before=colBoundary===0;
    if(focusCell(cell))editor.chain().focus()[before?'addColumnBefore':'addColumnAfter']().run();
    hide();
  }

  function selectRow(){if(rowIndex>=0&&data&&tableEl){const row=data.rows[rowIndex];if(!row||!row.cells.length)return;try{const sel=CellSelection.create(editor.state.doc,row.cells[0].pos,row.cells[row.cells.length-1].pos);editor.view.dispatch(editor.state.tr.setSelection(sel));editor.commands.focus();}catch{}}}
  function selectCol(){if(colIndex>=0&&data){const top=cellAt(0,colIndex),bottom=cellAt(data.rows.length-1,colIndex);if(!top||!bottom)return;try{const sel=CellSelection.create(editor.state.doc,top.pos,bottom.pos);editor.view.dispatch(editor.state.tr.setSelection(sel));editor.commands.focus();}catch{}}}

  function startRowResize(event){
    if(!data||rowBoundary<1||!tableEl)return;
    const rowIdx=rowBoundary-1;
    const row=data.rows[rowIdx];if(!row)return;
    const tr=tableEl.rows[rowIdx];const rect=tr?.getBoundingClientRect();
    drag={rowPos:row.pos,startY:event.clientY,startH:rect?rect.height:32};
    event.preventDefault();
    window.addEventListener('pointermove',onResizeMove);
    window.addEventListener('pointerup',endResize,{once:true});
  }
  function onResizeMove(event){
    if(!drag)return;
    const height=Math.max(24,Math.round(drag.startH+(event.clientY-drag.startY)));
    const row=editor.state.doc.nodeAt(drag.rowPos);if(!row)return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(drag.rowPos,undefined,{...row.attrs,rowHeight:height}));
  }
  function endResize(){drag=null;window.removeEventListener('pointermove',onResizeMove)}

  rowPlus.addEventListener('pointerdown',e=>e.preventDefault());
  colPlus.addEventListener('pointerdown',e=>e.preventDefault());
  rowHandle.addEventListener('pointerdown',e=>e.preventDefault());
  colHandle.addEventListener('pointerdown',e=>e.preventDefault());
  rowLine.addEventListener('pointerdown',startRowResize);
  rowPlus.addEventListener('click',insertRow);
  colPlus.addEventListener('click',insertCol);
  rowHandle.addEventListener('click',selectRow);
  colHandle.addEventListener('click',selectCol);

  const editorRoot=editor.view.dom;
  document.addEventListener('pointermove',onMove);
  const onLeave=()=>{if(!drag)hide()};
  const contentRoot=document.querySelector('.content-layout');
  contentRoot?.addEventListener('scroll',onLeave,{passive:true});
  const onBlur=()=>{setTimeout(()=>{if(!editorRoot.contains(document.activeElement)&&!drag)hide()},0)};
  editor.on('blur',onBlur);

  return {hide,destroy(){
    nodes.forEach(n=>n.remove());
    document.removeEventListener('pointermove',onMove);
    contentRoot?.removeEventListener('scroll',onLeave);
    editor.off('blur',onBlur);
    endResize();
  }};
}
