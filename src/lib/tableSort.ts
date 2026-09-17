import { useCallback, useMemo, useState } from 'react';

/** 表格列的三态排序：默认（添加时间倒序）→ 降序 → 升序 → 默认 */
export type SortDirection = 'default' | 'desc' | 'asc';
export type SortState<K extends string> = { key: K; direction: SortDirection };

/** 表头里能取到的值；null 表示没数据（缺行情、未填写），恒定排在最后 */
export type SortValue = string | number | null;

/** 点击表头时的方向轮换：第一次降序，第二次升序，第三次回到默认 */
const cycleDirections: SortDirection[] = ['desc', 'asc', 'default'];

const nextDirection = (current: SortDirection): SortDirection => {
  const index = cycleDirections.indexOf(current);
  return cycleDirections[(index + 1) % cycleDirections.length];
};

const compareValues = (left: SortValue, right: SortValue): number => {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right, 'zh-CN');
  }

  return Number(left) - Number(right);
};

/** null 永远沉底，不受升降序影响；免得「缺行情」的票被顶到最前面 */
const compareNullable = (left: SortValue, right: SortValue): number | null => {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return null;
};

/**
 * 表格排序：默认按添加时间倒序，点表头切换。
 * 同值时用 createdAt 倒序兜底，保证顺序稳定、不会每次渲染乱跳。
 */
export const useSortedRows = <Row extends { id: string; createdAt: string }, Key extends string>({
  rows,
  getValueFor,
}: {
  rows: Row[];
  /** 拿到某一列的取值函数；行情类表格里它依赖实时行情，所以由调用方带上依赖 */
  getValueFor: (key: Key) => (row: Row) => SortValue;
}) => {
  const [sort, setSort] = useState<SortState<Key> | null>(null);

  const toggle = useCallback((key: Key): void => {
    setSort((current) => {
      if (current === null || current.key !== key) {
        return { key, direction: 'desc' };
      }

      const direction = nextDirection(current.direction);
      return direction === 'default' ? null : { key, direction };
    });
  }, []);

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    const compareByCreatedAt = (left: Row, right: Row): number =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);

    if (sort === null) {
      return sorted.sort(compareByCreatedAt);
    }

    const getValue = getValueFor(sort.key);
    const factor = sort.direction === 'asc' ? 1 : -1;

    return sorted.sort((left, right) => {
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      const nullResult = compareNullable(leftValue, rightValue);

      if (nullResult !== null) {
        return nullResult;
      }

      return factor * compareValues(leftValue, rightValue) || compareByCreatedAt(left, right);
    });
  }, [rows, sort, getValueFor]);

  return { rows: sortedRows, sort, toggle };
};
