/** Local-only destructive pixel crop, saved as a new asset. Never mutates the source. */
export function isLocalRasterSource(src) {
  return typeof src === 'string' && (/^\/api\/assets\/[a-f0-9]{64}$/.test(src) || /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\r\n]+$/.test(src));
}
export function boundCrop(rect, width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid image dimensions');
  const number = (n, fallback) => Number.isFinite(Number(n)) ? Math.round(Number(n)) : fallback;
  const x = Math.max(0, Math.min(width - 1, number(rect.x, 0)));
  const y = Math.max(0, Math.min(height - 1, number(rect.y, 0)));
  return { x, y, width: Math.max(1, Math.min(width - x, number(rect.width, width))), height: Math.max(1, Math.min(height - y, number(rect.height, height))) };
}
export function openImageCrop({src, name = 'image', upload, isCurrent, onApply, onError = () => {}, onClose = () => {}, resolveSource, ownerDocument = globalThis.document, loadImage, renderCrop} = {}) {
  if (!isLocalRasterSource(src)) throw new Error('Only embedded raster images and local assets can be cropped');
  if (![upload, isCurrent, onApply].every(fn => typeof fn === 'function')) throw new Error('Crop requires upload, isCurrent and onApply callbacks');
  const doc = ownerDocument, win = doc.defaultView;
  const previousFocus = doc.activeElement;
  let closed = false, pending = false, image, rect, drag, displaySource = src;
  const el = (tag, text, parent) => { const node = doc.createElement(tag); if (text) node.textContent = text; parent?.append(node); return node; };
  const backdrop = el('div', '', doc.body);
  backdrop.dataset.imageCrop = 'true';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:center;justify-content:center;padding:16px';
  const dialog = el('section', '', backdrop);
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '裁剪图片');
  dialog.style.cssText = 'background:white;color:#17202c;border-radius:12px;padding:20px;max-width:800px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 16px 60px #0005';
  el('h2', '裁剪图片', dialog);
  el('p', '拖动图片选择裁剪范围，或输入原图像素坐标。应用后生成新图片，保留原始资源。', dialog);
  const status = el('p', '正在读取原图…', dialog); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stage = el('div', '', dialog); stage.style.cssText = 'position:relative;display:inline-block;max-width:100%;line-height:0;touch-action:none;user-select:none';
  const preview = el('img', '', stage); preview.alt = '裁剪预览'; preview.draggable = false;
  preview.style.cssText = 'display:block;max-width:100%;max-height:48vh;width:auto;height:auto';
  const overlay = el('div', '', stage); overlay.style.cssText = 'position:absolute;border:2px solid #2269ed;box-sizing:border-box;background:#2269ed22;pointer-events:none';
  const fields = el('div', '', dialog); fields.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin:16px 0';
  const inputs = {};
  for (const [key, title] of [['x','左侧 X'],['y','顶部 Y'],['width','宽度'],['height','高度']]) {
    const label = el('label', title + ' ', fields); const input = el('input', '', label);
    input.type = 'number'; input.step = '1'; input.style.width = '90px'; input.setAttribute('aria-label', title + '（像素）'); input.disabled = true; inputs[key] = input;
    input.addEventListener('change', () => { if (closed || pending || !image) return; rect = boundCrop({...rect,[key]: input.value},image.naturalWidth,image.naturalHeight); refresh(); });
  }
  const cancel = el('button', '取消', dialog); cancel.type = 'button';
  const apply = el('button', '应用裁剪', dialog); apply.type = 'button'; apply.disabled = true; apply.style.marginLeft = '12px';
  function refresh() {
    for (const key of Object.keys(inputs)) { inputs[key].value = rect[key]; inputs[key].min = key === 'x' || key === 'y' ? '0' : '1'; inputs[key].max = key === 'x' ? image.naturalWidth - 1 : key === 'y' ? image.naturalHeight - 1 : key === 'width' ? image.naturalWidth - rect.x : image.naturalHeight - rect.y; }
    Object.assign(overlay.style, {left: `${rect.x/image.naturalWidth*100}%`, top: `${rect.y/image.naturalHeight*100}%`, width: `${rect.width/image.naturalWidth*100}%`, height: `${rect.height/image.naturalHeight*100}%`});
  }
  function close() { if (closed) return; closed = true; doc.removeEventListener('keydown', keydown, true); backdrop.remove(); onClose(); if (previousFocus?.isConnected) previousFocus.focus(); }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') { const focusable = [...dialog.querySelectorAll('button,input')].filter(n => !n.disabled); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {event.preventDefault(); last?.focus();} else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {event.preventDefault(); first?.focus();} }
  }
  doc.addEventListener('keydown', keydown, true); cancel.addEventListener('click', close); cancel.focus();
  function point(event) { const box = preview.getBoundingClientRect(); if (!box.width || !box.height) return null; return {x: Math.max(0,Math.min(image.naturalWidth, (event.clientX-box.left)/box.width*image.naturalWidth)),y:Math.max(0,Math.min(image.naturalHeight,(event.clientY-box.top)/box.height*image.naturalHeight))}; }
  stage.addEventListener('pointerdown', event => { if (!image || pending || event.button !== 0) return; drag = point(event); if (drag) { stage.setPointerCapture?.(event.pointerId); event.preventDefault(); } });
  stage.addEventListener('pointermove', event => { if (!drag || pending) return; const end = point(event); if (!end) return; rect = boundCrop({x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),width:Math.abs(end.x-drag.x),height:Math.abs(end.y-drag.y)},image.naturalWidth,image.naturalHeight); refresh(); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) stage.addEventListener(type, () => {drag = null;});
  const defaultLoad = () => new Promise((resolve,reject) => {const img = new win.Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('无法读取本地图片')); img.src = displaySource;});
  const defaultRender = (img, crop) => {const canvas = doc.createElement('canvas'); canvas.width = crop.width; canvas.height = crop.height; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器不支持图片裁剪'); ctx.drawImage(img,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height); return canvas.toDataURL('image/png').split(',')[1];};
  const ready = Promise.resolve().then(async () => { if (resolveSource) displaySource = await resolveSource(src); if (closed) return null; if (!isLocalRasterSource(displaySource) && !/^blob:/.test(displaySource)) throw new Error('不支持远程图片来源'); return (loadImage || defaultLoad)(displaySource); }).then(img => {
    if (closed) return;
    if (!Number.isInteger(img.naturalWidth) || !Number.isInteger(img.naturalHeight) || img.naturalWidth < 1 || img.naturalHeight < 1 || img.naturalWidth * img.naturalHeight > 40000000) throw new Error('图片尺寸无效或超过 4000 万像素限制');
    image = img; preview.src = displaySource; rect = boundCrop({},image.naturalWidth,image.naturalHeight); refresh(); for (const input of Object.values(inputs)) input.disabled = false; apply.disabled = false; status.textContent = `原图 ${image.naturalWidth} × ${image.naturalHeight} 像素`;
  }).catch(error => { if (!closed) {status.textContent = error.message; onError(error);} });
  apply.addEventListener('click', async () => {
    if (!image || closed || pending) return;
    if (!isCurrent()) {status.textContent = '文档或图片已更改，请关闭后重新选择图片。'; apply.disabled = true; return;}
    pending = true; apply.disabled = true; for (const input of Object.values(inputs)) input.disabled = true;
    const crop = {...rect}; status.textContent = '正在生成裁剪图片…';
    try {
      const dataBase64 = await (renderCrop || defaultRender)(image,crop);
      if (closed || !isCurrent()) {if (!closed) status.textContent = '文档或图片已更改，未应用裁剪。'; return;}
      const asset = await upload({name: `${name.replace(/\.[^.]*$/, '')}-crop.png`, mime: 'image/png', dataBase64});
      if (closed || !isCurrent()) {if (!closed) status.textContent = '文档或图片已更改，未应用裁剪。'; return;}
      onApply(asset,{width:crop.width,height:crop.height,rect:crop}); close();
    } catch (error) {if (!closed) { status.textContent = `裁剪失败：${error.message}`; onError(error); }}
    finally {pending = false; if (!closed) {apply.disabled = !isCurrent(); for (const input of Object.values(inputs)) input.disabled = false;}}
  });
  return {close,ready};
}
