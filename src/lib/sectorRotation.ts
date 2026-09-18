/**
 * 板块轮动（财联社）：近 4 / 30 个交易日每日涨幅 top10。
 *
 * 与 `src/lib/screener` 的题材数据不同，这里给的是**历史**板块口径：
 * 现有题材页只有当日快照，回答不了「这个题材是第几天走强 / 昨天谁在涨」。
 *
 * 上游只支持 `days=4` 与 `days=30`，请求其它值后端会直接回 400。
 */
import type { ScreenerDataStatus, SectorRotationItem, SectorRotationResponse } from '../types';

const ROTATION_ENDPOINT = '/api/themes/rotation';
const FORMAT_ERROR = '板块轮动响应数据格式错误';

export const ROTATION_DAY_OPTIONS = [4, 30] as const;
export type RotationDays = (typeof ROTATION_DAY_OPTIONS)[number];
export const DEFAULT_ROTATION_DAYS: RotationDays = 30;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isDataStatus = (value: unknown): value is ScreenerDataStatus =>
  value === 'fresh' || value === 'partial' || value === 'stale' || value === 'unavailable';

const isRotationItem = (value: unknown): value is SectorRotationItem =>
  isRecord(value) &&
  typeof value.plateCode === 'string' &&
  typeof value.plateName === 'string' &&
  isNullableNumber(value.latestChange) &&
  typeof value.appearCount === 'number' &&
  Number.isFinite(value.appearCount) &&
  isNullableNumber(value.maxChange) &&
  isNullableNumber(value.avgChange) &&
  typeof value.firstSeen === 'string' &&
  typeof value.lastSeen === 'string' &&
  Array.isArray(value.days) &&
  value.days.every((day) => typeof day === 'string');

export const unavailableRotation = (days: RotationDays, error: string | null): SectorRotationResponse => ({
  days,
  tradeDates: [],
  items: [],
  fetchedAt: new Date().toISOString(),
  source: 'cls',
  status: 'unavailable',
  error,
});

export const toSectorRotationResponse = (
  payload: unknown,
  fallbackDays: RotationDays,
): SectorRotationResponse => {
  if (
    !isRecord(payload) ||
    (payload.days !== 4 && payload.days !== 30) ||
    !Array.isArray(payload.tradeDates) ||
    !payload.tradeDates.every((day) => typeof day === 'string') ||
    !Array.isArray(payload.items) ||
    payload.source !== 'cls' ||
    !isDataStatus(payload.status)
  ) {
    return unavailableRotation(fallbackDays, FORMAT_ERROR);
  }

  return {
    days: payload.days,
    tradeDates: payload.tradeDates,
    items: payload.items.filter(isRotationItem),
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : new Date().toISOString(),
    source: 'cls',
    status: payload.status,
    error: typeof payload.error === 'string' ? payload.error : null,
  };
};

export const fetchSectorRotation = async (
  days: RotationDays = DEFAULT_ROTATION_DAYS,
  fetchImpl: typeof fetch = fetch,
): Promise<SectorRotationResponse> => {
  try {
    const response = await fetchImpl(`${ROTATION_ENDPOINT}?days=${days}`);
    if (!response.ok) {
      return unavailableRotation(days, `板块轮动请求失败（${response.status}）`);
    }
    return toSectorRotationResponse(await response.json(), days);
  } catch {
    return unavailableRotation(days, '板块轮动请求失败');
  }
};

/** 轮动天数选择：value 来自 UI，非法值退回默认 */
export const parseRotationDays = (value: unknown): RotationDays =>
  value === 4 || value === 30 ? value : DEFAULT_ROTATION_DAYS;
