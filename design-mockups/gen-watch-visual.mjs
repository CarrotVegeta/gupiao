/**
 * 生成「自选 / 持仓」列表的「不只是数字」对比稿 Z1–Z4。
 *
 * 四个方案共用同一套外壳（顶栏 + 指数带 + 左自选 / 右持仓 + 页脚）与同一份种子数据，
 * 只有「数字怎么被呈现」不同，方便横向比较：
 *   z1 分时脉搏  每行一条当日分时迷你图，持仓卡标注成本线（需新增分时接口）
 *   z2 刻度尺    涨跌幅/自选收益/换手/量比/成交额改成条形刻度（零新增数据）
 *   z3 信息行    数字让位给文字：行业 · 连板 · 涨停原因 · 加入/持有天数（零新增数据）
 *   z4 迷你K线   每行近 10 日迷你 K 线，持仓卡标注开仓价（需新增日K接口）
 *
 * 用法: node design-mockups/gen-watch-visual.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ 种子数据 */

/** 自选 11 只：沿用 o-watch-dualdesk 的口径，补上行业 / 涨停原因 / 分时形状 */
const WATCH = [
  { name: '澳弘电子', code: '605058', price: 48.76, pct: 9.99, turnover: 11.47, vr: 2.1, amount: 8.6, date: '09-15', watchPrice: 44.33, industry: 'PCB', reason: '覆铜板涨价', board: 5, note: '打板观察', shape: [[0, 0.0999], [1, 0.0999]], noise: 0.0004 },
  { name: '金健米业', code: '600127', price: 13.02, pct: 9.97, turnover: 29.82, vr: 1.02, amount: 3.2, date: '09-16', watchPrice: 12.5, industry: '农业种植', reason: '粮食安全', board: 1, note: '', hold: true, shape: [[0, 0.012], [0.06, 0.03], [0.14, 0.062], [0.22, 0.088], [0.3, 0.0976], [1, 0.0976]], noise: 0.0022 },
  { name: '农发种业', code: '600313', price: 7.11, pct: 5.18, turnover: 9.84, vr: 1.89, amount: 6.4, date: '09-01', watchPrice: 7.02, industry: '种业', reason: null, board: 0, note: '', hold: true, shape: [[0, -0.004], [0.2, 0.012], [0.45, 0.026], [0.7, 0.044], [1, 0.0518]], noise: 0.0026 },
  { name: '登海种业', code: '002041', price: 10.36, pct: 5.5, turnover: 7.63, vr: 1.52, amount: 2.8, date: '09-02', watchPrice: 9.6, industry: '种业', reason: null, board: 0, note: '', hold: true, shape: [[0, 0.008], [0.15, 0.03], [0.3, 0.018], [0.55, 0.042], [0.8, 0.061], [1, 0.055]], noise: 0.0026 },
  { name: '中晶科技', code: '003026', price: 37.0, pct: 9.99, turnover: 12.85, vr: 1.88, amount: 5.4, date: '09-12', watchPrice: 33.64, industry: '半导体材料', reason: '硅片涨价', board: 3, note: '', shape: [[0, 0.03], [0.05, 0.062], [0.1, 0.0999], [1, 0.0999]], noise: 0.0018 },
  { name: '华瓷股份', code: '001216', price: 19.88, pct: 10.02, turnover: 18.3, vr: 3.05, amount: 4.2, date: '09-16', watchPrice: 19.53, industry: '陶瓷', reason: '出口链', board: 3, note: '', shape: [[0, -0.018], [0.12, -0.026], [0.3, 0.012], [0.5, 0.062], [0.62, 0.1002], [1, 0.1002]], noise: 0.0028 },
  { name: '贵州茅台', code: '600519', price: 1266.66, pct: 0.69, turnover: 0.14, vr: 0.94, amount: 18.7, date: '08-28', watchPrice: 1258.0, industry: '白酒', reason: null, board: 0, note: '', shape: [[0, 0.002], [0.3, 0.009], [0.5, 0.004], [0.75, 0.009], [1, 0.0069]], noise: 0.0016 },
  { name: '深桑达Ａ', code: '000032', price: 14.39, pct: -1.71, turnover: 4.56, vr: 1.18, amount: 3.5, date: '09-03', watchPrice: 14.2, industry: '信创', reason: null, board: 0, note: '等回踩 14', shape: [[0, 0.006], [0.12, 0.014], [0.35, 0.004], [0.6, -0.008], [1, -0.0171]], noise: 0.0026 },
  { name: '平安银行', code: '000001', price: 11.62, pct: -0.68, turnover: 0.62, vr: 1.34, amount: 9.6, date: '09-05', watchPrice: 11.5, industry: '银行', reason: null, board: 0, note: '', shape: [[0, 0.001], [0.25, -0.004], [0.55, -0.002], [0.8, -0.008], [1, -0.0068]], noise: 0.0014 },
  { name: '招金黄金', code: '000506', price: 18.57, pct: -5.21, turnover: 6.52, vr: 1.56, amount: 2.6, date: '09-10', watchPrice: 19.4, industry: '黄金', reason: null, board: 0, note: '反弹减仓', hold: true, shape: [[0, -0.021], [0.2, -0.033], [0.45, -0.041], [0.7, -0.048], [1, -0.0521]], noise: 0.0024 },
  { name: '金螳螂', code: '002081', price: 4.79, pct: -1.44, turnover: 4.55, vr: 0.79, amount: 1.4, date: '09-08', watchPrice: 4.86, industry: '建筑装饰', reason: null, board: 0, note: '', shape: [[0, -0.004], [0.2, -0.011], [0.45, -0.006], [0.7, -0.016], [1, -0.0144]], noise: 0.0022 },
];

/** 持仓 4 只：开仓价 / 数量 / 持有天数 */
const HOLD = [
  { code: '002041', openPrice: 9.6, qty: 3000, days: 12 },
  { code: '600127', openPrice: 12.5, qty: 2000, days: 2 },
  { code: '600313', openPrice: 7.02, qty: 10000, days: 17 },
  { code: '000506', openPrice: 19.4, qty: 1000, days: 6 },
];

/* ------------------------------------------------------------------ 数值工具 */

