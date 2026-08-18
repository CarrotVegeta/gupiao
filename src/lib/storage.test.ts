import { describe, expect, it } from 'vitest';
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

  it('moves holdings into ungrouped without mutating the original state', () => {
    const state = stateWithHolding({ groupId: 'growth' });
    const next = moveHoldingsToGroup(state, 'growth', 'ungrouped');
    expect(next.holdings[0].groupId).toBe('ungrouped');
    expect(state.holdings[0].groupId).toBe('growth');
  });
});
