import {
  applyReplacement,
  fieldText,
  findEditable,
  focusedEditable,
  wholeFieldTarget,
  type Target,
} from './editable';
import { isInsideUi } from './ui/root';

interface InsertChrome {
  runtime: {
    id?: string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: { id?: string; url?: string; tab?: unknown },
          reply: (value: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
}

export function createChatInsert(ext: InsertChrome): void {
  let last: { el: HTMLElement; fieldId: string } | undefined;
  let bound: { sequence: string; fieldId: string; target: Target; dirty: boolean } | undefined;
  let applying = false;
  const remember = (event: Event) => {
    if (!event.isTrusted || isInsideUi(event)) return;
    const el = focusedEditable();
    if (!el) return;
    if (last?.el === el) return;
    last = { el, fieldId: crypto.getRandomValues(new Uint32Array(4)).join('-') };
    // runtime.id disappears once the extension reloads; sendMessage would then throw.
    if (!ext.runtime.id) return;
    void ext.runtime
      .sendMessage({ type: 'chat-editable-focus', fieldId: last.fieldId })
      .catch(() => {});
  };
  document.addEventListener('focusin', remember, true);
  document.addEventListener(
    'input',
    (event) => {
      remember(event);
      if (!bound) return;
      const el = bound.target.kind === 'field' ? bound.target.el : bound.target.root;
      if (event.composedPath().includes(el)) bound.dirty = true;
    },
    true,
  );
  ext.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      !ext.runtime.id ||
      sender.id !== ext.runtime.id ||
      sender.tab !== undefined ||
      (sender.url !== `chrome-extension://${ext.runtime.id}/background.js` &&
        sender.url !== undefined) ||
      typeof message !== 'object' ||
      message === null
    )
      return;
    const value = message as Record<string, unknown>;
    if (!['chat-bind-target', 'chat-insert-target'].includes(value.type as string)) return;
    if (
      typeof value.sequence !== 'string' ||
      typeof value.fieldId !== 'string' ||
      Object.keys(value).some(
        (key) =>
          ![
            'type',
            'sequence',
            'fieldId',
            ...(value.type === 'chat-insert-target' ? ['text'] : []),
          ].includes(key),
      )
    ) {
      reply({ ok: false, message: 'Invalid insert request. Use Copy instead.' });
      return;
    }
    if (value.type === 'chat-bind-target') {
      if (
        !last ||
        last.fieldId !== value.fieldId ||
        !last.el.isConnected ||
        findEditable(last.el) !== last.el
      ) {
        reply({ ok: false });
        return;
      }
      bound = {
        sequence: value.sequence,
        fieldId: value.fieldId,
        target: wholeFieldTarget(last.el),
        dirty: false,
      };
      reply({ ok: true });
      return;
    }
    if (
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      new TextEncoder().encode(value.text).length > 1024 * 1024
    ) {
      reply({ ok: false, message: 'Invalid answer. Use Copy instead.' });
      return;
    }
    const snapshot = bound;
    if (!snapshot || snapshot.sequence !== value.sequence || snapshot.fieldId !== value.fieldId) {
      reply({
        ok: false,
        message:
          'The chat target is no longer available. Open chat from the page again, or use Copy.',
      });
      return;
    }
    const el = snapshot.target.kind === 'field' ? snapshot.target.el : snapshot.target.root;
    const isCurrent = () =>
      bound === snapshot &&
      !snapshot.dirty &&
      el.isConnected &&
      findEditable(el) === el &&
      fieldText(el) === snapshot.target.text &&
      document.visibilityState === 'visible';
    if (!isCurrent()) {
      reply({ ok: false, message: 'The text field changed or was removed. Use Copy instead.' });
      return;
    }
    if (applying) {
      reply({ ok: false, message: 'Insertion is already running.' });
      return;
    }
    applying = true;
    void applyReplacement(snapshot.target, value.text, isCurrent)
      .then(
        (result) => {
          snapshot.dirty = true;
          reply(
            result.ok
              ? { ok: true }
              : { ok: false, message: 'The page did not accept the answer. Use Copy instead.' },
          );
        },
        () => reply({ ok: false, message: 'Could not insert the answer. Use Copy instead.' }),
      )
      .finally(() => {
        applying = false;
      });
    return true;
  });
}
