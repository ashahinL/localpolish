import { type Point } from '../position';

interface FloatingButtonProps {
  point: Point;
  title: string;
  onActivate(): void;
}

export function FloatingButton({ point, title, onActivate }: FloatingButtonProps) {
  return (
    <button
      type="button"
      class="lp-fab"
      style={{ top: `${point.top}px`, left: `${point.left}px` }}
      title={title}
      aria-label={title}
      // Keeps the page's selection and focus while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11 2.5l1.9 5.6 5.6 1.9-5.6 1.9L11 17.5l-1.9-5.6L3.5 10l5.6-1.9z"
        />
        <path fill="currentColor" d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
      </svg>
    </button>
  );
}
