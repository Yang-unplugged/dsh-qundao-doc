# 图标来源

界面图标全部来自用户提供的三套飞书复刻资产，已复制进 `assets/feishu-icons/`，构建时由 `tools/build-icons.mjs` 挑选、清理并生成 `src/icons-vendor.js`。

| 目录 | 来源 | 说明 |
|---|---|---|
| `assets/feishu-icons/toolbar/` | toolbar-svg-assets | 浮条：B/S/I/U、链接、代码、文字颜色 A、左对齐、下拉箭头 |
| `assets/feishu-icons/menu/` | feishu-menu-svg-assets | 块菜单/插入菜单：标题、列表、任务、代码块、引用、高亮块、分割线、表格、图片、视频或文件、分栏、公式等（含彩色版） |
| `assets/feishu-icons/live/` | feishu-live-icons-svg（currentColor） | 实机抓取：块样式、对齐、缩进、拖拽点、历史、搜索、文档、复制、剪切、删除、换行、合并拆分等 |
| `assets/feishu-icons/live-color/` | feishu-live-icons-svg（原色） | 画板等保留原色的图标 |

这些是按截图/客户端实机重建的矢量，**不是飞书官方源文件**；不随包分发第三方许可证。
个别图标按需另行着色（如浮条的文字颜色 A 用 `#d83931`，与原版一致）。

生成命令：

```bash
node tools/build-icons.mjs   # 重新生成 src/icons-vendor.js
```

`src/icons.js`（早期 51 个单色图标）目前只保留给块菜单的「向上/向下移动」使用（飞书实测未观察到这两个按钮，没有可复刻的版本）。
`src/icons-format.js`、`src/icons-color.js` 保留作参考，已不再被引用。
