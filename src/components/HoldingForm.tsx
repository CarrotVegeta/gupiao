import { useEffect, useState } from 'react';
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
  defaultGroupId?: string;
  isSubmitting?: boolean;
  onSearch?: (query: string) => Promise<StockSearchResult[]>;
  onSubmit: (values: HoldingFormValues) => void;
  onCancel: () => void;
};

type HoldingFormErrors = Partial<Record<keyof HoldingFormValues, string>>;

const symbolPattern = /^[0-9]{6}$/;

const hasAtMostTwoDecimals = (value: string): boolean => /^(\d+)(\.\d{1,2})?$/.test(value);

const emptySearch = async (): Promise<StockSearchResult[]> => [];

const getAssignableGroups = (groups: StockGroup[]): StockGroup[] =>
  groups.filter((group) => !group.isSystem || group.id === 'ungrouped');

export const HoldingForm = ({
  groups,
  initialHolding,
  defaultGroupId,
  isSubmitting = false,
  onSearch = emptySearch,
  onSubmit,
  onCancel,
}: HoldingFormProps) => {
  const assignableGroups = getAssignableGroups(groups);
  const dialogRef = useDialogFocus(onCancel);
  const initialGroupId =
    initialHolding?.groupId ??
    assignableGroups.find((group) => group.id === defaultGroupId)?.id ??
    assignableGroups[0]?.id ??
    '';

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
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const query = symbol.trim();

    if (!query) {
      setSuggestions([]);
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
          }
        })
        .catch(() => {
          if (active) {
            setSuggestions([]);
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

  const validate = (): HoldingFormErrors => {
    const nextErrors: HoldingFormErrors = {};
    const normalizedSymbol = symbol.trim();
    const normalizedNote = note.trim();
    const parsedOpenPrice = Number(openPrice);
    const parsedQuantity = Number(quantity);

    if (!symbolPattern.test(normalizedSymbol)) {
      nextErrors.symbol = '请输入 6 位股票代码';
    }

    if (!groupId) {
      nextErrors.groupId = '请选择分组';
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
    setSymbol(value);
    setStockName('');
    setSuggestions([]);
  };

  const handleSelectSuggestion = (result: StockSearchResult): void => {
    setSymbol(result.symbol);
    setStockName(result.name);
    setSuggestions([]);
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
      </div>

      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        <label className="field stock-search-field" htmlFor="holding-symbol">
          <span>股票代码</span>
          <input
            id="holding-symbol"
            className="input"
            name="symbol"
            value={symbol}
            onChange={(event) => handleSymbolChange(event.target.value)}
            inputMode="search"
            autoComplete="off"
            aria-label="股票代码"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="holding-symbol-suggestions"
            aria-expanded={suggestions.length > 0}
          />
          <span className="field__hint">可输入股票代码或名称搜索</span>
          {isSearching ? <span className="field__hint">搜索中…</span> : null}
          {suggestions.length > 0 ? (
            <div id="holding-symbol-suggestions" className="stock-search-results" role="listbox">
              {suggestions.map((result) => (
                <button
                  key={result.symbol}
                  className="stock-search-result"
                  type="button"
                  role="option"
                  aria-label={`${result.name} ${result.symbol}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectSuggestion(result)}
                >
                  <span>{result.name}</span>
                  <span>{result.symbol}</span>
                </button>
              ))}
            </div>
          ) : null}
          {errors.symbol ? <span className="field__error">{errors.symbol}</span> : null}
        </label>

        <label className="field" htmlFor="holding-group">
          <span>分组</span>
          <select
            id="holding-group"
            className="input"
            name="groupId"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            {assignableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          {errors.groupId ? <span className="field__error">{errors.groupId}</span> : null}
        </label>

        <label className="field" htmlFor="holding-open-price">
          <span>开仓价</span>
          <span className="field__hint">可选，填写后计算收益</span>
          <input
            id="holding-open-price"
            className="input"
            name="openPrice"
            value={openPrice}
            onChange={(event) => setOpenPrice(event.target.value)}
            inputMode="decimal"
            aria-label="开仓价"
          />
          {errors.openPrice ? <span className="field__error">{errors.openPrice}</span> : null}
        </label>

        <label className="field" htmlFor="holding-quantity">
          <span>持有数量</span>
          <span className="field__hint">可选，填写后计算收益</span>
          <input
            id="holding-quantity"
            className="input"
            name="quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            aria-label="持有数量"
          />
          {errors.quantity ? <span className="field__error">{errors.quantity}</span> : null}
        </label>

        <label className="field field--full" htmlFor="holding-note">
          <span>备注</span>
          <textarea
            id="holding-note"
            aria-label="备注"
            className="input input--textarea"
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
          />
          <span className="field__hint">{note.trim().length}/120</span>
          {errors.note ? <span className="field__error">{errors.note}</span> : null}
        </label>

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
