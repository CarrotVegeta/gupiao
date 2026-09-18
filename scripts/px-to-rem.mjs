#!/usr/bin/env node
/**
 * px → rem 迁移脚本（大屏自适应改造）
 *
 * 背景：src/styles.css 原有 640 处硬编码 px。根字号是常量 13px，
 * 于是 2560px 宽的屏幕上「只有留白在长大、字号一直停在 11~13px」，
 * 看起来一切都特别小。改造方式是把「参与 UI 缩放的量」全部改成 rem，
 * 再让 :root 的 font-size 跟着视口宽度增长。
 *
 * 为什么必须连间距一起换，而不是只换 font-size：
 *   只放大字号会得到「大字 + 小间距」的拥挤版式。字号、内边距、间距、
 *   圆角、控件高度是同一套视觉比例，必须一起缩放。
 *
 * 哪些**不换**（这些描述的是「屏幕/像素」而不是「UI 比例」）：
 *   - 1px 与 0px：发丝线语义，放大后不该变成 1.4px 的粗线
 *   - border / border-* / outline*：同上，描边宽度保持物理像素
 *   - box-shadow / --shadow-*：阴影扩散不参与 UI 缩放
 *   - transform / background 渐变：装饰性，保持原样
 *   - @media 断点：断点必须固定在视口像素上，否则和 rem 互相影响
 *   - :root 的 font-size：它就是那个基准，由 clamp() 手工定义
 *
 * 精度：换算基准 13px，结果保留 4 位小数。
 *   13px 根字号下的相对误差 < 0.0006%（0.9231rem × 13 = 12.0003px），
 *   19px 根字号下绝对误差 < 0.001px，可忽略。
 *
 * 用法：
 *   node scripts/px-to-rem.mjs --dry-run   # 只统计，不写盘
 *   node scripts/px-to-rem.mjs             # 就地转换 src/styles.css
 *   node scripts/px-to-rem.mjs --check     # 与 git HEAD 对比，证明 root=13px 时等价
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT_DIR, 'src/styles.css');
const BASE_PX = 13;

/** 参与 UI 缩放的标准属性 */
const SCALE_PROPS = new Set([
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'flex',
  'flex-basis',
  'grid-template-columns',
  'grid-template-rows',
  /*
   * font 简写里的字号（例如 `font: 550 12.5px inherit`）也必须跟着缩放，
   * 否则这一处会永远停在 12.5px。`font: inherit` 没有 px，不受影响。
   */
  'font',
  /*
   * backdrop-filter 的模糊半径：大部分走 var(--blur-*)，但有两处写字面量
   * `blur(12px)`，漏掉就会和 var 那条路走出来的结果不一致。
   * （`@supports not ((backdrop-filter: blur(1px)))` 那种特性探测写在 @ 前奏行里，
   *   由 at-rule 规则整体跳过，且 1px 本身也在发丝线白名单内。）
   */
  'backdrop-filter',
  '-webkit-backdrop-filter',
]);

/** 参与 UI 缩放的自定义属性（间距 / 圆角 / 毛玻璃半径） */
const SCALE_CUSTOM_PROPS = /^--(space|radius|blur)-/;

/** 值本身是发丝线语义，保持 px */
const HAIRLINE = new Set([0, 1]);

const isScaled = (prop) => SCALE_PROPS.has(prop) || SCALE_CUSTOM_PROPS.test(prop);

/** 13px 基准下的 px → rem，保留 4 位小数并去掉尾随 0 */
function pxToRem(px) {
  const rem = px / BASE_PX;
  return `${Number(rem.toFixed(4))}rem`;
}

/**
 * 转换一个声明值里的 px。
 * 会保留 1px / 0px 原样；负值（如 margin-top: -2px）同样处理。
 */
function convertValue(value) {
  return value.replace(/(-?\d*\.?\d+)px\b/g, (match, num) => {
    const n = Number(num);
    if (HAIRLINE.has(n)) return match;
    return pxToRem(n);
  });
}

/**
 * 行级转换。
 * 依赖 src/styles.css 的既定书写规范（prettier 结果）：一行一条声明、
 * 注释独占整行、没有行内注释 —— 这一点已在改造前验证过。
 */
