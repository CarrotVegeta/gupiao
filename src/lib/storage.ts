import type { Holding, StorageState, StockGroup } from '../types';

const STORAGE_KEY = 'stock-dashboard:v1';

const isString = (value: unknown): value is string => typeof value === 'string';

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isStockGroup = (value: unknown): value is StockGroup => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const group = value as Partial<StockGroup>;

  return (
    isString(group.id) &&
    isString(group.name) &&
    typeof group.isSystem === 'boolean' &&
    isString(group.createdAt)
  );
};

const isHolding = (value: unknown): value is Holding => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const holding = value as Partial<Holding>;

  return (
    isString(holding.id) &&
    isString(holding.symbol) &&
    isString(holding.name) &&
    isString(holding.groupId) &&
    isFinitePositiveNumber(holding.openPrice) &&
    isFinitePositiveNumber(holding.quantity) &&
    isString(holding.note) &&
    isString(holding.createdAt) &&
    isString(holding.updatedAt)
  );
};

const isStorageState = (value: unknown): value is StorageState => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Partial<StorageState>;

  return (
    Array.isArray(state.groups) &&
    Array.isArray(state.holdings) &&
    state.groups.every(isStockGroup) &&
    state.holdings.every(isHolding)
  );
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

    if (!isStorageState(parsed)) {
      return { state: createDefaultState(), recovered: true };
    }

    return { state: parsed, recovered: false };
  } catch {
    return { state: createDefaultState(), recovered: true };
  }
};

export const saveState = (storage: Storage, state: StorageState): void => {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      groups: state.groups,
      holdings: state.holdings,
    }),
  );
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
