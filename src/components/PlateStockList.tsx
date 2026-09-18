import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** 财联社板块成分股（`/api/themes/rotation/:plateCode/stocks`） */
export type PlateStock = {
  symbol: string;
  name: string;
  exchange: 'SH' | 'SZ' | 'BJ';
  isCore: boolean;
  assocDesc: string | null;
  price: number | null;
  pct: number | null;
  changePx: number | null;
  /** 上游 col1 / col2 原文：语义未确认，界面不解释 */
  rawCol1: string | null;
  rawCol2: string | null;
  amount: number | null;
};

export type PlateStocksResponse = {
  plateCode: string;
  stocks: PlateStock[];
  hasCore: boolean | null;
  coreCount: number;
  fetchedAt: string;
  status: 'fresh' | 'unavailable';
  warnings: string[];
  error: { symbol: string; message: string } | null;
};

export type PlateStocksState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: PlateStocksResponse }
  | { status: 'error'; message: string };

const formatPct = (value: number | null): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatPrice = (value: number | null): string =>
  value === null ? '—' : value.toFixed(2);

/**
 * 按「能放几个字符」把长文本真正截断，末尾补省略号。
 *
 * 为什么不用 CSS 的 `-webkit-line-clamp`：这个单元格里试过两次都不行 ——
 * `display: -webkit-box` 会被覆盖成 `flow-root`（`-webkit-line-clamp` 随之失效），
 * 结果是**不画省略号、文字被硬切**；而是否画省略号还取决于文本正好断在哪个字上，
 * 表现为「有的行有省略号、有的行没有」。用户明确要求「展示不完就省略」，
 * 所以改成在渲染前按字符预算截断。
 *
 * 权重口径：中日韩字符（含全角标点）按 1、其余按 0.55 —— 与 `font-size` 的 em 宽度对应，
 * 这样 `预算 = 每行字数 × 行数` 的单位就一致了。
 *
 * ⚠ 预算必须留安全余量：实测按 `width/fontSize × 行数` 直接取整会**多出约一行**
 * （中文字宽≈1em 但英文数字偏宽，加权后仍不够）。所以乘 0.9，并且截断后再实测一次行数，
 * 超了就把预算按比例收紧重算，最多退 6 轮。
 */
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const charWeight = (char: string): number => (CJK.test(char) ? 1 : 0.55);

/** 累计权重不超过 budget 的最长前缀长度 */
const fitChars = (text: string, budget: number): number => {
  let used = 0;
  for (let index = 0; index < text.length; index += 1) {
    used += charWeight(text[index]);
    if (used > budget) return index;
  }
  return text.length;
};

const SAFETY = 0.9;

/** 文本在给定像素宽度下最多能显示多少「字宽」 */
const budgetFor = (widthPx: number, fontSizePx: number, lineCount: number): number =>
  Math.max(6, Math.floor((widthPx / Math.max(fontSizePx, 1)) * lineCount * SAFETY));

const useTruncate = (
  text: string,
  lineCount: number,
): { text: string; ref: React.RefObject<HTMLSpanElement | null> } => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [budget, setBudget] = useState(60);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (): void => {
      const width = node.clientWidth > 0 ? node.clientWidth : node.parentElement?.clientWidth ?? 0;
      const fontSize = Number.parseFloat(getComputedStyle(node).fontSize) || 13;
      setBudget(budgetFor(width, fontSize, lineCount));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [lineCount]);

  const truncated = useMemo(() => {
    const keep = fitChars(text, budget);
    return keep >= text.length ? text : `${text.slice(0, Math.max(1, keep - 1))}…`;
  }, [text, budget]);

  /*
   * 实测兜底：渲染完量一下行数，超过 lineCount 就把预算按「实际占了几行」收紧重算。
   * 只靠宽度估算在这类中英混排里不够准（实测会多放一行）。
   */
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || truncated === text) return;
    const style = getComputedStyle(node);
    const lineHeight = Number.parseFloat(style.lineHeight) || 16;
    const rendered = Math.round(node.clientHeight / lineHeight);
    if (rendered > lineCount) {
      setBudget((current) => Math.max(6, Math.floor((current * lineCount) / rendered) - 1));
    }
  }, [truncated, text, lineCount]);

  return { text: truncated, ref };
};

/** 单行入选理由：超长则截断并补省略号，全文仍在 title 里 */
const TruncatedDesc = ({ text }: { text: string }) => {
  const { text: shown, ref } = useTruncate(text, 3);
  return <span ref={ref}>{shown}</span>;
};

/**
 * 筛选口径：**只要沪深主板 + 创业板**。
 *
 * 也就是排除这两类：
 *   - 北交所（`920xxx` / `8xxxxx` / `4xxxxx`）：30cm 一档，涨跌幅与沪深不可比
 *   - **科创板（`688xxx` / `689xxx`）：20cm 一档，同样不可比**，按用户口径一并排除
 *
 * 用户指出过：`688` 是科创板，放在「仅沪深主板+创业板」里是错的口径。
 */
const isMainBoardOrChiNext = (exchange: 'SH' | 'SZ' | 'BJ', symbol: string): boolean =>
  exchange !== 'BJ' && !/^(688|689)/.test(symbol);

/**
 * 板块成分股列表。
 *
 * 两种用法：
 *   - `variant="inline"`：渲染在板块行下面（窄屏 / 单独使用）
 *   - `variant="panel"`：渲染在右栏卡片里（宽屏下点开板块时，顶掉右栏的「市场情绪」）
 */
