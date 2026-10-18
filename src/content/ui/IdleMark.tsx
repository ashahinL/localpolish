interface IdleMarkProps {
  top: number;
  left: number;
  tone: 'fixes' | 'error' | 'busy';
  stale: boolean;
  text: string;
  title?: string;
  ariaLabel: string;
  onActivate(): void;
}

export function IdleMark({
  top,
  left,
  tone,
  stale,
  text,
  title,
  ariaLabel,
  onActivate,
}: IdleMarkProps) {
  return (
    <button
      type="button"
      class={stale ? `lp-mark lp-mark-${tone} lp-mark-stale` : `lp-mark lp-mark-${tone}`}
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
