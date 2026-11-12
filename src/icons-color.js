/**
 * dsh-documents 彩色双色调线性图标（块菜单 / 块类型选择器）
 *
 * 与 icons.js（16×16 单色 currentColor 图标）并存，专供块菜单「常用」分组与顶部网格使用：
 *   - 24×24 画布，图形落在 3 ~ 21 之间，默认输出 22×22
 *   - 主体 2px、细节 1.6px 描边，round cap / round join
 *   - 颜色写死（飞书色板），不是 currentColor：一眼能认出、颜色轻快
 *   - 允许同色 0.15（彩色）/ 0.1（深灰）透明度填充做浅色底，主体仍是描边风格
 *   - 每个图标 1 ~ 2 种颜色；不确定语义的图标（标题、列表、代码、引用…）用深灰 #1F2329
 *
 * 命名：
 *   - 无前缀：按图标语义配色（task 蓝 / image 黄橙 / media 青 / columns 紫 / callout 橙 …）
 *   - mono- 前缀：强制深灰单色版，用于块菜单顶部那排（H1~H4、列表、任务、代码、引用…）
 *
 * 用法：
 *   import {colorIcon, ICON_COLOR} from './icons-color.js';
 *   el.innerHTML = colorIcon('callout', {size: 22, className: 'block-menu-icon'});
 */

/** 飞书色板（只用这些值，不引新颜色） */
const COLOR = {
  blue: '#3370FF',
  blueLight: '#7BA7FF',
  cyan: '#00C2B8',
  yellow: '#FFC60A',
  green: '#34C724',
  orange: '#FF8800',
  purple: '#7F3BF5',
  red: '#F54A45',
  ink: '#1F2329',
};

/** 描边宽度：主体 2px，细节 1.6px（24 画布） */
const W_MAIN = 2;
const W_DETAIL = 1.6;

/* ── 基础工具 ─────────────────────────────────────────────────────────── */

function svg(body) {
  return (
    '<svg viewBox="0 0 24 24" width="22" height="22" class="dsh-icon dsh-icon-color" ' +
    'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
    body +
    '</svg>'
  );
}

/** 一条描边路径 */
function stroke(d, color, width = W_MAIN) {
  return `<path d="${d}" stroke="${color}" stroke-width="${width}"/>`;
}

/** 实心圆点（用于列表圆点、分割线端点、图片里的太阳） */
function dot(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
}

/** 圆角容器：彩色描边 + 同色浅底（主体始终是描边风格） */
function frame(x, y, w, h, r, p, tinted = true) {
  const fill = tinted ? ` fill="${p.tint}" fill-opacity="${p.tintOpacity}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" stroke="${p.main}"${fill}/>`;
}

/* ── 各图标的图形构造器（p = 调色板，见 paletteFor） ──────────────────── */

/** 任务：方形复选框 + 勾 */
function buildTask(p) {
  return (
    frame(3, 3, 18, 18, 4.6, p) +
    stroke('M7.4 12.2L10.7 15.5L16.6 8.8', p.main, W_MAIN)
  );
}

/** 图片：圆角画框 + 山峰（橙）+ 太阳（黄点） */
function buildImage(p) {
  return (
    frame(3, 3, 18, 18, 4.6, p) +
    `<circle cx="7.9" cy="8.2" r="1.7" fill="${p.sub}"/>` +
    stroke('M5.4 16.6L10.0 11.2L13.8 15.4L15.8 13.0L18.6 16.6', p.sub, W_MAIN)
  );
}

/** 音视频 / 附件：圆角矩形 + 播放三角 */
function buildMedia(p) {
  return (
    frame(3, 3, 18, 18, 4.6, p) +
    `<path d="M8.9 8.0L15.8 12L8.9 16.0Z" fill="${p.main}" stroke="${p.main}" stroke-width="${W_DETAIL}"/>`
  );
}

/** 表格：外框 + 表头浅底 + 表头分隔线 + 一列分栏 */
function buildTable(p) {
  return (
    frame(3, 3, 18, 18, 3.2, p, false) +
    `<rect x="4.1" y="4.1" width="15.8" height="4.7" rx="1.7" fill="${p.tint}" fill-opacity="${p.tintOpacity}"/>` +
    stroke('M3 8.8H21', p.main, W_MAIN) +
    stroke('M12 8.8V21', p.main, W_DETAIL)
  );
}

/** 分栏：两个并排的竖卡片（各带一条短线，避免在小尺寸下被读成暂停符号） */
function buildColumns(p) {
  return (
    frame(3, 3.6, 7.2, 16.8, 3.2, p) +
    frame(13.8, 3.6, 7.2, 16.8, 3.2, p) +
    stroke('M5.1 8.3H8.1M15.9 8.3H18.9', p.sub, W_DETAIL)
  );
}

