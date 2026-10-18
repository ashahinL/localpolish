interface IdleMarkProps {
  top: number;
  left: number;
  error: boolean;
  stale: boolean;
  text: string;
  title?: string;
  ariaLabel: string;
  onActivate(): void;
}

export function IdleMark({
  top,
  left,
  error,
  stale,
  text,
  title,
  ariaLabel,
  onActivate,
}: IdleMarkProps) {
  const tone = error ? 'lp-mark-error' : 'lp-mark-fixes';
  return (
    <button
      type="button"
      class={stale ? `lp-mark ${tone} lp-mark-stale` : `lp-mark ${tone}`}
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
