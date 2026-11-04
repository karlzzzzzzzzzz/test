#!/usr/bin/env node
/**
 * 移动端审计（统一入口，无第三方依赖）
 *
 * 用法（在 react-app 目录，先起 dev 或 preview）：
 *   npm run audit:mobile
 *   npm run audit:mobile -- --url http://localhost:5199/#/docs --selector '#root'
 *   npm run audit:mobile -- --widths 320,375,414 --no-shots
 *
 * 检查项：320~1024 各档横向溢出/元素越界、可见文本最小字号、可点热区尺寸。
 * 有任一违规时退出码 1，并输出 JSON 明细；默认在 320/375 各存一张整屏截图。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const opts = {
  url: valueOf('--url', 'http://localhost:5199/#/'),
  selector: valueOf('--selector', '#root'),
  widths: valueOf('--widths', '320,360,375,414,480,600,768,820,1024').split(',').map(Number).filter(Boolean),
  shots: args.includes('--no-shots') ? '' : path.resolve(valueOf('--shots', path.join(APP_DIR, '../mobile-audit-shots'))),
  minFont: Number(valueOf('--min-font', '12')),
  minTarget: Number(valueOf('--min-target', '40')),
  timeout: Number(valueOf('--timeout', '20000')),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

async function launch() {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome/Edge，无法执行移动端审计');
  const profile = path.join(os.tmpdir(), `mobile-audit-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--mute-audio',
    '--hide-scrollbars',
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
  if (!port) {
    try { child.kill(); } catch {}
    throw new Error('Chrome 启动失败（无法连接 DevTools）');
  }

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(200);
  }
  if (!target) {
    try { child.kill(); } catch {}
    throw new Error('Chrome 未创建页面目标');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools WebSocket 连接失败'));
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}, timeoutMs = 20000) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} 超时`)); }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面脚本执行失败');
    return res.result.value;
  };

  const waitFor = async (expression, predicate, label) => {
    const deadline = Date.now() + opts.timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(expression);
        if (predicate(last)) return last;
      } catch {}
      await sleep(250);
    }
    throw new Error(`等待超时：${label}`);
  };

  const close = async () => {
    try { ws.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  return { send, evaluate, waitFor, close, profile };
}

const measureScript = (selector, minFont, minTarget) => `(() => {
  const root = document.querySelector(${JSON.stringify(selector)});
  if (!root) return JSON.stringify({ error: 'selector not found' });
  const srOnly = (el) => el.classList.contains('sr-only')
    || getComputedStyle(el).clipPath === 'inset(50%)';
  const outside = [];
  const fontOffenders = [];
  let minFontSeen = 999;
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    if (!srOnly(el)) {
      if (r.right > innerWidth + 1 || r.left < -1) {
        outside.push(String(el.className || el.tagName).slice(0, 40) + '@' + Math.round(r.right) + '/' + Math.round(r.left));
      }
      if (el.scrollWidth - el.clientWidth > 1) outside.push('scroll:' + String(el.className || el.tagName).slice(0, 30));
    }
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minFontSeen) minFontSeen = fs;
    if (fs < ${minFont}) fontOffenders.push(String(el.className || el.tagName).slice(0, 30) + ':' + fs);
  }
  const smallTargets = [];
  for (const el of root.querySelectorAll('a, button, input, select, textarea, summary, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.width < ${minTarget} - 0.5 || r.height < ${minTarget} - 0.5) {
      smallTargets.push((el.textContent || el.tagName).trim().slice(0, 16) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  const doc = document.documentElement;
  return JSON.stringify({
    viewport: innerWidth,
    pageOverflowX: doc.scrollWidth - doc.clientWidth,
    bodyOverflowX: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
    rootWidth: Math.round(root.getBoundingClientRect().width),
    outside: [...new Set(outside)].slice(0, 8),
    minFont: Math.round(minFontSeen * 10) / 10,
    fontOffenders: [...new Set(fontOffenders)].slice(0, 8),
    smallTargets: [...new Set(smallTargets)].slice(0, 8),
  });
})()`;

async function main() {
  if (opts.shots) fs.mkdirSync(opts.shots, { recursive: true });

  const cdp = await launch();
  const results = [];
  const violations = [];
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: opts.url });
    await cdp.waitFor('document.readyState', (s) => s === 'complete', '页面加载');
    await cdp.waitFor(`!!document.querySelector(${JSON.stringify(opts.selector)})`, (v) => !!v, `选择器 ${opts.selector}`);
    await sleep(600);

    for (const width of opts.widths) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: true });
      await sleep(450);
      const raw = await cdp.evaluate(measureScript(opts.selector, opts.minFont, opts.minTarget));
      const m = JSON.parse(raw);
      if (m.error) throw new Error(m.error);
      const bad = m.pageOverflowX > 1 || m.outside.length || m.fontOffenders.length || m.smallTargets.length;
      if (bad) violations.push({ width, ...m });
      results.push(m);
      console.log(`${bad ? '✗' : '✓'} ${width}px 横向溢出=${m.pageOverflowX} 越界=${m.outside.length} 最小字号=${m.minFont} 小热区=${m.smallTargets.length}`);

      if (opts.shots && (width === 320 || width === 375)) {
        const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(opts.shots, `mobile-audit-${width}.png`);
        fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
        console.log(`  截图：${file}`);
      }
    }
  } finally {
    await cdp.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    url: opts.url,
    selector: opts.selector,
    widths: results.map((r) => ({
      viewport: r.viewport,
      pageOverflowX: r.pageOverflowX,
      outside: r.outside.length,
      minFont: r.minFont,
      smallTargets: r.smallTargets.length,
    })),
    violations,
  }, null, 2));
  if (violations.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`审计失败：${error.message}`);
  process.exitCode = 1;
});
