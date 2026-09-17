import type { SortDirection } from '../lib/tableSort';

type SortableHeaderProps = {
  label: string;
  /** 当前是否按这一列排序 */
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
};

const directionGlyph = (direction: SortDirection): string => {
  if (direction === 'desc') {
    return '▾';
  }
  if (direction === 'asc') {
    return '▴';
  }
  return '⇅';
};

/**
 * 可排序的表头单元格：点一次降序、再点升序、第三次回到默认（添加时间倒序）。
 * 只有当前排序列才写 aria-sort，读屏才不会把每一列都念成已排序。
 */
export const SortableHeader = ({ label, active, direction, onToggle }: SortableHeaderProps) => (
  <th
    scope="col"
    aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
  >
    <button
      type="button"
      className={`sort-button${active ? ' sort-button--on' : ''}`}
      onClick={onToggle}
      title={`按「${label}」排序`}
    >
      <span>{label}</span>
      <span className="sort-button__glyph" aria-hidden="true">
        {active ? directionGlyph(direction) : '⇅'}
      </span>
    </button>
  </th>
);
