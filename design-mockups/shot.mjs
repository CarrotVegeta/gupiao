/**
 * 给真实运行中的应用截图（通过 CDP，可预置 localStorage 后加载）
 * 用法: node design-mockups/shot.mjs <输出png> [页面] [宽] [高]
 */
const [, , out = '/tmp/app.png', page = 'watchlist', width = '1440', height = '900'] = process.argv;
const PORT = Number(process.env.CDP_PORT ?? 9222);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 预置一组真实的持仓/观察数据，避免截到空页面
const SEED = {
  groups: [
    { id: 'g-agri', name: '农业', isSystem: false, createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'g-gold', name: '黄金', isSystem: false, createdAt: '2026-09-01T00:00:00.000Z' },
  ],
  holdings: [
    ['h1','600313','农发种业','g-agri',7.02,10000,''],
    ['h2','600127','金健米业','g-agri',12.5,2000,'涨停'],
    ['h3','002041','登海种业','g-agri',9.6,3000,''],
    ['h4','000506','招金黄金','g-gold',19.4,1000,''],
    ['h5','600519','贵州茅台',null,1258,100,''],
    ['h6','000032','深桑达Ａ',null,14.2,1000,''],
    ['h7','002081','金螳螂',null,4.72,5000,''],
    ['h8','000001','平安银行',null,11.5,2000,''],
    ['h9','605058','澳弘电子',null,null,null,'看能否连板'],
    ['h10','001216','华瓷股份',null,null,null,''],
    ['h11','003026','中晶科技',null,null,null,''],
  ].map(([id, symbol, name, groupId, openPrice, quantity, note]) => ({
    id, symbol, name, groupId: groupId ?? '', openPrice, quantity, note,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })),
};

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve) => {
  const msgId = ++id;
  pending.set(msgId, resolve);
  ws.send(JSON.stringify({ id: msgId, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width), height: Number(height), deviceScaleFactor: 2, mobile: false,
});
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('stock-dashboard:v1', ${JSON.stringify(JSON.stringify(SEED))});`,
});
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(3500);
// 切到目标页面
const labels = { watchlist: '自选', holdings: '持仓', 'limit-up': '涨停聚焦', auction: '竞价', 'dragon-tiger': '龙虎榜' };
if (labels[page]) {
  await send('Runtime.evaluate', {
    expression: `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')?.startsWith(${JSON.stringify(labels[page])}));if(b)b.click();})()`,
  });
  await sleep(2500);
}
if (process.env.FULL === '1') {
  const { result } = await send('Runtime.evaluate', {
    expression: 'document.documentElement.scrollHeight',
    returnByValue: true,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width),
    height: Math.min(Number(result.value) || Number(height), 2600),
    deviceScaleFactor: 1.6,
    mobile: false,
  });
  await sleep(600);
}
if (process.env.CLICK) {
  await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(process.env.CLICK)})?.click()` });
  await sleep(1200);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close();
process.exit(0);