/** 高亮块：圆角卡片 + 左侧竖条 + 两条短线 */
function buildCallout(p) {
  return (
    frame(3, 3.4, 18, 17.2, 3.6, p) +
    stroke('M7.3 7.6V16.4', p.main, 2.4) +
    stroke('M10.8 9.7H17.2', p.main, W_DETAIL) +
    stroke('M10.8 14.3H15.0', p.main, W_DETAIL)
  );
}

/** 公式：Σ（飞书里是黑的） */
function buildFormula(p) {
  return stroke('M19.4 5H4.6L11.6 12L4.6 19H19.4', p.main, W_MAIN);
}

/** 分割线：一条横线 + 两端圆点 */
function buildDivider(p) {
  return (
    stroke('M7.2 12H16.8', p.main, W_MAIN) +
    dot(4.4, 12, 1.6, p.main) +
    dot(19.6, 12, 1.6, p.main)
  );
}

/** 双引号的两个逗号形状（局部坐标 0~6 / 0~9.4，用 transform 摆放两次） */
const QUOTE_MARK =
  'M6.1 2.8C6.1 0.9 4.6 0.1 3.2 0.3C1.4 0.5 0.2 2 0.5 3.9C0.8 5.5 2.1 6.4 3.6 6.2' +
  'C3.5 7.3 2.9 8.4 1.9 9.2L2.8 9.4C4.9 8.2 6.1 6.3 6.1 2.8Z';

/** 引用：双引号 + 底部短线 */
function buildQuote(p) {
  return (
    `<path d="${QUOTE_MARK}" transform="translate(5.4 5.2)" fill="${p.sub}"/>` +
    `<path d="${QUOTE_MARK}" transform="translate(12.8 5.2)" fill="${p.sub}"/>` +
    stroke('M9.4 17.4H14.6', p.main, W_MAIN)
  );
}

/** 代码块：{ } 花括号 */
function buildCode(p) {
  return (
    stroke(
      'M10.2 4.4C8.4 4.4 8.7 7.2 8.7 8.8C8.7 10.6 7.4 12 5.0 12C7.4 12 8.7 13.4 8.7 15.2C8.7 16.8 8.4 19.6 10.2 19.6',
      p.main,
      W_MAIN,
    ) +
    stroke(
      'M13.8 4.4C15.6 4.4 15.3 7.2 15.3 8.8C15.3 10.6 16.6 12 19.0 12C16.6 12 15.3 13.4 15.3 15.2C15.3 16.8 15.6 19.6 13.8 19.6',
      p.main,
      W_MAIN,
    )
  );
}

/** 链接：左右两段链环 + 中间连杆 */
function buildLink(p) {
  return (
    stroke('M10.4 8.0H8.2A4 4 0 0 0 8.2 16.0H10.4', p.main, W_MAIN) +
    stroke('M13.6 8.0H15.8A4 4 0 0 1 15.8 16.0H13.6', p.main, W_MAIN) +
    stroke('M8.9 12H15.1', p.main, W_MAIN)
  );
}

/** 圆点列表：三个圆点 + 三条横线 */
function buildBulletList(p) {
  return (
    dot(4.6, 6.4, 1.6, p.main) +
    dot(4.6, 12, 1.6, p.main) +
    dot(4.6, 17.6, 1.6, p.main) +
    stroke('M8.8 6.4H20M8.8 12H20M8.8 17.6H20', p.main, W_MAIN)
  );
}

/** 编号列表：1 / 2 / 3 小字 + 三条横线 */
function buildOrderedList(p) {
  return (
    stroke('M4.9 5.2L6.4 4.2V8.6', p.main, W_DETAIL) +
    stroke('M4.0 11.0C4.0 9.7 5.2 9.3 6.1 9.7C7.1 10.1 7.0 11.3 6.1 12.2L4.0 13.9H7.4', p.main, W_DETAIL) +
    stroke(
      'M4.1 16.1C4.5 15.2 6.6 15.1 6.8 16.4C6.9 17.5 5.5 17.7 5.2 17.7C6.9 17.7 7.3 18.7 7.2 19.2C7.0 20.2 4.7 20.3 4.1 19.1',
      p.main,
      W_DETAIL,
    ) +
    stroke('M9.6 6.4H20M9.6 12H20M9.6 17.6H20', p.main, W_MAIN)
  );
}

/** H 字标：H 大、数字小（右下角），保证 16px 也读得出 H1/H2/H3/H4 */
const H_GLYPH = 'M4.2 4.2V19.8M9.8 4.2V19.8M4.2 12H9.8';

