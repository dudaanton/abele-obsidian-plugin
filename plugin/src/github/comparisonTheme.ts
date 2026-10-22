import { EditorView } from '@codemirror/view'

// Host status variables can be opaque. Derive comparison layers once for both layouts,
// rather than treating a status colour as a line background in only one of them.
const removed = 'color-mix(in srgb, var(--text-error) 16%, var(--background-primary))'
const added = 'color-mix(in srgb, var(--text-success) 16%, var(--background-primary))'
export const comparisonTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: removed,
    boxShadow: 'inset var(--border-width) 0 var(--text-error)',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: added,
    boxShadow: 'inset var(--border-width) 0 var(--text-success)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'color-mix(in srgb, var(--text-error) 18%, transparent)',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'color-mix(in srgb, var(--text-success) 18%, transparent)',
  },
  '.cm-deletedChunk': { color: 'var(--text-muted)' },
})
