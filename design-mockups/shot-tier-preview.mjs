/**
 * 「只在真实界面上加两处」的对照截图：分档变色/加底 + 换手·量比档位词。
 *
 * 做法是把改动注入正在运行的 dev server 页面（CDP），而不是另写一份 HTML，
 * 这样除了这两处，界面上的任何东西（首字头像、行高、列宽、右栏）都不会变。
 *
 * 前置：dev server 跑在 http://localhost:5174，Chrome 带 --remote-debugging-port=9222。
 * 用法: node design-mockups/shot-tier-preview.mjs
 */
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const OUT = new URL('./renders/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 和 shot.mjs 同一份种子：11 只自选（其中 4 只有开仓价/数量） */
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
    ['h11', '003026', '中晶科技', null, null, null, ''],
  ].map(([id, symbol, name, groupId, openPrice, quantity, note]) => ({
    id, symbol, name, groupId: groupId ?? '', openPrice, quantity, note,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })),
};

/* ------------------------------------------------------------------ 注入脚本 */

/**
 * 只做两件事：
 *   1) 涨跌幅 / 自选收益 / 持仓收益 的值本身按档变色、极端档加底
 *   2) 换手、量比 两个值后面补一个档位词
 * 加底用 padding+负 margin，视觉上鼓出来但不占布局，列宽行高都动不了。
 */
