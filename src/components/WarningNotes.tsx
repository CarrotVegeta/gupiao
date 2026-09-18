import { useId, useState, type ReactNode } from 'react';

/**
 * 「⚠ 数据说明与限制」警示按钮 + 面板（板块列表 / 板块详情共用）。
 *
 * 两条约定（都是踩过的坑）：
 *   1. 按钮紧跟在标题后面（标题行内的 flex 项）；正文面板由调用方渲染在**表头之外**
 *      （标题行 / 状态行下面）。面板放进表头左栏会被 flex 计算成左栏的最小宽度，
 *      把右侧「交易日 / 刷新板块」挤到下一行；浮在表头上又会遮住下面的内容。
 *   2. children 为空时不渲染按钮，避免出现点了什么都没有的空按钮。
 */
type WarningNotesProps = {
  /** 按钮文案，例如「数据说明与限制」 */
  title: string;
  /** 条数；给了就显示「（N 条）」，没给只显示 title */
  count?: number;
  /** 悬停提示 */
  tooltip?: string;
  /** 面板内容 */
  children: ReactNode;
  /** 面板渲染位置：由调用方放在表头下面的任意位置 */
  panelAfter?: ReactNode;
};

export const useWarningNotes = () => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return {
    open,
    panelId,
    toggle: () => setOpen((current) => !current),
  };
};

type WarningNotesToggleProps = {
  title: string;
  count?: number;
  tooltip?: string;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  className?: string;
};

export const WarningNotesToggle = ({
  title,
  count,
  tooltip,
  open,
  panelId,
  onToggle,
  className,
}: WarningNotesToggleProps) => (
  <button
    className={['warning-notes__toggle', 'warning-notes__toggle--warning', className]
      .filter(Boolean)
      .join(' ')}
    type="button"
    aria-expanded={open}
    aria-controls={panelId}
    title={tooltip}
    onClick={onToggle}
  >
    <span className="warning-notes__icon" aria-hidden="true">
      ⚠
    </span>
    <span>
      {title}
      {typeof count === 'number' && count > 0 ? `（${count} 条）` : ''}
    </span>
    <span className="warning-notes__caret" aria-hidden="true">
      {open ? '▾' : '▸'}
    </span>
  </button>
);

type WarningNotesPanelProps = {
  panelId: string;
  open: boolean;
  children: ReactNode;
};

export const WarningNotesPanel = ({ panelId, open, children }: WarningNotesPanelProps) => {
  if (!children) return null;
  return (
    <div className="warning-notes__panel" id={panelId} hidden={!open}>
      {children}
    </div>
  );
};

/** 便捷包装：按钮 + 面板紧挨着渲染（面板留给调用方时用上面两个分开的组件） */
export const WarningNotes = ({ title, count, tooltip, children }: WarningNotesProps) => {
  const notes = useWarningNotes();
  if (!children) return null;
  return (
    <div className="warning-notes">
      <WarningNotesToggle
        title={title}
        count={count}
        tooltip={tooltip}
        open={notes.open}
        panelId={notes.panelId}
        onToggle={notes.toggle}
      />
      <WarningNotesPanel panelId={notes.panelId} open={notes.open}>
        {children}
      </WarningNotesPanel>
    </div>
  );
};
