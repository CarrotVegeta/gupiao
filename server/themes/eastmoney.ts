/**
 * 选股页的东财适配器。
 *
 * 三件事：
 *   1. 板块目录 / 快照（`push2delay` clist）——概念 504 + 行业 496，含涨跌幅、成交额、涨跌家数、领涨股
 *   2. 板块成分股（`push2delay` clist `fs=b:BKxxxx`）——单板块最多 700+ 只，含成交额 / 换手 / 量比 / 流通市值
 *   3. 个股 → 题材归属（`datacenter` F10）——**支持批量 `in` 查询**，是「涨停股」与「板块」缝合的关键；
 *      同时给出 `IS_PRECISE`（题材纯正度）与 `SELECTED_BOARD_REASON`（业务依据）
 *   4. 风险核验（减持 / 业绩预告），同样支持批量
 *
 * 注意：`push2.eastmoney.com` 与 `push2his.eastmoney.com` 在本网络下 100% 失败
 * （实测 0/15，与 README 一致），所以这里一律走 `push2delay` 镜像。
 */
import type { QuoteError } from '../../src/types.js';

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 12;
const F10_BATCH_SIZE = 50;
const F10_PAGE_SIZE = 500;
const F10_MAX_PAGES = 8;
const RISK_PAGE_SIZE = 100;
const RISK_MAX_PAGES = 4;

const CLIST_ENDPOINT = 'https://push2delay.eastmoney.com/api/qt/clist/get';
const F10_ENDPOINT = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const DATACENTER_ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-' || value === '') return null;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : null;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeSymbol = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(?:[01]\.)?(\d{6})$/);
  return match?.[1] ?? '';
};

const fetchJson = async (
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://quote.eastmoney.com/',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// 板块目录 / 快照
// ---------------------------------------------------------------------------

export type BoardSnapshot = {
  code: string;
  name: string;
  pct: number | null;
  /** 成交额（元） */
  amount: number | null;
  /** 换手率 % */
  turnover: number | null;
  /** 上涨家数 */
  upCount: number | null;
  /** 下跌家数 */
  downCount: number | null;
  leaderName: string | null;
  leaderSymbol: string | null;
};

export type BoardCatalog = Map<string, BoardSnapshot>;

const BOARD_KINDS: Array<{ label: string; filter: string }> = [
  { label: 'concept', filter: 'm:90+t:3' },
  { label: 'industry', filter: 'm:90+t:2' },
];

const toBoardCode = (raw: unknown): string => {
  const text = String(raw ?? '').trim();
  return /^BK\d{4}$/.test(text) ? text : '';
};

/** F10 的 BOARD_CODE（"900"）→ clist 的板块代码（"BK0900"） */
export const toBoardCodeFromF10 = (raw: unknown): string => {
  const text = String(raw ?? '').trim();
  return /^\d+$/.test(text) ? `BK${text.padStart(4, '0')}` : '';
};

const mapBoardSnapshot = (row: Record<string, unknown>): BoardSnapshot | null => {
  const code = toBoardCode(row.f12);
  const name = asString(row.f14);
  if (!code || !name) return null;
  const leaderSymbol = normalizeSymbol(row.f140);
  return {
    code,
    name,
    pct: asNumber(row.f3),
    amount: asNumber(row.f6),
    turnover: asNumber(row.f8),
    upCount: asNumber(row.f104),
    downCount: asNumber(row.f105),
    leaderName: asString(row.f128) || null,
    leaderSymbol: leaderSymbol || null,
  };
};

/**
 * 拉取东财概念 + 行业板块快照（分页直到取完）。
 *
 * 单页失败不能让整张目录为空：保留已经取到的页，只把失败页记下来。
 * 否则「某个分页偶发超时」会表现成「全部题材都消失」，比少几个板块严重得多。
 */
export const fetchBoardCatalog = async (
  fetchImpl: typeof fetch = fetch,
): Promise<{ catalog: BoardCatalog; errors: QuoteError[] }> => {
  const catalog: BoardCatalog = new Map();
  const errors: QuoteError[] = [];

  for (const kind of BOARD_KINDS) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        pn: String(page),
        pz: String(PAGE_SIZE),
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fid: 'f3',
        fs: kind.filter,
        fields: 'f3,f6,f8,f12,f14,f104,f105,f128,f140',
      });

      let diff: unknown[] = [];
      try {
        const payload = await fetchJson(`${CLIST_ENDPOINT}?${params.toString()}`, fetchImpl);
        const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
        diff = data && Array.isArray(data.diff) ? data.diff : [];
      } catch (error) {
        errors.push({
          symbol: `${kind.label}#${page}`,
          message: error instanceof Error ? error.message : '板块目录请求失败',
        });
        break;
      }
      if (diff.length === 0) break;

      for (const raw of diff) {
        if (!isRecord(raw)) continue;
        const snapshot = mapBoardSnapshot(raw);
        if (snapshot) catalog.set(snapshot.code, snapshot);
      }

      if (diff.length < PAGE_SIZE) break;
    }
  }

  return { catalog, errors };
};

