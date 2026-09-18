import { useEffect, useMemo, useState } from 'react';

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
 * 板块成分股列表。
 *
 * 两种用法：
 *   - `variant="inline"`：渲染在板块行下面（窄屏 / 单独使用）
 *   - `variant="panel"`：渲染在右栏卡片里（宽屏下点开板块时，顶掉右栏的「市场情绪」）
 *
 * 三种过滤：全部 / 核心票 / 涨停（`pct ≥ 9.8`，与项目别处一致用「近似阈值」，
 * 不区分 20cm —— 这里只是浏览用的筛选，不做判定）。
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
        (stock) => (!onlyCore || stock.isCore) && (!onlyLimitUp || (stock.pct ?? 0) >= 9.8),
      ),
    [stocks, onlyCore, onlyLimitUp],
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
                  <td className="plate-stocks__desc" title={stock.assocDesc ?? ''}>
                    {stock.assocDesc ?? '—'}
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
