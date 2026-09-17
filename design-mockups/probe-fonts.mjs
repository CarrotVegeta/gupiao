/**
 * 报告某个元素实际用了哪些字体族（以及字形数），用来确认中文到底落在哪个字体上。
 * 用法: node probe-fonts.mjs <url> <selector>
 */
const [, , url, selector] = process.argv;
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
await send('DOM.enable');
await send('CSS.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(3200);
const doc = await send('DOM.getDocument', { depth: -1 });
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
if (!node.nodeId) { console.log('找不到元素:', selector); ws.close(); process.exit(1); }
const fonts = await send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
const computed = await send('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
const fam = computed.computedStyle.find((p) => p.name === 'font-family')?.value;
const weight = computed.computedStyle.find((p) => p.name === 'font-weight')?.value;
console.log(JSON.stringify({ selector, fontFamily: fam, fontWeight: weight, fonts: fonts.fonts }, null, 1));
ws.close(); process.exit(0);
