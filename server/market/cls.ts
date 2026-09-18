/**
 * 财联社（cls.cn）适配器：市场情绪 + 板块轮动。
 *
 * 为什么单独开一个源（评估见 `docs/levistock-evaluation.md`）：
 *
 * 1. **封板率 / 高开率 / 获利率 / 分档连板率** —— `server/market/breadth.ts` 自算的只有
 *    涨跌家数、涨停/炸板家数、总体晋级率。情绪周期最关键的这 4 个指标我们一个都没有，
 *    而且自算它们需要「昨日涨停池」——那正是东财只保留 ~15 个交易日的短板。
 * 2. **板块轮动（近 4 / 30 个交易日 top10）** —— `server/themes` 只有**当日**快照
 *    （东财板块 + F10 题材归属），回答不了「这个题材是第几天走强 / 昨天谁在涨」。
 *    轮动是逐日快照，天然没有前视偏差。
 *
 * ## 上游的两个硬边界（实测，别想当然）
 *
 * * `rotation` 的 `days` **只接受 4 和 30**；传 15 会返回 `{"days":"支持 4/30"}` 而不是数组。
 * * `emotion` **没有日期参数**，只有当天实时快照 —— 所以情绪只用于线上展示，不能回测。
 *
 * ## 签名
 *
 * 两个端点都用同一套签名：参数按 key 字母序拼成 `k=v&k=v` → SHA1 → MD5。
 * `emotion` 在当前版本用一个固定 `sign`，这里仍走统一签名函数，避免依赖魔法值。
 *
 * 本模块不引入任何依赖、不需要任何凭据，纯 `fetch`。
 */
import { createHash } from 'node:crypto';
import type {
  ClsLadderRung,
  MarketEmotion,
  SectorRotationItem,
  SectorRotationResponse,
} from '../../src/types.js';

const EMOTION_ENDPOINT = 'https://x-quote.cls.cn/v2/quote/a/stock/emotion';
const ROTATION_ENDPOINT = 'https://x-quote.cls.cn/v2/quote/a/plate/rotation';

const REQUEST_TIMEOUT_MS = 8_000;

/** 财联社 App 的公共参数（无 token / uid，即游客口径） */
const BASE_PARAMS: Record<string, string> = {
  app: 'cailianpress',
  sv: '8.7.4',
  os: 'android',
  mb: 'Xiaomi-2206123SC',
  ov: '32',
  channel: '8',
  motif: '0',
  net: '',
  province_code: '3205',
  token: '',
  uid: '',
};

/**
 * 上游只支持这两个窗口，其它值会被回一个 `{days: "支持 4/30"}` 对象。
 * 别在这里「顺手支持任意天数」——接口不认。
 */
export const ROTATION_SUPPORTED_DAYS = [4, 30] as const;
export type RotationDays = (typeof ROTATION_SUPPORTED_DAYS)[number];

export const DEFAULT_ROTATION_DAYS: RotationDays = 30;

export const isRotationDays = (value: unknown): value is RotationDays =>
  value === 4 || value === 30;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }
  return null;
};

/**
 * 带单位的数字：`"76.00%"` → 76、`"2.08万亿"` → 2080000000000、`123456` → 123456。
 *
 * 上游的金额字段（如 `shsz_balance`）直接给「2.08万亿」这种展示串，
 * 不做单位换算会把 2.08 当成 2.08 元。
 */
const asUnitNumber = (value: unknown): number | null => {
  const direct = asNumber(value);
  if (direct !== null) {
    return direct;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)\s*(万亿|亿|万)?%?$/.exec(text);
  if (!match) {
    return null;
  }

  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) {
    return null;
  }

  const unitScale: Record<string, number> = {
    万亿: 1_000_000_000_000,
    亿: 100_000_000,
    万: 10_000,
  };
  return magnitude * (match[2] ? (unitScale[match[2]] ?? 1) : 1);
};

/** 板位名的归一化键：中文板位名 → ascii key，顺带避开 unicode 比较 */
const LADDER_KEY_ALIASES: Record<string, string> = {
  一板: 'yiban',
  首板: 'yiban',
  二板: 'erban',
  三板: 'sanban',
  四板: 'siban',
  高度板: 'gaoduban',
};

const ladderKey = (name: string, index: number): string =>
  LADDER_KEY_ALIASES[name] ?? (/^[a-zA-Z0-9_]+$/.test(name) ? name : `rung${index}`);

