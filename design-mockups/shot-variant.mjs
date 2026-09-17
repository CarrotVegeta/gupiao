/**
 * 在给定视口下截图，并可注入一段临时 CSS 做「A/B 观感对比」
 * 用法: node shot-variant.mjs <out.png> [w] [h] [extraCss]
 */
const [, , out, w = '1670', h = '1352', extraCss = ''] = process.argv;
const PORT = process.env.CDP_PORT ?? 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = {
  groups: [
    { id: 'g-agri', name: '农业', isSystem: false, createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'g-gold', name: '黄金', isSystem: false, createdAt: '2026-09-01T00:00:00.000Z' },
  ],
  holdings: [
    ['h1', '600313', '农发种业', 'g-agri', 7.02, 10000, ''],
    ['h2', '600127', '金健米业', 'g-agri', 12.5, 2000, '涨停'],
    ['h3', '002041', '登海种业', 'g-agri', 9.6, 3000, ''],
    ['h4', '000506', '招金黄金', 'g-gold', 19.4, 1000, ''],
    ['h5', '600519', '贵州茅台', null, 1258, 100, ''],
    ['h6', '000032', '深桑达Ａ', null, 14.2, 1000, ''],
    ['h7', '002081', '金螳螂', null, 4.72, 5000, ''],
    ['h8', '000001', '平安银行', null, 11.5, 2000, ''],
    ['h9', '605058', '澳弘电子', null, null, null, '看能否连板'],
    ['h10', '001216', '华瓷股份', null, null, null, ''],
  ].map(([id, symbol, name, groupId, openPrice, quantity, note]) => ({
    id, symbol, name, groupId: groupId ?? '', openPrice, quantity, note,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })),
};
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = targets.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('stock-dashboard:v1', ${JSON.stringify(JSON.stringify(SEED))});`,
});
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(3800);
if (extraCss) {
  await send('Runtime.evaluate', {
    expression: `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.appendChild(s); })()`,
  });
  await sleep(500);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close(); process.exit(0);
