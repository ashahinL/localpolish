import React from 'react';
import ReactDOM from 'react-dom';
import { Editor, EditorState } from 'draft-js';
import 'draft-js/dist/Draft.css';
import { $getRoot, createEditor } from 'lexical';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerRichText } from '@lexical/rich-text';
import { createEditor as createSlateEditor, Node as SlateNode } from 'slate';
import { withHistory } from 'slate-history';
import { Editable, Slate, withReact } from 'slate-react';
import { EditorState as PmState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import Quill from 'quill';
import { applyReplacement, captureTarget } from '../../../src/content/editable.ts';
import { createButton } from '../../../src/content/button.ts';
import { createController } from '../../../src/content/controller.ts';
import { options } from 'preact';
import { createIdleFix } from '../../../src/content/idle.ts';
import { IdleMark } from '../../../src/content/ui/IdleMark.tsx';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';

// Counts IdleMark VNode commits, not DOM mutations.
let markCommits = 0;
const diffed = options.diffed;
options.diffed = (vnode) => {
  if (vnode.type === IdleMark) markCommits += 1;
  diffed?.(vnode);
};

// Each connect() replays the next script; the last one repeats.
const fake = {
  scripts: [],
  settings: DEFAULT_SETTINGS,
  calls: 0,
  open: 0,
  maxOpen: 0,
  sent: [],
  ports: [],
};

function fakePort(script) {
  fake.open += 1;
  if (fake.open > fake.maxOpen) fake.maxOpen = fake.open;
  const messageListeners = [];
  fake.ports.push((event) => messageListeners.forEach((listener) => listener(event)));
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
let button;
let enabled = true;

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
    fake.ports = [];
  },
  startButton() {
    button = createButton({
      isMac: false,
      isEnabled: () => enabled,
      isPopupOpen: controller.isOpen,
      onActivate() {
        const target = captureTarget({ wholeFieldIfEmpty: false });
        if (target) {
          if (idle) idle.open(target);
          else controller.open(target);
        }
      },
    });
  },
  startIdle() {
    idle = createIdleFix({
      connect,
      isEnabled: () => enabled,
      isPopupOpen: controller.isOpen,
      isFixDefault: () => fake.settings.defaultMode === 'fix',
      openPopup: controller.open,
      languages: () => ({ en: true, ar: true, franco: true, other: true }),
      detect: async () => ({ isReliable: false, languages: [] }),
    });
  },
  setEnabled(on, refresh = true) {
    enabled = on;
    if (refresh) {
      idle?.refresh();
      button?.refresh();
    }
  },
  manual() {
    const target = captureTarget({ wholeFieldIfEmpty: true });
    if (!target) throw new Error('no target');
    idle.open(target);
  },
  markCommits: () => markCommits,
  resetMarkCommits() {
    markCommits = 0;
  },
  requests: () => fake.calls,
  maxOpen: () => fake.maxOpen,
  sent: () => fake.sent.map((message) => message.text),
  triggers: () => fake.sent.map((message) => message.trigger ?? null),
  deliver: (index, event) => fake.ports[index](event),
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

// ChatGPT, Claude.ai, Jira and Confluence use ProseMirror (some through Tiptap).
const proseMirror = new EditorView(document.getElementById('prosemirror'), {
  state: PmState.create({
    schema,
    plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap)],
  }),
  attributes: { spellcheck: 'true' },
});

// Slack's composer is built on Quill.
const quill = new Quill('#quill');

document.getElementById('other').addEventListener('paste', (event) => {
  event.preventDefault();
  document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
});

function DraftBox() {
  const [editorState, setEditorState] = React.useState(() => EditorState.createEmpty());
  window.__lp = {
    ...popupApi,
    captureTarget,
    applyReplacement,
    draftText: () => editorState.getCurrentContent().getPlainText(),
    slateText: () => slate.children.map((block) => SlateNode.string(block)).join('\n'),
    proseMirrorText: () =>
      proseMirror.state.doc.textBetween(0, proseMirror.state.doc.content.size, '\n'),
    quillText: () => quill.getText().replace(/\n$/, ''),
    plainText: () => document.getElementById('ce').innerText.trim(),
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

// Discord's composer is Slate.
const slate = withHistory(withReact(createSlateEditor()));

function SlateBox() {
  const [value] = React.useState(() => [{ type: 'paragraph', children: [{ text: '' }] }]);
  return React.createElement(
    Slate,
    { editor: slate, initialValue: value },
    React.createElement(Editable, { id: 'slate', spellCheck: true }),
  );
}

ReactDOM.render(React.createElement(SlateBox), document.getElementById('slate-root'));
