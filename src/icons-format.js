/**
 * dsh-documents 格式化工具条图标集（飞书风格 · 粗线版）
 *
 * 设计规范：
 *   - 统一 viewBox 0 0 16 16，主体 stroke-width = 2（细节 1.8 / 2.4）
 *   - 直线类（blockStyle / align* / 列表横线）butt 端点，曲线类 round 端点
 *   - 内容落在 1.2 ~ 14.8 之间，视觉中心对齐 (8, 8)
 *   - 颜色一律 currentColor，实心点 / 引号用 fill，其余纯描边
 *
 * 用法：
 *   import {formatIcon} from './icons-format.js';
 *   el.innerHTML = formatIcon('link', {size: 18, className: 'toolbar-icon'});
 */

/* ── 复用的属性组 ─────────────────────────────────────────────────────── */

/** 直线 / 横线类：方切端点，转角不圆 */
const SHARP = 'stroke-width="1.9" stroke-linecap="butt" stroke-linejoin="miter"';
/** 曲线 / 折线类：圆头圆角 */
const SOFT = 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** 圆角卡片外框（callout / codeBlock / table 共用，保证视觉重量一致） */
const CARD = '<rect x="2.4" y="2.8" width="11.2" height="10.4" rx="2.4"/>';

/* ── 列表类横线（bullet / ordered / task 共用节律 y 4 / 8 / 12） ────── */

const LIST_LINES = '<path d="M6.4 4H13.4M6.4 8H13.4M6.4 12H13.4"/>';

/** 实心小圆点（fill 画法，比极短线段更稳、更黑） */
function dot(cx, cy, r) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
}

/* ── 图标定义 ───────────────────────────────────────────────────────── */

