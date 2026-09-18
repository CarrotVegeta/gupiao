/**
 * 静态 HTML 设计稿的布局体检：溢出、越界、关键容器尺寸
 * 用法: node design-mockups/probe-layout.mjs <file.html> [w] [h] [selectorPrefix]
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const [, , file, w = '1440', h = '900', prefix = ''] = process.argv;
if (!file) { console.error('usage: probe-layout.mjs <file.html> [w] [h] [selector]'); process.exit(1); }
const PORT = 9333;
const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--window-size=${w},${h}`, 'about:blank',
], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 40 && !list; i++) {
  await sleep(250);
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* retry */ }
}
const target = list?.find((t) => t.type === 'page');
if (!target) { child.kill(); console.error('无法启动 headless chrome'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: pathToFileURL(file).href });
await sleep(1200);

const expr = `(() => {
  const W = innerWidth, H = innerHeight;
  const out = { viewport: [W, H], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], boxes: [], overflow: [], clipped: [] };
  const sel = ${JSON.stringify(prefix)} || null;
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' && el.className.trim()
    ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  for (const el of document.querySelectorAll(sel ? sel + ' *' : 'body *')) {
    if (el.hasAttribute('data-decor') || /(^|\s)glow(\s|$)/.test(el.className || '')) continue; // 装饰性光斑不算越界
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom > H + 1 || r.right > W + 1 || r.top < -1 || r.left < -1) {
      out.overflow.push({ tag: name(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
    }
    // 被最近的可裁剪祖先切掉的部分（父容器 overflow != visible）
    let p = el.parentElement, clip = null;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.overflow !== 'visible' || s.overflowY !== 'visible' || s.overflowX !== 'visible') { clip = p; break; }
      p = p.parentElement;
    }
    if (clip) {
      const c = clip.getBoundingClientRect();
      if (r.bottom > c.bottom + 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.left < c.left - 1) {
        out.clipped.push({ tag: name(el), in: name(clip),
          over: [Math.round(c.right - r.right), Math.round(c.bottom - r.bottom)] });
      }
    }
  }
  out.overflow = out.overflow.slice(0, 25);
  out.clipped = out.clipped.slice(0, 25);
  for (const s of ${JSON.stringify(['header', 'footer', '.main', '.grid', '.wrap', '.holds', '.hcard', '.bottom', '.lanes', '.rail', 'aside', 'section', 'table', '.heatmap',
    '.shell', '.phone', '.status', '.apphead', '.indices', '.mood', '.chips', '.list', '.tabbar', '.row', '.sumcard', '.hero', '.rows', '.board', '.axis', '.lane', '.lane__body'])} ) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.boxes.push({ sel: s, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], h: Math.round(r.height) });
  }
  return out;
})()`;

const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(result.value, null, 2));
ws.close();
child.kill();
process.exit(0);