const hash32 = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
};
const rndOf = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
const fixed = (v, d = 2) => v.toFixed(d);
const signed = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const signedPct = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;
const signedMoney = (v) => `${v >= 0 ? '+' : '−'}¥${Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
const toneOf = (v) => (v > 0 ? 'rise' : v < 0 ? 'fall' : 'muted');

/** 分时：按锚点插值 + 噪声，收在现价 */
const minuteSeries = (stock, n = 72) => {
  const preClose = stock.price / (1 + stock.pct / 100);
  const rnd = rndOf(hash32(stock.code));
  const at = (t) => {
    const a = stock.shape;
    for (let i = 1; i < a.length; i += 1) {
      if (t <= a[i][0]) {
        const [t0, v0] = a[i - 1];
        const [t1, v1] = a[i];
        const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * k;
      }
    }
    return a[a.length - 1][1];
  };
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const drift = (rnd() - 0.5) * 2 * stock.noise;
    return preClose * (1 + at(t) + (i === n - 1 ? 0 : drift));
  });
};

/** 近 10 日 K 线：连板数决定尾部几根涨停，其余按当日方向随机游走 */
const dailyBars = (stock, n = 10) => {
  const rnd = rndOf(hash32(`${stock.code}k`));
  const trend = stock.pct >= 0 ? 1 : -1;
  const closes = [stock.price];
  for (let i = 1; i < n; i += 1) {
    const back = i <= stock.board ? 1 / 1.0999 : 1 / (1 + trend * (0.002 + rnd() * 0.018));
    closes.unshift(closes[0] * back);
  }
  return closes.map((close, i) => {
    const prev = i === 0 ? close * (1 - trend * 0.008) : closes[i - 1];
    const open = prev * (1 + (rnd() - 0.5) * 0.012);
    const high = Math.max(open, close) * (1 + rnd() * 0.011);
    const low = Math.min(open, close) * (1 - rnd() * 0.011);
    return { open, close, high, low };
  });
};

/* ------------------------------------------------------------------ SVG 部件 */

const sparkline = (vals, preClose, { w = 112, h = 30, up, cost = null } = {}) => {
  const pad = 3;
  const lo = Math.min(...vals, preClose, cost ?? Infinity);
  const hi = Math.max(...vals, preClose, cost ?? -Infinity);
  const span = Math.max(hi - lo, preClose * 0.002);
  const X = (i) => pad + (i * (w - pad * 2)) / (vals.length - 1);
  const Y = (v) => pad + ((hi - v) * (h - pad * 2)) / span;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${X(vals.length - 1).toFixed(1)} ${h - pad} L${X(0).toFixed(1)} ${h - pad} Z`;
  const costLine = cost === null ? '' :
    `<line class="spark__cost" x1="${pad}" x2="${w - pad}" y1="${Y(cost).toFixed(1)}" y2="${Y(cost).toFixed(1)}"/>`;
  return `<svg class="spark ${up ? 'spark--up' : 'spark--down'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="当日分时走势">` +
    `<line class="spark__base" x1="${pad}" x2="${w - pad}" y1="${Y(preClose).toFixed(1)}" y2="${Y(preClose).toFixed(1)}"/>` +
    `<path class="spark__area" d="${area}"/>${costLine}` +
    `<path class="spark__line" d="${d}"/>` +
    `<circle class="spark__dot" cx="${X(vals.length - 1).toFixed(1)}" cy="${Y(vals[vals.length - 1]).toFixed(1)}" r="2.3"/></svg>`;
};

const candles = (bars, { w = 130, h = 38, ref = null } = {}) => {
  const pad = 3;
  const lo = Math.min(...bars.map((b) => b.low), ref ?? Infinity);
  const hi = Math.max(...bars.map((b) => b.high), ref ?? -Infinity);
  const span = Math.max(hi - lo, ((hi + lo) / 2) * 0.002);
  const Y = (v) => pad + ((hi - v) * (h - pad * 2)) / span;
  const bw = (w - pad * 2) / bars.length;
  const body = bars.map((b, i) => {
    const cx = pad + i * bw + bw / 2;
    const cls = b.close >= b.open ? 'k--up' : 'k--down';
    const yO = Y(b.open);
    const yC = Y(b.close);
    const top = Math.min(yO, yC);
    const hgt = Math.max(Math.abs(yO - yC), 1);
    return `<line class="${cls}" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${Y(b.high).toFixed(1)}" y2="${Y(b.low).toFixed(1)}"/>` +
      `<rect class="${cls}" x="${(cx - bw * 0.28).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * 0.56).toFixed(1)}" height="${hgt.toFixed(1)}" rx="0.5"/>`;
  }).join('');
  const refLine = ref === null ? '' :
    `<line class="k__ref" x1="${pad}" x2="${w - pad}" y1="${Y(ref).toFixed(1)}" y2="${Y(ref).toFixed(1)}"/>`;
  return `<svg class="kline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="近 10 日 K 线">${body}${refLine}</svg>`;
};

/** 双向条形：以中线为 0，域宽 ±max */
const divergeBar = (value, max, w) => {
  const half = (w - 2) / 2;
  const ratio = Math.max(-1, Math.min(1, value / max));
  const len = Math.abs(ratio) * half;
  const left = ratio >= 0 ? half : half - len;
  const tone = value > 0 ? 'rise' : value < 0 ? 'fall' : 'flat';
  return `<div class="bar-wrap" style="width:${w}px"><div class="bar-track">` +
    `<i class="bar-fill bar-fill--${tone}" style="left:${left.toFixed(1)}px;width:${len.toFixed(1)}px"></i>` +
    '<i class="bar-axis"></i></div></div>';
};

/** 单向条形：0 → max 的进度，mid 为中线刻度 */
const meterBar = (value, max, w, mid = null, tone = 'ink') => {
  const ratio = Math.max(0, Math.min(1, value / max));
  return `<div class="bar-wrap" style="width:${w}px"><div class="bar-track">` +
    `<i class="bar-fill bar-fill--${tone}" style="left:0;width:${(ratio * (w - 2)).toFixed(1)}px"></i>` +
    (mid === null ? '' : `<i class="bar-tick" style="left:${(((mid / max) * (w - 2)) + 1).toFixed(1)}px"></i>`) +
    '</div></div>';
};

/* ------------------------------------------------------------------ 样式 */

const CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  :root{
    --bg:#EEF0F4; --panel:#FFFFFF; --line:#E3E6EC; --line2:#F0F2F6; --head:#F7F8FB;
    --ink:#151A22; --ink2:#59616F; --ink3:#949CAB;
    --rise:#D8202B; --fall:#0E9F5B; --amber:#C2760A; --brand:#1D4ED8;
    --mono:'JetBrains Mono','WenQuanYi Zen Hei Mono',ui-monospace,monospace;
  }
  html,body{width:1440px;height:900px;overflow:hidden}
  body{background:var(--bg);color:var(--ink);
    font:400 12.5px/1.45 -apple-system,'Segoe UI','WenQuanYi Zen Hei',sans-serif;-webkit-font-smoothing:antialiased}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.2px}
  .rise{color:var(--rise)}.fall{color:var(--fall)}.muted{color:var(--ink2)}.dim{color:var(--ink3)}
  .shell{height:100%;display:flex;flex-direction:column;padding:11px 13px 9px;gap:9px}

  header{height:46px;display:flex;align-items:center;gap:12px;padding:0 14px;background:var(--panel);
    border:1px solid var(--line);border-radius:10px;flex:none}
  .brand{display:flex;align-items:center;gap:8px;font-weight:750;font-size:14px}
  .mark{width:22px;height:22px;border-radius:6px;background:#141922;color:#fff;display:grid;place-items:center;
    font-size:11px;font-weight:800}
  .vlabel{margin-left:2px;padding:3px 9px;border-radius:999px;background:#EEF2FF;color:var(--brand);
    border:1px solid #DCE6FF;font-size:11.5px;font-weight:700}
  nav{display:flex;gap:1px}
  nav a{display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:7px;font-size:12.5px;
    color:var(--ink2);text-decoration:none}
  nav a b{font-family:var(--mono);font-size:11px;font-weight:650;color:var(--ink3)}
  nav a.on{background:#EEF2FF;color:var(--brand);font-weight:700}
  nav a.on b{color:var(--brand)}
  .sp{margin-left:auto;display:flex;align-items:center;gap:8px}
  .btn{height:28px;padding:0 11px;border-radius:7px;border:1px solid var(--line);background:#fff;color:var(--ink);
    font:600 12px inherit;cursor:pointer}
  .btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}

  .market{display:grid;grid-template-columns:repeat(4,1fr);background:var(--panel);border:1px solid var(--line);
    border-radius:10px;overflow:hidden;flex:none;height:82px}
  .mk{padding:8px 14px;border-right:1px solid var(--line2);display:flex;flex-direction:column;justify-content:center;gap:2px}
  .mk:last-child{border-right:0}
  .mk .k{font-size:11px;color:var(--ink3);display:flex;gap:5px}
  .mk .v{font-size:19px;font-weight:750;letter-spacing:-.4px}
  .mk .sub{font-size:11.5px;display:flex;gap:9px;font-weight:600}
  .mk .sub i{font-style:normal;color:var(--ink3);font-weight:500}

  .cols{display:grid;grid-template-columns:1fr 524px;gap:9px;flex:1;min-height:0}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;
    overflow:hidden;min-height:0}
  .bar{height:38px;display:flex;align-items:center;gap:9px;padding:0 13px;border-bottom:1px solid var(--line);flex:none}
  .bar h2{font-size:13.5px;font-weight:750}
  .bar .n{font-size:11px;color:var(--ink3);font-family:var(--mono)}
  .bar .rt{margin-left:auto;display:flex;align-items:center;gap:6px}
  .seg{display:flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
  .seg span{padding:4px 10px;font-size:11.5px;color:var(--ink2);border-right:1px solid var(--line)}
  .seg span:last-child{border-right:0}
  .seg span.on{background:#EEF2FF;color:var(--brand);font-weight:700}
  .gchip{font-size:11px;padding:3px 8px;border-radius:6px;background:var(--head);border:1px solid var(--line);color:var(--ink2)}
  .gchip.on{background:#141922;border-color:#141922;color:#fff;font-weight:650}

  .scroll{flex:1;min-height:0;overflow:hidden}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  thead th{height:28px;padding:0 8px;font-size:10.5px;font-weight:650;color:var(--ink3);text-align:right;
    background:var(--head);border-bottom:1px solid var(--line);white-space:nowrap}
  thead th:first-child{text-align:left}
  tbody td{height:56px;padding:0 8px;text-align:right;font-size:12.5px;border-bottom:1px solid var(--line2);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  tbody td:first-child{text-align:left}
  tbody tr:hover{background:#F6F8FD}
  tbody tr.hold{background:#FFFBFB}
  .stk{display:flex;align-items:baseline;gap:6px}
  .nm{font-weight:650}
  .code{font-family:var(--mono);font-size:10.5px;color:var(--ink3)}
  .tag{font-size:10px;padding:0 5px;border-radius:3px;font-weight:750;background:#FDECEC;color:var(--rise);
    border:1px solid #F7D5D8}
  .tag.b{background:#FEF5E7;color:var(--amber);border-color:#F6E2C4}
  .tag.g{background:#EDF3FF;color:var(--brand);border-color:#DCE6FF}
  .tag.n{background:#F1F3F7;color:var(--ink2);border-color:#E3E6EC;font-weight:600}
  .stk2{display:flex;flex-direction:column;gap:3px;align-items:flex-start}
  .stk2 .r2{display:flex;gap:5px;align-items:center}
  .px{font-size:15px;font-weight:750;letter-spacing:-.3px}
  .pc{font-size:12.5px;font-weight:700}
  .note{font-size:11px;color:var(--ink2)}
  tbody td.l{text-align:left}
  tbody.t54 td,.t54 tbody td{height:54px}

  /* 字段值口径：值下面的小字 / 档位色 */
  .an{font-size:10.5px;color:var(--ink3);margin-top:2px}
  .chip{display:inline-block;padding:1px 7px;border-radius:5px;font-weight:700;font-size:11.5px;
    font-family:var(--mono);font-variant-numeric:tabular-nums}
  .t-limit{background:#D8202B;color:#fff}
  .t-limitd{background:#0E9F5B;color:#fff}
  .t-up2{background:#FDECEC;color:#C81722;border:1px solid #F7D5D8}
  .t-down2{background:#E8F7F0;color:#0C8A4D;border:1px solid #CFEBDE}
  .t-up1{color:#D8202B}
  .t-down1{color:#0E9F5B}
  .t-flat{color:#59616F;background:#F1F3F7;border:1px solid #E3E6EC}
  .w-rise{color:#C81722}.w-amber{color:#C2760A}.w-ink{color:#59616F}.w-dim{color:#949CAB}.w-fall{color:#0E9F5B}
  .legendbar{height:26px;display:flex;align-items:center;gap:6px;padding:0 13px;flex:none;
    border-bottom:1px solid var(--line2);font-size:10.5px;color:var(--ink3);white-space:nowrap}

  /* 持仓卡内的纵向排布 */
  .hcol{display:flex;flex-direction:column;gap:5px;width:100%}
  .hrow-mid{display:flex;align-items:center;gap:10px}

  /* Z7 行内字段网格 */
  .fgrid-body{display:flex;flex-direction:column}
  .frow{display:flex;align-items:center;gap:16px;height:57px;padding:0 13px;border-bottom:1px solid var(--line2)}
  .frow.hold{background:#FFFBFB}
  .fid{width:196px;flex:none;display:flex;flex-direction:column;gap:3px;overflow:hidden}
  .fid .r2{display:flex;gap:5px;align-items:center}
  .fvals{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
  .fline{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
  .fline--3{grid-template-columns:repeat(3,1fr)}
  .fp{display:flex;align-items:baseline;gap:5px;min-width:0}
  .fl{font-size:10.5px;color:var(--ink3);flex:none}
  .fv{font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hcard .fmid{display:flex;flex-direction:column;gap:6px;width:100%}
  .phrase{font-size:11.5px;color:var(--ink2)}
  .phrase b{color:var(--ink);font-weight:650}
  .stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .stack .cap{font-size:11.5px;font-weight:700}
  .chart-note{font-size:10px;color:var(--ink3);margin-top:3px;text-align:right}

  .spark,.kline{display:block;margin-left:auto}
  .spark__base{stroke:#C9CFDA;stroke-width:1;stroke-dasharray:3 3}
  .spark__line{fill:none;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
  .spark__area{stroke:none}
  .spark__cost{stroke:var(--brand);stroke-width:1;stroke-dasharray:4 2;opacity:.75}
  .spark--up .spark__line{stroke:var(--rise)}
  .spark--up .spark__area{fill:var(--rise);opacity:.10}
  .spark--up .spark__dot{fill:var(--rise)}
  .spark--down .spark__line{stroke:var(--fall)}
  .spark--down .spark__area{fill:var(--fall);opacity:.10}
  .spark--down .spark__dot{fill:var(--fall)}
  .k--up{stroke:var(--rise);fill:var(--rise)}
  .k--down{stroke:var(--fall);fill:var(--fall)}
  .k__ref{stroke:var(--brand);stroke-width:1;stroke-dasharray:4 2;opacity:.8}

  .bar-wrap{display:block}
  .bar-track{position:relative;height:9px;border-radius:5px;background:#EEF1F6;border:1px solid #E4E8EF;
    width:100%;box-sizing:border-box;overflow:hidden}
  .bar-fill{position:absolute;top:0;bottom:0;border-radius:5px}
  .bar-fill--rise{background:linear-gradient(90deg,#E4453F,#C81722)}
  .bar-fill--fall{background:linear-gradient(270deg,#25A96B,#0C8A4D)}
  .bar-fill--ink{background:linear-gradient(90deg,#9FB0CC,#5A6B87)}
  .bar-fill--flat{background:#C9CFDA}
  .bar-axis{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#B9C1CE}
  .bar-tick{position:absolute;top:-2px;bottom:-2px;width:1px;background:#B9C1CE}

  .summary{padding:10px 14px 11px;border-bottom:1px solid var(--line);flex:none}
  .summary .k{font-size:11px;color:var(--ink3)}
  .summary .hero{font-size:30px;font-weight:800;letter-spacing:-1.1px;margin:1px 0 8px;font-family:var(--mono)}
  .sm{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
  .sm div{padding:7px 8px;border-radius:8px;background:var(--head);border:1px solid var(--line2)}
  .sm .t{font-size:10.5px;color:var(--ink3)}
  .sm .v{font-size:13px;font-weight:700;margin-top:2px;font-family:var(--mono);letter-spacing:-.3px}
  .hlist{flex:1;min-height:0;display:flex;flex-direction:column}
  .hcard{flex:1;display:flex;flex-direction:column;justify-content:center;gap:5px;padding:8px 14px;
    border-bottom:1px solid var(--line2);min-height:0}
  .hcard:last-child{border-bottom:0}
  .hcard .top{display:flex;align-items:baseline;gap:7px}
  .hcard .nm{font-size:13.5px;font-weight:750}
  .hcard .code{font-family:var(--mono);font-size:10.5px;color:var(--ink3)}
  .hcard .pct{margin-left:auto;font-family:var(--mono);font-size:14px;font-weight:750}
  .hcard .mid{display:flex;align-items:center;gap:10px}
  .hcard .price{font-family:var(--mono);font-size:20px;font-weight:750;letter-spacing:-.6px;white-space:nowrap}
  .hcard .price small{font-size:11.5px;font-weight:650;margin-left:5px;letter-spacing:0}
  .hcard .pnl{margin-left:auto;text-align:right}
  .hcard .pnl .v{font-family:var(--mono);font-size:13.5px;font-weight:750}
  .hcard .pnl .k{font-size:10px;color:var(--ink3);margin-top:1px}
  .hcard .foot{display:flex;gap:13px;font-size:10.5px;color:var(--ink3)}
  .hcard .foot b{font-family:var(--mono);color:var(--ink2);font-weight:650}
  footer{height:22px;display:flex;align-items:center;gap:11px;font-size:11px;color:var(--ink3);padding:0 3px;flex:none}
  footer .sep{width:1px;height:10px;background:var(--line)}
  footer .need{color:var(--brand);font-weight:650}
`;

/* ------------------------------------------------------------------ 外壳 */

const HEADER = (title) => `
  <header>
    <div class="brand"><span class="mark">A</span>A 股看板<span class="vlabel">${title}</span></div>
    <nav>
      <a class="on" href="#">自选 <b>11</b></a>
      <a href="#">持仓 <b>4</b></a>
      <a href="#">涨停聚焦 <b>47</b></a>
      <a href="#">竞价 <b>89</b></a>
      <a href="#">龙虎榜 <b>—</b></a>
      <a href="#">选股 <b>—</b></a>
    </nav>
    <div class="sp">
      <span class="dim num" style="font-size:11px">最后刷新 09-18 10:35:22</span>
      <button class="btn">刷新</button>
      <button class="btn pri">添加股票</button>
    </div>
  </header>`;

const MARKET = `
  <div class="market">
    <div class="mk"><div class="k">上证指数 <span class="num dim">000001</span></div>
      <div class="v num fall">3875.60</div>
      <div class="sub"><span class="num fall">-16.00</span><span class="num fall">-0.41%</span><i class="num">8688亿</i></div></div>
    <div class="mk"><div class="k">深证成指 <span class="num dim">399001</span></div>
      <div class="v num fall">13409.91</div>
      <div class="sub"><span class="num fall">-44.83</span><span class="num fall">-0.33%</span><i class="num">9544亿</i></div></div>
    <div class="mk"><div class="k">创业板指 <span class="num dim">399006</span></div>
      <div class="v num fall">3298.31</div>
      <div class="sub"><span class="num fall">-13.16</span><span class="num fall">-0.40%</span><i class="num">4432亿</i></div></div>
    <div class="mk"><div class="k">两市成交</div>
      <div class="v num">1.82 万亿</div>
      <div class="sub"><span>涨停 <b class="num rise">47</b></span><span>炸板 <b class="num" style="color:var(--amber)">5</b></span>
        <span>晋级 <b class="num">10.1%</b></span></div></div>
  </div>`;

const FOOT = (note, need) => `
  <footer>
    <span>数据源 腾讯 / 东方财富</span><span class="sep"></span>
    <span>行情 10:35:22</span><span class="sep"></span>
    <span>${note}</span><span class="sep"></span>
    <span class="need">数据依赖：${need}</span>
  </footer>`;

const WATCH_BAR = `
  <div class="bar">
    <h2>自选</h2><span class="n">11 只</span>
    <div class="rt">
      <span class="gchip on">全部 11</span><span class="gchip">农业 3</span><span class="gchip">黄金 1</span>
      <span class="gchip">未分组 7</span>
      <div class="seg" style="margin-left:4px"><span class="on">全部 11</span><span>持仓 4</span></div>
    </div>
  </div>`;

const HOLD_BAR = (note) => `
  <div class="bar"><h2>持仓</h2><span class="n">4 只</span>
    <span class="rt dim" style="font-size:11px">${note}</span></div>`;

const SUMMARY = `
  <div class="summary">
    <div class="k">当前范围总览 · 总收益率</div>
    <div class="hero rise">+2.36%</div>
    <div class="sm">
      <div><div class="t">总收益额</div><div class="v rise">+¥3,390.00</div></div>
      <div><div class="t">总投入</div><div class="v">¥143,400</div></div>
      <div><div class="t">当前市值</div><div class="v">¥146,790</div></div>
      <div><div class="t">持仓数量</div><div class="v">4</div></div>
    </div>
  </div>`;

const page = (title, cols, footer) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>方案 ${title}（自选 / 持仓）</title>
<style>${CSS}</style></head><body>
<div class="shell">${HEADER(title)}${MARKET}
  <div class="cols">${cols}</div>
  ${footer}
</div>
</body></html>`;

/* ------------------------------------------------------------------ 公共派生值 */

const rows = WATCH.map((s) => {
  const preClose = s.price / (1 + s.pct / 100);
  return {
    ...s,
    preClose,
    change: s.price - preClose,
    watchReturn: ((s.price - s.watchPrice) / s.watchPrice) * 100,
    series: minuteSeries(s),
    bars: dailyBars(s),
  };
});

const holdRows = HOLD.map((h) => {
  const s = rows.find((r) => r.code === h.code);
  const profit = (s.price - h.openPrice) * h.qty;
  return { ...s, ...h, profit, returnPct: ((s.price - h.openPrice) / h.openPrice) * 100 };
});

const maxAmount = Math.max(...rows.map((r) => r.amount));
const maxProfit = Math.max(...holdRows.map((h) => Math.abs(h.profit)));

const stkTags = (r) => [
  r.board > 1 ? `<span class="tag">${r.board}连板</span>` : r.board === 1 ? '<span class="tag">涨停</span>' : '',
  r.hold ? '<span class="tag g">持仓</span>' : '',
].join('');

const pnlBlock = (h, tone) => `<div class="pnl"><div class="v ${tone}">${signedMoney(h.profit)}</div>
  <div class="k">持仓收益 · ${signedPct(h.returnPct)}</div></div>`;

/** 持仓卡：mid 区由各方案自己拼 */
const holdCards = (renderMid, midClass = 'mid', showFoot = true) => holdRows.map((h) => {
  const tone = toneOf(h.returnPct);
  return `<div class="hcard">
    <div class="top"><span class="nm">${h.name}</span><span class="code">${h.code}</span>
      <span class="tag n">${h.industry}</span><span class="pct ${tone}">${signedPct(h.pct)}</span></div>
    <div class="${midClass}">${renderMid(h, tone)}</div>
    ${showFoot ? `<div class="foot"><span>开仓价 <b>${fixed(h.openPrice)}</b></span>
      <span>持有数量 <b>${h.qty.toLocaleString('zh-CN')}</b></span>
      <span>持有 <b>${h.days}</b> 天</span><span>换手 <b>${fixed(h.turnover)}%</b></span></div>` : ''}
  </div>`;
}).join('');

const priceBlock = (h, tone) =>
  `<div class="price ${tone}">${fixed(h.price)}<small class="${tone}">${signed(h.change)}</small></div>${pnlBlock(h, tone)}`;

/* ------------------------------------------------------------------ Z1 · 分时脉搏 */

const z1 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:23%"><col style="width:15%"><col style="width:10%"><col style="width:9%">
        <col style="width:6%"><col style="width:7%"><col style="width:7%"><col style="width:9%"><col style="width:14%"></colgroup>
      <thead><tr><th>股票</th><th>当日分时</th><th>最新价</th><th>涨跌幅</th><th>换手</th>
        <th>成交额</th><th>自选日</th><th>自选价</th><th>自选收益</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td>${sparkline(r.series, r.preClose, { up: r.pct >= 0 })}
            <div class="chart-note num">昨收 ${fixed(r.preClose)}</div></td>
          <td><div class="px num ${toneOf(r.pct)}">${fixed(r.price)}</div></td>
          <td><div class="pc num ${toneOf(r.pct)}">${signedPct(r.pct)}</div></td>
          <td class="num muted">${fixed(r.turnover)}%</td>
          <td class="num muted">${fixed(r.amount, 1)}亿</td>
          <td class="num dim">${r.date}</td>
          <td class="num dim">${fixed(r.watchPrice)}</td>
          <td><div class="stack"><span class="cap num ${toneOf(r.watchReturn)}">${signedPct(r.watchReturn)}</span>
            ${divergeBar(r.watchReturn, 12, 100)}</div></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('分时图上蓝虚线 = 开仓价')}
    <div class="hlist">
      ${holdCards((h, tone) => `${priceBlock(h, tone)}
        ${sparkline(h.series, h.preClose, { w: 218, h: 52, up: h.pct >= 0, cost: h.openPrice })}`)}
    </div>
  </section>`;

/* ------------------------------------------------------------------ Z2 · 刻度尺 */

const z2 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:22%"><col style="width:10%"><col style="width:16%"><col style="width:12%">
        <col style="width:12%"><col style="width:13%"><col style="width:15%"></colgroup>
      <thead><tr><th>股票</th><th>最新价</th><th>涨跌幅 · 相对昨收</th><th>换手 · 0~30%</th>
        <th>量比 · 1.0 中线</th><th>成交额 · 相对最大</th><th>自选收益 · 相对自选价</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td class="px num ${toneOf(r.pct)}">${fixed(r.price)}</td>
          <td><div class="stack"><span class="cap num ${toneOf(r.pct)}">${signedPct(r.pct)}</span>
            ${divergeBar(r.pct, 11, 118)}</div></td>
          <td><div class="stack"><span class="cap num muted">${fixed(r.turnover)}%</span>
            ${meterBar(r.turnover, 30, 84, 10)}</div></td>
          <td><div class="stack"><span class="cap num muted">${fixed(r.vr)}</span>
            ${meterBar(r.vr, 4, 84, 1)}</div></td>
          <td><div class="stack"><span class="cap num muted">${fixed(r.amount, 1)}亿</span>
            ${meterBar(r.amount, maxAmount, 92)}</div></td>
          <td><div class="stack"><span class="cap num ${toneOf(r.watchReturn)}">${signedPct(r.watchReturn)}</span>
            ${divergeBar(r.watchReturn, 12, 110)}</div></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('条形 = 相对最大浮盈 / 浮亏')}
    <div class="hlist">
      ${holdCards((h, tone) => `${priceBlock(h, tone)}
        <div class="stack" style="align-items:flex-end;gap:4px">
          <span class="num ${tone}" style="font-size:11.5px">${signedPct(h.returnPct)}</span>
          ${divergeBar(h.profit, maxProfit, 176)}
        </div>`, 'mid')}
    </div>
  </section>`;

/* ------------------------------------------------------------------ Z3 · 信息行 */

const z3 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:27%"><col style="width:10%"><col style="width:10%"><col style="width:20%">
        <col style="width:22%"><col style="width:11%"></colgroup>
      <thead><tr><th>股票 · 行业 · 涨停原因</th><th>最新价</th><th>涨跌幅</th><th>今日盘口</th>
        <th>自选以来</th><th>备注</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk2">
            <div class="r2"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div>
            <div class="r2"><span class="tag n">${r.industry}</span>
              ${r.reason ? `<span class="tag b">${r.reason}</span>` : '<span class="dim" style="font-size:10.5px">无涨停驱动</span>'}</div>
          </div></td>
          <td class="px num ${toneOf(r.pct)}">${fixed(r.price)}</td>
          <td><div class="pc num ${toneOf(r.pct)}">${signedPct(r.pct)}</div>
            <div class="num dim" style="font-size:10.5px">${signed(r.change)}</div></td>
          <td class="l"><div class="phrase">换手 <b>${fixed(r.turnover, 1)}%</b> · 量比 <b>${fixed(r.vr)}</b> · <b>${fixed(r.amount, 1)}亿</b></div></td>
          <td class="l"><div class="phrase">${r.date} 加入 · 较自选价
            <b class="${toneOf(r.watchReturn)}">${signedPct(r.watchReturn)}</b></div>
            <div class="num dim" style="font-size:10.5px">自选价 ${fixed(r.watchPrice)}</div></td>
          <td class="l note">${r.note || '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('成本 → 现价，一句话说清')}
    <div class="hlist">
      ${holdCards((h, tone) => `
        <div style="display:flex;align-items:center;gap:10px">
          ${priceBlock(h, tone)}
        </div>
        <div class="phrase">成本 <b>${fixed(h.openPrice)}</b> → 现价 <b>${fixed(h.price)}</b>，每股
          <b class="${tone}">${tone === 'rise' ? '浮盈' : '浮亏'} ${fixed(Math.abs(h.price - h.openPrice))} 元</b></div>
      `, 'mid')}
    </div>
  </section>`;

/* ------------------------------------------------------------------ Z4 · 迷你K线 */

const z4 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:22%"><col style="width:16%"><col style="width:10%"><col style="width:9%">
        <col style="width:6%"><col style="width:7%"><col style="width:7%"><col style="width:9%"><col style="width:14%"></colgroup>
      <thead><tr><th>股票</th><th>近 10 日 K 线</th><th>最新价</th><th>涨跌幅</th><th>换手</th>
        <th>成交额</th><th>自选日</th><th>自选价</th><th>自选收益</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const span10 = ((r.bars[9].close - r.bars[0].close) / r.bars[0].close) * 100;
          return `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td>${candles(r.bars, { w: 120, h: 38 })}
            <div class="chart-note num">10 日 ${signedPct(span10, 1)}</div></td>
          <td><div class="px num ${toneOf(r.pct)}">${fixed(r.price)}</div></td>
          <td><div class="pc num ${toneOf(r.pct)}">${signedPct(r.pct)}</div></td>
          <td class="num muted">${fixed(r.turnover)}%</td>
          <td class="num muted">${fixed(r.amount, 1)}亿</td>
          <td class="num dim">${r.date}</td>
          <td class="num dim">${fixed(r.watchPrice)}</td>
          <td><div class="stack"><span class="cap num ${toneOf(r.watchReturn)}">${signedPct(r.watchReturn)}</span>
            ${divergeBar(r.watchReturn, 12, 96)}</div></td>
        </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('K 线上蓝虚线 = 开仓价')}
    <div class="hlist">
      ${holdCards((h, tone) => `${priceBlock(h, tone)}
        ${candles(h.bars, { w: 218, h: 52, ref: h.openPrice })}`)}
    </div>
  </section>`;

/* --------------------------------------------------- 字段值口径（Z5–Z7 共用） */

/** 涨跌幅档位：值本身按档变色/加底 */
const pctTier = (v) => {
  if (v >= 9.9) return { word: '涨停', cls: 't-limit' };
  if (v >= 5) return { word: '大涨', cls: 't-up2' };
  if (v > 0) return { word: '小涨', cls: 't-up1' };
  if (v === 0) return { word: '平盘', cls: 't-flat' };
  if (v > -5) return { word: '小跌', cls: 't-down1' };
  if (v > -9.9) return { word: '大跌', cls: 't-down2' };
  return { word: '跌停', cls: 't-limitd' };
};

/** 自选收益 / 持仓收益档位：换一套说法，避免和当日涨跌混用「涨停」 */
const pnlTier = (v) => {
  if (v >= 10) return { word: '大幅浮盈', cls: 't-limit' };
  if (v >= 5) return { word: '浮盈', cls: 't-up2' };
  if (v > 0) return { word: '微盈', cls: 't-up1' };
  if (v === 0) return { word: '持平', cls: 't-flat' };
  if (v > -5) return { word: '微亏', cls: 't-down1' };
  if (v > -10) return { word: '浮亏', cls: 't-down2' };
  return { word: '大幅浮亏', cls: 't-limitd' };
};

const turnoverWord = (v) => (v < 1 ? '冷清' : v < 5 ? '正常' : v < 15 ? '活跃' : '过热');
const turnoverTone = (v) => (v < 1 ? 'w-dim' : v < 5 ? 'w-ink' : v < 15 ? 'w-amber' : 'w-rise');
const vrWord = (v) => (v < 0.8 ? '缩量' : v <= 1.5 ? '平量' : v <= 2.5 ? '温和放量' : '大幅放量');
const vrTone = (v) => (v < 0.8 ? 'w-fall' : v <= 1.5 ? 'w-ink' : v <= 2.5 ? 'w-amber' : 'w-rise');

/** 自选到今天的自然日数（稿子里以 09-18 为「今天」） */
const daysSince = (md) => {
  const [m, d] = md.split('-').map(Number);
  return Math.round((Date.UTC(2026, 8, 18) - Date.UTC(2026, m - 1, d)) / 86400000);
};

/** 成交额占两市成交（1.82 万亿）的比重 */
const shareOfMarket = (amountYi) => `${((amountYi / 18232) * 100).toFixed(2)}%`;

/** 单个「字段名 + 字段值」对，Z7 的行内字段网格用 */
const fieldPair = (label, valueHTML, cls = '') =>
  `<span class="fp"><span class="fl">${label}</span><span class="fv num ${cls}">${valueHTML}</span></span>`;

/* ------------------------------------------------------- Z5 · 数值分档色阶 */

const LEGEND = `
  <div class="legendbar">
    <span>涨跌幅分档</span>
    <span class="chip t-limit">涨停 ≥9.9%</span><span class="chip t-up2">大涨 ≥5%</span>
    <span class="chip t-up1">小涨</span><span class="chip t-flat">平盘</span>
    <span class="chip t-down1">小跌</span><span class="chip t-down2">大跌 ≤−5%</span>
    <span class="chip t-limitd">跌停 ≤−9.9%</span>
    <span style="margin-left:8px">换手活跃度</span>
    <span class="w-dim">冷清 &lt;1%</span><span class="w-ink">正常 1~5%</span>
    <span class="w-amber">活跃 5~15%</span><span class="w-rise">过热 &gt;15%</span>
  </div>`;

const z5 = `
  <section class="panel">${WATCH_BAR}${LEGEND}
    <div class="scroll"><table class="t54">
      <colgroup><col style="width:21%"><col style="width:10%"><col style="width:11%"><col style="width:11%">
        <col style="width:11%"><col style="width:10%"><col style="width:8%"><col style="width:8%"><col style="width:10%"></colgroup>
      <thead><tr><th>股票</th><th>最新价 / 涨跌额</th><th>涨跌幅</th><th>换手</th><th>量比 · 缩量→放量</th>
        <th>成交额</th><th>自选日</th><th>自选价</th><th>自选收益</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const t = pctTier(r.pct);
          const p = pnlTier(r.watchReturn);
          return `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td><div class="px num ${toneOf(r.pct)}">${fixed(r.price)}</div>
            <div class="an num">${signed(r.change)}</div></td>
          <td><div><span class="chip ${t.cls}">${signedPct(r.pct)}</span></div>
            <div class="an">${t.word}</div></td>
          <td><div class="num ${turnoverTone(r.turnover)}">${fixed(r.turnover)}%</div>
            <div class="an ${turnoverTone(r.turnover)}">${turnoverWord(r.turnover)}</div></td>
          <td><div class="num ${vrTone(r.vr)}">${fixed(r.vr)}</div>
            <div class="an ${vrTone(r.vr)}">${vrWord(r.vr)}</div></td>
          <td><div class="num muted">${fixed(r.amount, 1)}亿</div>
            <div class="an">占两市 ${shareOfMarket(r.amount)}</div></td>
          <td class="num dim">${r.date}</td>
          <td class="num dim">${fixed(r.watchPrice)}</td>
          <td><div><span class="chip ${p.cls}">${signedPct(r.watchReturn)}</span></div>
            <div class="an">${p.word} · ${daysSince(r.date)} 天</div></td>
        </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('每个字段值带档位词：浮盈 / 活跃 / 放量')}
    <div class="hlist">
      ${holdCards((h, tone) => {
        const p = pnlTier(h.returnPct);
        return `<div class="hcol">
          <div class="hrow-mid">${priceBlock(h, tone)}</div>
          <div style="text-align:right">
            <span class="chip ${p.cls}">${signedMoney(h.profit)} · ${signedPct(h.returnPct)}</span>
            <div class="an">${p.word} · 成本 ${fixed(h.openPrice)} → 现价 ${fixed(h.price)} · 换手${turnoverWord(h.turnover)}</div>
          </div>
        </div>`;
      })}
    </div>
  </section>`;

/* ------------------------------------------------------- Z6 · 值带口径小字 */

const z6 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:22%"><col style="width:11%"><col style="width:11%"><col style="width:10%">
        <col style="width:10%"><col style="width:11%"><col style="width:10%"><col style="width:15%"></colgroup>
      <thead><tr><th>股票</th><th>最新价</th><th>今日涨跌</th><th>换手</th><th>量比</th>
        <th>成交额</th><th>自选价</th><th>自选收益</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const t = pctTier(r.pct);
          return `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td><div class="px num ${toneOf(r.pct)}">${fixed(r.price)}</div>
            <div class="an num">较昨收 ${signed(r.change)}</div></td>
          <td><div class="pc num ${toneOf(r.pct)}">${signedPct(r.pct)}</div>
            <div class="an">${t.word}</div></td>
          <td><div class="num muted">${fixed(r.turnover)}%</div>
            <div class="an">${turnoverWord(r.turnover)}</div></td>
          <td><div class="num muted">${fixed(r.vr)}</div>
            <div class="an">${vrWord(r.vr)}</div></td>
          <td><div class="num muted">${fixed(r.amount, 1)}亿</div>
            <div class="an">占两市 ${shareOfMarket(r.amount)}</div></td>
          <td><div class="num dim">${fixed(r.watchPrice)}</div>
            <div class="an">${r.date} 加入</div></td>
          <td><div class="pc num ${toneOf(r.watchReturn)}">${signedPct(r.watchReturn)}</div>
            <div class="an">${daysSince(r.date)} 天 · 今日 ${signedPct(r.pct)}</div></td>
        </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('每个字段值下面一行写清口径')}
    <div class="hlist">
      ${holdCards((h, tone) => `<div class="hcol">
        <div class="hrow-mid">${priceBlock(h, tone)}</div>
        <div style="text-align:right;line-height:1.6">
          <div class="an" style="font-size:11px;color:var(--ink3)">
            成本 ${fixed(h.openPrice)} · 持有 ${h.days} 天 · ${h.qty.toLocaleString('zh-CN')} 股 · 市值 ¥${(h.price * h.qty).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          </div>
          <div class="an" style="font-size:11px;color:var(--ink3)">
            每股 ${tone === 'rise' ? '浮盈' : '浮亏'} ${fixed(Math.abs(h.price - h.openPrice))} 元 · 换手 ${turnoverWord(h.turnover)} · 量比 ${vrWord(h.vr)}
          </div>
        </div>
      </div>`, 'mid', false)}
    </div>
  </section>`;

/* ------------------------------------------------- Z7 · 字段名 + 字段值网格 */

const z7 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><div class="fgrid-body">
      ${rows.map((r) => `<div class="frow${r.hold ? ' hold' : ''}">
        <div class="fid"><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span></div>
          <div class="r2">${stkTags(r)}<span class="tag n">${r.industry}</span></div></div>
        <div class="fvals">
          <div class="fline">
            ${fieldPair('最新价', fixed(r.price), toneOf(r.pct))}
            ${fieldPair('涨跌幅', signedPct(r.pct), toneOf(r.pct))}
            ${fieldPair('涨跌额', signed(r.change), toneOf(r.pct))}
            ${fieldPair('换手', `${fixed(r.turnover)}%`)}
            ${fieldPair('量比', fixed(r.vr))}
          </div>
          <div class="fline">
            ${fieldPair('成交额', `${fixed(r.amount, 1)}亿`)}
            ${fieldPair('自选日', r.date)}
            ${fieldPair('自选价', fixed(r.watchPrice))}
            ${fieldPair('自选收益', signedPct(r.watchReturn), toneOf(r.watchReturn))}
            ${fieldPair('加入天数', `${daysSince(r.date)} 天`)}
          </div>
        </div>
      </div>`).join('')}
    </div></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('字段名 + 字段值成对排列')}
    <div class="hlist">
      ${holdCards((h, tone) => `
        <div class="fline fline--3">
          ${fieldPair('持仓收益', signedMoney(h.profit), tone)}
          ${fieldPair('收益率', signedPct(h.returnPct), tone)}
          ${fieldPair('开仓价', fixed(h.openPrice))}
          ${fieldPair('现价', fixed(h.price), tone)}
          ${fieldPair('持有', `${h.days} 天`)}
        </div>
        <div class="fline fline--3">
          ${fieldPair('持有数量', h.qty.toLocaleString('zh-CN'))}
          ${fieldPair('持仓市值', `¥${(h.price * h.qty).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`)}
          ${fieldPair('投入成本', `¥${(h.openPrice * h.qty).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`)}
          ${fieldPair('换手', `${fixed(h.turnover)}%`)}
          ${fieldPair('量比', fixed(h.vr))}
        </div>
      `, 'fmid', false)}
    </div>
  </section>`;

/* --------------------------------- Z8 · Z5 精简：只留分档色 + 换手/量比 档位词 */

const z8 = `
  <section class="panel">${WATCH_BAR}
    <div class="scroll"><table>
      <colgroup><col style="width:21%"><col style="width:9%"><col style="width:10%"><col style="width:8%">
        <col style="width:10%"><col style="width:10%"><col style="width:8%"><col style="width:7%"><col style="width:8%"><col style="width:9%"></colgroup>
      <thead><tr><th>股票</th><th>最新价</th><th>涨跌幅</th><th>涨跌额</th><th>换手</th><th>量比</th>
        <th>成交额</th><th>自选日</th><th>自选价</th><th>自选收益</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const t = pctTier(r.pct);
          const p = pnlTier(r.watchReturn);
          return `<tr${r.hold ? ' class="hold"' : ''}>
          <td><div class="stk"><span class="nm">${r.name}</span><span class="code">${r.code}</span>${stkTags(r)}</div></td>
          <td class="px num ${toneOf(r.pct)}">${fixed(r.price)}</td>
          <td><span class="chip ${t.cls}">${signedPct(r.pct)}</span></td>
          <td class="num ${toneOf(r.pct)}">${signed(r.change)}</td>
          <td><div class="num ${turnoverTone(r.turnover)}">${fixed(r.turnover)}%</div>
            <div class="an ${turnoverTone(r.turnover)}">${turnoverWord(r.turnover)}</div></td>
          <td><div class="num ${vrTone(r.vr)}">${fixed(r.vr)}</div>
            <div class="an ${vrTone(r.vr)}">${vrWord(r.vr)}</div></td>
          <td class="num muted">${fixed(r.amount, 1)}亿</td>
          <td class="num dim">${r.date}</td>
          <td class="num dim">${fixed(r.watchPrice)}</td>
          <td><span class="chip ${p.cls}">${signedPct(r.watchReturn)}</span></td>
        </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="panel">${SUMMARY}${HOLD_BAR('涨跌幅与收益按档变色，换手带档位词')}
    <div class="hlist">
      ${holdCards((h, tone) => {
        const p = pnlTier(h.returnPct);
        return `<div class="hcol">
          <div class="hrow-mid">
            <div class="price ${tone}">${fixed(h.price)}<small class="${tone}">${signed(h.change)}</small></div>
            <div class="pnl"><div class="v num">${signedMoney(h.profit)}</div><div class="k">持仓收益</div></div>
            <span class="chip ${p.cls}">${signedPct(h.returnPct)}</span></div>
          <div class="foot"><span>开仓价 <b>${fixed(h.openPrice)}</b></span>
            <span>持有数量 <b>${h.qty.toLocaleString('zh-CN')}</b></span>
            <span>持有 <b>${h.days}</b> 天</span>
            <span>换手 <b>${fixed(h.turnover)}%</b> <b class="${turnoverTone(h.turnover)}">${turnoverWord(h.turnover)}</b></span></div>
        </div>`;
      }, 'fmid', false)}
    </div>
  </section>`;

/* ------------------------------------------------------------------ 输出 */

const PAGES = [
  ['z1-watch-pulse.html', `Z1 · 分时脉搏`, z1, '每行一条当日分时 · 持仓卡标注成本线', '新增分时接口 /api/quotes/minute（腾讯 minute/query，一次批量）'],
  ['z2-watch-scale.html', `Z2 · 刻度尺`, z2, '涨跌幅 / 自选收益 / 换手 / 量比 / 成交额条形化', '无，纯前端由现有行情字段计算'],
  ['z3-watch-info.html', `Z3 · 信息行`, z3, '行业 · 涨停原因 · 连板 · 加入/持有天数写成句子', '无，行业与涨停原因取自现有行情 / 涨停池'],
  ['z4-watch-kline.html', `Z4 · 迷你K线`, z4, '每行近 10 日 K 线 · 持仓卡标注开仓价', '新增日K接口 /api/quotes/daily（东财 push2his，一次批量）'],
  ['z5-watch-tier.html', `Z5 · 数值分档色阶`, z5, '每个字段值按档着色：涨停 / 大涨 / 活跃 / 放量 / 浮盈', '无，档位阈值前端定义'],
  ['z6-watch-annotated.html', `Z6 · 值带口径`, z6, '每个字段值下面一行写口径：较昨收 / 占两市 / 自选 N 天', '无，口径由现有字段推导'],
  ['z7-watch-fieldgrid.html', `Z7 · 字段值网格`, z7, '字段名 + 字段值成对铺开，值不再挤在表头下面猜', '无'],
  ['z8-watch-tier-lite.html', `Z8 · 分档色（精简）`, z8, '只加分档色 + 换手/量比档位词，其余保持原表', '无，阈值前端定义'],
];

for (const [file, title, body, note, need] of PAGES) {
  writeFileSync(join(HERE, file), page(title, body, FOOT(note, need)));
  console.log('wrote', file);
}
