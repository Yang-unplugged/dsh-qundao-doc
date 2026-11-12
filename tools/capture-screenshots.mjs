#!/usr/bin/env node
/**
 * 生成 README 用的界面截图。
 *
 *   node tools/capture-screenshots.mjs            # 拍图，产物在 docs/screenshots/
 *   node tools/capture-screenshots.mjs --serve    # 只起服务，浏览器里手动改演示文档
 *
 * 演示文档存在 .screenshot-data/（已 gitignore），不会被删：
 * 想改文案，用 --serve 打开 http://127.0.0.1:4399 直接改，再跑一次脚本重拍。
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/screenshots');
const dataDir = path.join(root, '.screenshot-data');
const port = Number(process.env.SHOT_PORT || 4399);
const serveOnly = process.argv.includes('--serve');
fs.mkdirSync(dataDir, { recursive: true });

const demo = JSON.parse(fs.readFileSync(path.join(root, 'tools/demo-document.json'), 'utf8'));
const content = demo.content;
const DEMO_TITLE = demo.title;



const server = spawn(process.execPath, [path.join(root, 'server/index.mjs')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => server.kill('SIGTERM'));

const cleanupFns = [];
const cleanup = async () => {
  for (const fn of cleanupFns.reverse()) await fn();
  server.kill('SIGTERM');
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
  const api = async (method, url, payload) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const { documents } = await api('GET', '/api/documents');
  const existing = documents.find((d) => d.title === DEMO_TITLE && !d.deletedAt);

  if (existing) {
    console.log(`演示文档已存在（版本 ${existing.revision}）：${path.join(dataDir, 'state.json')}`);
  } else {
    // 用三段文案造历史：初稿 → 改一句 → 最终（最终必须等于 fixture，截图才和正文一致）
    const drafts = [
      '把飞书文档那套块编辑手感搬进 DeepSeek Harness，先写在本机。',
      '把飞书文档那套块编辑手感搬进 DeepSeek Harness，数据只写本机。',
    ];
    const withFirstParagraph = (text) => {
      const variant = JSON.parse(JSON.stringify(content));
      const first = variant.content.find((n) => n.type === 'paragraph' && n.content);
      first.content = [{ type: 'text', text }];
      return variant;
    };

    const { document: doc0 } = await api('POST', '/api/documents', { title: DEMO_TITLE, content: withFirstParagraph(drafts[0]) });
    let rev = doc0.revision;
    for (const text of drafts.slice(1)) {
      const { document: next } = await api('PUT', `/api/documents/${doc0.id}`, {
        title: DEMO_TITLE,
        content: withFirstParagraph(text),
        expectedRevision: rev,
      });
      rev = next.revision;
    }
    const { document: last } = await api('PUT', `/api/documents/${doc0.id}`, { title: DEMO_TITLE, content, expectedRevision: rev });
    rev = last.revision;
    await api('POST', `/api/documents/${doc0.id}/named-versions`, { revision: rev, name: '交付版', expectedRevision: rev });
    console.log('已创建演示文档');
  }

  if (serveOnly) {
    console.log(`\n打开 ${base} 编辑「${DEMO_TITLE}」，保存是自动的。`);
    console.log('改完回到终端 Ctrl-C，然后重跑 node tools/capture-screenshots.mjs 刷新截图。\n');
    await new Promise(() => {});
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  cleanupFns.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
  await page.goto(base);
  await page.locator('#documents button').filter({ hasText: DEMO_TITLE }).first().click();
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
