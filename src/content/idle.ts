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
  isFixDefault(): boolean;
  openPopup(target: Target, preset?: Preset): void;
}

const IDLE_MS = 3000;
const MIN_WORDS = 4;
const MARK_INSET = 14;
const SMALL_FIELD = 32;
const FOLLOW_MS = 250;
const STOPPED = 'LocalPolish stopped before the new text was ready. Try again.';

type Outcome = { fixed: string } | { error: string };
type IdleResult = { sent: string; fixed: string; count: number } | { sent: string; error: string };

interface Slot {
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
  pending: boolean;
  lastFull: string | undefined;
  result: IdleResult | undefined;
  runningText: string | undefined;
  inflight: Promise<Outcome> | undefined;
  finish: ((outcome: Outcome | undefined) => void) | undefined;
}

export interface IdleFix {
  refresh(): void;
  open(target: Target): void;
  accepted(target: Target): void;
}

export function createIdleFix(deps: IdleDeps): IdleFix {
  const slots = new WeakMap<HTMLElement, Slot>();
  const ids = new WeakMap<HTMLElement, number>();
  const marked = new Set<HTMLElement>();
  const waiting = new WeakSet<Slot>();
  let nextId = 1;
  let follow: ReturnType<typeof setInterval> | undefined;

  // Draft.js (X) handles Backspace, Delete and paste itself, so those edits fire no input event.
  for (const type of ['input', 'keyup', 'paste', 'cut', 'drop']) {
    document.addEventListener(type, guarded(onInput), true);
  }
  document.addEventListener('focusin', guarded(reposition), true);
  window.addEventListener('scroll', guarded(reposition), { capture: true, passive: true });
  window.addEventListener('resize', guarded(reposition));

  function onInput(event: Event): void {
    if (!(event.target instanceof Node)) return;
    const host = findEditable(event.target);
    if (!host || !isIdleField(host)) return;
    const slot = slotOf(host);
    reposition();
    slot.pending = false;
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
      runningText: undefined,
      inflight: undefined,
      finish: undefined,
    };
    slots.set(el, slot);
    return slot;
  }

  function tryRun(el: HTMLElement): void {
    const slot = slotOf(el);
    if (deps.isPopupOpen()) return;
    if (!deps.isEnabled() || focusedEditable() !== el || !el.isConnected || !isIdleField(el))
      return;
    if (slot.running) {
      slot.pending = true;
      return;
    }
    const full = fieldText(el);
    if (full.trim() === slot.lastFull?.trim()) return;
    if (wordCount(full) < MIN_WORDS) return;
    send(el, slot, full);
  }

  function send(el: HTMLElement, slot: Slot, full: string): Promise<Outcome> | undefined {
    slot.running = true;
    slot.pending = false;
    let port: PortLike;
    try {
      port = deps.connect();
    } catch {
      slot.running = false;
      return undefined;
    }
    slot.lastFull = full;
    slot.runningText = full;
    marked.add(el);
    renderMarks();
    let resolveOutcome: (outcome: Outcome) => void = () => {};
    const promise = new Promise<Outcome>((resolve) => {
      resolveOutcome = resolve;
    });
    slot.inflight = promise;
    let settled = false;

    const finish = (outcome: Outcome | undefined) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // An orphaned port throws on disconnect; it is already gone.
      }
      slot.running = false;
      slot.runningText = undefined;
      slot.inflight = undefined;
      slot.finish = undefined;
      waiting.delete(slot);
      if (!outcome) {
        slot.pending = false;
        renderMarks();
        return;
      }
      if (!el.isConnected) {
        drop(el, slot);
        renderMarks();
      } else {
        record(el, slot, full, outcome);
      }
      resolveOutcome(outcome);
      if (slot.pending) {
        slot.pending = false;
        tryRun(el);
      }
    };
    slot.finish = finish;

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
    port.postMessage({ mode: 'fix', tone: 'polite', text: full, trigger: 'idle' });
    return promise;
  }

  function cancel(slot: Slot): void {
    slot.finish?.(undefined);
  }

  function record(
    el: HTMLElement,
    slot: Slot,
    sent: string,
    outcome: { fixed: string } | { error: string },
  ): void {
    if ('error' in outcome) {
      slot.result = { sent, error: outcome.error };
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
    slot.result = { sent, fixed: outcome.fixed, count };
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
    if (!deps.isEnabled()) {
      renderMarks();
      return;
    }
    const slot = slots.get(el);
    const result = slot?.result;
    if (!slot || (!result && !slot.running)) return;
    const current = fieldText(el);
    if (result && !slot.running && result.sent === current) {
      deps.openPopup(
        wholeFieldTarget(el),
        'error' in result ? { error: result.error } : { fixed: result.fixed },
      );
      return;
    }
    const pending = inflightFor(slot, current);
    if (pending) {
      deps.openPopup(wholeFieldTarget(el), waitOn(slot, pending));
      return;
    }
    cancel(slot);
    const started = send(el, slot, current);
    if (!started) return;
    deps.openPopup(wholeFieldTarget(el), waitOn(slot, started));
  }

  function open(target: Target): void {
    const el = target.kind === 'field' ? target.el : target.root;
    const slot = slotOf(el);
    const current = fieldText(el);
    if (deps.isFixDefault() && target.text === current) {
      const result = slot.result;
      if (result && 'fixed' in result && result.sent === current) {
        cancel(slot);
        deps.openPopup(target, { fixed: result.fixed });
        return;
      }
      const pending = inflightFor(slot, current);
      if (pending) {
        deps.openPopup(target, waitOn(slot, pending));
        return;
      }
    }
    cancel(slot);
    deps.openPopup(target);
  }

  function waitOn(slot: Slot, pending: Promise<Outcome>): Preset {
    waiting.add(slot);
    return {
      pending,
      cancel() {
        if (slot.inflight === pending) cancel(slot);
      },
    };
  }

  function inflightFor(slot: Slot, text: string): Promise<Outcome> | undefined {
    if (slot.inflight && slot.runningText === text) return slot.inflight;
    return undefined;
  }

  function renderMarks(): void {
    if (!deps.isEnabled()) {
      for (const el of marked) {
        const slot = slots.get(el);
        if (!slot) continue;
        if (!waiting.has(slot)) cancel(slot);
        clearTimeout(slot.timer);
        slot.timer = undefined;
        slot.result = undefined;
      }
      marked.clear();
      hideAll();
      return;
    }
    if (deps.isPopupOpen()) {
      hideAll();
      return;
    }
    const items = [];
    for (const el of marked) {
      const slot = slots.get(el);
      const result = slot?.result;
      if (!el.isConnected || !slot || (!result && !slot.running)) {
        if (slot && !el.isConnected) drop(el, slot);
        else marked.delete(el);
        continue;
      }
      if (slot.running) {
        const spot = markSpot(el);
        if (spot) items.push({ el, result: undefined, ...spot });
        continue;
      }
      if (!result) continue;
      if ('fixed' in result && fieldText(el).trim() === result.fixed.trim()) {
        slot.result = undefined;
        marked.delete(el);
        continue;
      }
      const spot = markSpot(el);
      if (spot) items.push({ el, result, ...spot });
    }
    if (marked.size === 0) {
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
          if (!mark) {
            return h(IdleMark, {
              key: idOf(item.el),
              top: item.top,
              left: item.left,
              tone: 'busy',
              stale: false,
              text: '',
              ariaLabel: 'LocalPolish: checking',
              onActivate: guarded(() => activate(item.el)),
            });
          }
          const stale = fieldText(item.el) !== mark.sent;
          if ('error' in mark) {
            return h(IdleMark, {
              key: idOf(item.el),
              top: item.top,
              left: item.left,
              tone: 'error',
              stale,
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
            tone: 'fixes',
            stale,
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

  function accepted(target: Target): void {
    const el = target.kind === 'field' ? target.el : target.root;
    const slot = slotOf(el);
    slot.lastFull = fieldText(el);
    if (slot.result) hide(el, slot);
  }

  return { open, accepted, refresh: renderMarks };
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
