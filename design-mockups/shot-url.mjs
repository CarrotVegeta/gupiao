/** 通用截图：node shot-url.mjs <url> <out.png> [w] [h] [waitMs] [fullPage] */
const [, , url, out, w = '1440', h = '900', wait = '2500', full = '0'] = process.argv;
const PORT = process.env.CDP_PORT ?? 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = targets.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url });
await sleep(Number(wait));
if (full === '1') {
  const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
  const sh = Math.min(Number(result.value) || Number(h), 4000);
  await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: sh, deviceScaleFactor: 1.5, mobile: false });
  await sleep(800);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close(); process.exit(0);