// ---------------------------------------------------------------------------
// 板块成分股
// ---------------------------------------------------------------------------

export type BoardMember = {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  /** 成交额（元） */
  amount: number | null;
  /** 换手率 % */
  turnoverRate: number | null;
  /** 量比 */
  volumeRatio: number | null;
  /** 流通市值（元） */
  floatMarketCap: number | null;
  /**
   * 所属行业板块名称（东财 clist 的 f100）。这是上游给的「这只票属于哪个板块」，
   * 不是本项目自己算出来的题材归属；拿不到就是 null，界面上按「—」显示。
   */
  industry: string | null;
};

const mapBoardMember = (row: Record<string, unknown>): BoardMember | null => {
  const symbol = normalizeSymbol(row.f12);
  const name = asString(row.f14);
  if (!symbol || !name) return null;
  return {
    symbol,
    name,
    price: asNumber(row.f2),
    pct: asNumber(row.f3),
    amount: asNumber(row.f6),
    turnoverRate: asNumber(row.f8),
    volumeRatio: asNumber(row.f10),
    // f21 是流通市值（元）
    floatMarketCap: asNumber(row.f21),
    industry: asString(row.f100) || null,
  };
};

/** 拉取单个板块的全部成分股 */
export const fetchBoardMembers = async (
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BoardMember[]> => {
  const members: BoardMember[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(PAGE_SIZE),
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs: `b:${code}`,
      fields: 'f2,f3,f6,f8,f10,f12,f14,f21',
    });

    const payload = await fetchJson(`${CLIST_ENDPOINT}?${params.toString()}`, fetchImpl);
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const diff = data && Array.isArray(data.diff) ? data.diff : [];
    if (diff.length === 0) break;

    for (const raw of diff) {
      if (!isRecord(raw)) continue;
      const member = mapBoardMember(raw);
      if (!member || seen.has(member.symbol)) continue;
      seen.add(member.symbol);
      members.push(member);
    }

    if (diff.length < PAGE_SIZE) break;
  }

  return members;
};

// ---------------------------------------------------------------------------
// 个股 → 题材归属（F10）
// ---------------------------------------------------------------------------

export type SymbolTheme = {
  code: string;
  name: string;
  /** 题材纯正度：主营相关 */
  precise: boolean;
  /** 入选依据（可能很长，只保留前 200 字） */
  reason: string | null;
};

const fetchF10Batch = async (
  batch: string[],
  fetchImpl: typeof fetch,
): Promise<Array<Record<string, unknown>>> => {
  const filter = `(SECURITY_CODE in (${batch.map((symbol) => `"${symbol}"`).join(',')}))`;
  const rows: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= F10_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      reportName: 'RPT_F10_CORETHEME_BOARDTYPE',
      columns: 'SECURITY_CODE,BOARD_CODE,BOARD_NAME,IS_PRECISE,SELECTED_BOARD_REASON',
      filter,
      pageNumber: String(page),
      pageSize: String(F10_PAGE_SIZE),
      source: 'HSF10',
      client: 'PC',
    });

    const payload = await fetchJson(`${F10_ENDPOINT}?${params.toString()}`, fetchImpl);
    const root = isRecord(payload) && isRecord(payload.result) ? payload.result : null;
    const data = root && Array.isArray(root.data) ? root.data : [];
    const pages = root ? Number(root.pages ?? 1) : 1;
    for (const row of data) if (isRecord(row)) rows.push(row);
    if (page >= pages || data.length === 0) break;
  }

  return rows;
};

