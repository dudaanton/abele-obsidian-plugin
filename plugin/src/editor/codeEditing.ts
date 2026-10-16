/**
 * What the plugin's code editor does beyond showing text, shared by the code view of a file and
 * by every field that edits code in place (a request's body): folds, matching brackets, the line
 * under the caret, the other places of a selected word, a comment toggled with Mod+/ and Tab to
 * indent. Each host adds its own keys on top (saving, searching, sending).
 */
import { type Extension } from '@codemirror/state'
import { drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { indentWithTab, toggleComment } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'

export function codeEditing(): Extension[] {
  return [
    foldGutter(),
    drawSelection(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      // The commands package types its view against its own copy of the state package.

      { key: 'Mod-/', run: (view) => toggleComment(view as any) },
      indentWithTab,
      ...foldKeymap,
    ]),
  ]
}
