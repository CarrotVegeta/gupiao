import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (dialog: HTMLElement): HTMLElement[] =>
  Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

export const useDialogFocus = (onClose: () => void) => {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog) {
      return;
    }

    const focusableElements = getFocusableElements(dialog);
    // 弹窗可以指定 [data-autofocus] 作为首选落点（比如表单里的第一个输入框），
    // 否则仍然是 Tab 顺序里的第一个可聚焦元素
    const initialFocus =
      dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusableElements[0] ?? dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 故意不 preventDefault：分组下拉（appearance: base-select 的页内 picker）
        // 要靠这次 Esc 的原生默认行为收起；这里只负责问一句「要不要关弹窗」
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const currentFocusableElements = getFocusableElements(dialog);

      if (currentFocusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = currentFocusableElements[0];
      const last = currentFocusableElements[currentFocusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);

    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
  }, []);

  return dialogRef;
};
