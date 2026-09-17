/** 在图片里搜索指定颜色，返回出现的区域范围 */
const [, , file, ...colorArgs] = process.argv;
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
  const targets = ${JSON.stringify(colorArgs.map((s) => s.split(',').map(Number)))};
  const hits = targets.map(() => ({ count: 0, minX: 1e9, maxX: -1, minY: 1e9, maxY: -1 }));
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      for (let k = 0; k < targets.length; k += 1) {
        const t = targets[k];
        if (Math.abs(data[i] - t[0]) <= 3 && Math.abs(data[i+1] - t[1]) <= 3 && Math.abs(data[i+2] - t[2]) <= 3) {
          const h = hits[k]; h.count += 1;
          if (x < h.minX) h.minX = x; if (x > h.maxX) h.maxX = x;
          if (y < h.minY) h.minY = y; if (y > h.maxY) h.maxY = y;
        }
      }
    }
  }
  return { size: [img.width, img.height], hits };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
ws.close(); process.exit(0);
