import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { dracula } from "@ddietr/codemirror-themes/theme/dracula";
import { tags } from "@lezer/highlight";

const markdownExtras: Extension = HighlightStyle.define([
  { tag: tags.monospace, color: "#8BE9FD" },
]);

const appThemePatch: Extension = EditorView.theme(
  {
    "&": { height: "100%" },
    ".cm-content": { padding: "20px 8px" },
    ".cm-scroller": {
      scrollbarWidth: "thin",
      scrollbarColor: "rgba(255,255,255,0.08) transparent",
    },
  },
  { dark: true },
);

function createPlanEditor(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: "",
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

export {
  createPlanEditor,
  EditorState as CMEditorState,
  EditorView as CMEditorView,
};
