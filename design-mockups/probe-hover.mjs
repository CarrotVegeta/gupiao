/** 悬停顶栏主按钮后截图，用来确认 hover 不再是旧的红色 */
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(3500);
const box = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => { const b = [...document.querySelectorAll('.app-topbar button')].find((x) => x.textContent.includes('添加股票')); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
});
const { x, y } = box.result.value;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
await sleep(600);
const color = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => { const b = [...document.querySelectorAll('.app-topbar button')].find((x) => x.textContent.includes('添加股票')); return getComputedStyle(b).backgroundColor; })()`,
});
console.log('primary hover background:', color.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 1100, y: 10, width: 340, height: 70, scale: 3 } });
const { writeFileSync } = await import('node:fs');
writeFileSync('design-mockups/shots/fix-app-hover.png', Buffer.from(shot.data, 'base64'));
ws.close(); process.exit(0);
