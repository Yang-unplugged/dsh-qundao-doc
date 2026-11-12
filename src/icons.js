/**
 * dsh-documents 线性图标集
 *
 * 设计规范（飞书文档风格）：
 *   - 统一 16×16 画布，1.4px 线性描边（H1~H4 的字标用 1.6，细节用 1.2）
 *   - 线条颜色一律 currentColor，不写死颜色
 *   - 端点 / 转角 round，图形落在 1.5 ~ 14.5 之内
 *   - 所有坐标对齐 .5 或整数网格，16px 下保持可辨识
 *
 * 用法：
 *   import {icon} from './icons.js';
 *   el.innerHTML = icon('link', {size: 16, className: 'toolbar-icon'});
 */

const SVG_ATTRS =
  'viewBox="0 0 16 16" width="16" height="16" class="dsh-icon" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

function svg(body) {
  return `<svg ${SVG_ATTRS}>${body}</svg>`;
}

/** 圆点：用极短线段 + round cap 画成直径 1.4 的点，保持纯描边、纯 currentColor。 */
function dot(x, y) {
  return `M${x} ${y}h.01`;
}

function dots(points, width) {
  const style = width ? ` stroke-width="${width}"` : '';
  return `<path d="${points.map(([x, y]) => dot(x, y)).join('')}"${style}/>`;
}

/** H1~H4 左侧的「H」字标（1.6 粗），右侧跟一个小号数字。 */
const H_GLYPH = '<path d="M2.6 4.6V11.4M5.4 4.6V11.4M2.6 8H5.4" stroke-width="1.6"/>';

/** 数字 1~4 的描边画法（1.4 粗，x 6.8~13.4，y 3.4~12.2）。 */
const DIGITS = {
  1: '<path d="M10.2 6.4L12 4V12.2M10 12.2H13.2" stroke-width="1.4"/>',
  2: '<path d="M7.6 6.2C7.6 4.2 9.2 3.3 10.7 3.5C12.4 3.7 13.1 5.5 11.9 7L7.6 12.2H13.4" stroke-width="1.4"/>',
  3: '<path d="M7.6 4.5C9 3.3 12.9 3.4 12.9 5.9C12.9 7.4 10.7 7.7 9.9 7.7C12.2 7.7 13.3 8.7 13.3 10.1C13.3 12.5 9 13.1 7.6 11.6" stroke-width="1.4"/>',
  4: '<path d="M11.9 12.2V4.1L7.5 10H13.4" stroke-width="1.4"/>',
};

/** 块类型：圆角矩形容器（5 个块类图标共用同一套外框尺寸，保证视觉重量一致）。 */
const FRAME = '<rect x="2.5" y="3.4" width="11" height="9.2" rx="1.6"/>';

