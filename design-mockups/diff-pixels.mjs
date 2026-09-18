/**
 * 逐像素 diff 两张同尺寸截图：报告差异像素数、占比、差异包围盒，并导出一张 diff 图
 * （底图淡化 25%，差异像素标成品红），用来证明「除了想改的地方，别的都没动」。
 *
 * 依赖一个带 CDP 的 Chrome（借它的 canvas 解码 PNG）。
 * 用法: node design-mockups/diff-pixels.mjs <a.png> <b.png> [out-diff.png] [阈值=12]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , fileA, fileB, outDiff, thresholdArg] = process.argv;
if (!fileA || !fileB) { console.error('usage: diff-pixels.mjs <a.png> <b.png> [out-diff.png] [threshold]'); process.exit(1); }
const THRESHOLD = Number(thresholdArg ?? 12);
const PORT = process.env.CDP_PORT ?? 9222;

const b64a = readFileSync(fileA).toString('base64');
const b64b = readFileSync(fileB).toString('base64');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) { console.error('no page target (需要带 --remote-debugging-port 的 Chrome)'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Page.enable');

const expr = `(async () => {
  const load = async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: c.getContext('2d').getImageData(0, 0, img.width, img.height).data };
  };
  const A = await load(${JSON.stringify(b64a)});
  const B = await load(${JSON.stringify(b64b)});
  if (A.w !== B.w || A.h !== B.h) return { error: 'size mismatch', a: [A.w, A.h], b: [B.w, B.h] };
  const T = ${THRESHOLD};
  const out = document.createElement('canvas'); out.width = A.w; out.height = A.h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(A.w, A.h);
  let changed = 0, minX = A.w, minY = A.h, maxX = -1, maxY = -1;
  for (let i = 0; i < A.d.length; i += 4) {
    const diff = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i+1] - B.d[i+1]), Math.abs(A.d[i+2] - B.d[i+2]));
    const p = i / 4, x = p % A.w, y = (p - x) / A.w;
    if (diff > T) {
      changed += 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      img.data[i] = 255; img.data[i+1] = 0; img.data[i+2] = 170; img.data[i+3] = 255;
    } else {
      img.data[i] = 170 + A.d[i] * 0.2; img.data[i+1] = 170 + A.d[i+1] * 0.2;
      img.data[i+2] = 170 + A.d[i+2] * 0.2; img.data[i+3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const total = A.w * A.h;
  return {
    size: [A.w, A.h], changed, total, ratio: +(changed / total * 100).toFixed(3),
    bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
    dataUrl: out.toDataURL('image/png'),
  };
})()`;

const { result } = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const r = result.value;
if (!r || r.error) { console.error(JSON.stringify(r)); process.exit(1); }
console.log(JSON.stringify({ size: r.size, changed: r.changed, total: r.total, changedPercent: r.ratio, bbox: r.bbox }, null, 2));
if (outDiff) {
  writeFileSync(outDiff, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
  console.log('saved', outDiff);
}
ws.close();
process.exit(0);
