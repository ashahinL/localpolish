import { h, render } from 'preact';
import { type RewriteEvent, type RewriteRequest } from '../core/messages';
import { type DefaultMode, type Settings, type Tone } from '../core/settings';
import { copyText } from './clipboard';
import { applyReplacement, type Target } from './editable';
import { guarded, settle } from './guard';
import { type Rect } from './position';
import {
  canAccept,
  initialState,
  isUnchanged,
  pickAction,
  popupReducer,
  type Choice,
  type PopupAction,
  type PopupState,
  type Tab,
} from './popupState';
import { Popup } from './ui/Popup';
import { isInsideUi, layer } from './ui/root';

export interface PortLike {
  postMessage(message: RewriteRequest): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

export interface ControllerDeps {
  connect(): PortLike;
  getSettings(): Pick<Settings, 'defaultMode'>;
  isMac: boolean;
  onAccepted?(target: Target): void;
}

type Outcome = { fixed: string } | { error: string };

export type Preset = Outcome | { pending: Promise<Outcome>; cancel(): void };

export interface Controller {
  open(target: Target, preset?: Preset): void;
  close(): void;
  isOpen(): boolean;
}

interface Session {
  target: Target;
  anchor: Rect;
  state: PopupState;
  port: PortLike | null;
  waiting: Promise<Outcome> | undefined;
  cancelWaiting: (() => void) | undefined;
  container: HTMLElement;
  copiedTimer: ReturnType<typeof setTimeout> | undefined;
  accepting: boolean;
}

const UPDATED = 'LocalPolish was updated. Reload this page to use it.';
const STOPPED = 'LocalPolish stopped before the new text was ready. Try again.';

export function createController(deps: ControllerDeps): Controller {
  let session: Session | null = null;

  const onKeyDown = guarded((event: KeyboardEvent) => {
    if (!session || event.isComposing || !event.isTrusted) return;
    if (event.key === 'Escape') {
      block(event);
      close();
      return;
    }
    if (event.key === 'Enter' && (deps.isMac ? event.metaKey : event.ctrlKey)) {
      // Swallowed even while Accept is disabled: pages like Gmail send the message on it.
      block(event);
      settle(accept(session));
      return;
    }
    // The popup has no text inputs, so its keys are only Tab, Enter and Space;
    // page shortcuts (Gmail's single-letter ones) must not see them.
    if (isInsideUi(event)) event.stopImmediatePropagation();
  });

  const onPointerDown = guarded((event: MouseEvent) => {
    if (session && !isInsideUi(event)) close();
  });

  function open(target: Target, preset?: Preset): void {
    close();
    const choice = preset ? 'fix' : defaultChoice(deps.getSettings().defaultMode);
    const s: Session = {
      target,
      anchor: anchorRect(target),
      state: initialState(target.text, choice),
      port: null,
      waiting: undefined,
      cancelWaiting: undefined,
      container: layer('popup'),
      copiedTimer: undefined,
      accepting: false,
    };
    session = s;
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onPointerDown, true);
    if (!preset) {
      request(s, { type: 'start', choice });
      return;
    }
    if ('pending' in preset) {
      const pending = preset.pending;
      s.waiting = pending;
      s.cancelWaiting = preset.cancel;
      dispatch(s, { type: 'start', choice: 'fix' });
      void pending.then(
        guarded((outcome) => {
          if (session !== s || s.waiting !== pending) return;
          s.waiting = undefined;
          if ('fixed' in outcome) dispatch(s, { type: 'done', text: outcome.fixed });
          else dispatch(s, { type: 'error', message: outcome.error });
        }),
      );
      return;
    }
    if ('fixed' in preset) dispatch(s, { type: 'done', text: preset.fixed });
    else dispatch(s, { type: 'error', message: preset.error });
  }

  function close(): void {
    const s = session;
    if (!s) return;
    session = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('mousedown', onPointerDown, true);
    stopPort(s);
    clearTimeout(s.copiedTimer);
    render(null, s.container);
    restoreFocus(s.target);
  }

  function dispatch(s: Session, action: PopupAction): void {
    if (session !== s) return;
    s.state = popupReducer(s.state, action);
    render(
      h(Popup, {
        state: s.state,
        anchor: s.anchor,
        isMac: deps.isMac,
        onTab: guarded((tab: Tab) => {
          if (tab === 'rephrase') dispatch(s, { type: 'tab', tab });
          else choose(s, tab);
        }),
        onChoice: guarded((choice: Choice) => choose(s, choice)),
        onClose: guarded(close),
        onAccept: () => settle(accept(s)),
        onCopy: () => settle(copy(s)),
        onRetry: guarded(() => request(s, { type: 'retry' })),
      }),
      s.container,
    );
  }

