import { Fragment, h, render } from 'preact';
import { wordDiff } from '../core/diff';
import { BRIDGE_MISSING } from '../core/messages';
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
import { appendedEnding, countChanges, preserveEnding, wordCount } from './idleText';
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

type Outcome = { fixed: string } | { error: string; code?: typeof BRIDGE_MISSING };
type IdleResult = { sent: string; fixed: string; count: number } | { sent: string; error: string };

interface Slot {
  timer: ReturnType<typeof setTimeout> | undefined;
  lastInput: number | undefined;
  running: boolean;
  pending: boolean;
  lastFull: string | undefined;
  result: IdleResult | undefined;
  runningText: string | undefined;
  inflight: Promise<Outcome> | undefined;
  finish: ((outcome: Outcome | undefined) => void) | undefined;
}

interface MarkView {
  el: HTMLElement;
  top: number;
  left: number;
  tone: 'fixes' | 'error' | 'busy';
  stale: boolean;
  text: string;
  title?: string;
  ariaLabel: string;
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
  let frame: number | undefined;
  let shown: { container: HTMLElement; views: MarkView[] } | undefined;

  // Draft.js (X) handles Backspace, Delete and paste itself, so those edits fire no input event.
  for (const type of ['input', 'keyup', 'paste', 'cut', 'drop']) {
    document.addEventListener(type, guarded(onInput), true);
  }
  // Closing the popup restores markers through focusin, so it stays immediate.
  document.addEventListener('focusin', guarded(reposition), true);
  document.addEventListener('visibilitychange', guarded(onVisibility));
  window.addEventListener('scroll', guarded(queueReposition), { capture: true, passive: true });
  window.addEventListener('resize', guarded(queueReposition));

  function onInput(event: Event): void {
    if (!deps.isEnabled()) return;
    if (!(event.target instanceof Node)) return;
    const host = findEditable(event.target);
    if (!host || !isIdleField(host)) return;
    const slot = slotOf(host);
    slot.lastInput = Date.now();
    queueReposition();
    slot.pending = false;
    arm(host, slot, IDLE_MS);
  }

  function onVisibility(): void {
    renderMarks();
    if (!document.hidden) resumeFocused();
  }

  function arm(el: HTMLElement, slot: Slot, delay: number): void {
    clearTimeout(slot.timer);
    slot.timer = setTimeout(
      guarded(() => {
        slot.timer = undefined;
        tryRun(el);
      }),
      delay,
    );
  }

  function resumeFocused(): void {
    const el = focusedEditable();
    if (!el) return;
    const slot = slots.get(el);
    if (!slot || slot.lastInput === undefined) return;
    if (!deps.isEnabled() || deps.isPopupOpen() || !el.isConnected || !isIdleField(el)) return;
    const remaining = IDLE_MS - (Date.now() - slot.lastInput);
    if (remaining <= 0) {
      clearTimeout(slot.timer);
      slot.timer = undefined;
      tryRun(el);
      return;
    }
    arm(el, slot, remaining);
  }

  function reposition(): void {
    if (marked.size === 0) return;
    renderMarks();
  }

  function queueReposition(): void {
    if (document.hidden || marked.size === 0 || frame !== undefined) return;
    frame = requestAnimationFrame(
      guarded(() => {
        frame = undefined;
        reposition();
      }),
    );
  }