/**
 * 批量拉「股票 → 所属题材板块」。
 *
 * **只保留 `IS_PRECISE = 1`（题材纯正 / 主营相关）且在 `catalog` 里的板块。**
 * 这一步是必须的：东财 F10 会把「融资融券 / 深股通 / 沪股通 / 机构重仓 / QFII重仓 /
 * 标准普尔 / 富时罗素 / 破发股 / 昨日涨停」这类**属性与统计板块**也算进来，
 * 它们的成员数上千，会让「涨停家数」这类指标彻底失真（实测不加这层过滤，
 * 一天能算出 64 个「主线板块」，等价于全市场）。
 * 回测脚本里用的是同一层过滤，见 scripts/screener-trend-backtest.ts。
 */
export const fetchSymbolThemes = async (
  symbols: string[],
  catalog: Map<string, { name: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, SymbolTheme[]>> => {
  const result = new Map<string, SymbolTheme[]>();

  for (let offset = 0; offset < symbols.length; offset += F10_BATCH_SIZE) {
    const batch = symbols.slice(offset, offset + F10_BATCH_SIZE);
    const rows = await fetchF10Batch(batch, fetchImpl);

    for (const row of rows) {
      const symbol = String(row.SECURITY_CODE ?? '').trim();
      const code = toBoardCodeFromF10(row.BOARD_CODE);
      if (!/^\d{6}$/.test(symbol) || !code) continue;
      const board = catalog.get(code);
      if (!board) continue;

      if (String(row.IS_PRECISE ?? '') !== '1') continue;

      const rawReason = asString(row.SELECTED_BOARD_REASON);
      const list = result.get(symbol) ?? [];
      if (list.some((item) => item.code === code)) continue;
      list.push({
        code,
        name: board.name,
        precise: String(row.IS_PRECISE ?? '') === '1',
        reason: rawReason ? rawReason.slice(0, 200) : null,
      });
      result.set(symbol, list);
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// 风险核验：减持 / 业绩预告
// ---------------------------------------------------------------------------

export type RiskCheck = {
  /** 是否成功查过（查过才能说「未见风险」） */
  checked: boolean;
  /** 命中的风险描述 */
  flags: string[];
  errors: QuoteError[];
};

const fetchDatacenterBatch = async (
  endpoint: string,
  reportName: string,
  columns: string,
  filter: string,
  fetchImpl: typeof fetch,
  extra: Record<string, string> = {},
): Promise<Array<Record<string, unknown>>> => {
  const rows: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= RISK_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      reportName,
      columns,
      filter,
      pageNumber: String(page),
      pageSize: String(RISK_PAGE_SIZE),
      ...extra,
    });
    const payload = await fetchJson(`${endpoint}?${params.toString()}`, fetchImpl);
    const root = isRecord(payload) && isRecord(payload.result) ? payload.result : null;
    const data = root && Array.isArray(root.data) ? root.data : [];
    const pages = root ? Number(root.pages ?? 1) : 1;
    for (const row of data) if (isRecord(row)) rows.push(row);
    if (page >= pages || data.length === 0) break;
  }

  return rows;
};

/**
 * 批量核验风险：近 3 个月减持公告 + 最新业绩预告为预亏 / 预减。
 * 任何一路失败都把 `checked` 置为 false —— 宁可在页面上说「未核验」，也不能谎报「未见风险」。
 */
export const fetchRiskFlags = async (
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, RiskCheck>> => {
  const result = new Map<string, RiskCheck>();
  for (const symbol of symbols) result.set(symbol, { checked: true, flags: [], errors: [] });

  const threeMonthsAgo = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10);

  for (let offset = 0; offset < symbols.length; offset += F10_BATCH_SIZE) {
    const batch = symbols.slice(offset, offset + F10_BATCH_SIZE);
    const inList = batch.map((symbol) => `"${symbol}"`).join(',');

    // 减持
    try {
      const rows = await fetchDatacenterBatch(
        DATACENTER_ENDPOINT,
        'RPT_SHARE_HOLDER_INCREASE',
        'SECURITY_CODE,NOTICE_DATE,CHANGE_NUM_SYMBOL,HOLDER_NAME',
        `(SECURITY_CODE in (${inList}))(NOTICE_DATE>='${threeMonthsAgo}')`,
        fetchImpl,
        { sortColumns: 'NOTICE_DATE', sortTypes: '-1' },
      );
      for (const row of rows) {
        const symbol = String(row.SECURITY_CODE ?? '').trim();
        const entry = result.get(symbol);
        if (!entry) continue;
        const date = String(row.NOTICE_DATE ?? '').slice(0, 10);
        const shares = asNumber(row.CHANGE_NUM_SYMBOL);
        entry.flags.push(`近 3 个月减持公告（${date}${shares === null ? '' : `，${shares.toFixed(1)} 万股`}）`);
      }
    } catch (error) {
      for (const symbol of batch) {
        const entry = result.get(symbol);
        if (!entry) continue;
        entry.checked = false;
        entry.errors.push({
          symbol,
          message: error instanceof Error ? error.message : '减持数据请求失败',
        });
      }
    }

    // 业绩预告
    try {
      const rows = await fetchDatacenterBatch(
        DATACENTER_ENDPOINT,
        'RPT_PUBLIC_OP_NEWPREDICT',
        'SECURITY_CODE,NOTICE_DATE,REPORT_DATE,PREDICT_FINANCE_CODE,PREDICT_TYPE,PREDICT_CONTENT',
        `(SECURITY_CODE in (${inList}))`,
        fetchImpl,
        { sortColumns: 'NOTICE_DATE', sortTypes: '-1' },
      );
      const seen = new Set<string>();
      for (const row of rows) {
        const symbol = String(row.SECURITY_CODE ?? '').trim();
        if (seen.has(symbol)) continue;
        const entry = result.get(symbol);
        if (!entry) continue;
        seen.add(symbol);
        const type = String(row.PREDICT_TYPE ?? '');
        const content = String(row.PREDICT_CONTENT ?? '');
        if (/预亏|预减|首亏|续亏|略减|减亏/.test(`${type}${content}`)) {
          const date = String(row.NOTICE_DATE ?? '').slice(0, 10);
          entry.flags.push(`业绩预告为「${type || '预减/预亏'}」（${date}）`);
        }
      }
    } catch (error) {
      for (const symbol of batch) {
        const entry = result.get(symbol);
        if (!entry) continue;
        entry.checked = false;
        entry.errors.push({
          symbol,
          message: error instanceof Error ? error.message : '业绩预告数据请求失败',
        });
      }
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// 全市场快照（用于「不做主线过滤」的形态扫描对照）
// ---------------------------------------------------------------------------

/** 沪深京 A 股（非 ST 也包含，ST 由调用方按名称排除） */
const ALL_MARKET_FILTER = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

/** 拉取全市场行情快照（单次查询，pz 上限 100，需要分页） */
export const fetchMarketSnapshot = async (
  fetchImpl: typeof fetch = fetch,
): Promise<BoardMember[]> => {
  const members: BoardMember[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 70; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(PAGE_SIZE),
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f6',
      fs: ALL_MARKET_FILTER,
      // f100 = 所属行业板块名称：形态扫描要展示「所属板块」，不能再拿空题材冒充
      fields: 'f2,f3,f6,f8,f10,f12,f14,f21,f100',
    });

    const payload = await fetchJson(`${CLIST_ENDPOINT}?${params.toString()}`, fetchImpl);
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const diff = data && Array.isArray(data.diff) ? data.diff : [];
    if (diff.length === 0) break;

    for (const raw of diff) {
      if (!isRecord(raw)) continue;
      const member = mapBoardMember(raw);
      if (!member || seen.has(member.symbol)) continue;
      seen.add(member.symbol);
      members.push(member);
    }

    if (diff.length < PAGE_SIZE) break;
  }

  return members;
};
