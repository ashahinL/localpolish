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
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';

// Each connect() replays the next script; the last one repeats.
const fake = { scripts: [], settings: DEFAULT_SETTINGS, calls: 0 };

function fakePort(script) {
  const messageListeners = [];
  const disconnectListeners = [];
  let open = true;
  return {
    postMessage() {
      script.forEach((event, index) => {
        setTimeout(
          () => {
            if (!open) return;
            if (event === 'disconnect') disconnectListeners.forEach((listener) => listener());
            else messageListeners.forEach((listener) => listener(event));
          },
          20 * (index + 1),
        );
      });
    },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    disconnect() {
      open = false;
    },
  };
}

const controller = createController({
  connect: () => fakePort(fake.scripts[Math.min(fake.calls++, fake.scripts.length - 1)] ?? []),
  getSettings: () => fake.settings,
  isMac: false,
});

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
  });
}

const root = document.getElementById('draft');
if (!root) throw new Error('missing #draft');
ReactDOM.render(React.createElement(DraftBox), root);
