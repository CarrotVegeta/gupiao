import { useState } from 'react';
import type { ReactNode } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import type { StockGroup } from '../types';

export type GroupDialogValues = {
  name: string;
};

type GroupDialogProps = {
  initialGroup?: StockGroup;
  existingNames: string[];
  children?: ReactNode;
  onSubmit: (values: GroupDialogValues) => void;
  onCancel: () => void;
};

const normalizeName = (value: string): string => value.trim().toLocaleLowerCase('zh-CN');

export const GroupDialog = ({
  initialGroup,
  existingNames,
  children,
  onSubmit,
  onCancel,
}: GroupDialogProps) => {
  const dialogRef = useDialogFocus(onCancel);
  const [name, setName] = useState(initialGroup?.name ?? '');
  const [error, setError] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setError('请输入分组名称');
      return;
    }

    const currentName = initialGroup ? normalizeName(initialGroup.name) : null;
    const duplicate = existingNames.some((existingName) => {
      const normalizedExistingName = normalizeName(existingName);

      return normalizedExistingName === normalizeName(trimmedName) && normalizedExistingName !== currentName;
    });

    if (duplicate) {
      setError('分组名称不能重复');
      return;
    }

    setError('');
    onSubmit({ name: trimmedName });
  };

  return (
    <section
      ref={dialogRef}
      className="dialog-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-dialog-title"
      tabIndex={-1}
    >
      <div className="dialog-card__header">
        <div>
          <p className="eyebrow">{initialGroup ? '编辑分组' : '新增分组'}</p>
          <h2 id="group-dialog-title">{initialGroup ? '编辑分组' : '新建分组'}</h2>
        </div>
      </div>

      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        <label className="field field--full">
          <span>分组名称</span>
          <input
            className="input"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) {
                setError('');
              }
            }}
          />
          {error ? <span className="field__error">{error}</span> : null}
        </label>

        <div className="form-actions field--full">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button" type="submit">
            保存分组
          </button>
        </div>
      </form>
      {children}
    </section>
  );
};
