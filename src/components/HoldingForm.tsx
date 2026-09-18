import { useEffect, useRef, useState } from 'react';
import { DialogCloseButton } from './DialogCloseButton';
import { useDialogFocus } from '../lib/useDialogFocus';
import type { Holding, StockGroup, StockSearchResult } from '../types';

export type HoldingFormValues = {
  symbol: string;
  name: string;
  groupId: string;
  openPrice: number | null;
  quantity: number | null;
  note: string;
};

type HoldingFormProps = {
  groups: StockGroup[];
  initialHolding?: Holding;
  isSubmitting?: boolean;
  onSearch?: (query: string) => Promise<StockSearchResult[]>;
  onSubmit: (values: HoldingFormValues) => void;
  onCancel: () => void;
  /** 编辑已有股票时提供删除入口（表格里不再有操作列） */
  onDelete?: () => void;
};

type HoldingFormErrors = Partial<Record<keyof HoldingFormValues, string>>;

const symbolPattern = /^[0-9]{6}$/;

const hasAtMostTwoDecimals = (value: string): boolean => /^(\d+)(\.\d{1,2})?$/.test(value);

const emptySearch = async (): Promise<StockSearchResult[]> => [];

const getAssignableGroups = (groups: StockGroup[]): StockGroup[] => groups;

/** 校验失败时把焦点送回第一个出错的输入框，键盘用户不用自己找 */
const errorTargets: Partial<Record<keyof HoldingFormValues, string>> = {
  symbol: 'holding-symbol',
  openPrice: 'holding-open-price',
  quantity: 'holding-quantity',
  note: 'holding-note',
};

const SUGGESTION_LIST_ID = 'holding-symbol-suggestions';
const suggestionOptionId = (index: number): string => `${SUGGESTION_LIST_ID}-option-${index}`;