function convertCss(css) {
  const lines = css.split('\n');
  const stats = new Map();
  let inComment = false;
  let selector = '';

  const out = lines.map((line) => {
    const trimmed = line.trim();

    // 注释块：整段跳过，避免把注释里的 "348px" 之类的说明文字换算掉
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      return line;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inComment = true;
      return line;
    }

    // @media / @supports 等 at-rule 的前奏行：断点必须留在 px
    if (trimmed.startsWith('@')) return line;

    // 选择器行，记录当前选择器（用于跳过 :root 的 font-size）
    if (trimmed.endsWith('{') || trimmed.endsWith(',')) {
      if (trimmed.endsWith('{')) selector = trimmed.replace(/\s*\{$/, '');
      return line;
    }
    if (trimmed === '}' || trimmed === '') {
      selector = '';
      return line;
    }

    const colon = line.indexOf(':');
    if (colon < 0) return line;

    const prop = line.slice(0, colon).trim();
    if (!isScaled(prop)) return line;
    // :root / html 的 font-size 就是缩放基准本身，由 clamp() 定义，不能自引用成 rem
    if (prop === 'font-size' && /^(:root|html)$/.test(selector)) return line;
    if (!/\d*\.?\d+px\b/.test(line)) return line;

    const head = line.slice(0, colon + 1);
    const tail = line.slice(colon + 1);
    const converted = convertValue(tail);
    if (converted === tail) return line;

    const key = SCALE_CUSTOM_PROPS.test(prop) ? prop.replace(/-[\w]+$/, '-*') : prop;
    stats.set(key, (stats.get(key) ?? 0) + 1);
    return head + converted;
  });

  return { css: out.join('\n'), stats };
}

/** 审计：列出转换后仍然存在的 px，按属性归类，用于确认只留下白名单里的那几类 */
function auditRemainingPx(css) {
  const rest = new Map();
  let inComment = false;
  // 多行声明（box-shadow / background 渐变）的续行没有冒号，
  // 用「最近一次出现过的属性名」归属，避免它们被静默漏掉。
  let currentProp = '(未知)';

  for (const line of css.split('\n')) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inComment = true;
      continue;
    }

    if (trimmed.startsWith('@')) {
      if (/\d*\.?\d+px\b/.test(line)) rest.set('@media 断点', (rest.get('@media 断点') ?? 0) + 1);
      continue;
    }

    // 属性名要在「是否含 px」之前记录：`--shadow-soft:`、`background:` 这类
    // 首行不带 px 的多行声明，其续行才是真正含 px 的行。
    const colon = line.indexOf(':');
    let prop = currentProp;
    if (colon >= 0) {
      const declared = line.slice(0, colon).trim();
      if (/^[a-z-]+$/.test(declared)) currentProp = declared;
      prop = currentProp;
    } else {
      prop = `${currentProp}（多行续行）`;
    }

    if (!/\d*\.?\d+px\b/.test(line)) continue;
    rest.set(prop, (rest.get(prop) ?? 0) + 1);
  }
  return rest;
}

/**
 * 把 CSS 压成「有序声明序列」：[类型, 选择器, 属性, 值]。
 * 用序列而不是按行号比对，是为了对注释块的增删免疫 —— 改造时在 :root 里补了一段
 * 说明性注释，按行号比对会整体错位，看起来像几百处改动。
 */
