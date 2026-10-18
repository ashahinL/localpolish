import { Fragment, h, render } from 'preact';
import { wordDiff } from '../core/diff';
import { type PortLike, type Preset } from './controller';
import {
  fieldText,
  findEditable,
  focusedEditable,
  isIdleField,
  wholeFieldTarget,
  type Target,
} from './editable';
import { guarded } from './guard';
import { countChanges, wordCount } from './idleText';
import { IdleMark } from './ui/IdleMark';
import { layer } from './ui/root';

export interface IdleDeps {
  connect(): PortLike;
  isEnabled(): boolean;
  isPopupOpen(): boolean;
  openPopup(target: Target, preset: Preset): void;
}

const IDLE_MS = 3000;
const MIN_WORDS = 4;
const MARK_INSET = 14;
const SMALL_FIELD = 32;
const FOLLOW_MS = 250;
const STOPPED = 'LocalPolish stopped before the new text was ready. Try again.';

type IdleResult = { fixed: string; count: number } | { error: string };

interface Slot {
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
  pending: boolean;
  lastFull: string | undefined;
  result: IdleResult | undefined;
}

export function createIdleFix(deps: IdleDeps): void {
  const slots = new WeakMap<HTMLElement, Slot>();
  const ids = new WeakMap<HTMLElement, number>();
  const marked = new Set<HTMLElement>();
  let nextId = 1;
  let follow: ReturnType<typeof setInterval> | undefined;

  document.addEventListener('input', guarded(onInput), true);
  document.addEventListener('focusin', guarded(reposition), true);
  window.addEventListener('scroll', guarded(reposition), { capture: true, passive: true });
  window.addEventListener('resize', guarded(reposition));

  function onInput(event: Event): void {
    if (!(event.target instanceof Node)) return;
    const host = findEditable(event.target);
    if (!host || !isIdleField(host)) return;
    const slot = slotOf(host);
    if (slot.result) hide(host, slot);
    reposition();
    clearTimeout(slot.timer);
    slot.timer = setTimeout(
      guarded(() => {
        slot.timer = undefined;
        tryRun(host);
      }),
      IDLE_MS,
    );
  }

  function reposition(): void {
    if (marked.size === 0) return;
    renderMarks();
  }

  function slotOf(el: HTMLElement): Slot {
    let slot = slots.get(el);
    if (slot) return slot;
    slot = {
      timer: undefined,
      running: false,
      pending: false,
      lastFull: undefined,
      result: undefined,
    };
    slots.set(el, slot);
    return slot;
  }

  function tryRun(el: HTMLElement): void {
    const slot = slotOf(el);
    if (!deps.isEnabled() || focusedEditable() !== el || !el.isConnected || !isIdleField(el))
      return;
    if (slot.running) {
      slot.pending = true;
      return;
    }
    const full = fieldText(el);
    if (full === slot.lastFull) return;
    if (wordCount(full) < MIN_WORDS) return;
    send(el, slot, full);
  }

  function send(el: HTMLElement, slot: Slot, full: string): void {
    slot.running = true;
    slot.pending = false;
    let port: PortLike;
    try {
      port = deps.connect();
    } catch {
      slot.running = false;
      return;
    }
    slot.lastFull = full;
    let settled = false;

    const finish = (outcome: { fixed: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // An orphaned port throws on disconnect; it is already gone.
      }
      slot.running = false;
      if (!el.isConnected) {
        drop(el, slot);
        renderMarks();
      } else if (fieldText(el) === full) {
        record(el, slot, full, outcome);
      }
      if (slot.pending) {
        slot.pending = false;
        tryRun(el);
      }
    };

    port.onMessage.addListener(
      guarded((message: unknown) => {
        const outcome = readOutcome(message);
        if (outcome) finish(outcome);
      }),
    );
    port.onDisconnect.addListener(
      guarded(() => {
        finish({ error: STOPPED });
      }),
    );
    port.postMessage({ mode: 'fix', tone: 'polite', text: full });
  }

  function record(
    el: HTMLElement,
    slot: Slot,
    sent: string,
    outcome: { fixed: string } | { error: string },
  ): void {
    if ('error' in outcome) {
      slot.result = outcome;
      marked.add(el);
      renderMarks();
      return;
    }
    const count =
      outcome.fixed.trim() === sent.trim() ? 0 : countChanges(wordDiff(sent, outcome.fixed));
    if (count === 0) {
      hide(el, slot);
      return;
    }
    slot.result = { fixed: outcome.fixed, count };
    marked.add(el);
    renderMarks();
  }

  function hide(el: HTMLElement, slot: Slot): void {
    slot.result = undefined;
    marked.delete(el);
    renderMarks();
  }

  function drop(el: HTMLElement, slot: Slot): void {
    clearTimeout(slot.timer);
    slot.timer = undefined;
    slot.pending = false;
    slot.result = undefined;
    marked.delete(el);
  }

  function activate(el: HTMLElement): void {
    const slot = slots.get(el);
    if (!slot || !slot.result) return;
    const result = slot.result;
    hide(el, slot);
    if ('fixed' in result) slot.lastFull = result.fixed;
    deps.openPopup(wholeFieldTarget(el), result);
  }

  function renderMarks(): void {
    if (deps.isPopupOpen()) {
      hideAll();
      return;
    }
    const items = [];
    for (const el of marked) {
      const result = slots.get(el)?.result;
      if (!el.isConnected || !result) {
        const slot = slots.get(el);
        if (slot && !el.isConnected) drop(el, slot);
        else marked.delete(el);
        continue;
      }
      const spot = markSpot(el);
      if (spot) items.push({ el, result, ...spot });
    }
    if (items.length === 0) {
      hideAll();
      return;
    }
    // Sites move their composers without a scroll or resize event (X adds its toolbar under the box).
    follow ??= setInterval(guarded(renderMarks), FOLLOW_MS);
    render(
      h(
        Fragment,
        null,
        items.map((item) => {
          const mark = item.result;
          if ('error' in mark) {
            return h(IdleMark, {
              key: idOf(item.el),
              top: item.top,
              left: item.left,
              error: true,
              text: '!',
              title: mark.error,
              ariaLabel: 'LocalPolish: error',
              onActivate: guarded(() => activate(item.el)),
            });
          }
          return h(IdleMark, {
            key: idOf(item.el),
            top: item.top,
            left: item.left,
            error: false,
            text: mark.count > 9 ? '9+' : String(mark.count),
            ariaLabel: `LocalPolish: ${mark.count} ${mark.count === 1 ? 'fix' : 'fixes'}`,
            onActivate: guarded(() => activate(item.el)),
          });
        }),
      ),
      layer('marks'),
    );
  }

  function hideAll(): void {
    if (follow === undefined) return;
    clearInterval(follow);
    follow = undefined;
    render(null, layer('marks'));
  }

  function idOf(el: HTMLElement): number {
    let id = ids.get(el);
    if (id !== undefined) return id;
    id = nextId;
    nextId += 1;
    ids.set(el, id);
    return id;
  }
}

function markSpot(el: HTMLElement): { top: number; left: number } | null {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const style = getComputedStyle(el);
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth - borders);
  const top = rect.height < SMALL_FIELD ? rect.bottom : rect.bottom - MARK_INSET;
  const left = rect.right - scrollbar - MARK_INSET;
  if (top < 0 || left < 0 || top > window.innerHeight || left > window.innerWidth) return null;
  return { top, left };
}

function readOutcome(message: unknown): { fixed: string } | { error: string } | null {
  if (typeof message !== 'object' || message === null) return null;
  const event = message as { type?: unknown; text?: unknown; message?: unknown };
  if (event.type === 'done' && typeof event.text === 'string') return { fixed: event.text };
  if (event.type === 'error' && typeof event.message === 'string') return { error: event.message };
  return null;
}
