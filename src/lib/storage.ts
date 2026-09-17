import type { Holding, StorageState, StockGroup } from '../types';

const STORAGE_KEY = 'stock-dashboard:v1';
const ASHARE_SYMBOL_PATTERN = /^[0-9]{6}$/;

const isString = (value: unknown): value is string => typeof value === 'string';

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isOptionalPositiveNumber = (value: unknown): value is number | null =>
  value === null || isFinitePositiveNumber(value);

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
    !Object.prototype.hasOwnProperty.call(holding, 'openPrice') ||
    !Object.prototype.hasOwnProperty.call(holding, 'quantity') ||
    !isOptionalPositiveNumber(holding.openPrice) ||
    !isOptionalPositiveNumber(holding.quantity) ||
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

  const parsedGroups = groups as StockGroup[];
  let normalizedHoldings = holdings as Holding[];

  if (new Set(parsedGroups.map((group) => group.id)).size !== parsedGroups.length) {
    return null;
  }

  // 「未分组」以前是一个系统分组，现在整个概念被取消：
  // 不分配分组的股票用空 groupId 表示，只在「全部」里出现，侧边栏不再有这一栏。
  const normalizedGroups = parsedGroups
    .filter((group) => group.id !== 'ungrouped')
    .map((group) => (group.isSystem ? { ...group, isSystem: false } : group));

  const groupIds = new Set(normalizedGroups.map((group) => group.id));

  // 未分配（空 groupId）是合法状态；指向已删除分组的股票降级为未分配，而不是判整份数据无效
  normalizedHoldings = normalizedHoldings.map((holding) =>
    holding.groupId === '' || groupIds.has(holding.groupId)
      ? holding
      : { ...holding, groupId: '' },
  );

  return {
    groups: normalizedGroups,
    holdings: normalizedHoldings,
  };
};

/** 新浏览器不再预置「未分组」，分组完全由用户自己建 */
export const createDefaultState = (): StorageState => ({
  groups: [],
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

/**
 * 写回本地存储。返回是否真的写成功：
 * 状态没通过校验（例如 holding 指向了不存在的分组）时不会写入，
 * 以前这里是静默 return，用户加完股票看不到任何反馈，所以改成显式返回。
 */
export const saveState = (storage: Storage, state: StorageState): boolean => {
  const normalizedState = normalizeStorageState(state);

  if (normalizedState === null) {
    return false;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
    return true;
  } catch {
    // 隐私模式、配额写满等
    return false;
  }
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
