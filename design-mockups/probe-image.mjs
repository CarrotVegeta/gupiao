/** 采样一张 PNG 里某条水平线的颜色变化，用来确认「有没有底色块」这类问题 */
const [, , file, yArg, x0Arg, x1Arg] = process.argv;
const b64 = (await import('node:fs')).readFileSync(file).toString('base64');
const PORT = process.env.CDP_PORT ?? 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = targets.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
const expr = `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const y = ${yArg};
  const out = []; let prev = null;
  for (let x = ${x0Arg}; x < ${x1Arg}; x += 2) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    const key = d[0] + ',' + d[1] + ',' + d[2];
    if (key !== prev) { out.push(x + ' → ' + key); prev = key; }
  }
  return { size: [img.width, img.height], y, bands: out };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
ws.close(); process.exit(0);
