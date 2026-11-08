#!/usr/bin/env node
/**
 * 构建产物页面冒烟（零依赖，headless Chrome + vite preview）
 *
 * 用法（在 react-app 目录，需先 npm run build）：
 *   npm run smoke:pages
 *
 * 从 src/App.jsx 读取全部静态路由，逐个打开 `#/<route>`，检查：
 *   1) #root 有子节点（懒加载页面真的渲染了，而不是白屏）；
 *   2) 该页期间没有未捕获异常 / console.error。
 * 动态路由（含 `:` 参数）跳过。找不到 Chrome 时打印跳过说明并退出 0。
 * 任一页面失败退出 1。verify 已在 build 之后串联本脚本。
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 取一个空闲端口，避免和已运行的 dev server（5199）冲突 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function findChrome() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

function routesFromApp() {
  const source = fs.readFileSync(path.join(APP_DIR, 'src/App.jsx'), 'utf8');
  return [...new Set([...source.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))]
    .filter((p) => p !== '*' && !p.includes(':'));
}

async function startPreview() {
  const viteBin = path.join(APP_DIR, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(viteBin)) throw new Error('未找到 vite，请先 npm install');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: APP_DIR,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`vite preview 退出（code ${child.exitCode}）`);
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return { child, base };
    } catch {}
    await sleep(250);
  }
  try { child.kill(); } catch {}
  throw new Error(`vite preview 未在 ${base} 就绪`);
}

class Cdp {
  static async launch(chrome, profile) {
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(chrome, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--mute-audio',
      'about:blank',
    ], { stdio: 'ignore' });

    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(portFile)) {
        port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
        if (port) break;
      }
      if (child.exitCode !== null) break;
      await sleep(200);
    }
    if (!port) throw new Error('Chrome 启动失败（无法连接 DevTools）');

    let target = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch {}
      await sleep(200);
    }
    if (!target) throw new Error('Chrome 未创建页面目标');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('DevTools WebSocket 连接失败'));
    });
    return new Cdp(ws, child, profile);
  }

  constructor(ws, child, profile) {
    this.ws = ws;
    this.child = child;
    this.profile = profile;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '页面异常');
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') {
        this.errors.push(msg.params.entry.text);
      }
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面脚本执行失败');
    return res.result.value;
  }

  async waitFor(expression, predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const v = await this.evaluate(expression);
        if (predicate(v)) return v;
      } catch {}
      await sleep(150);
    }
    return null;
  }

  async close() {
    try { this.ws.close(); } catch {}
    try { this.child.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const routes = routesFromApp();
  const chrome = findChrome();
  if (!chrome) {
    console.log('⚠ 未找到 Chrome/Edge，跳过页面冒烟（安装 Chrome 后自动生效）');
    return;
  }
  if (!fs.existsSync(path.join(APP_DIR, 'dist/index.html'))) {
    throw new Error('dist/index.html 不存在，先 npm run build');
  }

  let preview;
  let cdp;
  const failures = [];
  try {
    const started = await startPreview();
    preview = started.child;
    const base = started.base;
    const profile = path.join(os.tmpdir(), `page-smoke-${crypto.randomBytes(4).toString('hex')}`);
    cdp = await Cdp.launch(chrome, profile);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable').catch(() => {});

    for (const route of routes) {
      cdp.errors.length = 0;
      const url = `${base}/#${route}`;
      await cdp.send('Page.navigate', { url });
      const rootCount = await cdp.waitFor('document.querySelector("#root") ? document.querySelector("#root").children.length : 0', (v) => v > 0, 8000);
      await sleep(250);
      const realErrors = cdp.errors.filter((e) => !/favicon/i.test(e));
      if (!rootCount) failures.push(`${route}: 白屏（#root 无子节点）`);
      else if (realErrors.length) failures.push(`${route}: ${realErrors[0].slice(0, 160)}`);
      console.log(`${rootCount && !realErrors.length ? '✓' : '✗'} ${route}`);
    }
  } finally {
    if (cdp) await cdp.close();
    if (preview) {
      try { preview.kill(); } catch {}
      await sleep(300);
    }
  }

  console.log(`\n页面冒烟：${routes.length - failures.length}/${routes.length} 通过`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`页面冒烟失败：${error.message}`);
  process.exitCode = 1;
});
