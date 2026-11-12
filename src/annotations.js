import { Extension, Mark, Node } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';

// Deliberately a local, single-author workflow. No account or notification side effects.
export const LOCAL_AUTHOR = '我（本地）';
const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const plainBody = value => typeof value === 'string' && value.trim() && value.length <= 10000 ? value.trim() : null;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const validEntry = e => e && validId(e.id) && e.author === LOCAL_AUTHOR && typeof e.body === 'string' && !!e.body.trim() && e.body.length <= 10000 && typeof e.createdAt === 'string' && e.createdAt.length <= 80;
const validThread = t => t && validId(t.id) && typeof t.resolved === 'boolean' && Array.isArray(t.entries) && t.entries.length > 0 && t.entries.length <= 500 && t.entries.every(validEntry);
const validSuggestion = a => a && validId(a.id) && a.author === LOCAL_AUTHOR && typeof a.before === 'string' && typeof a.after === 'string' && a.before.length <= 10000 && a.after.length <= 10000 && a.before !== a.after && !/[\r\n]/.test(a.before + a.after) && typeof a.createdAt === 'string' && a.createdAt.length <= 80;
const threadsOf = doc => Array.isArray(doc.attrs.localComments) ? doc.attrs.localComments.filter(validThread).slice(0, 1000) : [];

// Call before importing/opening JSON, before the ProseMirror schema silently drops data.
export function validateAnnotationsJSON(json) {
  if (!json || typeof json !== 'object') throw new Error('文档格式无效');
  const threads = json.attrs?.localComments;
  if (threads != null && (!Array.isArray(threads) || threads.length > 1000 || !threads.every(validThread) || new Set(threads.map(t => t.id)).size !== threads.length)) throw new Error('本地评论数据无效');
  const ids = new Set((threads || []).map(t => t.id));
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 100) throw new Error('文档嵌套无效');
    if (node.type === 'textSuggestion' && !validSuggestion(node.attrs)) throw new Error('本地文字建议数据无效');
    for (const mark of node.marks || []) if (mark.type === 'commentAnchor' && (!Array.isArray(mark.attrs?.ids) || !mark.attrs.ids.length || mark.attrs.ids.length > 1000 || !mark.attrs.ids.every(id => validId(id) && ids.has(id)) || new Set(mark.attrs.ids).size !== mark.attrs.ids.length)) throw new Error('评论锚点数据无效');
    for (const child of node.content || []) visit(child, depth + 1);
  }
  visit(json); return true;
}
const markIds = mark => Array.isArray(mark?.attrs.ids) ? mark.attrs.ids.filter(id => typeof id === 'string') : [];
const entry = body => ({ id: newId(), author: LOCAL_AUTHOR, body, createdAt: new Date().toISOString() });
function changeThreads(tr, threads) { tr.setDocAttribute('localComments', threads); closeHistory(tr); }
function selectedTextRanges(doc, from, to) {
  const ranges = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) ranges.push({ node, from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) });
  });
  return ranges;
}

export const CommentAnchor = Mark.create({
  name: 'commentAnchor', inclusive: false,
  addAttributes() { return { ids: { default: [], parseHTML: el => { try { const ids = JSON.parse(el.dataset.commentIds || '[]'); return Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : []; } catch { return []; } }, renderHTML: attrs => ({ 'data-comment-ids': JSON.stringify(attrs.ids) }) } }; },
  parseHTML() { return [{ tag: 'span[data-comment-ids]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, class: 'local-comment-anchor', style: 'background-color:#fff2bf;border-bottom:2px solid #e5b332' }, 0]; },
});

export function listLocalComments(editor) {
  return threadsOf(editor.state.doc).map(thread => {
    const ranges = []; let quote = '';
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some(mark => mark.type.name === 'commentAnchor' && markIds(mark).includes(thread.id))) {
        ranges.push({ from: pos, to: pos + node.nodeSize }); quote += node.text;
      }
    });
    return { ...thread, ranges, quote, orphaned: ranges.length === 0 };
  });
}
export function listTextSuggestions(editor) {
  const suggestions = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'textSuggestion' && validSuggestion(node.attrs)) suggestions.push({ ...node.attrs, pos }); });
  return suggestions;
}
const decideSuggestion = (accept, id, pos) => ({ tr, dispatch, editor }) => {
  if (!editor.isEditable) return false;
  const matches = []; tr.doc.descendants((node, at) => { if (node.type.name === 'textSuggestion' && node.attrs.id === id && (pos === undefined || at === pos)) matches.push({ node, at }); });
  // Pasted copies retain the ID; require an exact position when it is ambiguous.
  if (matches.length !== 1) return false;
  const { node, at } = matches[0]; const text = accept ? node.attrs.after : node.attrs.before;
  if (!validSuggestion(node.attrs) || typeof text !== 'string') return false;
  if (dispatch) { closeHistory(tr); tr.replaceWith(at, at + node.nodeSize, text ? editor.schema.text(text) : []); }
  return true;
};
export const TextSuggestion = Node.create({
  name: 'textSuggestion', inline: true, group: 'inline', atom: true, selectable: true,
  addAttributes() { return { id: { default: null }, before: { default: '' }, after: { default: '' }, author: { default: LOCAL_AUTHOR }, createdAt: { default: null } }; },
  // HTML is a readable downgrade, not an import format for suggestion metadata.
  renderHTML({ node }) {
    const children = [];
    if (node.attrs.before) children.push(['del', { style: 'color:#a12e31;background:#ffe6e6' }, String(node.attrs.before)]);
    if (node.attrs.after) children.push(['ins', { style: 'color:#18723b;background:#dcfce7' }, String(node.attrs.after)]);
    return ['span', { 'data-text-suggestion': node.attrs.id, class: 'local-text-suggestion', contenteditable: 'false', title: '本地文字建议：请在建议面板接受或拒绝' }, ...children];
  },
  addCommands() { return {
    proposeTextChange: replacement => ({ tr, dispatch, editor }) => {
      if (!editor.isEditable || typeof replacement !== 'string' || replacement.length > 10000 || /[\r\n]/.test(replacement)) return false;
      const { from, to, $from, $to } = tr.selection;
      if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
      let supported = true;
      tr.doc.nodesBetween(from, to, node => { if (node.isInline && (!node.isText || node.marks.length)) supported = false; });
      if (!supported) return false;
      const before = tr.doc.textBetween(from, to, '');
      if (before === replacement || (!before && !replacement)) return false;
      if (! $from.parent.type.contentMatch.matchType(editor.schema.nodes.textSuggestion)) return false;
      if (dispatch) { closeHistory(tr); tr.replaceWith(from, to, editor.schema.nodes.textSuggestion.create({ id: newId(), before, after: replacement, author: LOCAL_AUTHOR, createdAt: new Date().toISOString() })); }
      return true;
    },
    acceptTextSuggestion: (id, pos) => decideSuggestion(true, id, pos),
    rejectTextSuggestion: (id, pos) => decideSuggestion(false, id, pos),
  }; },
});

