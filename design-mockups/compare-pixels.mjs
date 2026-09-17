/**
 * 逐像素对比两张截图（同一坐标取色），用来判断「谁更白」。
 * 用法: node compare-pixels.mjs <a.png> <b.png> [x1,y1 x2,y2 ...]  （CSS 像素坐标，内部 ×2）
 */
const [, , fileA, fileB, ...pointArgs] = process.argv;
const POINTS = (pointArgs.length > 0
  ? pointArgs
  : [
      '8,450', // 页面背景（左）
      '1432,450', // 页面背景（右）
      '700,45', // 顶栏空白处
      '700,100', // 指数条第 2 格空白处
      '800,230', // 「我的票」卡片表头空白处
      '1200,230', // 右侧竞价卡表头空白处
      '700,894', // 底部背景
    ]
).map((s) => s.split(',').map(Number));
const SCALE = Number(process.env.SCALE ?? 2);
const PORT = process.env.CDP_PORT ?? 9222;
const { readFileSync } = await import('node:fs');
const b64a = readFileSync(fileA).toString('base64');
const b64b = readFileSync(fileB).toString('base64');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = targets.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

const expr = `(async () => {
  const load = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0); return c.getContext('2d'); };
  const ctxA = await load(${JSON.stringify(b64a)});
  const ctxB = await load(${JSON.stringify(b64b)});
  const points = ${JSON.stringify(POINTS)};
  const px = (h) => (x, y) => { const d = h.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  const a = px(ctxA), b = px(ctxB);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { size: [ctxA.canvas.width, ctxA.canvas.height],
    rows: points.map(([x, y]) => { const A = a(x * ${SCALE}, y * ${SCALE}); const B = b(x * ${SCALE}, y * ${SCALE});
      return { point: x + ',' + y, design: hex(A), impl: hex(B), delta: [B[0] - A[0], B[1] - A[1], B[2] - A[2]] }; }) };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
ws.close(); process.exit(0);