export const HoldingForm = ({
  groups,
  initialHolding,
  isSubmitting = false,
  onSearch = emptySearch,
  onSubmit,
  onCancel,
  onDelete,
}: HoldingFormProps) => {
  const assignableGroups = getAssignableGroups(groups);
  /*
   * 新增时分组默认「不分组」：和「添加自选」那条路径同一个口径 —— 不擅自把票塞进用户建的分组，
   * 也不因为当前筛选停在某个分组就顺手带过去（要带过去用户自己选一下）。
   * 编辑已有记录时才用记录自己的分组。
   */
  const initialGroupId = initialHolding?.groupId ?? '';

  const [symbol, setSymbol] = useState(initialHolding?.symbol ?? '');
  const [stockName, setStockName] = useState(initialHolding?.name ?? '');
  const [groupId, setGroupId] = useState(initialGroupId);
  const [openPrice, setOpenPrice] = useState(
    initialHolding?.openPrice === null || initialHolding?.openPrice === undefined
      ? ''
      : String(initialHolding.openPrice),
  );
  const [quantity, setQuantity] = useState(
    initialHolding?.quantity === null || initialHolding?.quantity === undefined
      ? ''
      : String(initialHolding.quantity),
  );
  const [note, setNote] = useState(initialHolding?.note ?? '');
  const [errors, setErrors] = useState<HoldingFormErrors>({});
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * 只有用户真的改了代码才去搜。编辑已有股票时 symbol 的初始值不该拉起候选下拉，
   * 否则弹窗一打开，候选列表就盖住下面的「开仓价」输入框。
   */
  const isUserTyping = useRef(false);

  const closeSuggestions = (): void => {
    setSuggestions([]);
    setActiveSuggestion(-1);
  };

  /**
   * Esc 分三级：先收股票搜索候选，再收分组下拉，最后才关弹窗。
   * 不下钻的话，输入到一半按 Esc 会把整个表单连输入一起关掉。
   */
  const dismissOrClose = (): void => {
    if (suggestions.length > 0) {
      closeSuggestions();
      return;
    }

    // 分组下拉（appearance: base-select 的页内下拉）开着时，这次 Esc 归它，
    // 原生默认行为会收起下拉，弹窗不动
    if (document.querySelector('.dialog-card select:open')) {
      return;
    }

    onCancel();
  };

  const dialogRef = useDialogFocus(dismissOrClose);

  useEffect(() => {
    if (!isUserTyping.current) {
      return undefined;
    }

    const query = symbol.trim();

    if (!query) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      setIsSearching(false);
      return undefined;
    }

    let active = true;
    const timerId = window.setTimeout(() => {
      setIsSearching(true);
      void onSearch(query)
        .then((results) => {
          if (active) {
            setSuggestions(results);
            setActiveSuggestion(-1);
          }
        })
        .catch(() => {
          if (active) {
            setSuggestions([]);
            setActiveSuggestion(-1);
          }
        })
        .finally(() => {
          if (active) {
            setIsSearching(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [onSearch, symbol]);

  // 键盘上下键选中候选时，把它滚进可视区（候选列表有最大高度）
  useEffect(() => {
    if (activeSuggestion < 0) {
      return;
    }

    // jsdom 没有实现 scrollIntoView，这里要允许它缺席
    document
      .getElementById(suggestionOptionId(activeSuggestion))
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeSuggestion]);

  const clearError = (field: keyof HoldingFormValues): void => {
    setErrors((current) => {
      if (!(field in current)) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validate = (): HoldingFormErrors => {
    const nextErrors: HoldingFormErrors = {};
    const normalizedSymbol = symbol.trim();
    const normalizedNote = note.trim();
    const parsedOpenPrice = Number(openPrice);
    const parsedQuantity = Number(quantity);

    if (!symbolPattern.test(normalizedSymbol)) {
      nextErrors.symbol = '请输入 6 位股票代码';
    }

    if (openPrice && (!Number.isFinite(parsedOpenPrice) || parsedOpenPrice <= 0)) {
      nextErrors.openPrice = '请输入大于 0 的开仓价';
    } else if (openPrice && !hasAtMostTwoDecimals(openPrice)) {
      nextErrors.openPrice = '开仓价最多保留两位小数';
    }

    if (quantity && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) {
      nextErrors.quantity = '请输入大于 0 的持有数量';
    } else if (quantity && !hasAtMostTwoDecimals(quantity)) {
      nextErrors.quantity = '持有数量最多保留两位小数';
    }

    if (normalizedNote.length > 120) {
      nextErrors.note = '备注不能超过 120 个字符';
    }

    return nextErrors;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const nextErrors = validate();

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      // 报错要能被看见：把焦点送回第一个出错的字段（错误本身带 role="alert"）
      const firstError = (Object.keys(nextErrors) as Array<keyof HoldingFormValues>).find(
        (field) => errorTargets[field],
      );
      const targetId = firstError ? errorTargets[firstError] : undefined;

      if (targetId) {
        formRef.current?.querySelector<HTMLElement>(`#${targetId}`)?.focus();
      }

      return;
    }

    onSubmit({
      symbol: symbol.trim(),
      name: stockName.trim() || symbol.trim(),
      groupId,
      openPrice: openPrice ? Number(openPrice) : null,
      quantity: quantity ? Number(quantity) : null,
      note: note.trim(),
    });
  };

  const handleSymbolChange = (value: string): void => {
    isUserTyping.current = true;
    clearError('symbol');
    setSymbol(value);
    setStockName('');
    closeSuggestions();
  };

  const handleSelectSuggestion = (result: StockSearchResult): void => {
    // 选中候选后 symbol 会变，但那次变化不该再触发一次搜索把下拉重新拉起来
    isUserTyping.current = false;
    setSymbol(result.symbol);
    setStockName(result.name);
    setIsSearching(false);
    closeSuggestions();
  };

  /** 焦点还在这个字段里（比如 Tab 到候选、点候选项）时不要收起下拉 */
  const handleSymbolBlur = (event: React.FocusEvent<HTMLInputElement>): void => {
    const field = event.currentTarget.closest('.stock-search-field');
    const next = event.relatedTarget;

    if (field && next instanceof Node && field.contains(next)) {
      return;
    }

    closeSuggestions();
  };

  const handleSymbolKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestions.length === 0) {
      return;
    }

    if (event.key === 'Escape') {
      // useDialogFocus 也监听 Esc，这里先一步把下拉收掉
      event.preventDefault();
      closeSuggestions();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;

      setActiveSuggestion((current) => {
        const next = current + step;

        if (next < 0) {
          return suggestions.length - 1;
        }

        return next >= suggestions.length ? 0 : next;
      });
      return;
    }

    if (event.key === 'Enter') {
      const picked = suggestions[activeSuggestion];

      if (picked) {
        event.preventDefault();
        handleSelectSuggestion(picked);
      }
    }
  };

  return (
    <section
      ref={dialogRef}
      className="dialog-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="holding-form-title"
      aria-busy={isSubmitting}
      tabIndex={-1}
    >
      <div className="dialog-card__header">
        <div>
          <p className="eyebrow">{initialHolding ? '编辑持仓' : '新增持仓'}</p>
          <h2 id="holding-form-title">{initialHolding ? '编辑股票' : '添加股票'}</h2>
        </div>
        <DialogCloseButton onClick={onCancel} />
      </div>

      <form className="form-grid" ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="field stock-search-field">
          <div className="field__head">
            <label className="field__label" htmlFor="holding-symbol">
              股票代码
            </label>
            {/* 不用 live region：每敲一个字都播报「搜索中…」对读屏用户太吵 */}
            <span className="field__hint">{isSearching ? '搜索中…' : '代码 / 名称'}</span>
          </div>
          <input
            id="holding-symbol"
            className="input"
            name="symbol"
            value={symbol}
            placeholder="600519 或 贵州茅台"
            onChange={(event) => handleSymbolChange(event.target.value)}
            onBlur={handleSymbolBlur}
            onKeyDown={handleSymbolKeyDown}
            data-autofocus
            inputMode="search"
            autoComplete="off"
            aria-label="股票代码"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={suggestions.length > 0 ? SUGGESTION_LIST_ID : undefined}
            aria-expanded={suggestions.length > 0}
            aria-activedescendant={
              activeSuggestion >= 0 ? suggestionOptionId(activeSuggestion) : undefined
            }
            aria-invalid={errors.symbol ? true : undefined}
            aria-describedby={errors.symbol ? 'holding-symbol-error' : undefined}
          />
          {errors.symbol ? (
            <span className="field__error" id="holding-symbol-error" role="alert">
              {errors.symbol}
            </span>
          ) : null}
          {suggestions.length > 0 ? (
            <div
              id={SUGGESTION_LIST_ID}
              className="stock-search-results"
              role="listbox"
              aria-label="股票搜索结果"
            >
              {suggestions.map((result, index) => (
                <button
                  key={result.symbol}
                  id={suggestionOptionId(index)}
                  className={`stock-search-result${
                    index === activeSuggestion ? ' stock-search-result--active' : ''
                  }`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestion}
                  aria-label={`${result.name} ${result.symbol}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => handleSelectSuggestion(result)}
                >
                  <span>{result.name}</span>
                  <span>{result.symbol}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field">
          <div className="field__head">
            <label className="field__label" htmlFor="holding-group">
              分组
            </label>
            <span className="field__hint">可选</span>
          </div>
          <select
            id="holding-group"
            className="input"
            name="groupId"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">不分组</option>
            {assignableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="field__head">
            <label className="field__label" htmlFor="holding-open-price">
              开仓价
            </label>
            <span className="field__hint">可选 · 算收益用</span>
          </div>
          <input
            id="holding-open-price"
            className="input"
            name="openPrice"
            value={openPrice}
            onChange={(event) => {
              clearError('openPrice');
              setOpenPrice(event.target.value);
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-label="开仓价"
            aria-invalid={errors.openPrice ? true : undefined}
            aria-describedby={errors.openPrice ? 'holding-open-price-error' : undefined}
          />
          {errors.openPrice ? (
            <span className="field__error" id="holding-open-price-error" role="alert">
              {errors.openPrice}
            </span>
          ) : null}
        </div>

        <div className="field">
          <div className="field__head">
            <label className="field__label" htmlFor="holding-quantity">
              持有数量
            </label>
            <span className="field__hint">可选 · 算收益用</span>
          </div>
          <input
            id="holding-quantity"
            className="input"
            name="quantity"
            value={quantity}
            onChange={(event) => {
              clearError('quantity');
              setQuantity(event.target.value);
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-label="持有数量"
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={errors.quantity ? 'holding-quantity-error' : undefined}
          />
          {errors.quantity ? (
            <span className="field__error" id="holding-quantity-error" role="alert">
              {errors.quantity}
            </span>
          ) : null}
        </div>

        <div className="field field--full">
          <div className="field__head">
            <label className="field__label" htmlFor="holding-note">
              备注
            </label>
            <span className="field__hint" id="holding-note-count">
              {note.trim().length}/120
            </span>
          </div>
          <textarea
            id="holding-note"
            aria-label="备注"
            className="input input--textarea"
            name="note"
            value={note}
            rows={3}
            onChange={(event) => {
              clearError('note');
              setNote(event.target.value);
            }}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={
              errors.note ? 'holding-note-error holding-note-count' : 'holding-note-count'
            }
          />
          {errors.note ? (
            <span className="field__error" id="holding-note-error" role="alert">
              {errors.note}
            </span>
          ) : null}
        </div>

        {onDelete && initialHolding ? (
          <div className="form-danger field--full">
            <div>
              <p className="form-danger__title">删除这只股票</p>
              <p className="form-danger__hint">
                从「{initialHolding.groupId ? '当前分组' : '自选'}」中移除，持仓记录一并删除。
              </p>
            </div>
            <button
              className="button button--danger button--compact"
              type="button"
              onClick={onDelete}
            >
              删除 {initialHolding.name}
            </button>
          </div>
        ) : null}

        <div className="form-actions field--full">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '保存中…' : '保存股票'}
          </button>
        </div>
      </form>
    </section>
  );
};
