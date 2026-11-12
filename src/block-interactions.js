import { Fragment } from '@tiptap/pm/model';
import { icon } from './icons.js';
import { vendorIcon } from './icons-vendor.js';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { MapResult } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';

const itemTypes = new Set(['listItem', 'taskItem']);
const structuralTypes = new Set(['tableRow', 'tableCell', 'tableHeader', 'column']);
const movable = node => node?.isBlock && !structuralTypes.has(node.type.name);

function descriptor($pos, depth) {
  if (!depth) return null;
  const node = $pos.node(depth), parent = $pos.node(depth - 1);
  if (!movable(node)) return null;
  const pos = $pos.before(depth);
  return { pos, from: pos, to: pos + node.nodeSize, node, type: node.type.name,
    parent, index: $pos.index(depth - 1), parentDepth: depth - 1,
    parentPos: depth > 1 ? $pos.before(depth - 1) : -1, depth };
}

/** Text selections choose their innermost list item, never a list's required paragraph.
 * Tables move as a whole. Columns, rows and cells are not independently movable.
 * exact is for an already known node boundary (hovered handle/menu/NodeSelection).
 */
export function getBlockAtPosition(doc, position, { exact = false } = {}) {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return null;
  const $pos = doc.resolve(position);
  if (exact) {
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === 'table') return descriptor($pos, depth);
    }
    const node = $pos.nodeAfter;
    if (!movable(node)) return null;
    const parent = $pos.parent;
    // Paragraphs inside list items are not handles: reorder the whole list item instead.
    if (itemTypes.has(parent.type.name)) return descriptor($pos, $pos.depth);
    return { pos: position, from: position, to: position + node.nodeSize, node, type: node.type.name,
      parent, index: $pos.index(), parentDepth: $pos.depth,
      parentPos: $pos.depth ? $pos.before($pos.depth) : -1, depth: $pos.depth + 1 };
  }
  // A cursor in a cell must never reorder a row, cell, or the cell's paragraphs.
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') return descriptor($pos, depth);
  }
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (itemTypes.has($pos.node(depth).type.name)) return descriptor($pos, depth);
  }
  for (let depth = $pos.depth; depth > 0; depth--) {
    const block = descriptor($pos, depth);
    if (block) return block;
  }
  return exact ? null : getBlockAtPosition(doc, position, { exact: true });
}

function siblingsOf(block) {
  const blocks = []; let pos = block.parentPos + 1;
  block.parent.forEach((node, offset, index) => blocks.push({ node, pos: pos + offset, index }));
  return blocks;
}

/** A pure, schema-checked reorder. toIndex is the final index within the SAME parent.
 * One atomic replacement avoids temporarily invalid list/column/container content.
 * Existing nodes and doc attributes are retained, including local annotations/assets.
 */
export function createBlockMoveTransaction(state, sourcePos, toIndex) {
  const source = getBlockAtPosition(state.doc, sourcePos, { exact: true });
  if (!source || source.pos !== sourcePos || !Number.isInteger(toIndex) || toIndex < 0 ||
      toIndex >= source.parent.childCount || source.index === toIndex) return null;
  const siblings = siblingsOf(source), reordered = [...siblings];
  const [moving] = reordered.splice(source.index, 1); reordered.splice(toIndex, 0, moving);
  if (!source.parent.type.validContent(Fragment.fromArray(reordered.map(x => x.node)))) return null;
  const low = Math.min(source.index, toIndex), high = Math.max(source.index, toIndex);
  const from = siblings[low].pos, to = siblings[high].pos + siblings[high].node.nodeSize;
  const tr = closeHistory(state.tr).replaceWith(from, to, reordered.slice(low, high + 1).map(x => x.node));
  let cursor = source.parentPos + 1;
  const newPositions = new Map();
  for (const sibling of reordered) { newPositions.set(sibling.index, cursor); cursor += sibling.node.nodeSize; }
  const map = (pos, assoc = 1) => {
    if (pos < from || pos > to) return pos;
    const sibling = siblings.find(x => pos >= x.pos && pos <= x.pos + x.node.nodeSize &&
      (pos !== x.pos + x.node.nodeSize || assoc < 0 || x.index === siblings.length - 1));
    return sibling ? newPositions.get(sibling.index) + pos - sibling.pos : pos;
  };
  try {
    tr.setSelection(state.selection.map(tr.doc, { map, mapResult: (pos, assoc) => new MapResult(map(pos, assoc), 0, null) }));
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(newPositions.get(source.index) + 1)));
  }
  return tr.setMeta('dshBlockMove', { from: source.pos, to: newPositions.get(source.index), parentPos: source.parentPos })
    .setMeta('uiEvent', 'dsh-block-move').scrollIntoView();
}