/** `2026-09-18` / `20260918` → `20260918`；认不出来就 null */
const normalizeTradeDate = (value: unknown): string | null => {
  const text = asString(value);
  if (/^\d{8}$/.test(text)) {
    return text;
  }
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return dashed ? `${dashed[1]}${dashed[2]}${dashed[3]}` : null;
};

/**
 * 财联社签名：参数按 key 字母序拼成 `k=v&k=v` → SHA1 → MD5。
 *
 * 用 node:crypto 的同步接口。注意上游签名覆盖的是**除 sign 以外**的全部参数，
 * 所以必须先拼参数、后算签名。
 */
export const clsSign = (params: Record<string, string>): string => {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const sha1 = createHash('sha1').update(sorted, 'utf8').digest('hex');
  return createHash('md5').update(sha1, 'utf8').digest('hex');
};

const buildSignedUrl = (endpoint: string, extra: Record<string, string> = {}): string => {
  const params = { ...BASE_PARAMS, ...extra };
  params.sign = clsSign(params);
  return `${endpoint}?${new URLSearchParams(params).toString()}`;
};

const requestJson = async (
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Referer: 'https://www.cls.cn/' },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 解析 `limit_up_board`：上游是「三行」结构。
 *
 * ```text
 * row1: ['一板', '二板', '三板', '高度板']   板位名
 * row2: ['66', '8', '2', '2']                家数
 * row3: ['连板率', '21%', '40%', '50%']      ⚠️ 首项是表头文字，不是一板的连板率
 * ```
 *
 * 所以 `row3` 要右移一位取，且**不能**把表头 `连板率` 当数字。
 */
export const parseLadder = (raw: unknown): ClsLadderRung[] => {
  if (!isRecord(raw)) {
    return [];
  }

  const names = Array.isArray(raw.row1) ? raw.row1 : [];
  const counts = Array.isArray(raw.row2) ? raw.row2 : [];
  const rates = Array.isArray(raw.row3) ? raw.row3 : [];

  return names.map((rawName, index) => {
    const name = asString(rawName);
    // row3[0] 是表头，真实连板率从 row3[1] 开始，所以取 rates[index + 1]
    const rawRate = rates[index + 1];
    const rate = asUnitNumber(rawRate);
    return {
      key: ladderKey(name, index),
      name,
      count: asNumber(counts[index]),
      // 表头是「连板率」这种非数字文字，解析失败即为 null，不能算成 0
      promotionRate: rate,
    };
  });
};

/** 解析情绪响应；结构不对返回 null，由调用方降级成不可用 */
export const parseEmotion = (payload: unknown, tradeDate: string | null): MarketEmotion | null => {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;

  return {
    source: 'cls',
    tradeDate,
    marketDegree: asNumber(data.market_degree),
    sealRate: asUnitNumber(data.up_ratio),
    sealCount: asNumber(data.up_ratio_num),
    brokenCount: asNumber(data.up_open_num),
    openRate: asUnitNumber(data.up_open_ratio),
    profitRate: asUnitNumber(data.profit_ratio),
    yesterdayLimitUpPerformance: asUnitNumber(data.performance),
    // 上游给「2.08万亿」，统一换算成元
    turnover: asUnitNumber(data.shsz_balance),
    ladder: parseLadder(data.limit_up_board),
    status: 'fresh',
  };
};

export const unavailableEmotion = (tradeDate: string | null): MarketEmotion => ({
  source: 'cls',
  tradeDate,
  marketDegree: null,
  sealRate: null,
  sealCount: null,
  brokenCount: null,
  openRate: null,
  profitRate: null,
  yesterdayLimitUpPerformance: null,
  turnover: null,
  ladder: [],
  status: 'unavailable',
});

/**
 * 市场情绪。
 *
 * ⚠️ 上游没有日期参数：无论传哪天都只会拿到**当天**的快照。
 * 这里的 `tradeDate` 只用于回填标记，不代表数据真的属于那一天；
 * 传历史日期时调用方应当直接跳过（见 `server/index.ts` 的判断）。
 */