const HEADING_DIGITS = {
  1: 'M15.3 13.4L17.1 11.6V19.6M14.7 19.6H19.5',
  2: 'M13.5 13.5C13.5 11.6 15.0 10.9 16.3 11.1C17.8 11.3 18.4 12.7 17.5 14.0L13.5 19.6H19.5',
  3: 'M14.6 12.3C15.4 11.2 17.9 11.1 18.6 12.5C19.3 13.8 17.7 14.9 16.7 14.9C18.3 14.9 19.4 15.8 19.4 17.1C19.4 19.3 15.7 20.0 14.5 18.5',
  4: 'M16.7 19.6V11.4L13.3 16.5H19.5',
};

function buildHeading(level) {
  return (p) =>
    stroke(H_GLYPH, p.main, W_MAIN) + stroke(HEADING_DIGITS[level], p.main, W_DETAIL);
}

/** 正文：两段横线，末段收短 */
function buildText(p) {
  return stroke('M3.6 9.6H20.4', p.main, W_MAIN) + stroke('M3.6 14.4H14.6', p.main, W_MAIN);
}

/* ── 索引：名字 → 构造器 ──────────────────────────────────────────────── */

const BUILDERS = {
  task: buildTask,
  taskList: buildTask,
  image: buildImage,
  media: buildMedia,
  table: buildTable,
  columns: buildColumns,
  callout: buildCallout,
  formula: buildFormula,
  divider: buildDivider,
  quote: buildQuote,
  code: buildCode,
  link: buildLink,
  bulletList: buildBulletList,
  orderedList: buildOrderedList,
  h1: buildHeading(1),
  h2: buildHeading(2),
  h3: buildHeading(3),
  h4: buildHeading(4),
  text: buildText,
};

/** 无前缀版本的配色（飞书块菜单：常用那组彩色，语义类深灰） */
const PALETTES = {
  task: { main: COLOR.blue, sub: COLOR.blue },
  taskList: { main: COLOR.blue, sub: COLOR.blue },
  image: { main: COLOR.yellow, sub: COLOR.orange },
  media: { main: COLOR.cyan, sub: COLOR.cyan },
  table: { main: COLOR.cyan, sub: COLOR.cyan },
  columns: { main: COLOR.purple, sub: COLOR.purple },
  callout: { main: COLOR.orange, sub: COLOR.orange },
  formula: { main: COLOR.ink, sub: COLOR.ink },
  divider: { main: COLOR.ink, sub: COLOR.ink },
  quote: { main: COLOR.ink, sub: COLOR.ink },
  code: { main: COLOR.ink, sub: COLOR.ink },
  link: { main: COLOR.blue, sub: COLOR.blue },
  bulletList: { main: COLOR.ink, sub: COLOR.ink },
  orderedList: { main: COLOR.ink, sub: COLOR.ink },
  h1: { main: COLOR.ink, sub: COLOR.ink },
  h2: { main: COLOR.ink, sub: COLOR.ink },
  h3: { main: COLOR.ink, sub: COLOR.ink },
  h4: { main: COLOR.ink, sub: COLOR.ink },
  text: { main: COLOR.ink, sub: COLOR.ink },
};

/**
 * 取调色板。
 * 彩色版：main 语义色 + 同色 0.15 浅底；mono 版：全部深灰 #1F2329，浅底 0.1。
 */
function paletteFor(name, mono) {
  const base = PALETTES[name];
  const main = mono ? COLOR.ink : base.main;
  const sub = mono ? COLOR.ink : base.sub;
  return { main, sub, tint: main, tintOpacity: mono ? '0.1' : '0.15' };
}

/** 名字 → 可直接塞 innerHTML 的 svg 源码（含 mono- 深灰版） */
export const ICON_COLOR = (() => {
  const out = {};
  for (const name of Object.keys(BUILDERS)) {
    out[name] = svg(BUILDERS[name](paletteFor(name, false)));
    out[`mono-${name}`] = svg(BUILDERS[name](paletteFor(name, true)));
  }
  return out;
})();

/**
 * 取一个彩色图标的 svg 字符串。
 * @param {string} name ICON_COLOR 中的图标名（可用 mono- 前缀取深灰版）
 * @param {{size?: number|string, className?: string}} [options]
 * @returns {string} 可直接塞进 innerHTML 的 svg 源码
 */
export function colorIcon(name, { size = 22, className = '' } = {}) {
  const markup = ICON_COLOR[name];
  if (typeof markup !== 'string') {
    throw new Error(`[icons-color] 未知图标：${String(name)}`);
  }
  const dimension = String(size);
  const classes = className ? `dsh-icon dsh-icon-color ${className}` : 'dsh-icon dsh-icon-color';
  return markup
    .replace(' width="22"', ` width="${dimension}"`)
    .replace(' height="22"', ` height="${dimension}"`)
    .replace('class="dsh-icon dsh-icon-color"', `class="${classes}"`);
}

export default ICON_COLOR;