export const ICONS = {
  /* ── 块类型 ─────────────────────────────────────────────────────────── */

  // 正文段落：三行文字，末行收短
  paragraph: svg('<path d="M2.5 4.6H13.5M2.5 8H13.5M2.5 11.4H9.5"/>'),

  // 一级标题：H + 1
  h1: svg(H_GLYPH + DIGITS[1]),
  // 二级标题：H + 2
  h2: svg(H_GLYPH + DIGITS[2]),
  // 三级标题：H + 3
  h3: svg(H_GLYPH + DIGITS[3]),
  // 四级标题：H + 4
  h4: svg(H_GLYPH + DIGITS[4]),

  // 无序列表：三个圆点 + 三条横线
  bulletList: svg(dots([[3, 4.6], [3, 8], [3, 11.4]]) + '<path d="M5.6 4.6H13.5M5.6 8H13.5M5.6 11.4H13.5"/>'),

  // 有序列表：1 / 2 / 3 编号 + 三条横线
  orderedList: svg(
    '<path d="M2.6 3.4L3.3 2.7V5.5M2.2 7.5C2.2 6.4 3.6 6.3 3.95 7.1C4.3 7.9 2.8 9 2.2 9.6H4.35M2.2 11.1C2.7 10.4 4.2 10.5 4.2 11.1C4.2 11.6 3.4 11.8 3.4 11.8C4.2 11.8 4.4 12.3 4.4 12.6C4.4 13.4 2.8 13.5 2.2 12.9" stroke-width="1.3"/>' +
      '<path d="M6.6 4H13.5M6.6 8H13.5M6.6 12H13.5"/>',
  ),

  // 任务列表：勾选框 + 空勾选框 + 两条文字线
  taskList: svg(
    '<rect x="2.5" y="3.4" width="3.4" height="3.4" rx="0.9"/>' +
      '<path d="M3.5 5.1L4.3 5.9L5.7 4.3"/>' +
      '<rect x="2.5" y="9.6" width="3.4" height="3.4" rx="0.9"/>' +
      '<path d="M8.4 5.1H13.5M8.4 11.3H13.5"/>',
  ),

  // 高亮块 / 强调块：圆角提示卡片 + 感叹号标记
  callout: svg('<rect x="2.5" y="2.8" width="11" height="10.4" rx="2.6"/><path d="M8 5V8.6"/><path d="M8 10.8h.01"/>'),

  // 代码块：圆角容器 + 内部 < >
  codeBlock: svg(FRAME + '<path d="M6.4 6.4L4.2 8L6.4 9.6M9.6 6.4L11.8 8L9.6 9.6"/>'),

  // 引用：左侧竖引用条 + 三行文字
  quote: svg('<path d="M3 3.4V12.6"/><path d="M6 5.2H13.4M6 8H13.4M6 10.8H10"/>'),

  // 分割线：一条居中横线
  divider: svg('<path d="M2.5 8H13.5"/>'),

  /* ── 行内格式 ───────────────────────────────────────────────────────── */

  // 粗体：B 字形
  bold: svg(
    '<path d="M4.4 3V13M4.4 3H8C11 3 11 8 8 8H4.4M4.4 8H8.9C12.2 8 12.2 13 8.9 13H4.4"/>',
  ),

  // 斜体：I 字形（上下横 + 斜杆）
  italic: svg('<path d="M6.4 3.2H10.4M5.6 12.8H9.6M9.8 3.2L6.2 12.8"/>'),

  // 下划线：U 字形 + 底部横线
  underline: svg('<path d="M5 3.4V7.4A3 3 0 0 0 11 7.4V3.4"/><path d="M3.6 13H12.4"/>'),

  // 删除线：S 字形 + 贯穿横线
  strike: svg(
    '<path d="M11 4.6C10 3.2 6 3 5.4 5C4.8 7 8 7.4 9.6 8C11.8 8.8 11.6 12.2 8 12.2C6.5 12.2 5.4 11.6 4.9 10.7"/>' +
      '<path d="M2.8 8H13.2"/>',
  ),

  // 链接：左右两段链环 + 中间连杆
  link: svg(
    '<path d="M7.2 4.9H5.4A3.1 3.1 0 0 0 5.4 11.1H7.2"/>' +
      '<path d="M8.8 4.9H10.6A3.1 3.1 0 0 1 10.6 11.1H8.8"/>' +
      '<path d="M5.8 8H10.2"/>',
  ),

  // 行内代码：</>
  code: svg(
    '<path d="M5.4 5L2.6 8L5.4 11M10.6 5L13.4 8L10.6 11M9.2 4L6.8 12"/>',
  ),

  // 清除格式：橡皮擦（斜置块 + 分界线）
  clearFormat: svg('<path d="M6.2 3.2L12.8 9.8L9.8 12.8L3.2 6.2Z"/><path d="M8.4 5.4L5.4 8.4"/>'),

  /* ── 对齐与缩进 ─────────────────────────────────────────────────────── */

  // 左对齐：长短交替、全部靠左
  alignLeft: svg('<path d="M2.5 4.2H13.5M2.5 6.9H9.5M2.5 9.6H13.5M2.5 12.3H9.5"/>'),

  // 居中对齐：长短交替、居中对齐
  alignCenter: svg('<path d="M2.5 4.2H13.5M4.8 6.9H11.2M2.5 9.6H13.5M4.8 12.3H11.2"/>'),

  // 右对齐：长短交替、全部靠右
  alignRight: svg('<path d="M2.5 4.2H13.5M6.5 6.9H13.5M2.5 9.6H13.5M6.5 12.3H13.5"/>'),

  // 增加缩进：右向箭头 + 右移的三行文字
  indentUp: svg('<path d="M3 5.6L5.2 8L3 10.4"/><path d="M6.6 4.2H13.5M6.6 8H13.5M6.6 11.8H13.5"/>'),

  // 减少缩进：左向箭头 + 右移的三行文字
  indentDown: svg('<path d="M5.2 5.6L3 8L5.2 10.4"/><path d="M6.6 4.2H13.5M6.6 8H13.5M6.6 11.8H13.5"/>'),

  /* ── 界面图标 ───────────────────────────────────────────────────────── */

  // 新增：加号
  plus: svg('<path d="M8 2.8V13.2M2.8 8H13.2"/>'),

  // 拖拽手柄：两列共六个圆点
  drag: svg(dots([[5.6, 4.2], [5.6, 8], [5.6, 11.8], [10.4, 4.2], [10.4, 8], [10.4, 11.8]])),

  // 更多：横向三点
  more: svg(dots([[3.4, 8], [8, 8], [12.6, 8]])),

  // 展开 / 下拉
  chevronDown: svg('<path d="M4 6.2L8 10.2L12 6.2"/>'),
  // 向右 / 折叠项
  chevronRight: svg('<path d="M6.2 4L10.2 8L6.2 12"/>'),
  // 向左 / 返回
  chevronLeft: svg('<path d="M9.8 4L5.8 8L9.8 12"/>'),

  // 搜索：放大镜
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.4 13.4"/>'),

  // 确认：对勾
  check: svg('<path d="M3.2 8.2L6.4 11.4L12.8 4.6"/>'),

  // 撤销：左向折返箭头
  undo: svg('<path d="M7 9.6L3.6 6.2L7 2.8"/><path d="M3.6 6.2H10.2A3.2 3.2 0 0 1 10.2 12.6H8.3"/>'),

  // 重做：右向折返箭头
  redo: svg('<path d="M9 9.6L12.4 6.2L9 2.8"/><path d="M12.4 6.2H5.8A3.2 3.2 0 0 0 5.8 12.6H7.7"/>'),

  // 删除：垃圾桶
  trash: svg(
    '<path d="M2.8 4.6H13.2"/>' +
      '<path d="M6.2 4.6V2.9H9.8V4.6"/>' +
      '<path d="M4.4 4.6L5 13.2H11L11.6 4.6"/>' +
      '<path d="M6.8 7.2V10.8M9.2 7.2V10.8"/>',
  ),

  // 复制：前后两张纸
  copy: svg(
    '<path d="M10.6 4.6V3.6A1.2 1.2 0 0 0 9.4 2.4H3.6A1.2 1.2 0 0 0 2.4 3.6V9.4A1.2 1.2 0 0 0 3.6 10.6H4.6"/>' +
      '<rect x="5.4" y="5.4" width="7.2" height="7.2" rx="1.4"/>',
  ),

  // 剪切：两环 + 交叉刀片
  scissors: svg(
    '<circle cx="3.8" cy="4.8" r="1.5"/>' +
      '<circle cx="3.8" cy="11.2" r="1.5"/>' +
      '<path d="M5 5.6L12.6 12.4M5 10.4L12.6 3.6"/>',
  ),

  // 历史记录：时钟（历史版本）
  history: svg('<circle cx="8" cy="8" r="4.8"/><path d="M8 5.2V8.1H10.6"/>'),

  // 表格：容器 + 表头 + 两列
  table: svg(FRAME + '<path d="M2.5 6.6H13.5M6.2 6.6V12.6M9.8 6.6V12.6"/>'),

  // 图片：容器 + 山峰 + 太阳
  image: svg(
    FRAME +
      '<circle cx="6" cy="6.6" r="1.1"/>' +
      '<path d="M3.6 11.9L6.7 8.7L9.3 11.3L11 9.6L12.7 11.3"/>',
  ),

  // 公式：Σ
  formula: svg('<path d="M12.2 3.2H4.6L9 8L4.6 12.8H12.2"/>'),

  // 双栏：两个并排卡片
  columns: svg(
    '<rect x="2.5" y="4" width="5" height="8" rx="1"/>' +
      '<rect x="8.5" y="4" width="5" height="8" rx="1"/>',
  ),

  // 音视频：容器 + 播放三角
  media: svg(FRAME + '<path d="M6.8 6L10.4 8L6.8 10Z"/>'),

  // 画板：曲线路径 + 两个锚点
  canvas: svg(
    '<path d="M4.2 12.4C9 12.4 7 3.6 11.8 3.6"/>' +
      '<circle cx="4.2" cy="12.4" r="1.3"/>' +
      '<circle cx="11.8" cy="3.6" r="1.3"/>',
  ),

  // 上移：向上箭头
  moveUp: svg('<path d="M8 13V3.6M4.4 7.2L8 3.6L11.6 7.2"/>'),
  // 下移：向下箭头
  moveDown: svg('<path d="M8 3V12.4M4.4 8.8L8 12.4L11.6 8.8"/>'),

  // 向下插入：下箭头 + 落点横线
  insertBelow: svg('<path d="M8 3.4V10.2M5.2 7.4L8 10.2L10.8 7.4"/><path d="M3 13H13"/>'),

  // 调色盘：盘体 + 四个颜料坑
  palette: svg(
    '<path d="M8 2.6C5.02 2.6 2.6 5.02 2.6 8S5.02 13.4 8 13.4C8.5 13.4 8.9 13 8.9 12.5C8.9 12.27 8.81 12.06 8.67 11.9C8.53 11.74 8.44 11.53 8.44 11.3C8.44 10.8 8.84 10.4 9.34 10.4H10.4C12.06 10.4 13.4 9.06 13.4 7.4C13.4 4.75 10.98 2.6 8 2.6Z"/>' +
      dots([[4.7, 8], [6.5, 5.6], [9.5, 5.6], [11.3, 8]], 1.2),
  ),

  // 文字颜色：A + 色条
  textColor: svg(
    '<path d="M3.2 10.8L6.8 3.4L10.4 10.8"/><path d="M4.6 8.2H9.1"/><path d="M2.8 13.4H13.2" stroke-width="1.6"/>',
  ),

  // 高亮：马克笔 + 底部高亮条
  highlight: svg(
    '<path d="M9.8 3L13 6.2L8.2 11H4V8.8Z"/><path d="M3 13.4H13" stroke-width="1.6"/>',
  ),

  // 设置：滑杆（两条带旋钮的调节线）
  settings: svg(
    '<path d="M2.8 5.2H8.1M11.1 5.2H13.2M2.8 10.8H4.9M7.9 10.8H13.2"/>' +
      '<circle cx="9.6" cy="5.2" r="1.5"/>' +
      '<circle cx="6.4" cy="10.8" r="1.5"/>',
  ),
};

/**
 * 取一个图标的 svg 字符串。
 * @param {string} name ICONS 中的图标名
 * @param {{size?: number|string, className?: string}} [options]
 * @returns {string} 可直接塞进 innerHTML 的 svg 源码
 */
export function icon(name, {size = 16, className = ''} = {}) {
  const markup = ICONS[name];
  if (typeof markup !== 'string') {
    throw new Error(`[icons] 未知图标：${String(name)}`);
  }
  if (size === 16 && !className) return markup;
  const dimension = String(size);
  const classes = className ? `dsh-icon ${className}` : 'dsh-icon';
  return markup
    .replace(' width="16"', ` width="${dimension}"`)
    .replace(' height="16"', ` height="${dimension}"`)
    .replace('class="dsh-icon"', `class="${classes}"`);
}

export default ICONS;
