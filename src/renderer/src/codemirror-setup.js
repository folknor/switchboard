import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { dracula } from '@ddietr/codemirror-themes/theme/dracula';
import { tags } from '@lezer/highlight';

const markdownExtras = HighlightStyle.define([
  { tag: tags.monospace, color: '#8BE9FD' },
]);

const appThemePatch = EditorView.theme({
  '&': { height: '100%' },
  '.cm-content': { padding: '20px 8px' },
  '.cm-scroller': {
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255,255,255,0.08) transparent',
  },
}, { dark: true });

function createPlanEditor(parent) {
  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...searchKeymap,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      dracula,
      syntaxHighlighting(markdownExtras),
      appThemePatch,
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state, parent });
  return view;
}

export { createPlanEditor, EditorView as CMEditorView, EditorState as CMEditorState };