  function slotOf(el: HTMLElement): Slot {
    let slot = slots.get(el);
    if (slot) return slot;
    slot = {
      timer: undefined,
      lastInput: undefined,
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
    if (document.hidden) return;
    const slot = slotOf(el);
    if (deps.isPopupOpen()) return;
    if (!deps.isEnabled() || focusedEditable() !== el || !el.isConnected || !isIdleField(el))
      return;
    if (slot.running) {
      slot.pending = true;
      return;
    }
    const full = fieldText(el);
    if (appendedEnding(slot.lastFull, full) !== undefined) return;
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

  function record(el: HTMLElement, slot: Slot, sent: string, outcome: Outcome): void {
    // Before setup every pause fails this way, so idle Fix stays quiet. The popup still shows it.
    if ('error' in outcome && outcome.code === BRIDGE_MISSING) {
      hide(el, slot);
      return;
    }
    if ('error' in outcome) {
      slot.result = { sent, error: outcome.error };
      marked.add(el);
      renderMarks();
      return;
    }
    const count =
      outcome.fixed.trim() === sent.trim() ? 0 : countChanges(wordDiff(sent, outcome.fixed));
    slot.result = { sent, fixed: outcome.fixed, count };
    if (count === 0) marked.delete(el);
    else marked.add(el);
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
    const ending = result ? appendedEnding(result.sent, current) : undefined;
    if (result && !slot.running && ending !== undefined) {
      deps.openPopup(
        wholeFieldTarget(el),
        'error' in result
          ? { error: result.error }
          : { fixed: preserveEnding(result.fixed, ending) },
      );
      return;
    }
    const pending = inflightFor(slot, current);
    if (pending) {
      deps.openPopup(wholeFieldTarget(el), pending);
      return;
    }
    cancel(slot);
    const started = send(el, slot, current);
    if (!started) return;
    deps.openPopup(wholeFieldTarget(el), waitOn(slot, started, ''));
  }

  function open(target: Target): void {
    const el = target.kind === 'field' ? target.el : target.root;
    const slot = slotOf(el);
    const current = fieldText(el);
    const whole =
      target.kind === 'rich' ? target.whole : target.start === 0 && target.end === current.length;
    if (deps.isFixDefault() && whole) {
      target = wholeFieldTarget(el);
      const result = slot.result;
      const ending = result ? appendedEnding(result.sent, current) : undefined;
      if (result && 'fixed' in result && ending !== undefined) {
        cancel(slot);
        deps.openPopup(target, { fixed: preserveEnding(result.fixed, ending) });
        return;
      }
      const pending = inflightFor(slot, current);
      if (pending) {
        deps.openPopup(target, pending);
        return;
      }
      cancel(slot);
      const started = send(el, slot, current);
      if (started) deps.openPopup(target, waitOn(slot, started, ''));
      return;
    }
    cancel(slot);
    deps.openPopup(target);
  }

  function waitOn(slot: Slot, pending: Promise<Outcome>, ending: string): Preset {
    waiting.add(slot);
    return {
      pending: pending.then((outcome) =>
        'fixed' in outcome ? { fixed: preserveEnding(outcome.fixed, ending) } : outcome,
      ),
      cancel() {
        if (slot.inflight === pending) cancel(slot);
      },
    };
  }

  function inflightFor(slot: Slot, text: string): Preset | undefined {
    const ending = appendedEnding(slot.runningText, text);
    if (slot.inflight && ending !== undefined) return waitOn(slot, slot.inflight, ending);
    return undefined;
  }

  function renderMarks(): void {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
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
    if (document.hidden) {
      concealMarks();
      return;
    }
    if (deps.isPopupOpen()) {
      hideAll();
      return;
    }
    const views: MarkView[] = [];
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
        if (spot) {
          views.push({
            el,
            ...spot,
            tone: 'busy',
            stale: false,
            text: '',
            ariaLabel: 'LocalPolish: checking',
          });
        }
        continue;
      }
      if (!result) continue;
      const current = fieldText(el);
      if ('fixed' in result && appendedEnding(result.fixed, current) !== undefined) {
        slot.result = undefined;
        marked.delete(el);
        continue;
      }
      const spot = markSpot(el);
      if (!spot) continue;
      const stale = appendedEnding(result.sent, current) === undefined;
      if ('error' in result) {
        views.push({
          el,
          ...spot,
          tone: 'error',
          stale,
          text: '!',
          title: result.error,
          ariaLabel: 'LocalPolish: error',
        });
      } else {
        views.push({
          el,
          ...spot,
          tone: 'fixes',
          stale,
          text: result.count > 9 ? '9+' : String(result.count),
          ariaLabel: `LocalPolish: ${result.count} ${result.count === 1 ? 'fix' : 'fixes'}`,
        });
      }
    }
    if (marked.size === 0) {
      hideAll();
      return;
    }
    // Sites move their composers without a scroll or resize event (X adds its toolbar under the box).
    follow ??= setInterval(guarded(renderMarks), FOLLOW_MS);
    // layer() also moves the host into a newly opened modal, so it runs even when nothing changed.
    const container = layer('marks');
    if (shown?.container === container && sameViews(shown.views, views)) return;
    shown = { container, views };
    render(
      h(
        Fragment,
        null,
        views.map(({ el, ...props }) =>
          h(IdleMark, { key: idOf(el), ...props, onActivate: guarded(() => activate(el)) }),
        ),
      ),
      container,
    );
  }

  function concealMarks(): void {
    if (follow !== undefined) {
      clearInterval(follow);
      follow = undefined;
    }
    if (shown === undefined) return;
    shown = undefined;
    render(null, layer('marks'));
  }

  function hideAll(): void {
    if (follow === undefined) return;
    clearInterval(follow);
    follow = undefined;
    shown = undefined;
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

const VIEW_FIELDS = ['el', 'top', 'left', 'tone', 'text', 'ariaLabel', 'title', 'stale'] as const;

function sameViews(before: MarkView[], after: MarkView[]): boolean {
  return (
    before.length === after.length &&
    before.every((view, index) => VIEW_FIELDS.every((key) => view[key] === after[index]?.[key]))
  );
}

function readOutcome(message: unknown): Outcome | null {
  if (typeof message !== 'object' || message === null) return null;
  const event = message as { type?: unknown; text?: unknown; message?: unknown; code?: unknown };
  if (event.type === 'done' && typeof event.text === 'string') return { fixed: event.text };
  if (event.type !== 'error' || typeof event.message !== 'string') return null;
  if (event.code === BRIDGE_MISSING) return { error: event.message, code: BRIDGE_MISSING };
  return { error: event.message };
}
