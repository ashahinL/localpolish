interface IdleMarkProps {
  top: number;
  left: number;
  error: boolean;
  text: string;
  title?: string;
  ariaLabel: string;
  onActivate(): void;
}

export function IdleMark({ top, left, error, text, title, ariaLabel, onActivate }: IdleMarkProps) {
  return (
    <button
      type="button"
      class={error ? 'lp-mark lp-mark-error' : 'lp-mark lp-mark-fixes'}
      style={{ top: `${top}px`, left: `${left}px` }}
      title={title}
      aria-label={ariaLabel}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      {text}
    </button>
  );
}