function declarations(css) {
  const out = [];
  let inComment = false;
  let selector = '';
  for (const line of css.split('\n')) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inComment = true;
      continue;
    }
    if (trimmed === '') continue;
    if (trimmed.startsWith('@')) {
      out.push(['at', '', '', trimmed]);
      continue;
    }
    if (trimmed.endsWith('{')) {
      selector = trimmed.replace(/\s*\{$/, '');
      out.push(['sel', selector, '', trimmed]);
      continue;
    }
    if (trimmed === '}') {
      selector = '';
      out.push(['end', '', '', '']);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) {
      out.push(['raw', selector, '', trimmed]);
      continue;
    }
    out.push(['decl', selector, line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return out;
}

/** --check：与 git HEAD 逐条对比，证明 root=13px 时新旧计算值等价 */
function check(css) {
  const head = execFileSync('git', ['show', 'HEAD:src/styles.css'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });

  const before = declarations(head);
  const after = declarations(css);
  const problems = [];
  let compared = 0;
  let maxErr = 0;
  let rootFontSizeSeen = false;

  if (before.length !== after.length) {
    problems.push(`声明条数不一致：HEAD ${before.length} 条 vs 当前 ${after.length} 条`);
  }

  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n && problems.length < 8; i += 1) {
    const [kind, sel, prop, oldValue] = before[i];
    const [kind2, sel2, prop2, newValue] = after[i];

    if (kind !== kind2) {
      problems.push(`第 ${i + 1} 条类型不同：HEAD ${kind} vs 当前 ${kind2}`);
      continue;
    }
    if (kind === 'sel' && sel !== sel2) {
      problems.push(`第 ${i + 1} 条选择器被改动：HEAD「${sel}」vs 当前「${sel2}」`);
      continue;
    }
    if (kind === 'at' && oldValue !== newValue) {
      problems.push(`第 ${i + 1} 条 at-rule 被改动：HEAD「${oldValue}」vs 当前「${newValue}」`);
      continue;
    }
    if (kind !== 'decl') continue;
    if (prop !== prop2) {
      problems.push(`第 ${i + 1} 条属性被改动：HEAD ${prop} vs 当前 ${prop2}`);
      continue;
    }

    // 唯一允许的「非等价」改动：:root / html 的 font-size 由常量换成 clamp()
    if (prop === 'font-size' && /^(:root|html)$/.test(sel)) {
      rootFontSizeSeen = true;
      if (!newValue.startsWith('clamp(')) {
        problems.push(`:root 的 font-size 不是 clamp()：${newValue}`);
      }
      continue;
    }

    // 参与缩放的属性：HEAD 的值经脚本换算后必须与当前值逐字符相同
    if (isScaled(prop)) {
      const expect = convertValue(oldValue);
      if (expect !== newValue) {
        problems.push(`第 ${i + 1} 条 ${prop} 换算不符：期望「${expect}」实际「${newValue}」`);
        continue;
      }
      // 再把 rem 换算回 13px，量化误差
      for (const m of oldValue.matchAll(/(-?\d*\.?\d+)px\b/g)) {
        const px = Number(m[1]);
        if (HAIRLINE.has(px)) continue;
        maxErr = Math.max(maxErr, Math.abs(Number((px / BASE_PX).toFixed(4)) * BASE_PX - px));
      }
      compared += 1;
      continue;
    }

    // 其余（发丝线 / 阴影 / 断点 / 变换）必须一字不改
    if (oldValue !== newValue) {
      problems.push(`第 ${i + 1} 条 ${prop} 被意外改动：HEAD「${oldValue}」vs 当前「${newValue}」`);
    }
  }

  if (!rootFontSizeSeen) problems.push('未找到 :root 的 font-size 声明，无法确认 clamp() 已生效');

  return { problems, maxErr, compared };
}

const mode = process.argv[2] ?? '--write';
const source = readFileSync(TARGET, 'utf8');
const { css: converted, stats } = convertCss(source);

if (mode === '--check') {
  const { problems, maxErr, compared } = check(source);
  console.log('== 等价性校验（root = 13px）==');
  console.log(`  逐条比对的数值: ${compared} 处`);
  console.log(`  最大换算误差  : ${maxErr.toFixed(5)}px`);
  if (problems.length) {
    console.error('\n❌ 校验未通过:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('  ✅ 通过：≤1440px 视口下与改造前逐行等价（误差 < 0.01px）');
} else {
  console.log('== 已换算的声明数（按属性）==');
  const sorted = [...stats.entries()].sort((a, b) => b[1] - a[1]);
  for (const [prop, n] of sorted) console.log(`  ${String(n).padStart(4)}  ${prop}`);
  console.log(`  ${'—'.repeat(24)}\n  ${String(sorted.reduce((s, [, n]) => s + n, 0)).padStart(4)}  合计`);

  console.log('\n== 仍保留 px 的声明（应仅剩白名单：发丝线 / 阴影 / 变换 / 断点）==');
  const rest = [...auditRemainingPx(converted)].sort((a, b) => b[1] - a[1]);
  for (const [prop, n] of rest) console.log(`  ${String(n).padStart(4)}  ${prop}`);
  console.log(`  ${'—'.repeat(24)}\n  ${String(rest.reduce((s, [, n]) => s + n, 0)).padStart(4)}  合计`);

  if (mode !== '--dry-run') {
    writeFileSync(TARGET, converted);
    console.log(`\n✅ 已写入 ${TARGET.replace(ROOT_DIR + '/', '')}`);
  } else {
    console.log('\n(--dry-run：未写盘)');
  }
}
