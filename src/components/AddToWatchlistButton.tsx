/**
 * 选股列表每行末尾的「添加自选」按钮。
 *
 * 已经在自选里的股票按钮置灰并显示「已在自选」，重复添加没有意义；
 * 点击时要 stopPropagation：题材详情的整行本身就是展开开关，
 * 不加这一句点按钮会连详情一起展开。
 */
type AddToWatchlistButtonProps = {
  symbol: string;
  name: string;
  /** 该股票已经在自选列表中 */
  added: boolean;
  onAdd: (stock: { symbol: string; name: string }) => void;
};

export const AddToWatchlistButton = ({
  symbol,
  name,
  added,
  onAdd,
}: AddToWatchlistButtonProps) => (
  <button
    className="button button--secondary button--compact add-watchlist-button"
    type="button"
    disabled={added}
    aria-label={added ? `${name} 已在自选` : `添加 ${name} 到自选`}
    title={added ? '已经在自选列表里' : '加入自选列表（不填开仓价与数量）'}
    onClick={(event) => {
      event.stopPropagation();
      if (added) return;
      onAdd({ symbol, name });
    }}
  >
    {added ? '已在自选' : '添加自选'}
  </button>
);

export type { AddToWatchlistButtonProps };
