import React from 'react';
import ReactDOM from 'react-dom';
import { Editor, EditorState } from 'draft-js';
import 'draft-js/dist/Draft.css';
import { $getRoot, createEditor } from 'lexical';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerRichText } from '@lexical/rich-text';
import { applyReplacement, captureTarget } from '../../../src/content/editable.ts';
import { createButton } from '../../../src/content/button.ts';
import { createController } from '../../../src/content/controller.ts';
import { createIdleFix } from '../../../src/content/idle.ts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';

// Each connect() replays the next script; the last one repeats.
const fake = { scripts: [], settings: DEFAULT_SETTINGS, calls: 0, open: 0, maxOpen: 0, sent: [] };

function fakePort(script) {
  fake.open += 1;
  if (fake.open > fake.maxOpen) fake.maxOpen = fake.open;
  const messageListeners = [];
  const disconnectListeners = [];
  let open = true;
  let closed = false;
  return {
    postMessage(message) {
      fake.sent.push(message);
      script.forEach((event, index) => {
        // Playwright resumes real time after fastForward, so a 20ms reply can land
        // before the next test step and the in-flight checks would miss it.
        setTimeout(
          () => {
            if (!open) return;
            if (event === 'disconnect') disconnectListeners.forEach((listener) => listener());
            else messageListeners.forEach((listener) => listener(event));
          },
          100 * (index + 1),
        );
      });
    },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    disconnect() {
      open = false;
      if (closed) return;
      closed = true;
      fake.open -= 1;
    },
  };
}

function connect() {
  return fakePort(fake.scripts[Math.min(fake.calls++, fake.scripts.length - 1)] ?? []);
}

const controller = createController({
  connect,
  getSettings: () => fake.settings,
  isMac: false,
  onAccepted: (target) => idle?.accepted(target),
});

let idle;

const popupApi = {
  openPopup(scripts, settings = {}) {
    fake.scripts = scripts;
    fake.settings = { ...DEFAULT_SETTINGS, ...settings };
    fake.calls = 0;
    const target = captureTarget({ wholeFieldIfEmpty: true });
    if (!target) throw new Error('no target');
    controller.open(target);
  },
  setScripts(scripts) {
    fake.scripts = scripts;
    fake.calls = 0;
    fake.open = 0;
    fake.maxOpen = 0;
    fake.sent = [];
  },
  startButton() {
    createButton({
      isMac: false,
      isEnabled: () => true,
      isPopupOpen: controller.isOpen,
      onActivate() {
        const target = captureTarget({ wholeFieldIfEmpty: false });
        if (target) controller.open(target);
      },
    });
  },
  startIdle() {
    idle = createIdleFix({
      connect,
      isEnabled: () => true,
      isPopupOpen: controller.isOpen,
      isFixDefault: () => fake.settings.defaultMode === 'fix',
      openPopup: controller.open,
    });
  },
  manual() {
    const target = captureTarget({ wholeFieldIfEmpty: true });
    if (!target) throw new Error('no target');
    idle.open(target);
  },
  requests: () => fake.calls,
  maxOpen: () => fake.maxOpen,
  sent: () => fake.sent.map((message) => message.text),
};

// Facebook's composer is Lexical.
const lexical = createEditor({
  namespace: 'fixture',
  onError: (error) => {
    throw error;
  },
});
lexical.setRootElement(document.getElementById('lexical'));
registerRichText(lexical);
registerHistory(lexical, createEmptyHistoryState(), 0);

function DraftBox() {
  const [editorState, setEditorState] = React.useState(() => EditorState.createEmpty());
  window.__lp = {
    ...popupApi,
    captureTarget,
    applyReplacement,
    draftText: () => editorState.getCurrentContent().getPlainText(),
    lexicalBlocks: () =>
      lexical.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((block) => block.getTextContent()),
      ),
  };
  return React.createElement(Editor, {
    editorState,
    onChange: setEditorState,
    // X turns spellcheck on; the idle Fix skips fields that turn it off.
    spellCheck: true,
  });
}

const root = document.getElementById('draft');
if (!root) throw new Error('missing #draft');
ReactDOM.render(React.createElement(DraftBox), root);
