<template>
  <div ref="host" class="abele-code-field" />
</template>

<script setup lang="ts">
// Code to edit in place, in the plugin's own code editor: its colours for the language, line
// numbers, folds, brackets, undo, comments with Mod+/ and Tab to indent. What was written is
// handed on when the field is left, as a text field's change is; Mod+Enter hands it on and asks
// for what the host does with it (a request sends).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder as hint } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languageFor } from '@/github/languages'
import { codeEditing } from '@/editor/codeEditing'

const props = withDefaults(
  defineProps<{
    value: string
    /** A file name the language is told by: `body.json`. */
    path: string
    /** The field in words, for a screen reader. */
    label: string
    placeholder?: string
  }>(),
  { placeholder: '' }
)
const emit = defineEmits<{ change: [text: string]; submit: [text: string] }>()

const host = ref<HTMLElement>()
let view: EditorView | null = null
let shown = props.value
const text = () => view?.state.doc.toString() ?? ''
const handOn = () => {
  const now = text()
  if (now === shown) return
  shown = now
  emit('change', now)
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        history(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...languageFor(props.path),
        EditorView.lineWrapping,
        ...codeEditing(),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              handOn()
              emit('submit', text())
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        ...(props.placeholder ? [hint(props.placeholder)] : []),
        EditorView.contentAttributes.of({ 'aria-label': props.label }),
        EditorView.domEventHandlers({ blur: () => handOn() }),
        // Obsidian makes its interface unselectable; code is there to be written and quoted.
        EditorView.baseTheme({
          '.cm-content': { userSelect: 'text', WebkitUserSelect: 'text' },
          '.cm-gutters': { userSelect: 'none', WebkitUserSelect: 'none' },
        }),
      ],
    }),
  })
})

// Another request, or the same one changed elsewhere: its text replaces what is shown.
watch(
  () => props.value,
  (next) => {
    if (!view || next === text()) return
    shown = next
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
  }
)

onBeforeUnmount(() => {
  handOn()
  view?.destroy()
  view = null
})
</script>

<style lang="scss">
// Framed as the answer's body beside it is, and as long as its text up to a screen's worth.
.abele-code-field {
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);

  &:focus-within {
    border-color: var(--background-modifier-border-focus);
  }
  .cm-editor {
    max-height: 24lh;
  }
  .cm-editor.cm-focused {
    outline: none;
  }
  .cm-scroller {
    min-height: 4lh;
    font-family: inherit;
  }
  .cm-gutters {
    border: none;
    background-color: var(--background-secondary);
    color: var(--text-faint);
  }
  .cm-activeLine {
    background-color: var(--background-modifier-hover);
  }
  .cm-activeLineGutter {
    background-color: transparent;
    color: var(--text-muted);
  }
  .cm-placeholder {
    color: var(--text-faint);
    font-family: var(--font-interface);
  }
}
</style>
