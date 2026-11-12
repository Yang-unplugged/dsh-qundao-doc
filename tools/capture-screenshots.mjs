#!/usr/bin/env node
/**
 * 生成 README 用的界面截图。
 * 启动一个临时资料库的本地服务，写入一份演示文档，再用 Chrome 截图。
 *
 *   node tools/capture-screenshots.mjs
 * 产物：docs/screenshots/*.png
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/screenshots');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qundao-shots-'));
const port = 4399;

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content) => ({ type: 'paragraph', attrs: { textAlign: null }, content: content.length ? content : undefined });
const h = (level, text) => ({ type: 'heading', attrs: { textAlign: null, level }, content: [t(text)] });
const bullet = (...items) => ({
  type: 'bulletList',
  content: items.map((item) => ({
    type: 'listItem',
    attrs: { collapsed: false },
    content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [t(item)] }],
  })),
});
const cell = (text, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: { verticalAlign: 'top', cellBg: null, colspan: 1, rowspan: 1, colwidth: null, align: null },
  content: text ? [p(t(text))] : [p()],
});
const table = (rows, headerRow = true) => ({
  type: 'table',
  content: rows.map((row, i) => ({
    type: 'tableRow',
    attrs: { rowHeight: null },
    content: row.map((text) => cell(text, headerRow && i === 0)),
  })),
});

const content = {
  type: 'doc',
  attrs: { localComments: null },
  content: [
    p(t('把飞书文档那套块编辑手感搬进 DeepSeek Harness，数据只写在这台机器上。')),
    {
      type: 'callout',
      attrs: { color: 'blue', icon: '💡', textColor: null, borderColor: null, backgroundColor: null },
      content: [p(t('没有云协作，也没有账号体系：文档、评论、版本历史、图片都存在本机目录里，随时整库备份走。'))],
    },
    h(2, '为什么是「本地」'),
    bullet(
      '写完即存：每次编辑都落一次版本，断网也不影响',
      '整库是一个带校验的文件，直接拷走就是备份',
      '冲突可见：别人改过就报 409，不会悄悄覆盖',
    ),
    h(2, '功能对照'),
    table([
      ['能力', '现状', '说明'],
      ['块编辑', '已支持', '标题 1–9、列表、任务、引用、分栏、高亮块'],
      ['表格', '已支持', '9×9 选择器、合并拆分、垂直对齐'],
      ['版本历史', '已支持', '完整历史、命名版本、恢复'],
      ['云协作', '未支持', '不做账号与权限，避免半成品协作'],
    ]),
    h(2, '保存接口'),
    {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [t('await fetch("/api/documents/" + id, {\n  method: "PUT",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ title, content, expectedRevision: revision }),\n});')],
    },
    h(2, '接下来'),
    bullet('注册 docs_* 工具，让 Agent 能读写这些文档', '把「文档属性」入口补回菜单（已完成）', '原创图标与主题色'),
  ],
};

const server = spawn(process.execPath, [path.join(root, 'server/index.mjs')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const cleanupFns = [];
const cleanup = async () => {
  for (const fn of cleanupFns.reverse()) await fn();
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
};

const base = `http://127.0.0.1:${port}`;
const waitReady = async () => {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${base}/api/documents`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

try {
  await waitReady();
  const api = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const { document: doc0 } = await api('POST', '/api/documents', { title: '群岛文档 · 产品说明', content });

  // 制造几条历史版本，并给其中一版命名，截图时历史面板才有内容
  let rev = doc0.revision;
  for (const note of ['补充：本机目录默认是 ~/.dsh/qundao-doc。', '补充：备份就是一个文件，拷走即可。']) {
    const variant = JSON.parse(JSON.stringify(content));
    variant.content.splice(2, 0, { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: note }] });
    const { document: next } = await api('PUT', `/api/documents/${doc0.id}`, { title: doc0.title, content: variant, expectedRevision: rev });
    rev = next.revision;
  }
  await api('POST', `/api/documents/${doc0.id}/named-versions`, { revision: rev, name: '交付版', expectedRevision: rev });

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  cleanupFns.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
  await page.goto(base);
  await page.locator('#documents button').first().click();
  await page.locator('table').first().waitFor();
  await page.waitForTimeout(600);

  fs.mkdirSync(outDir, { recursive: true });
  const shot = async (name, target) => {
    await (target || page).screenshot({ path: path.join(outDir, name) });
    console.log('wrote', path.join('docs/screenshots', name));
  };

  await shot('editor.png');
  await page.locator('aside[data-callout]').first().screenshot({ path: path.join(outDir, 'callout.png') });
  console.log('wrote docs/screenshots/callout.png');
  await page.locator('table').first().screenshot({ path: path.join(outDir, 'table.png') });
  console.log('wrote docs/screenshots/table.png');
  await page.locator('pre').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('pre').first().screenshot({ path: path.join(outDir, 'code.png') });
  console.log('wrote docs/screenshots/code.png');

  await page.locator('#more').click();
  await page.getByRole('menuitem', { name: '历史记录', exact: true }).click();
  await page.locator('#drawer').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const box = await page.locator('#drawer').boundingBox();
  await page.screenshot({
    path: path.join(outDir, 'versions.png'),
    clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 560) },
  });
  console.log('wrote docs/screenshots/versions.png');
} finally {
  await cleanup();
}
