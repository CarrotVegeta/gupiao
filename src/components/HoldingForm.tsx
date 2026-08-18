import { useState } from 'react';
import type { Holding, StockGroup } from '../types';

export type HoldingFormValues = {
  symbol: string;
  groupId: string;
  openPrice: number;
  quantity: number;
  note: string;
};

type HoldingFormProps = {
  groups: StockGroup[];
  initialHolding?: Holding;
  onSubmit: (values: HoldingFormValues) => void;
  onCancel: () => void;
};

type HoldingFormErrors = Partial<Record<keyof HoldingFormValues, string>>;

const symbolPattern = /^[0-9]{6}$/;

const hasAtMostTwoDecimals = (value: string): boolean => /^(\d+)(\.\d{1,2})?$/.test(value);

const getAssignableGroups = (groups: StockGroup[]): StockGroup[] =>
  groups.filter((group) => group.id !== 'all');

export const HoldingForm = ({
  groups,
  initialHolding,
  onSubmit,
  onCancel,
}: HoldingFormProps) => {
  const assignableGroups = getAssignableGroups(groups);

  const [symbol, setSymbol] = useState(initialHolding?.symbol ?? '');
  const [groupId, setGroupId] = useState(initialHolding?.groupId ?? assignableGroups[0]?.id ?? '');
  const [openPrice, setOpenPrice] = useState(
    initialHolding ? String(initialHolding.openPrice) : '',
  );
  const [quantity, setQuantity] = useState(
    initialHolding ? String(initialHolding.quantity) : '',
  );
  const [note, setNote] = useState(initialHolding?.note ?? '');
  const [errors, setErrors] = useState<HoldingFormErrors>({});

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

    if (!openPrice || !Number.isFinite(parsedOpenPrice) || parsedOpenPrice <= 0) {
      nextErrors.openPrice = '请输入大于 0 的开仓价';
    } else if (!hasAtMostTwoDecimals(openPrice)) {
      nextErrors.openPrice = '开仓价最多保留两位小数';
    }

    if (!quantity || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      nextErrors.quantity = '请输入大于 0 的持有数量';
    } else if (!hasAtMostTwoDecimals(quantity)) {
      nextErrors.quantity = '持有数量最多保留两位小数';
    }

    if (normalizedNote.length > 120) {
      nextErrors.note = '备注不能超过 120 个字符';
    }

    return nextErrors;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const nextErrors = validate();

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onSubmit({
      symbol: symbol.trim(),
      groupId,
      openPrice: Number(openPrice),
      quantity: Number(quantity),
      note: note.trim(),
    });
  };

  return (
    <section className="dialog-card" aria-labelledby="holding-form-title">
      <div className="dialog-card__header">
        <div>
          <p className="eyebrow">{initialHolding ? '编辑持仓' : '新增持仓'}</p>
          <h2 id="holding-form-title">{initialHolding ? '编辑股票' : '添加股票'}</h2>
        </div>
      </div>

      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        <label className="field" htmlFor="holding-symbol">
          <span>股票代码</span>
          <input
            id="holding-symbol"
            className="input"
            name="symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
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
          <input
            id="holding-open-price"
            className="input"
            name="openPrice"
            value={openPrice}
            onChange={(event) => setOpenPrice(event.target.value)}
            inputMode="decimal"
          />
          {errors.openPrice ? <span className="field__error">{errors.openPrice}</span> : null}
        </label>

        <label className="field" htmlFor="holding-quantity">
          <span>持有数量</span>
          <input
            id="holding-quantity"
            className="input"
            name="quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
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
          <button className="button" type="submit">
            保存股票
          </button>
        </div>
      </form>
    </section>
  );
};