const editable = (editor, canEdit) => !editor.isDestroyed && editor.isEditable &&
  (typeof canEdit === 'function' ? canEdit() : canEdit !== false);

export function moveBlock(editor, { from, toIndex, expectedDoc, canEdit } = {}) {
  if (!editable(editor, canEdit) || (expectedDoc && editor.state.doc !== expectedDoc)) return false;
  const tr = createBlockMoveTransaction(editor.state, from, toIndex);
  if (!tr) return false;
  editor.view.dispatch(tr);
  // Separate the next typing/formatting transaction as well as the preceding one.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  return true;
}

export function moveBlockBy(editor, direction, { from, canEdit } = {}) {
  if (direction !== -1 && direction !== 1) return false;
  if (!editable(editor, canEdit)) return false;
  const source = getBlockAtPosition(editor.state.doc, from ?? editor.state.selection.from,
    { exact: from !== undefined || editor.state.selection instanceof NodeSelection });
  return !!source && moveBlock(editor, { from: source.pos, toIndex: source.index + direction, canEdit });
}

/** Pointer geometry is deliberately limited to the exact parent. No list conversion,
 * cross-column move, row move, nesting, or document-to-document drop is inferred.
 */
export function resolveBlockDrop(source, rects, { x, y, containerRect }) {
  if (!source || !rects.length || !containerRect || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < containerRect.left - 48 || x > containerRect.right + 16 ||
      y < Math.min(containerRect.top, rects[0].rect.top) - 24 ||
      y > Math.max(containerRect.bottom, rects.at(-1).rect.bottom) + 24) return null;
  let boundary = rects.findIndex(item => y < (item.rect.top + item.rect.bottom) / 2);
  if (boundary < 0) boundary = rects.length;
  const toIndex = boundary > source.index ? boundary - 1 : boundary;
  if (toIndex === source.index) return null;
  const reference = rects[Math.min(boundary, rects.length - 1)].rect;
  const top = boundary === rects.length ? reference.bottom : reference.top;
  return { toIndex, left: reference.left, top, width: Math.max(24, reference.right - reference.left) };
}