export const PlateStockList = ({
  plateCode,
  variant = 'inline',
}: {
  plateCode: string;
  variant?: 'inline' | 'panel';
}) => {
  const [state, setState] = useState<PlateStocksState>({ status: 'idle' });
  const [onlyCore, setOnlyCore] = useState(false);
  const [onlyLimitUp, setOnlyLimitUp] = useState(false);
  /**
   * 只看沪深主板 + 创业板。**默认开启**（用户口径）。
   *
   * 排除北交所（30cm）与科创板（20cm）——这两档的涨跌幅和主板/创业板放一张表里
   * 比没有可比性。需要看全部时点掉即可。
   */
  const [onlyMainBoard, setOnlyMainBoard] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    (async () => {
      try {
        const response = await fetch(
          `/api/themes/rotation/${encodeURIComponent(plateCode)}/stocks`,
          { signal: controller.signal },
        );
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            payload && typeof payload === 'object' && 'error' in payload
              ? String((payload as { error?: { message?: string } }).error?.message ?? '')
              : '';
          setState({ status: 'error', message: message || `成分股请求失败（${response.status}）` });
          return;
        }
        setState({ status: 'ready', data: payload as PlateStocksResponse });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '成分股请求失败',
        });
      }
    })();
    return () => controller.abort();
  }, [plateCode]);

  const stocks = state.status === 'ready' ? state.data.stocks : [];
  const visible = useMemo(
    () =>
      stocks.filter(
        (stock) =>
          (!onlyCore || stock.isCore) &&
          (!onlyLimitUp || (stock.pct ?? 0) >= 9.8) &&
          (!onlyMainBoard || isMainBoardOrChiNext(stock.exchange, stock.symbol)),
      ),
    [stocks, onlyCore, onlyLimitUp, onlyMainBoard],
  );
  /** 被该开关排除的只数（北交所 + 科创板），标在按钮上让人知道排掉了多少 */
  const excludedCount = useMemo(
    () => stocks.filter((stock) => !isMainBoardOrChiNext(stock.exchange, stock.symbol)).length,
    [stocks],
  );

  if (state.status === 'loading' || state.status === 'idle') {
    return <p className="plate-stocks__note">正在加载成分股…</p>;
  }
  if (state.status === 'error') {
    return <p className="plate-stocks__note">{state.message}</p>;
  }

  const { data } = state;

  return (
    <div className={`plate-stocks plate-stocks--${variant}`}>
      <div className="plate-stocks__bar">
        <span className="plate-stocks__count">
          共 {stocks.length} 只
          {data.coreCount > 0 ? ` · 核心 ${data.coreCount} 只` : ''}
        </span>
        <div className="plate-stocks__filters" role="group" aria-label="成分股筛选">
          <button
            className="plate-stocks__filter"
            type="button"
            aria-pressed={onlyCore}
            onClick={(event) => {
              event.stopPropagation();
              setOnlyCore((value) => !value);
            }}
          >
            只看核心票
          </button>
          <button
            className="plate-stocks__filter"
            type="button"
            aria-pressed={onlyLimitUp}
            onClick={(event) => {
              event.stopPropagation();
              setOnlyLimitUp((value) => !value);
            }}
          >
            只看涨停
          </button>
          <button
            className="plate-stocks__filter"
            type="button"
            aria-pressed={onlyMainBoard}
            title={
              excludedCount > 0
                ? `排除北交所（30cm）与科创板 688/689（20cm）共 ${excludedCount} 只，只留沪深主板与创业板。默认开启`
                : '该板块没有北交所/科创板成分股（此开关无影响）'
            }
            onClick={(event) => {
              event.stopPropagation();
              setOnlyMainBoard((value) => !value);
            }}
          >
            仅沪深主板+创业板
            {excludedCount > 0 ? (
              <span className="plate-stocks__filter-hint">{excludedCount}</span>
            ) : null}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="plate-stocks__note">当前筛选下没有股票。</p>
      ) : (
        <div className="plate-stocks__table-wrap">
          <table className="plate-stocks__table">
            <thead>
              <tr>
                <th scope="col">代码</th>
                <th scope="col">名称</th>
                <th scope="col">最新价</th>
                <th scope="col">涨跌幅</th>
                <th scope="col">入选理由</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((stock) => (
                <tr key={stock.symbol}>
                  <td className="plate-stocks__code">
                    {stock.symbol}
                    <span className="plate-stocks__ex">{stock.exchange}</span>
                  </td>
                  <td>
                    {stock.name}
                    {stock.isCore ? <span className="plate-stocks__core">核心</span> : null}
                  </td>
                  <td>{formatPrice(stock.price)}</td>
                  <td className={(stock.pct ?? 0) >= 0 ? 'is-up' : 'is-down'}>
                    {formatPct(stock.pct)}
                  </td>
                  {/*
                    截断在渲染前做掉（见 TruncatedDesc），不靠 CSS：
                    这里试过 td 直接 clamp、td>span clamp 两种都不稳定 ——
                    `display: -webkit-box` 被覆盖成 flow-root，省略号时有时无。
                  */}
                  <td className="plate-stocks__desc" title={stock.assocDesc ?? ''}>
                    {stock.assocDesc === null ? '—' : <TruncatedDesc text={stock.assocDesc} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length < stocks.length ? (
        <p className="plate-stocks__note">
          已按筛选显示 {visible.length} / {stocks.length} 只。
        </p>
      ) : null}

      <ul className="plate-stocks__warnings">
        {data.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
};
