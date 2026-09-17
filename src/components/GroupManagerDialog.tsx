import { useEffect, useState } from 'react';
import type { Holding, StockGroup } from '../types';
import { DialogCloseButton } from './DialogCloseButton';
import { GroupDialog, type GroupDialogValues } from './GroupDialog';
import { useDialogFocus } from '../lib/useDialogFocus';

type GroupManagerDialogProps = {
  groups: StockGroup[];
  holdings: Holding[];
  onAdd: (values: GroupDialogValues) => void;
  onRename: (groupId: string, values: GroupDialogValues) => void;
  onDelete: (groupId: string) => void;
  onClose: () => void;
};

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; groupId: string };

const countByGroup = (holdings: Holding[], groupId: string): number =>
  holdings.filter((holding) => holding.groupId === groupId).length;

/**
 * 分组管理面板：新建 / 重命名 / 删除都收在这里，页面上不再有「点分组冒出一排按钮」。
 * 删除先展开一次行内确认，避免误删。
 */
export const GroupManagerDialog = ({
  groups,
  holdings,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: GroupManagerDialogProps) => {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const listRef = useDialogFocus(onClose);

  // 从表单返回列表时把行内确认状态收掉，避免删除按钮还停在「确认删除？」
  useEffect(() => {
    if (mode.kind === 'list') {
      setPendingDeleteId(null);
    }
  }, [mode]);

  const customGroups = groups.filter((group) => !group.isSystem);
  const editingGroup =
    mode.kind === 'edit' ? groups.find((group) => group.id === mode.groupId) : undefined;

  if (mode.kind === 'create') {
    return (
      <GroupDialog
        existingNames={customGroups.map((group) => group.name)}
        onSubmit={(values) => {
          onAdd(values);
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'edit' && editingGroup) {
    return (
      <GroupDialog
        initialGroup={editingGroup}
        existingNames={customGroups.map((group) => group.name)}
        onSubmit={(values) => {
          onRename(editingGroup.id, values);
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  return (
    <section
      ref={listRef}
      className="dialog-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-manager-title"
      tabIndex={-1}
    >
      <div className="dialog-card__header">
        <div>
          <p className="eyebrow">持仓分组</p>
          <h2 id="group-manager-title">分组管理</h2>
        </div>
        <div className="group-manager__header-actions">
          <button
            className="button button--secondary button--compact"
            type="button"
            onClick={() => setMode({ kind: 'create' })}
          >
            新建分组
          </button>
          <DialogCloseButton onClick={onClose} />
        </div>
      </div>

      {customGroups.length === 0 ? (
        <p className="dialog-card__body">
          还没有分组。点「新建分组」建一个，股票也可以先不分组。
        </p>
      ) : (
        <ul className="group-manager__list">
          {customGroups.map((group) => {
            const isConfirming = pendingDeleteId === group.id;

            return (
              <li key={group.id} className="group-manager__row">
                <div className="group-manager__info">
                  <span className="group-manager__name">{group.name}</span>
                  <span className="group-manager__count">{countByGroup(holdings, group.id)} 只</span>
                </div>

                {isConfirming ? (
                  <div className="group-manager__actions">
                    <span className="group-manager__hint">删除后股票变为未分配</span>
                    <button
                      className="button button--ghost button--compact"
                      type="button"
                      onClick={() => setPendingDeleteId(null)}
                    >
                      取消
                    </button>
                    <button
                      className="button button--danger button--compact"
                      type="button"
                      onClick={() => {
                        onDelete(group.id);
                        setPendingDeleteId(null);
                      }}
                    >
                      确认删除
                    </button>
                  </div>
                ) : (
                  <div className="group-manager__actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`重命名分组 ${group.name}`}
                      onClick={() => setMode({ kind: 'edit', groupId: group.id })}
                    >
                      重命名
                    </button>
                    <button
                      className="icon-button icon-button--danger"
                      type="button"
                      aria-label={`删除分组 ${group.name}`}
                      onClick={() => setPendingDeleteId(group.id)}
                    >
                      删除
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
