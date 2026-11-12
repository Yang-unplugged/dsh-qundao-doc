import {Node, Extension, mergeAttributes} from '@tiptap/core';
import {Plugin, TextSelection} from '@tiptap/pm/state';
import Heading from '@tiptap/extension-heading';
import katex from 'katex';
export const HeadingNine=Heading.extend({renderHTML({node,HTMLAttributes}){const level=node.attrs.level;return ['h'+Math.min(level,6),mergeAttributes(HTMLAttributes,{'data-level':level}),0]},parseHTML(){return Array.from({length:9},(_,i)=>({tag:i<6?'h'+(i+1):`h6[data-level="${i+1}"]`,attrs:{level:i+1},priority:i>=6?60:50}))}}).configure({levels:[1,2,3,4,5,6,7,8,9]});
export const Callout=Node.create({name:'callout',group:'block',content:'block+',defining:true,addAttributes(){return {color:{default:'blue',parseHTML:e=>e.dataset.color},icon:{default:'💡',parseHTML:e=>e.dataset.icon},textColor:{default:null},borderColor:{default:null},backgroundColor:{default:null}}},parseHTML(){return [{tag:'aside[data-callout]'}]},renderHTML({node,HTMLAttributes}){return ['aside',mergeAttributes(HTMLAttributes,{'data-callout':'','data-color':node.attrs.color,'data-icon':node.attrs.icon,style:[['color',node.attrs.textColor],['border-color',node.attrs.borderColor],['background-color',node.attrs.backgroundColor]].filter(([k,v])=>/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v||'')).map(([k,v])=>k+':'+v).join(';')}),0]}});
export const Formula=Node.create({name:'formula',group:'inline',inline:true,atom:true,addAttributes(){return {latex:{default:'E=mc^2'}}},parseHTML(){return [{tag:'span[data-formula]',getAttrs:e=>({latex:e.dataset.formula})}]},renderHTML({node}){return ['span',{'data-formula':node.attrs.latex},node.attrs.latex]},addNodeView(){return ({node,editor,getPos})=>{let current=node;const dom=document.createElement('span');dom.className='formula';const render=()=>{try{dom.innerHTML=katex.renderToString(current.attrs.latex,{throwOnError:true,trust:false})}catch{dom.textContent='公式错误: '+current.attrs.latex;dom.classList.add('invalid')}};render();dom.addEventListener('dblclick',()=>{if(!editor.isEditable)return;const latex=prompt('编辑 LaTeX 公式',current.attrs.latex);if(latex!==null)editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(),undefined,{latex}))});return {dom,update(n){if(n.type.name!=='formula')return false;current=n;render();return true}}}}});


/* 图片 / 附件这类「块级原子节点」贴在表格单元格或文档末尾时，光标没有落点，
   导致同一格里只能粘一张图。插入后自动补一个空段落并把光标放进去。 */
export const TrailingParagraphAfterAtom=Extension.create({
 name:'trailingParagraphAfterAtom',
 addProseMirrorPlugins(){
  const schema=this.editor.schema;
  return [new Plugin({
   appendTransaction(transactions,oldState,newState){
    if(!transactions.some(tr=>tr.docChanged))return null;
    let target=null;
    newState.doc.descendants((node,pos)=>{
     if(target!==null)return false;
     if(!node.isBlock||!node.isAtom)return true;
     if(!['image','mediaAttachment','localCanvas'].includes(node.type.name))return true;
     const after=pos+node.nodeSize;
     const $after=newState.doc.resolve(after);
     if($after.parentOffset!==$after.parent.content.size)return true;
     if(!$after.parent.type.contentMatch.matchType(schema.nodes.paragraph))return true;
     target=after;
     return false;
    });
    if(target===null)return null;
    const tr=newState.tr.insert(target,schema.nodes.paragraph.create());
    try{tr.setSelection(TextSelection.create(tr.doc,target+1))}catch{}
    return tr;
   },
  })];
 },
});
