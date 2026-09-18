/**
 * 静态 HTML 设计稿截图（精确视口 + 可选局部放大）
 * 用法: node design-mockups/shot-html.mjs <file.html> <out.png> [w=1440] [h=900] [scale=2] [clipX,clipY,clipW,clipH]
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';

const [, , file, out, w = '1440', h = '900', scale = '2', clip] = process.argv;
if (!file || !out) { console.error('usage: shot-html.mjs <file.html> <out.png> [w] [h] [scale] [clip]'); process.exit(1); }
const PORT = 9334;
const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, 'about:blank',
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
  width: Number(w), height: Number(h), deviceScaleFactor: Number(scale), mobile: false,
});
await send('Page.navigate', { url: pathToFileURL(file).href });
await sleep(1500); // 让内联脚本画完 K 线/迷你图

const params = { format: 'png' };
if (clip) {
  const [x, y, cw, ch] = clip.split(',').map(Number);
  params.clip = { x, y, width: cw, height: ch, scale: Math.max(1, Number(scale)) };
}
const shot = await send('Page.captureScreenshot', params);
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close();
child.kill();
process.exit(0);
