/** 在一个会话里扫描多个视口宽度，报告是否有横向溢出（scrollWidth > innerWidth） */
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(3500);
const widths = [];
for (let w = 1180; w <= 2000; w += 40) widths.push(w);
const out = [];
for (const w of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(220);
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => { const tb = document.querySelector('.app-topbar').getBoundingClientRect();
      return { w: innerWidth, sw: document.documentElement.scrollWidth, left: Math.round(tb.left), right: Math.round(tb.right) }; })()`,
  });
  out.push(r.result.value);
}
console.log(JSON.stringify(out.map((o) => `${o.w}:${o.sw}${o.sw > o.w ? ' OVERFLOW' : ''} L${o.left}/R${o.right}(margin L${o.left} R${o.w - o.right})`), null, 0).replace(/","/g, '",\n "'));
ws.close(); process.exit(0);
