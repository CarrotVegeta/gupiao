import { beforeEach, describe, expect, it } from 'vitest';
import type { Holding, StorageState } from '../types';
import { createDefaultState, loadState, moveHoldingsToGroup, saveState } from './storage';

const stateWithHolding = (overrides: Partial<Holding> = {}): StorageState => ({
  groups: [
    { id: 'ungrouped', name: '未分组', isSystem: true, createdAt: '2026-08-18T00:00:00.000Z' },
    { id: 'growth', name: '成长股', isSystem: false, createdAt: '2026-08-18T00:00:00.000Z' },
  ],
  holdings: [
    {
      id: 'h-1',
      symbol: '600519',
      name: '贵州茅台',
      groupId: 'ungrouped',
      openPrice: 10,
      quantity: 100,
      note: '',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      ...overrides,
    },
  ],
});

describe('storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('trims a valid holding symbol when saving and loading', () => {
    const state = stateWithHolding({ symbol: ' 600519 ' });
    saveState(localStorage, state);

    expect(loadState(localStorage)).toEqual({
      state: stateWithHolding({ symbol: '600519' }),
      recovered: false,
    });
  });

  it('recovers the default state when localStorage contains an invalid holding symbol', () => {
    localStorage.setItem(
      'stock-dashboard:v1',
      JSON.stringify(stateWithHolding({ symbol: '600519.SH' })),
    );

    expect(loadState(localStorage)).toMatchObject({
      recovered: true,
      state: {
        groups: [{ id: 'ungrouped', name: '未分组', isSystem: true }],
        holdings: [],
      },
    });
  });

  it('does not write invalid holding symbols to storage', () => {
    localStorage.setItem('stock-dashboard:v1', 'kept');

    saveState(localStorage, stateWithHolding({ symbol: 'sh600519' }));

    expect(localStorage.getItem('stock-dashboard:v1')).toBe('kept');
  });

  it('creates one system ungrouped group for a new browser', () => {
    expect(createDefaultState()).toMatchObject({
      groups: [{ id: 'ungrouped', name: '未分组', isSystem: true }],
      holdings: [],
    });
  });

  it('round-trips holdings and groups through localStorage', () => {
    const state = stateWithHolding();
    saveState(localStorage, state);
    expect(loadState(localStorage)).toEqual({ state, recovered: false });
  });

  it('recovers a usable empty state when localStorage contains invalid JSON', () => {
    localStorage.setItem('stock-dashboard:v1', '{');
    expect(loadState(localStorage).recovered).toBe(true);
    expect(loadState(localStorage).state.holdings).toEqual([]);
  });

  const expectInvalidStateRejected = (state: StorageState): void => {
    localStorage.setItem('stock-dashboard:v1', JSON.stringify(state));
    expect(loadState(localStorage)).toMatchObject({
      recovered: true,
      state: {
        groups: [{ id: 'ungrouped', name: '未分组', isSystem: true }],
        holdings: [],
      },
    });

    localStorage.setItem('stock-dashboard:v1', 'kept');
    saveState(localStorage, state);
    expect(localStorage.getItem('stock-dashboard:v1')).toBe('kept');
  };

  it('recovers and rejects a state missing the system ungrouped group', () => {
    const state = stateWithHolding({ groupId: 'growth' });
    state.groups = state.groups.filter((group) => group.id !== 'ungrouped');

    expectInvalidStateRejected(state);
  });

  it('recovers and rejects a state containing duplicate group ids', () => {
    const state = stateWithHolding();
    state.groups.push({
      id: 'growth',
      name: '重复分组',
      isSystem: false,
      createdAt: '2026-08-18T00:00:00.000Z',
    });

    expectInvalidStateRejected(state);
  });

  it('recovers and rejects a holding that refers to a nonexistent group', () => {
    expectInvalidStateRejected(stateWithHolding({ groupId: 'missing-group' }));
  });

  it('moves holdings into ungrouped without mutating the original state', () => {
    const state = stateWithHolding({ groupId: 'growth' });
    const next = moveHoldingsToGroup(state, 'growth', 'ungrouped');
    expect(next.holdings[0].groupId).toBe('ungrouped');
    expect(state.holdings[0].groupId).toBe('growth');
  });
});
