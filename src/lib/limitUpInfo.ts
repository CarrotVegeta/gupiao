import type { LimitUpResponse } from '../types';

/**
 * 一只票当前的涨停状态。来自涨停池（东财 `lbc` 连板数），
 * 只覆盖「今天封在涨停价」的票——不在池子里的票没有这个标识。
 */
export type LimitUpInfo = {
  /** 连板数：1 = 首板，2+ = 几连板 */
  boardCount: number | null;
};

/** 代码 -> 涨停状态，供自选/持仓的股票标签查 */
export type LimitUpInfoMap = Record<string, LimitUpInfo>;

const isPositiveInteger = (value: number | null): value is number =>
  value !== null && Number.isInteger(value) && value > 0;

/**
 * 涨停池响应 -> 标签查询表。
 *
 * 只认 fresh/stale 的池子：unavailable 时返回空表，宁可没有标签，
 * 也不能拿失败的响应把已显示的标签清掉（调用方用 merge 语义合并）。
 */
export const toLimitUpInfoMap = (response: LimitUpResponse): LimitUpInfoMap => {
  if (response.status === 'unavailable') {
    return {};
  }

  const map: LimitUpInfoMap = {};

  for (const item of response.items) {
    if (item.symbol && isPositiveInteger(item.boardCount)) {
      map[item.symbol] = { boardCount: item.boardCount };
    }
  }

  return map;
};

/** 名称旁的红标签文字：首板写「涨停」，连板写「3 连板」；没有涨停状态返回 null */
export const formatLimitUpTag = (info: LimitUpInfo | undefined): string | null => {
  if (!info || info.boardCount === null || !Number.isFinite(info.boardCount)) {
    return null;
  }

  if (info.boardCount <= 1) {
    return '涨停';
  }

  return `${info.boardCount} 连板`;
};