const DEFS = {
  /* ── 块样式 / 对齐 ──────────────────────────────────────────────── */

  // 正文样式：三条等长粗横线，代表"一段规整的正文"
  blockStyle: {
    attrs: SHARP,
    body: '<path d="M2.6 4H13.4M2.6 8H13.4M2.6 12H13.4"/>',
  },

  // 左对齐：5 条线 长-短-长-短-长，左端全部贴 x=2.6
  alignLeft: {
    attrs: SHARP,
    body: '<path d="M2.6 3.4H13.4M2.6 5.7H8.4M2.6 8H13.4M2.6 10.3H8.4M2.6 12.6H13.4"/>',
  },

  // 居中对齐：5 条线，长短交替，短线也居中
  alignCenter: {
    attrs: SHARP,
    body: '<path d="M2.6 3.4H13.4M5.1 5.7H10.9M2.6 8H13.4M5.1 10.3H10.9M2.6 12.6H13.4"/>',
  },

  // 右对齐：5 条线，右端全部贴 x=13.4
  alignRight: {
    attrs: SHARP,
    body: '<path d="M2.6 3.4H13.4M7.6 5.7H13.4M2.6 8H13.4M7.6 10.3H13.4M2.6 12.6H13.4"/>',
  },

  /* ── 行内插入 ───────────────────────────────────────────────────── */

  // 链接：两个 45° 圆角环互扣，没有中间直杆
  link: {
    attrs: SOFT,
    body:
      '<path d="M6.67 8.67a3.33 3.33 0 0 0 5.03.36l2-2a3.33 3.33 0 0 0-4.71-4.71l-1.15 1.14"/>' +
      '<path d="M9.33 7.33a3.33 3.33 0 0 0-5.03-.36l-2 2a3.33 3.33 0 0 0 4.71 4.71l1.14-1.14"/>',
  },

  // 行内代码：< / >，中间斜杠接近竖直（上端略偏右）
  code: {
    attrs: SOFT,
    body: '<path d="M5.7 4.4L3 8l2.7 3.6M10.3 4.4L13 8l-2.7 3.6M9.2 3.8L6.8 12.2"/>',
  },

  // 更多：三个实心圆点
  more: {
    attrs: SOFT,
    body: dot(3.4, 8, 1.35) + dot(8, 8, 1.35) + dot(12.6, 8, 1.35),
  },

  // 下拉：粗 V
  chevronDown: {
    attrs: SOFT,
    body: '<path d="M4.6 6.6L8 10L11.4 6.6"/>',
  },

  /* ── 列表类 ─────────────────────────────────────────────────────── */

  // 无序列表：3 个实心圆点 + 3 条粗横线
  bulletList: {
    attrs: SHARP,
    body: dot(3.4, 4, 1.25) + dot(3.4, 8, 1.25) + dot(3.4, 12, 1.25) + LIST_LINES,
  },

  // 有序列表：1 / 2 / 3 描边数字 + 3 条粗横线
  orderedList: {
    attrs: SHARP,
    body:
      '<path d="M2.9 3.2L3.65 2.6V5.2M2.5 7C2.5 6.1 4.3 6 4.3 7C4.3 7.8 2.6 8.5 2.5 9.2H4.4' +
      'M2.5 6.8C3.3 5.9 4.4 6.3 4.1 7.2C4.6 7.6 4.6 9.1 3.5 9.3C2.9 9.4 2.6 9.2 2.5 9.1" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      LIST_LINES,
  },

  // 任务列表：圆角勾选框 + 勾 + 空框 + 两条粗横线
  taskList: {
    attrs: SHARP,
    body:
      '<rect x="2.5" y="2.6" width="5" height="5" rx="1.4"/>' +
      '<path d="M3.7 5.1L4.7 6.1L6.4 4.1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<rect x="2.5" y="8.6" width="5" height="5" rx="1.4"/>' +
      '<path d="M9 5.1H13.4M9 11.1H13.4"/>',
  },

  // 引用：两个实心逗号引号 + 底部一条短横线
  quote: {
    attrs: SHARP,
    body:
      '<rect x="4.4" y="3.6" width="2.8" height="2.8" rx="0.7" fill="currentColor" stroke="none"/>' +
      '<path d="M4.4 6.4H5.8L4.4 8.5Z" fill="currentColor" stroke="none"/>' +
      '<rect x="8.4" y="3.6" width="2.8" height="2.8" rx="0.7" fill="currentColor" stroke="none"/>' +
      '<path d="M8.4 6.4H9.8L8.4 8.5Z" fill="currentColor" stroke="none"/>' +
      '<path d="M4.4 12.2H11.2"/>',
  },

  /* ── 块类 ───────────────────────────────────────────────────────── */

  // 高亮块 / 提示：圆角卡片 + 左侧粗竖条 + 两条短线
  callout: {
    attrs: SOFT,
    body:
      CARD +
      '<path d="M4.6 5.4V10.6" stroke-width="2.4"/>' +
      '<path d="M7.2 6.4H11.8" stroke-width="2" stroke-linecap="butt"/>' +
      '<path d="M7.2 9.6H10.4" stroke-width="2" stroke-linecap="butt"/>',
  },

  // 代码块：圆角卡片 + 内部小一号的 < / >
  codeBlock: {
    attrs: SOFT,
    body:
      CARD +
      '<path d="M6.9 6.4L5.9 8L6.9 9.6" stroke-width="1.8"/>' +
      '<path d="M8.1 6L7.95 10" stroke-width="1.7"/>' +
      '<path d="M9.1 6.4L10.1 8L9.1 9.6" stroke-width="1.8"/>',
  },

  // 表格：圆角外框 + 表头横线 + 两条竖线
  table: {
    attrs: SOFT,
    body: CARD + '<path d="M2.4 6.4H13.6M6.2 6.4V13.2M9.8 6.4V13.2"/>',
  },

  // 文本段落：两行文字，末行收短
  paragraph: {
    attrs: SHARP,
    body: '<path d="M2.6 5.6H13.4M2.6 10.4H9.6"/>',
  },
};

/* ── 对外接口 ───────────────────────────────────────────────────────── */

function render(name, size, className) {
  const def = DEFS[name];
  const cls = className ? `dsh-icon ${className}` : 'dsh-icon';
  return (
    `<svg viewBox="0 0 16 16" width="${size}" height="${size}" class="${cls}" ` +
    `fill="none" stroke="currentColor" ${def.attrs} aria-hidden="true">${def.body}</svg>`
  );
}

/** 名字 → 16px 标准 svg 字符串（可直接内联） */
export const ICONS_FORMAT = Object.freeze(
  Object.keys(DEFS).reduce((acc, name) => {
    acc[name] = render(name, 16, '');
    return acc;
  }, {}),
);

/**
 * 取某个图标的 svg 字符串。
 * @param {string} name ICONS_FORMAT 里的图标名
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} svg 标记
 */
export function formatIcon(name, { size = 16, className = '' } = {}) {
  if (!Object.prototype.hasOwnProperty.call(DEFS, name)) {
    throw new Error(`[icons-format] 未知图标: ${name}`);
  }
  return render(name, size, className);
}
