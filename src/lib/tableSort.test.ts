import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSortedRows, type SortValue } from './tableSort';

type Row = {
  id: string;
  createdAt: string;
  name: string;
  score: number | null;
};

const row = (id: string, createdAt: string, name: string, score: number | null): Row => ({
  id,
  createdAt,
  name,
  score,
});

// 故意不按 createdAt 排列，用来验证默认排序真的生效
const rows: Row[] = [
  row('a', '2026-09-01T00:00:00.000Z', 'b-beta', 3),
  row('b', '2026-09-03T00:00:00.000Z', 'a-alpha', 1),
  row('c', '2026-09-02T00:00:00.000Z', 'c-gamma', null),
];

const sortValues: Record<'name' | 'score', (item: Row) => SortValue> = {
  name: (item) => item.name,
  score: (item) => item.score,
};

const setup = () =>
  renderHook(
    ({ data }: { data: Row[] }) =>
      useSortedRows<Row, 'name' | 'score'>({
        rows: data,
        getValueFor: (key) => sortValues[key],
      }),
    { initialProps: { data: rows } },
  );

const ids = (items: Row[]): string[] => items.map((item) => item.id);

describe('useSortedRows', () => {
  it('defaults to newest-first by createdAt', () => {
    const { result } = setup();

    expect(result.current.sort).toBeNull();
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a']);
  });

  it('cycles a column through descending, ascending and back to the default', () => {
    const { result } = setup();

    act(() => result.current.toggle('score'));
    expect(result.current.sort).toEqual({ key: 'score', direction: 'desc' });
    // null 永远沉底，不会因为降序被顶到最前
    expect(ids(result.current.rows)).toEqual(['a', 'b', 'c']);

    act(() => result.current.toggle('score'));
    expect(result.current.sort).toEqual({ key: 'score', direction: 'asc' });
    expect(ids(result.current.rows)).toEqual(['b', 'a', 'c']);

    act(() => result.current.toggle('score'));
    expect(result.current.sort).toBeNull();
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a']);
  });

  it('switches to a new column in descending order', () => {
    const { result } = setup();

    act(() => result.current.toggle('score'));
    act(() => result.current.toggle('name'));

    expect(result.current.sort).toEqual({ key: 'name', direction: 'desc' });
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b']);
  });

  it('breaks ties by createdAt descending so the order stays stable', () => {
    const { result } = renderHook(() =>
      useSortedRows<Row, 'name' | 'score'>({
        rows: [
          row('old', '2026-09-01T00:00:00.000Z', 'same', 1),
          row('new', '2026-09-05T00:00:00.000Z', 'same', 1),
        ],
        getValueFor: (key) => sortValues[key],
      }),
    );

    act(() => result.current.toggle('name'));

    expect(ids(result.current.rows)).toEqual(['new', 'old']);
  });

  it('re-sorts when the quote data that backs a column changes', () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useSortedRows<Row, 'name' | 'score'>({
          rows: data,
          getValueFor: (key) => sortValues[key],
        }),
      { initialProps: { data: rows } },
    );

    act(() => result.current.toggle('score'));
    expect(ids(result.current.rows)).toEqual(['a', 'b', 'c']);

    // c 的分数被行情刷新改成 99，降序下应该立刻排到最前
    rerender({ data: [rows[0], rows[1], { ...rows[2], score: 99 }] });

    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b']);
    expect(result.current.rows.map((item) => item.score)).toEqual([99, 3, 1]);
  });
});
