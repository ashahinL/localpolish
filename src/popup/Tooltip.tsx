import { type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export const HOVER_DELAY_MS = 2000;

interface TooltipProps {
  id: string;
  text: ComponentChildren;
  children: ComponentChildren;
}

function describes(target: EventTarget | null, id: string): boolean {
  if (!(target instanceof Element)) return false;
  const value = target.getAttribute('aria-describedby');
  return value !== null && value.split(/\s+/).includes(id);
}

export function Tooltip({ id, text, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrap = useRef<HTMLSpanElement>(null);

  const clearTimer = () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  useLayoutEffect(() => {
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, []);

  // A passive effect waits a frame, so Escape in that same turn would miss.
  useLayoutEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // The switch this tip describes sits outside the wrapper, so its focus is not a wrapper event.
  useEffect(() => {
    const root = wrap.current;
    if (root === null) return;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) return;
      if (!describes(target, id) || !target.matches(':focus-visible')) return;
      setOpen(true);
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!describes(event.target, id)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && root.contains(next)) return;
      setOpen(false);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [id]);

  const onPointerEnter = () => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };

  const onPointerLeave = () => {
    clearTimer();
    setOpen(false);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof Element && target.matches(':focus-visible')) setOpen(true);
  };

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && wrap.current?.contains(next)) return;
    setOpen(false);
  };

  return (
    <span
      class="tip-wrap"
      ref={wrap}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusIn={onFocusIn}
      onFocusOut={onFocusOut}
    >
      {children}
      <span role="tooltip" id={id} class={open ? 'tip on' : 'tip'}>
        {text}
      </span>
    </span>
  );
}