const css = `
.dsh-block-controls{position:fixed;display:flex;align-items:center;gap:0;z-index:65;padding:1px;border-radius:8px;background:#fff;border:1px solid #e5e6eb;box-shadow:0 1px 4px #1f23290f;user-select:none}
.dsh-block-controls[hidden],.dsh-block-drop-indicator[hidden]{display:none!important}
.dsh-block-controls button{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;background:transparent;border-radius:5px;color:#8f959e;touch-action:none}
.dsh-block-controls button:hover,.dsh-block-controls button:focus-visible{background:#f2f3f5;color:#1f2329;outline:2px solid transparent}
.dsh-block-controls button:focus-visible{outline-color:#3370ff}
.dsh-block-controls button svg{display:block}
.dsh-block-controls .dsh-block-drag{cursor:grab}
.dsh-block-controls .dsh-block-type{color:#3370ff;font-size:12px;font-weight:600;line-height:1;font-family:inherit}
.dsh-block-controls .dsh-block-type .dsh-block-h{font-size:12.5px;font-weight:700;letter-spacing:-.3px}
.dsh-block-controls[data-empty="true"] .dsh-block-type,.dsh-block-controls[data-empty="true"] .dsh-block-drag{display:none}
.dsh-block-controls[data-empty="true"]{padding:2px}
.dsh-block-controls[data-empty="true"] .dsh-block-insert{width:26px;height:26px}
.dsh-block-controls:not([data-empty="true"]) .dsh-block-insert{display:none}
.dsh-block-controls[data-dragging=true] .dsh-block-drag{cursor:grabbing;color:#3370ff}
.dsh-block-drop-indicator{pointer-events:none;position:fixed;z-index:90;height:3px;border-radius:2px;background:#3370ff;box-shadow:0 0 0 1px #ffffffb3}
.dsh-block-drop-indicator::before{content:"";position:absolute;left:-3px;top:-2px;width:7px;height:7px;border-radius:50%;background:#3370ff}
.dsh-block-moving{outline:1px solid #3370ff70!important;outline-offset:3px;opacity:.6}
.dsh-block-sr-only{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media print{.dsh-block-controls,.dsh-block-drop-indicator,.dsh-block-sr-only{display:none!important}}
`;

/** Install outside the editable DOM. The plus/menu callbacks receive the exact block
 * BEFORE position, current node, type, parent information and viewport rect.
 * Destroy on editor teardown. refresh() must also be called when external modes change.
 */