export const fetchClsEmotion = async (
  tradeDate: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketEmotion | null> => {
  const payload = await requestJson(buildSignedUrl(EMOTION_ENDPOINT), fetchImpl);
  return parseEmotion(payload, tradeDate);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 汇总轮动窗口：把「每日 top10」压成「板块 → 上榜次数 / 最大涨幅 / 首次上榜」 */
export const summarizeRotation = (
  days: { tradeDate: string; plates: { plateCode: string; plateName: string; change: number }[] }[],
): SectorRotationItem[] => {
  type Acc = {
    plateCode: string;
    plateName: string;
    changes: { date: string; change: number }[];
  };
  const byPlate = new Map<string, Acc>();

  for (const day of days) {
    for (const plate of day.plates) {
      const existing = byPlate.get(plate.plateCode) ?? {
        plateCode: plate.plateCode,
        plateName: plate.plateName,
        changes: [],
      };
      existing.changes.push({ date: day.tradeDate, change: plate.change });
      // 上游偶尔改名，取最近一次看到的名称
      existing.plateName = plate.plateName || existing.plateName;
      byPlate.set(plate.plateCode, existing);
    }
  }

  const items: SectorRotationItem[] = [];
  for (const acc of byPlate.values()) {
    if (acc.changes.length === 0) {
      continue;
    }
    // days 已按日期升序传入，changes 因此天然升序
    const sorted = [...acc.changes].sort((left, right) => left.date.localeCompare(right.date));
    const changes = sorted.map((entry) => entry.change);
    const latest = sorted[sorted.length - 1];
    const first = sorted[0];
    const sum = changes.reduce((total, value) => total + value, 0);

    items.push({
      plateCode: acc.plateCode,
      plateName: acc.plateName,
      latestChange: latest ? round2(latest.change) : null,
      appearCount: sorted.length,
      maxChange: round2(Math.max(...changes)),
      avgChange: round2(sum / changes.length),
      firstSeen: first ? first.date : '',
      lastSeen: latest ? latest.date : '',
      days: sorted.map((entry) => entry.date),
    });
  }

  // 上榜次数多 → 最近上榜 → 涨幅，依次降序；次数相同看谁更「当下」
  return items.sort(
    (left, right) =>
      right.appearCount - left.appearCount ||
      right.lastSeen.localeCompare(left.lastSeen) ||
      (right.latestChange ?? -Infinity) - (left.latestChange ?? -Infinity) ||
      left.plateCode.localeCompare(right.plateCode),
  );
};

/**
 * 解析轮动响应。
 *
 * 上游在两个情况下会返回非数组的 `data`：
 * 不支持的 `days` 返回 `{days: "支持 4/30"}`；异常时可能为空对象。
 * 这两种都按「无数据」处理，而不是当成 0 天上榜。
 */
export const parseRotation = (
  payload: unknown,
): { tradeDates: string[]; items: SectorRotationItem[] } | null => {
  if (!isRecord(payload) || payload.code !== 200 || !Array.isArray(payload.data)) {
    return null;
  }

  const normalized: {
    tradeDate: string;
    plates: { plateCode: string; plateName: string; change: number }[];
  }[] = [];

  for (const rawDay of payload.data) {
    if (!isRecord(rawDay)) {
      continue;
    }
    const tradeDate = normalizeTradeDate(rawDay.trade_date);
    if (tradeDate === null || !Array.isArray(rawDay.plates)) {
      continue;
    }

    const plates: { plateCode: string; plateName: string; change: number }[] = [];
    for (const rawPlate of rawDay.plates) {
      if (!isRecord(rawPlate)) {
        continue;
      }
      const plateCode = asString(rawPlate.plate_code);
      const plateName = asString(rawPlate.plate_name);
      const change = asNumber(rawPlate.change);
      if (plateCode === '' || change === null) {
        continue;
      }
      plates.push({ plateCode, plateName, change });
    }

    normalized.push({ tradeDate, plates });
  }

  if (normalized.length === 0) {
    return null;
  }

  normalized.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

  return {
    tradeDates: normalized.map((day) => day.tradeDate),
    items: summarizeRotation(normalized),
  };
};

/** 板块轮动（近 `days` 个交易日 top10） */
export const fetchClsSectorRotation = async (
  days: RotationDays = DEFAULT_ROTATION_DAYS,
  fetchImpl: typeof fetch = fetch,
): Promise<SectorRotationResponse> => {
  const fetchedAt = new Date().toISOString();
  const payload = await requestJson(
    buildSignedUrl(ROTATION_ENDPOINT, { days: String(days) }),
    fetchImpl,
  );
  const parsed = parseRotation(payload);

  if (parsed === null) {
    return {
      days,
      tradeDates: [],
      items: [],
      fetchedAt,
      source: 'cls',
      status: 'unavailable',
      error: '财联社板块轮动暂不可用',
    };
  }

  return {
    days,
    tradeDates: parsed.tradeDates,
    items: parsed.items,
    fetchedAt,
    source: 'cls',
    status: 'fresh',
    error: null,
  };
};