const INJECT = String.raw`(() => {
  const style = document.createElement('style');
  style.id = 'tier-style';
  style.textContent = [
    // 档位样式都写成 .tier-hl.tier-hl--x（两个类），才能压过界面里自带的
    // .quote-row__chg.value--rise / .value--fall 那套颜色与 background:none。
    '.tier-hl{border-radius:4px;font-weight:700}',
    '.tier-hl--pad{padding:0 5px;margin:0 -5px}',
    '.tier-hl.tier-hl--limit{background:#D8202B;color:#fff}',
    '.tier-hl.tier-hl--limit strong,.tier-hl.tier-hl--limit span{color:#fff}',
    '.tier-hl.tier-hl--limitd{background:#0E9F5B;color:#fff}',
    '.tier-hl.tier-hl--limitd strong,.tier-hl.tier-hl--limitd span{color:#fff}',
    '.tier-hl.tier-hl--up2{background:#FDECEC;box-shadow:inset 0 0 0 1px #F7D5D8;color:#C81722}',
    '.tier-hl.tier-hl--up2 strong,.tier-hl.tier-hl--up2 span{color:#C81722}',
    '.tier-hl.tier-hl--down2{background:#E8F7F0;box-shadow:inset 0 0 0 1px #CFEBDE;color:#0C8A4D}',
    '.tier-hl.tier-hl--down2 strong,.tier-hl.tier-hl--down2 span{color:#0C8A4D}',
    '.tier-hl.tier-hl--up1,.tier-hl.tier-hl--up1 strong,.tier-hl.tier-hl--up1 span{color:#D8202B}',
    '.tier-hl.tier-hl--down1,.tier-hl.tier-hl--down1 strong,.tier-hl.tier-hl--down1 span{color:#0E9F5B}',
    '.tier-hl.tier-hl--flat,.tier-hl.tier-hl--flat strong{color:#59616F}',
    // 档位词绝对定位在值的正下方：脱离文档流 → 不占列宽、不撑行高，别的什么都不动
    '.quote-table tbody td.tier-host{position:relative}',
    '.tier-word{position:absolute;right:1.3846rem;bottom:0.1538rem;font-size:0.7692rem;line-height:1;font-weight:650;white-space:nowrap}',
    '.tier-word--dim{color:#949CAB}.tier-word--ink{color:#59616F}',
    '.tier-word--amber{color:#C2760A}.tier-word--rise{color:#C81722}.tier-word--fall{color:#0E9F5B}',
  ].join('');
  if (!document.getElementById('tier-style')) document.head.appendChild(style);

  const num = (text) => {
    const m = String(text).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  /** 持仓收益那格是「+¥3,640.00（+14.56%）」，档位该看括号里的收益率，不是金额 */
  const pctNum = (text) => {
    const m = String(text).match(/\(([-+]?\d+(?:\.\d+)?)%\)/);
    return m ? parseFloat(m[1]) : num(text);
  };
  // 恰好 0 不碰：界面原本怎么画就怎么画，免得为「+0.00%」多出一处改动
  const pctTier = (v) =>
    v >= 9.9 ? 'limit' : v >= 5 ? 'up2' : v > 0 ? 'up1' : v === 0 ? null
    : v > -5 ? 'down1' : v > -9.9 ? 'down2' : 'limitd';
  const turnoverWord = (v) => (v < 1 ? ['冷清', 'dim'] : v < 5 ? ['正常', 'ink'] : v < 15 ? ['活跃', 'amber'] : ['过热', 'rise']);
  const vrWord = (v) => (v < 0.8 ? ['缩量', 'fall'] : v <= 1.5 ? ['平量', 'ink'] : v <= 2.5 ? ['温和放量', 'amber'] : ['大幅放量', 'rise']);

  /** 直接给装数字的元素加档位样式（自选页 .watch-pct、持仓页 .quote-row__chg） */
  const addTier = (el, tier, pad) => {
    if (!el || el.dataset.tiered) return;
    el.classList.add('tier-hl', 'tier-hl--' + tier);
    if (pad) el.classList.add('tier-hl--pad');
    el.dataset.tiered = '1';
  };
  /** 块级元素（持仓收益的 <p>）不能整块加底，把文字包一层 */
  const wrapText = (el, tier) => {
    if (!el || el.dataset.tiered) return;
    const span = document.createElement('span');
    span.className = 'tier-hl tier-hl--pad tier-hl--' + tier;
    while (el.firstChild) span.appendChild(el.firstChild);
    el.appendChild(span);
    el.dataset.tiered = '1';
  };
  const addWord = (td, pair) => {
    if (!td || td.dataset.worded) return;
    const span = document.createElement('span');
    span.className = 'tier-word tier-word--' + pair[1];
    span.textContent = pair[0];
    td.classList.add('tier-host');
    td.appendChild(span);
    td.dataset.worded = '1';
  };

  let touched = 0;
  document.querySelectorAll('table.quote-table').forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const col = (label) => heads.findIndex((h) => h.indexOf(label) === 0);
    const i = { chg: col('涨跌幅'), turnover: col('换手'), vr: col('量比'), watch: col('自选收益'), profit: col('持仓收益') };
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = [...tr.children];
      const at = (k) => (i[k] >= 0 ? cells[i[k]] : null);

      const chg = at('chg');
      if (chg) {
        const v = num(chg.textContent);
        if (v !== null) {
          const tier = pctTier(v);
          if (tier) {
            const plain = chg.querySelector('.watch-pct');
            const chip = chg.querySelector('.quote-row__chg');
            if (plain) addTier(plain, tier, true);
            else if (chip) addTier(chip, tier, false);
            else addTier(chg, tier, false);
            touched += 1;
          }
        }
      }
      const watch = at('watch');
      if (watch) {
        const v = num(watch.textContent);
        const tier = v === null ? null : pctTier(v);
        if (tier) { const plain = watch.querySelector('.watch-pct'); addTier(plain || watch, tier, Boolean(plain)); touched += 1; }
      }
      const profit = at('profit');
      if (profit) {
        const v = pctNum(profit.textContent);
        const tier = v === null ? null : pctTier(v);
        if (tier) { const p = profit.querySelector('.holding-card__profit'); if (p) wrapText(p, tier); else addTier(profit, tier, false); touched += 1; }
      }

      const turn = at('turnover');
      if (turn) { const v = num(turn.textContent); if (v !== null) { addWord(turn, turnoverWord(v)); touched += 1; } }
      const vr = at('vr');
      if (vr) { const v = num(vr.textContent); if (v !== null) { addWord(vr, vrWord(v)); touched += 1; } }
    });
  });
  return 'touched ' + touched;
})()`;

/* ------------------------------------------------------------------ CDP 连接 */

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

const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(res.data, 'base64'));
  console.log('saved', name);
};
const clickNav = async (label) => {
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('nav button, nav a')].find((el) => el.textContent.includes(${JSON.stringify(label)}))?.click()`,
  });
  await sleep(2500);
};
const inject = async () => {
  const { result } = await send('Runtime.evaluate', { expression: INJECT, returnByValue: true });
  console.log('inject →', result?.value);
  await sleep(400);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('stock-dashboard:v1', ${JSON.stringify(JSON.stringify(SEED))});`,
});
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(4000);

await shot('tier-before-watchlist.png');
await clickNav('持仓');
await shot('tier-before-holdings.png');

await clickNav('自选');
await inject();
await shot('tier-after-watchlist.png');

await clickNav('持仓');
await inject();
await shot('tier-after-holdings.png');

ws.close();
process.exit(0);
