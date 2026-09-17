/** 涨停池 / 冲刺涨停 / 连板天梯共用的格式化工具 */

/** `20260917` → `2026-09-17`；null 或无法解析时给出调用方指定的兜底文案 */
export const formatTradeDate = (value: string | null, fallback = '暂无数据'): string => {
  if (value === null) {
    return fallback;
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-');
};

export const formatSignedPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`;

export const formatPercent = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

/** 板位：`null`（上游没给连板数）显式写成「连板未知」，不冒充首板 */
export const formatBoardLevel = (value: number | null): string =>
  value === null ? '连板未知' : `${value} 板`;

/** 连板天梯 / 今昨对比里给数值上色的类名 */
export const valueClass = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '';
  }

  return value > 0 ? 'value--rise' : value < 0 ? 'value--fall' : '';
};
