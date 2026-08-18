import type { Holding, StorageState, StockGroup } from '../types';

const STORAGE_KEY = 'stock-dashboard:v1';
const ASHARE_SYMBOL_PATTERN = /^[0-9]{6}$/;

const isString = (value: unknown): value is string => typeof value === 'string';

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const normalizeSymbol = (value: unknown): string | null => {
  if (!isString(value)) {
    return null;
  }

  const trimmed = value.trim();
  return ASHARE_SYMBOL_PATTERN.test(trimmed) ? trimmed : null;
};

const normalizeStockGroup = (value: unknown): StockGroup | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const group = value as Partial<StockGroup>;

  if (
    !isString(group.id) ||
    !isString(group.name) ||
    typeof group.isSystem !== 'boolean' ||
    !isString(group.createdAt)
  ) {
    return null;
  }

  return {
    id: group.id,
    name: group.name,
    isSystem: group.isSystem,
    createdAt: group.createdAt,
  };
};

const normalizeHolding = (value: unknown): Holding | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const holding = value as Partial<Holding>;
  const symbol = normalizeSymbol(holding.symbol);

  if (
    !isString(holding.id) ||
    symbol === null ||
    !isString(holding.name) ||
    !isString(holding.groupId) ||
    !isFinitePositiveNumber(holding.openPrice) ||
    !isFinitePositiveNumber(holding.quantity) ||
    !isString(holding.note) ||
    !isString(holding.createdAt) ||
    !isString(holding.updatedAt)
  ) {
    return null;
  }

  return {
    id: holding.id,
    symbol,
    name: holding.name,
    groupId: holding.groupId,
    openPrice: holding.openPrice,
    quantity: holding.quantity,
    note: holding.note,
    createdAt: holding.createdAt,
    updatedAt: holding.updatedAt,
  };
};

const normalizeStorageState = (value: unknown): StorageState | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<StorageState>;

  if (!Array.isArray(state.groups) || !Array.isArray(state.holdings)) {
    return null;
  }

  const groups = state.groups.map(normalizeStockGroup);
  const holdings = state.holdings.map(normalizeHolding);

  if (groups.some((group) => group === null) || holdings.some((holding) => holding === null)) {
    return null;
  }

  return {
    groups: groups as StockGroup[],
    holdings: holdings as Holding[],
  };
};

export const createDefaultState = (): StorageState => ({
  groups: [
    {
      id: 'ungrouped',
      name: '未分组',
      isSystem: true,
      createdAt: new Date().toISOString(),
    },
  ],
  holdings: [],
});

export const loadState = (storage: Storage): { state: StorageState; recovered: boolean } => {
  const raw = storage.getItem(STORAGE_KEY);

  if (raw === null) {
    return { state: createDefaultState(), recovered: false };
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    const state = normalizeStorageState(parsed);

    if (state === null) {
      return { state: createDefaultState(), recovered: true };
    }

    return { state, recovered: false };
  } catch {
    return { state: createDefaultState(), recovered: true };
  }
};

export const saveState = (storage: Storage, state: StorageState): void => {
  const normalizedState = normalizeStorageState(state);

  if (normalizedState === null) {
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
};

export const moveHoldingsToGroup = (
  state: StorageState,
  sourceGroupId: string,
  destinationGroupId: string,
): StorageState => ({
  groups: state.groups.map((group) => ({ ...group })),
  holdings: state.holdings.map((holding) =>
    holding.groupId === sourceGroupId ? { ...holding, groupId: destinationGroupId } : { ...holding },
  ),
});