  function choose(s: Session, choice: Choice): void {
    const action = pickAction(s.state, choice);
    if (action.type === 'start') {
      request(s, action);
      return;
    }
    if (action.type === 'restore') stopPort(s);
    dispatch(s, action);
  }

  function request(s: Session, action: Extract<PopupAction, { type: 'start' | 'retry' }>): void {
    s.cancelWaiting?.();
    s.cancelWaiting = undefined;
    s.waiting = undefined;
    stopPort(s);
    dispatch(s, action);
    const choice = s.state.choice;
    try {
      const port = deps.connect();
      s.port = port;
      port.onMessage.addListener(
        guarded((message) => {
          if (s.port === port && isRewriteEvent(message)) onEvent(s, message);
        }),
      );
      port.onDisconnect.addListener(
        guarded(() => {
          if (s.port !== port) return;
          s.port = null;
          dispatch(s, { type: 'error', message: STOPPED });
        }),
      );
      port.postMessage({ ...wireRequest(choice), text: s.target.text });
    } catch {
      s.port = null;
      dispatch(s, { type: 'error', message: UPDATED });
    }
  }

  function onEvent(s: Session, event: RewriteEvent): void {
    if (event.type === 'chunk') {
      dispatch(s, { type: 'chunk', text: event.text });
      return;
    }
    stopPort(s);
    if (event.type === 'done') dispatch(s, { type: 'done', text: event.text });
    else dispatch(s, { type: 'error', message: event.message });
  }

  async function accept(s: Session): Promise<void> {
    if (session !== s || s.accepting || !canAccept(s.state)) return;
    if (isUnchanged(s.state)) {
      deps.onAccepted?.(s.target);
      close();
      return;
    }
    const text = s.state.result;
    s.accepting = true;
    try {
      const result = await applyReplacement(s.target, text);
      if (session !== s) return;
      if (result.ok) {
        deps.onAccepted?.(s.target);
        close();
        return;
      }
      const copied = await copyText(text);
      dispatch(s, { type: 'accept-failed', reason: result.reason, copied });
    } finally {
      s.accepting = false;
    }
  }

  async function copy(s: Session): Promise<void> {
    if (!canAccept(s.state)) return;
    const copied = await copyText(s.state.result);
    dispatch(s, { type: 'copy', copy: copied ? 'copied' : 'failed' });
    clearTimeout(s.copiedTimer);
    s.copiedTimer = setTimeout(() => dispatch(s, { type: 'copy', copy: 'idle' }), 1500);
  }

  return { open, close, isOpen: () => session !== null };
}

function defaultChoice(mode: DefaultMode): Choice {
  return mode === 'rephrase' ? 'rephrase:keep' : mode;
}

// The background validates tone on every request, so 'polite' fills it where it is unused.
function wireRequest(choice: Choice): Omit<RewriteRequest, 'text'> {
  if (choice === 'fix' || choice === 'shorter') return { mode: choice, tone: 'polite' };
  if (choice === 'rephrase:keep') return { mode: 'rephrase', tone: 'polite' };
  return { mode: 'tone', tone: choice.slice('rephrase:'.length) as Tone };
}

function stopPort(s: Session): void {
  const port = s.port;
  s.port = null;
  try {
    port?.disconnect();
  } catch {
    // An orphaned port (extension reloaded) throws on disconnect; it is gone anyway.
  }
}

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function anchorRect(target: Target): DOMRect {
  if (target.kind === 'field') return target.el.getBoundingClientRect();
  const rect = target.range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return target.root.getBoundingClientRect();
  return rect;
}

function restoreFocus(target: Target): void {
  if (target.kind === 'field') {
    const { el } = target;
    if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
    return;
  }
  const { root, range } = target;
  if (!root.isConnected || root.contains(document.activeElement)) return;
  root.focus({ preventScroll: true });
  if (root.contains(range.startContainer)) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function isRewriteEvent(value: unknown): value is RewriteEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as { type?: unknown; text?: unknown; message?: unknown };
  if (event.type === 'chunk' || event.type === 'done') return typeof event.text === 'string';
  return event.type === 'error' && typeof event.message === 'string';
}
