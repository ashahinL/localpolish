import React from 'react';
import ReactDOM from 'react-dom';
import { Editor, EditorState } from 'draft-js';
import 'draft-js/dist/Draft.css';
import { applyReplacement, captureTarget } from '../../../src/content/editable.ts';

function DraftBox() {
  const [editorState, setEditorState] = React.useState(() => EditorState.createEmpty());
  window.__lp = {
    captureTarget,
    applyReplacement,
    draftText: () => editorState.getCurrentContent().getPlainText(),
  };
  return React.createElement(Editor, {
    editorState,
    onChange: setEditorState,
  });
}

const root = document.getElementById('draft');
if (!root) throw new Error('missing #draft');
ReactDOM.render(React.createElement(DraftBox), root);
