import { Fragment, h, render } from 'preact';
import { wordDiff } from '../core/diff';
import { type PortLike, type Preset } from './controller';
import {
  applyReplacement,
  fieldText,
  findEditable,
  focusedEditable,
  isIdleField,
  wholeFieldTarget,
  type Target,
} from './editable';
import { guarded } from './guard';
import { countChanges, mapRange, mergePart, pickParagraph, wordCount } from './idleText';
import { IdleMark } from './ui/IdleMark';
import { layer } from './ui/root';

export interface IdleDeps {
  connect(): PortLike;
  isEnabled(): boolean;
  isPopupOpen(): boolean;
  openPopup(target: Target, preset: Preset): void;
}

const IDLE_MS = 3000;
const WHOLE_LIMIT = 3000;
const MIN_WORDS = 4;
const MARK_INSET = 14;
const SMALL_FIELD = 32;
const FOLLOW_MS = 250;
const STOPPED = 'LocalPolish stopped before the new text was ready. Try again.';

interface Sent {
  sentText: string;
  start: number;
  end: number;
  text: string;
}

interface FixResult {
  sentText: string;
  start: number;
  end: number;
  fixed: string;
  count: number;
}

interface ErrorResult {
  error: string;
  sentText: string;
  start: number;
  end: number;
}

type IdleResult = FixResult | ErrorResult;

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
    reposition();
    const slot = slotOf(host);
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
    const part = choosePart(el, full);
    if (!part || wordCount(part.text) < MIN_WORDS) return;
    send(el, slot, full, part);
  }

  function send(el: HTMLElement, slot: Slot, full: string, part: Sent): void {
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
      } else {
        record(el, slot, part, outcome);
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
    port.postMessage({ mode: 'fix', tone: 'polite', text: part.text });
  }

  function record(
    el: HTMLElement,
    slot: Slot,
    part: Sent,
    outcome: { fixed: string } | { error: string },
  ): void {
    if ('error' in outcome) {
      slot.result = {
        error: outcome.error,
        sentText: part.sentText,
        start: part.start,
        end: part.end,
      };
      marked.add(el);
      renderMarks();
      return;
    }
    const count =
      outcome.fixed.trim() === part.text.trim()
        ? 0
        : countChanges(wordDiff(part.text, outcome.fixed));
    if (count === 0) {
      hide(el, slot);
      return;
    }
    slot.result = {
      sentText: part.sentText,
      start: part.start,
      end: part.end,
      fixed: outcome.fixed,
      count,
    };
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
    const current = fieldText(el);
    const range = mapRange(result.sentText, current, result.start, result.end);
    const target = { ...wholeFieldTarget(el), text: current.slice(range.start, range.end) };
    hide(el, slot);
    const replace = (text: string) => {
      const now = fieldText(el);
      const mapped = mapRange(result.sentText, now, result.start, result.end);
      return applyReplacement(wholeFieldTarget(el), mergePart(now, mapped, text));
    };
    if ('error' in result) deps.openPopup(target, { error: result.error, replace });
    else deps.openPopup(target, { fixed: result.fixed, replace });
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

function choosePart(el: HTMLElement, full: string): Sent | null {
  if (full.length <= WHOLE_LIMIT) {
    return { sentText: full, start: 0, end: full.length, text: full };
  }
  const offset = offsetInField(el, full);
  if (offset === null) return null;
  const range = pickParagraph(full, offset);
  return {
    sentText: full,
    start: range.start,
    end: range.end,
    text: full.slice(range.start, range.end),
  };
}

function offsetInField(el: HTMLElement, full: string): number | null {
  if (el instanceof HTMLTextAreaElement) return el.selectionStart;
  const focus = window.getSelection()?.focusNode;
  if (!focus || !el.contains(focus)) return null;
  const child = directChild(el, focus);
  if (!child) return null;
  const raw = child instanceof HTMLElement ? child.innerText : (child.textContent ?? '');
  return lastParagraphStart(full, raw.trim());
}

function directChild(root: HTMLElement, node: Node): Node | null {
  if (node === root) return null;
  let current: Node = node;
  while (current.parentNode !== null && current.parentNode !== root) current = current.parentNode;
  return current.parentNode === root ? current : null;
}

function lastParagraphStart(text: string, needle: string): number | null {
  let found: number | null = null;
  let at = 0;
  while (at <= text.length) {
    const range = pickParagraph(text, at);
    if (text.slice(range.start, range.end).trim() === needle) found = range.start;
    if (range.end >= text.length) break;
    at = range.end + 1;
  }
  return found;
}

function readOutcome(message: unknown): { fixed: string } | { error: string } | null {
  if (typeof message !== 'object' || message === null) return null;
  const event = message as { type?: unknown; text?: unknown; message?: unknown };
  if (event.type === 'done' && typeof event.text === 'string') return { fixed: event.text };
  if (event.type === 'error' && typeof event.message === 'string') return { error: event.message };
  return null;
}
