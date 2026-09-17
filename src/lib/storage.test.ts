import { beforeEach, describe, expect, it } from 'vitest';
import type { Holding, StorageState } from '../types';
import { createDefaultState, loadState, moveHoldingsToGroup, saveState } from './storage';

const stateWithHolding = (overrides: Partial<Holding> = {}): StorageState => ({
  groups: [{ id: 'long-term', name: '长期持仓', isSystem: false, createdAt: '2026-08-18T00:00:00.000Z' }],
  holdings: [
    {
      id: 'h-1',
      symbol: '600519',
      name: '贵州茅台',
      groupId: 'long-term',
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

  it('starts a new browser with no groups at all', () => {
    expect(createDefaultState()).toEqual({ groups: [], holdings: [] });
  });

  it('trims a valid holding symbol when saving and loading', () => {
    const state = stateWithHolding({ symbol: ' 600519 ' });
    saveState(localStorage, state);

    expect(loadState(localStorage)).toEqual({
      state: stateWithHolding({ symbol: '600519' }),
      recovered: false,
    });
  });

  it('round-trips holdings and groups through localStorage', () => {
    const state = stateWithHolding();
    saveState(localStorage, state);

    expect(loadState(localStorage)).toEqual({ state, recovered: false });
  });

  it('round-trips an unassigned holding', () => {
    const state = stateWithHolding({ groupId: '' });
    saveState(localStorage, state);

    expect(loadState(localStorage)).toEqual({ state, recovered: false });
  });

  it('round-trips observation holdings without position details', () => {
    const state = stateWithHolding({ openPrice: null, quantity: null });
    saveState(localStorage, state);

    expect(loadState(localStorage)).toEqual({ state, recovered: false });
  });

  it('does not write invalid holding symbols, and reports the failure', () => {
    localStorage.setItem('stock-dashboard:v1', 'kept');

    expect(saveState(localStorage, stateWithHolding({ symbol: 'sh600519' }))).toBe(false);

    expect(localStorage.getItem('stock-dashboard:v1')).toBe('kept');
  });

  it('reports success when the state is written', () => {
    expect(saveState(localStorage, stateWithHolding())).toBe(true);
  });

  it('reports failure instead of throwing when storage rejects the write', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    expect(saveState(broken, stateWithHolding())).toBe(false);
  });

  it('recovers a usable empty state when localStorage contains invalid JSON', () => {
    localStorage.setItem('stock-dashboard:v1', '{');
    expect(loadState(localStorage).recovered).toBe(true);
    expect(loadState(localStorage).state.holdings).toEqual([]);
  });

  it('drops the legacy 未分组 group and un-assigns its holdings', () => {
    localStorage.setItem(
      'stock-dashboard:v1',
      JSON.stringify({
        groups: [
          { id: 'ungrouped', name: '未分组', isSystem: true, createdAt: '2026-08-18T00:00:00.000Z' },
          { id: 'long-term', name: '长期持仓', isSystem: false, createdAt: '2026-08-18T00:00:00.000Z' },
        ],
        holdings: [
          {
            id: 'h-1',
            symbol: '600519',
            name: '贵州茅台',
            groupId: 'ungrouped',
            openPrice: null,
            quantity: null,
            note: '',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
      }),
    );

    const { state, recovered } = loadState(localStorage);

    expect(recovered).toBe(false);
    expect(state.groups.map((group) => group.id)).toEqual(['long-term']);
    expect(state.holdings[0].groupId).toBe('');
  });

  it('treats remaining system flags as normal groups so they can be edited', () => {
    localStorage.setItem(
      'stock-dashboard:v1',
      JSON.stringify({
        groups: [{ id: 'legacy', name: '旧系统分组', isSystem: true, createdAt: '2026-08-18T00:00:00.000Z' }],
        holdings: [],
      }),
    );

    expect(loadState(localStorage).state.groups[0].isSystem).toBe(false);
  });

  it('un-assigns holdings whose group no longer exists instead of dropping the data', () => {
    localStorage.setItem(
      'stock-dashboard:v1',
      JSON.stringify(stateWithHolding({ groupId: 'missing-group' })),
    );

    const { state, recovered } = loadState(localStorage);

    expect(recovered).toBe(false);
    expect(state.holdings).toHaveLength(1);
    expect(state.holdings[0].groupId).toBe('');
  });

  it('rejects duplicate group ids', () => {
    const state = stateWithHolding();
    state.groups.push({
      id: 'long-term',
      name: '重复分组',
      isSystem: false,
      createdAt: '2026-08-18T00:00:00.000Z',
    });

    localStorage.setItem('stock-dashboard:v1', JSON.stringify(state));
    expect(loadState(localStorage).recovered).toBe(true);

    localStorage.setItem('stock-dashboard:v1', 'kept');
    expect(saveState(localStorage, state)).toBe(false);
    expect(localStorage.getItem('stock-dashboard:v1')).toBe('kept');
  });

  it('rejects an invalid holding symbol', () => {
    const state = stateWithHolding({ symbol: '600519.SH' });

    localStorage.setItem('stock-dashboard:v1', JSON.stringify(state));
    expect(loadState(localStorage).recovered).toBe(true);
  });

  it('moves holdings between groups without mutating the original state', () => {
    const state = stateWithHolding();
    state.groups.push({
      id: 'swing',
      name: '波段交易',
      isSystem: false,
      createdAt: '2026-08-18T00:00:00.000Z',
    });

    const next = moveHoldingsToGroup(state, 'long-term', 'swing');

    expect(next.holdings[0].groupId).toBe('swing');
    expect(state.holdings[0].groupId).toBe('long-term');
  });

  it('moves holdings to un-assigned when their group is deleted', () => {
    const state = stateWithHolding();
    const next = moveHoldingsToGroup(state, 'long-term', '');

    expect(next.holdings[0].groupId).toBe('');
    expect(next.groups).toHaveLength(1);
  });
});