export const LocalAnnotations = Extension.create({
  name: 'localAnnotations',
  addProseMirrorPlugins() { return [new Plugin({ props: {
    transformPasted: (slice, view) => {
      const known = new Set(threadsOf(view.state.doc).map(t => t.id));
      const clean = fragment => {
        const children = [];
        fragment.forEach(node => {
          const marks = node.marks.flatMap(mark => {
            if (mark.type.name !== 'commentAnchor') return [mark];
            const ids = markIds(mark).filter(id => known.has(id));
            return ids.length ? [mark.type.create({ ids })] : [];
          });
          const copy = node.isLeaf ? node : node.copy(clean(node.content));
          children.push(copy.mark(marks));
        });
        return Fragment.fromArray(children);
      };
      return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
    },
  } })]; },
  addGlobalAttributes() { return [{ types: ['doc'], attributes: { localComments: { default: null, rendered: false } } }]; },
  addCommands() { return {
    loadAnnotatedContent: (content, options) => ({ commands }) => {
      try { validateAnnotationsJSON(content); } catch { return false; }
      return commands.setContent(content, options) && commands.command(({ tr }) => { tr.setDocAttribute('localComments', content.attrs?.localComments ?? null); return true; });
    },
    addLocalComment: value => ({ tr, dispatch, editor }) => {
      const body = plainBody(value), { from, to } = tr.selection;
      if (!editor.isEditable || !body || from === to || threadsOf(tr.doc).length >= 1000) return false;
      const ranges = selectedTextRanges(tr.doc, from, to);
      if (!ranges.length || ranges.some(r => !tr.doc.resolve(r.from).parent.type.allowsMarkType(editor.schema.marks.commentAnchor))) return false;
      const id = newId();
      if (dispatch) {
        for (const range of ranges) { const prior = range.node.marks.find(mark => mark.type.name === 'commentAnchor'); tr.addMark(range.from, range.to, editor.schema.marks.commentAnchor.create({ ids: [...markIds(prior), id] })); }
        changeThreads(tr, [...threadsOf(tr.doc), { id, resolved: false, entries: [entry(body)] }]);
      }
      return true;
    },
    replyLocalComment: (id, value) => ({ tr, dispatch, editor }) => {
      const body = plainBody(value), threads = threadsOf(tr.doc); const thread = threads.find(t => t.id === id);
      if (!editor.isEditable || !body || !thread || thread.resolved || thread.entries.length >= 500) return false;
      if (dispatch) changeThreads(tr, threads.map(t => t.id === id ? { ...t, entries: [...t.entries, entry(body)] } : t));
      return true;
    },
    resolveLocalComment: (id, resolved = true) => ({ tr, dispatch, editor }) => {
      const threads = threadsOf(tr.doc);
      if (!editor.isEditable || typeof resolved !== 'boolean' || !threads.some(t => t.id === id)) return false;
      if (dispatch) changeThreads(tr, threads.map(t => t.id === id ? { ...t, resolved } : t));
      return true;
    },
    deleteLocalComment: id => ({ tr, dispatch, editor }) => {
      const threads = threadsOf(tr.doc);
      if (!editor.isEditable || !threads.some(t => t.id === id)) return false;
      if (dispatch) {
        tr.doc.descendants((node, pos) => {
          const mark = node.marks.find(m => m.type.name === 'commentAnchor' && markIds(m).includes(id));
          if (!mark) return;
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
          const ids = markIds(mark).filter(other => other !== id);
          if (ids.length) tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ids }));
        });
        changeThreads(tr, threads.filter(t => t.id !== id));
      }
      return true;
    },
  }; },
});
export const annotationExtensions = [LocalAnnotations, CommentAnchor, TextSuggestion];