export function integrateBlockInteractions({ editor, canEdit, onInsert, onInsertMenu, onMenu, iconForBlock } = {}) {
  if (!editor?.view?.dom) throw new TypeError('A mounted editor is required');
  const root = editor.view.dom, document = root.ownerDocument, window = document.defaultView;
  const style = document.createElement('style'); style.dataset.dshBlockInteractions = 'true'; style.textContent = css;
  const controls = document.createElement('div'); controls.className = 'dsh-block-controls'; controls.hidden = true;
  controls.setAttribute('role', 'toolbar'); controls.setAttribute('aria-label', '块操作');
  const plus = document.createElement('button'); plus.type = 'button'; plus.innerHTML = vendorIcon('plus', { size: 16 }); plus.className = 'dsh-block-insert';
  plus.setAttribute('aria-label', '在当前块下方插入'); plus.title = '在下方插入块';
  const typeBtn = document.createElement('button'); typeBtn.type = 'button'; typeBtn.className = 'dsh-block-type';
  typeBtn.setAttribute('aria-label', '块类型与块菜单'); typeBtn.title = '块类型与块菜单';
  const grip = document.createElement('button'); grip.type = 'button'; grip.innerHTML = vendorIcon('drag', { size: 16 }); grip.className = 'dsh-block-drag'; grip.draggable = true;
  grip.setAttribute('aria-label', '拖动当前块排序，或使用上下方向键移动');
  grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown');
  grip.title = '拖动排序 · 点击块菜单 · Alt+Shift+↑/↓';
  const indicator = document.createElement('div'); indicator.className = 'dsh-block-drop-indicator'; indicator.hidden = true;
  indicator.setAttribute('aria-hidden', 'true');
  const live = document.createElement('div'); live.className = 'dsh-block-sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  controls.append(typeBtn, plus, grip); document.head.append(style); document.body.append(controls, indicator, live);
  let active = null, activeDoc = null, drag = null, destroyed = false, suppressClick = false, frame = null;
  const disposers = [];
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); disposers.push(() => target.removeEventListener(type, fn, options)); };
  const allowed = () => !destroyed && editable(editor, canEdit);
  const domFor = block => { const dom = editor.view.nodeDOM(block.pos); return dom?.nodeType === 1 ? dom : dom?.parentElement; };
  const current = () => active && activeDoc === editor.state.doc && editor.state.doc.nodeAt(active.pos) === active.node ? active : null;
  const announce = text => { live.textContent = text; };
  const cancelFrame = () => { if (frame !== null) window.cancelAnimationFrame(frame); frame = null; };
  function cancel(message) {
    const previous = drag; drag = null;
    if (previous) {
      previous.element?.classList.remove('dsh-block-moving');
      if (previous.pointerId !== undefined) { try { grip.releasePointerCapture(previous.pointerId); } catch {} }
    } indicator.hidden = true; delete controls.dataset.dragging; cancelFrame();
    if (message) announce(message);
  }
  function show(block) {
    if (!allowed() || !block) { controls.hidden = true; return; }
    const element = domFor(block); if (!element) { controls.hidden = true; return; }
    const rect = element.getBoundingClientRect();
    const clipping = root.closest('.content-layout')?.getBoundingClientRect();
    const top = Math.max(0, clipping?.top ?? 0), bottom = Math.min(window.innerHeight, clipping?.bottom ?? window.innerHeight);
    if (rect.bottom < top || rect.top > bottom || (!rect.width && !rect.height)) { controls.hidden = true; return; }
    active = block; activeDoc = editor.state.doc;
    const empty = block.node?.isTextblock ? block.node.content.size === 0 : false;
    controls.hidden = false; controls.dataset.blockType = block.type; controls.dataset.blockPos = String(block.pos);
    controls.dataset.empty = String(empty);
    if (!empty) {
      try { typeBtn.innerHTML = iconForBlock?.(block) || vendorIcon('blockStyle', { size: 16 }); } catch { typeBtn.innerHTML = vendorIcon('blockStyle', { size: 16 }); }
    }
    const width = controls.getBoundingClientRect().width || 56;
    const rootRect = root.getBoundingClientRect();
    const paper = root.closest('.paper');
    const paperLeft = (paper ? paper.getBoundingClientRect().left : rootRect.left) + 2;
    // 手柄固定在页面左侧留白（飞书式），不跟随列表缩进，避免盖住文字
    let left = Math.min(rect.left, rootRect.left) - width - 8;
    left = Math.max(paperLeft, left);
    if (left + width > rootRect.left - 2) left = Math.max(paperLeft, rootRect.left - width - 2);
    controls.style.left = `${Math.max(2, left)}px`;
    controls.style.top = `${Math.max(top + 2, rect.top + 1)}px`;
  }
  function fromSelection() { return getBlockAtPosition(editor.state.doc, editor.state.selection.from, { exact: editor.state.selection instanceof NodeSelection }); }
  function refresh() {
    if (!allowed()) { cancel(); active = null; activeDoc = null; controls.hidden = true; return; }
    if (drag && drag.doc !== editor.state.doc) cancel('内容已变化，已取消拖动');
    show(current() || (editor.isFocused || controls.contains(document.activeElement) ? fromSelection() : null));
  }
  function payload() { const block = current(); return block ? { ...block, rect: domFor(block)?.getBoundingClientRect() } : null; }
  function move(direction) {
    const source = current() || fromSelection();
    if (!source || !allowed()) return false;
    cancel();
    const expected = editor.state.doc, target = source.index + direction;
    const changed = moveBlock(editor, { from: source.pos, toIndex: target, expectedDoc: expected, canEdit });
    if (changed) {
      const pos = source.pos + (direction < 0 ? -source.parent.child(target).nodeSize : source.parent.child(target).nodeSize);
      active = getBlockAtPosition(editor.state.doc, pos, { exact: true }); activeDoc = editor.state.doc;
      show(active); announce(direction < 0 ? '块已向上移动，可撤销' : '块已向下移动，可撤销');
    } else announce('已到达当前容器边界');
    return changed;
  }
  function pick(event) {
    if (!allowed() || drag || controls.contains(event.target) || !root.contains(event.target)) return;
    try {
      let position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (position == null) position = editor.view.posAtDOM(event.target, 0);
      const directNode = editor.view.nodeDOM(position);
      show(getBlockAtPosition(editor.state.doc, position, { exact: directNode === event.target }));
    } catch { /* Node view transitions can briefly disconnect the hovered DOM. */ }
  }
  function geometry(source) {
    const siblings = siblingsOf(source), rects = siblings.map(block => {
      const element = domFor(block); return element ? { ...block, rect: element.getBoundingClientRect() } : null;
    });
    if (rects.some(x => !x)) return null;
    const container = source.parentDepth ? editor.view.nodeDOM(source.parentPos) : root;
    const containerRect = container?.getBoundingClientRect?.();
    return containerRect ? { rects, containerRect } : null;
  }
  function updateDrop(x, y) {
    if (!drag?.started || !allowed() || drag.doc !== editor.state.doc) { if (drag) cancel(); return; }
    drag.x = x; drag.y = y;
    const measured = geometry(drag.source);
    drag.target = measured ? resolveBlockDrop(drag.source, measured.rects, { x, y, containerRect: measured.containerRect }) : null;
    indicator.hidden = !drag.target;
    if (drag.target) {
      indicator.style.left = `${drag.target.left}px`; indicator.style.top = `${drag.target.top - 1}px`;
      indicator.style.width = `${drag.target.width}px`;
    }
  }
  function autoScroll() {
    cancelFrame();
    const tick = () => {
      frame = null; if (!drag?.started || destroyed) return;
      const scroll = root.closest('.content-layout') || document.scrollingElement;
      const box = scroll === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroll.getBoundingClientRect();
      const margin = 42, y = drag.y;
      const delta = y < box.top + margin ? -Math.min(18, (box.top + margin - y) / 3) : y > box.bottom - margin ? Math.min(18, (y - box.bottom + margin) / 3) : 0;
      if (delta && scroll) { scroll.scrollTop += delta; updateDrop(drag.x, drag.y); }
      if (drag?.started) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  }
  function start(native = false) {
    if (!drag || !allowed() || drag.doc !== editor.state.doc) { cancel(); return false; }
    drag.started = true; drag.native = native; drag.element?.classList.add('dsh-block-moving');
    controls.dataset.dragging = 'true'; suppressClick = true; announce('拖动中。仅在同一容器内排序，按 Escape 取消');
    autoScroll(); return true;
  }
  function finish() {
    const pending = drag;
    const shouldMove = pending?.started && pending.target && allowed() && pending.doc === editor.state.doc;
    cancel();
    if (shouldMove) {
      const tr = createBlockMoveTransaction(editor.state, pending.source.pos, pending.target.toIndex);
      const destination = tr?.getMeta('dshBlockMove')?.to;
      if (moveBlock(editor, { from: pending.source.pos, toIndex: pending.target.toIndex, expectedDoc: pending.doc, canEdit })) {
        active = getBlockAtPosition(editor.state.doc, destination, { exact: true }); activeDoc = editor.state.doc;
        editor.view.focus(); show(active); announce('块已移动，可撤销');
      }
    } else if (pending?.started) announce('未移动块');
  }
  listen(document, 'pointermove', event => {
    if (!drag) { pick(event); return; }
    if (drag.native || event.pointerId !== drag.pointerId) return;
    if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) {
      if (!start()) return;
      try { grip.setPointerCapture(event.pointerId); } catch {}
    }
    if (drag?.started) { event.preventDefault(); updateDrop(event.clientX, event.clientY); }
  }, { passive: false });
  listen(grip, 'pointerdown', event => {
    if (event.button !== 0 || !allowed()) return;
    const source = current(); if (!source) return;
    cancel(); suppressClick = false;
    drag = { source, doc: editor.state.doc, element: domFor(source), pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false, native: false, target: null };
    // Keep editor selection and focus stable until a real move is committed.
    event.preventDefault();
  });
  listen(document, 'pointerup', event => {
    if (drag && !drag.native && event.pointerId === drag.pointerId) {
      if (drag.started) { event.preventDefault(); updateDrop(event.clientX, event.clientY); }
      finish();
    }
  });
  listen(document, 'pointercancel', () => { if (drag) { suppressClick = true; cancel('已取消拖动'); } });
  listen(grip, 'lostpointercapture', () => { if (drag && !drag.native) cancel('已取消拖动'); });
  listen(grip, 'dragstart', event => {
    if (!allowed() || !current()) { event.preventDefault(); return; }
    if (!drag) { const source = current(); drag = { source, doc: editor.state.doc, element: domFor(source), started: false, x: event.clientX, y: event.clientY }; }
    if (!start(true)) { event.preventDefault(); return; }
    // No document HTML/plaintext is exported through the data transfer.
    event.dataTransfer?.setData('application/x-dsh-local-block', 'same-editor-only');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  });
  listen(document, 'dragover', event => {
    if (!drag?.native) return;
    event.preventDefault(); event.stopPropagation(); updateDrop(event.clientX, event.clientY);
    if (event.dataTransfer) event.dataTransfer.dropEffect = drag?.target ? 'move' : 'none';
  }, true);
  listen(document, 'drop', event => {
    if (!drag?.native) return;
    event.preventDefault(); event.stopPropagation(); updateDrop(event.clientX, event.clientY); finish();
  }, true);
  listen(grip, 'dragend', () => { if (drag) cancel('已取消拖动'); });
  listen(grip, 'click', event => {
    event.preventDefault();
    if (suppressClick) { suppressClick = false; return; }
    const block = payload(); if (allowed() && block) onMenu?.(block);
  });
  listen(grip, 'contextmenu', event => { event.preventDefault(); cancel(); const block = payload(); if (allowed() && block) onMenu?.(block); });
  listen(typeBtn, 'pointerdown', event => event.preventDefault());
  listen(typeBtn, 'click', event => { event.preventDefault(); const block = payload(); if (allowed() && block) onMenu?.(block); });
  listen(plus, 'pointerdown', event => event.preventDefault());
  listen(plus, 'click', event => { event.preventDefault(); const block = payload(); if (!allowed() || !block) return; (onInsertMenu || onInsert)?.(block); });
  listen(document, 'keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); suppressClick = true; cancel('已取消拖动'); return; }
    const arrow = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const fromGrip = event.target === grip && !event.metaKey && !event.ctrlKey;
    const fromEditor = root.contains(event.target) && event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey;
    if (arrow && allowed() && (fromGrip || fromEditor)) {
      event.preventDefault(); event.stopPropagation();
      if (fromEditor) { active = fromSelection(); activeDoc = editor.state.doc; }
      move(arrow);
    }
  }, true);
  listen(window, 'blur', () => cancel());
  listen(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  listen(document, 'scroll', () => { if (drag?.started) updateDrop(drag.x, drag.y); else refresh(); }, true);
  listen(window, 'resize', refresh);
  const onTransaction = ({ transaction }) => {
    if (transaction.docChanged) {
      if (drag) cancel('内容已变化，已取消拖动');
      active = null; activeDoc = null;
    }
    refresh();
  };
  const onSelection = () => { if (!drag) { active = fromSelection(); activeDoc = editor.state.doc; refresh(); } };
  editor.on('transaction', onTransaction); editor.on('selectionUpdate', onSelection); editor.on('focus', refresh); editor.on('blur', refresh);
  function destroy() {
    if (destroyed) return; cancel(); destroyed = true;
    for (const dispose of disposers) dispose();
    editor.off('transaction', onTransaction); editor.off('selectionUpdate', onSelection); editor.off('focus', refresh); editor.off('blur', refresh); editor.off('destroy', destroy);
    controls.remove(); indicator.remove(); live.remove(); style.remove();
  }
  editor.on('destroy', destroy);
  return { destroy, refresh, move, getActiveBlock: payload };
}
