/**
 * 打开「添加股票」弹窗后截图 + 量表单盒模型
 * 用法: node probe-dialog.mjs <out.png>
 */
const [, , out = 'design-mockups/shots/dialog.png'] = process.argv;
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: 'http://localhost:5174/' });
await sleep(3500);
await send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('添加股票'))?.click()`,
});
await sleep(1200);
const probe = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), boxSizing: cs.boxSizing, padding: cs.padding, border: cs.borderWidth, width: cs.width, background: cs.backgroundColor, radius: cs.borderRadius, font: cs.fontSize + ' ' + cs.fontWeight }; };
    const fields = [...document.querySelectorAll('.field')];
    return {
      backdrop: box('.dialog-backdrop'),
      dialogCard: box('.dialog-card'),
      firstField: fields[0] ? { fieldW: +fields[0].getBoundingClientRect().width.toFixed(1), inputW: +fields[0].querySelector('input').getBoundingClientRect().width.toFixed(1), overflow: +(fields[0].querySelector('input').getBoundingClientRect().width - fields[0].getBoundingClientRect().width).toFixed(1) } : null,
      input: box('.input'),
      select: box('.input'),
      primaryBtn: box('.button:not(.button--secondary):not(.button--ghost)'),
      secondaryBtn: box('.button--secondary'),
      formGrid: box('.form-grid'),
      gridCols: getComputedStyle(q('.form-grid')).gridTemplateColumns,
    };
  })()`,
});
console.log(JSON.stringify(probe.result?.value, null, 1));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
ws.close(); process.exit(0);
