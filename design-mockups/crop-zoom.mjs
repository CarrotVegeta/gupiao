/**
 * 把截图局部放大后另存，用来看清某条线/某个像素级细节。
 * 用法: node crop-zoom.mjs <in.png> <x> <y> <w> <h> <scale> <out.png>
 */
const [, , src, xArg, yArg, wArg, hArg, scaleArg, out] = process.argv;
const [x, y, w, h, scale] = [xArg, yArg, wArg, hArg, scaleArg].map(Number);
const PORT = process.env.CDP_PORT ?? 9222;
const { readFileSync, writeFileSync } = await import('node:fs');
const b64 = readFileSync(src).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = targets.find((tt) => tt.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);
await send('Emulation.setDeviceMetricsOverride', {
  width: Math.round(w * scale), height: Math.round(h * scale), deviceScaleFactor: 1, mobile: false,
});

const expr = `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; await img.decode();
  document.body.style.margin = '0';
  const c = document.createElement('canvas');
  c.width = ${Math.round(w * scale)}; c.height = ${Math.round(h * scale)};
  c.style.display = 'block';
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ${x}, ${y}, ${w}, ${h}, 0, 0, c.width, c.height);
  document.body.appendChild(c);
  return { srcSize: [img.width, img.height] };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out, JSON.stringify(r.result?.value));
ws.close(); process.exit(0);
