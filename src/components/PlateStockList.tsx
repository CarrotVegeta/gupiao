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
 * 所以改成在渲染前按字符预算截断，结果稳定可控。
 *
 * 每行能放多少字由容器宽度估算：中日韩字符按 1 个字宽算，其余按 0.55 算。
 */
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const charWidth = (char: string): number => (CJK.test(char) ? 1 : 0.55);

const fitChars = (text: string, budget: number): number => {
  let used = 0;
  for (let index = 0; index < text.length; index += 1) {
    used += charWidth(text[index]);
    if (used > budget) return index;
  }
  return text.length;
};

/** 文本在给定像素宽度下最多能显示多少「字宽」 */
const budgetFor = (widthPx: number, fontSizePx: number, lineCount: number): number =>
  Math.max(8, Math.floor((widthPx / Math.max(fontSizePx, 1)) * lineCount));

const useTruncate = (text: string, lineCount: number): { text: string; ref: React.RefObject<HTMLSpanElement | null> } => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [budget, setBudget] = useState(60);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (): void => {
      const style = getComputedStyle(node);
      const width = node.clientWidth > 0 ? node.clientWidth : node.parentElement?.clientWidth ?? 0;
      setBudget(budgetFor(width, Number.parseFloat(style.fontSize) || 13, lineCount));
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

  return { text: truncated, ref };
};

/** 单行入选理由：超长则截断并补省略号，全文仍在 title 里 */
const TruncatedDesc = ({ text }: { text: string }) => {
  const { text: shown, ref } = useTruncate(text, 3);
  return <span ref={ref}>{shown}</span>;
};

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
   * 只看沪深两市（排除北交所）。
   *
   * 财联社的成分股里混着北交所（`920298.BJ` 这类），涨跌幅是 30cm 一档，
   * 和沪深主板/创业板放在一张表里比涨跌幅没有可比性，所以给一个开关而不是默认排除。
   */
  const [onlyMainBoard, setOnlyMainBoard] = useState(false);

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
          (!onlyMainBoard || stock.exchange !== 'BJ'),
      ),
    [stocks, onlyCore, onlyLimitUp, onlyMainBoard],
  );
  /** 北交所只数：仅沪深开关上标出来，让人知道排除了多少 */
  const beijingCount = useMemo(
    () => stocks.filter((stock) => stock.exchange === 'BJ').length,
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
              beijingCount > 0
                ? `排除北交所 ${beijingCount} 只（30cm 涨跌幅，与沪深不可直接比较）`
                : '该板块没有北交所成分股'
            }
            onClick={(event) => {
              event.stopPropagation();
              setOnlyMainBoard((value) => !value);
            }}
          >
            仅沪深
            {beijingCount > 0 ? <span className="plate-stocks__filter-hint">{beijingCount}</span> : null}
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
