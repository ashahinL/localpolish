import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { PortLike } from './controller';
import { createIdleFix } from './idle';
import type { ChromeLanguageResult } from './language';

const field = vi.hoisted(() => ({
  text: '',
  focused: true,
  el: { isConnected: true, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
}));
vi.mock('./editable', () => ({
  fieldText: () => field.text,
  findEditable: () => field.el,
  focusedEditable: () => (field.focused ? field.el : null),
  isIdleField: () => true,
  wholeFieldTarget: () => ({ kind: 'field', el: field.el, start: 0, end: field.text.length }),
}));
vi.mock('preact', async (original) => ({
  ...(await original<typeof import('preact')>()),
  render: vi.fn(),
}));
vi.mock('./ui/root', () => ({ layer: () => ({}) }));

const english: ChromeLanguageResult = {
  isReliable: true,
  languages: [{ language: 'en', percentage: 100 }],
};

function harness() {
  const listeners = new Map<string, (event: Event) => void>();
  vi.stubGlobal('Node', Object);
  const doc = {
    hidden: false,
    addEventListener: (type: string, cb: (event: Event) => void) => listeners.set(type, cb),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const postMessage = vi.fn();
  let reply: (message: unknown) => void = () => {};
  const port: PortLike = {
    postMessage,
    disconnect: vi.fn(),
    onMessage: {
      addListener: (cb) => {
        reply = cb;
      },
    },
    onDisconnect: { addListener: vi.fn() },
  };
  const state = { enabled: true, popup: false, languages: { ...DEFAULT_SETTINGS.languages } };
  const detect = vi.fn(async () => english);
  const openPopup = vi.fn();
  const idle = createIdleFix({
    connect: () => port,
    isEnabled: () => state.enabled,
    isPopupOpen: () => state.popup,
    isFixDefault: () => true,
    languages: () => state.languages,
    detect,
    openPopup,
  });
  return {
    idle,
    state,
    detect,
    postMessage,
    doc,
    openPopup,
    reply: (text: string) => reply({ type: 'done', text }),
    async input(text: string) {
      field.text = text;
      listeners.get('input')?.({ target: field.el } as unknown as Event);
      await vi.advanceTimersByTimeAsync(3000);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  field.text = '';
  field.focused = true;
  field.el.isConnected = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('idle language switches', () => {
  it('skips detection when every language is on', async () => {
    const h = harness();
    await h.input('the purple moon have wings');
    expect(h.detect).not.toHaveBeenCalled();
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
      trigger: 'idle',
    });
  });

  it('skips an off main language but still sends manual Fix without keep', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('هذه جمله خياليه عن القمر');
    expect(h.postMessage).not.toHaveBeenCalled();
    h.idle.open({
      kind: 'field',
      el: field.el as unknown as HTMLTextAreaElement,
      start: 0,
      end: field.text.length,
      text: field.text,
    });
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
    });
  });

  it('keeps only the off parts in an on main language', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('the purple moon have a قمر');
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
      trigger: 'idle',
      keep: ['ar'],
    });
  });

  it('uses the last main language for a later short result in the same field', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('هذه جمله خياليه عن القمر');
    await h.input('قمر https://example.test @madeup #moon');
    expect(h.postMessage).not.toHaveBeenCalled();
  });

  it('treats a short result with no history as on', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('قمر https://example.test @madeup #moon');
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
      trigger: 'idle',
      keep: ['ar'],
    });
  });

  it('sends without keep when detection rejects, even after an off main language', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('هذه جمله خياليه عن القمر');
    h.detect.mockRejectedValueOnce(new Error('fake detection failure'));
    await h.input('the purple moon have a قمر');
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
      trigger: 'idle',
    });
  });

  it.each(['disabled', 'blurred', 'disconnected', 'popup', 'changed', 'hidden'])(
    'drops detection after the field becomes %s',
    async (change) => {
      const h = harness();
      h.state.languages.ar = false;
      let resolve!: (result: ChromeLanguageResult) => void;
      h.detect.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      await h.input('the purple moon have a قمر');
      if (change === 'disabled') h.state.enabled = false;
      if (change === 'blurred') field.focused = false;
      if (change === 'disconnected') field.el.isConnected = false;
      if (change === 'popup') h.state.popup = true;
      if (change === 'changed') field.text = 'a different made up draft';
      if (change === 'hidden') h.doc.hidden = true;
      resolve(english);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.postMessage).not.toHaveBeenCalled();
    },
  );

  it('does not send a second request when manual Fix starts during detection', async () => {
    const h = harness();
    h.state.languages.ar = false;
    let resolve!: (result: ChromeLanguageResult) => void;
    h.detect.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await h.input('the purple moon have a قمر');
    h.idle.open({
      kind: 'field',
      el: field.el as unknown as HTMLTextAreaElement,
      start: 0,
      end: field.text.length,
      text: field.text,
    });
    resolve(english);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
    });
  });

  it('clears existing marks and answers when language switches change', async () => {
    const h = harness();
    await h.input('هذه جمله خياليه عن القمر');
    h.reply('هذه جملة خيالية عن القمر');
    h.state.languages.ar = false;
    h.idle.refresh();
    expect(render).toHaveBeenLastCalledWith(null, expect.any(Object));
    await h.input(field.text);
    expect(h.postMessage).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an idle answer with keep for manual Fix', async () => {
    const h = harness();
    h.state.languages.ar = false;
    await h.input('the purple moon have a قمر');
    h.reply('The purple moon has a قمر');
    h.idle.open({
      kind: 'field',
      el: field.el as unknown as HTMLTextAreaElement,
      start: 0,
      end: field.text.length,
      text: field.text,
    });
    expect(h.postMessage).toHaveBeenCalledTimes(2);
    expect(h.postMessage).toHaveBeenLastCalledWith({
      mode: 'fix',
      tone: 'polite',
      text: field.text,
    });
  });
});
