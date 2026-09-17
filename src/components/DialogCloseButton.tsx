type DialogCloseButtonProps = {
  onClick: () => void;
};

/** 弹窗右上角的关闭按钮：两个弹窗共用，避免图标和可访问名各写一份 */
export const DialogCloseButton = ({ onClick }: DialogCloseButtonProps) => (
  <button
    type="button"
    className="icon-button dialog-card__close"
    aria-label="关闭"
    onClick={onClick}
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  </button>
);
