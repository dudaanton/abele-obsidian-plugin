<template>
  <div class="abele-note-editor-field">
    <div
      v-show="!fallback"
      ref="host"
      class="abele-note-editor-field__editor"
      @mousedown="onEmptyPress"
    />
    <ObsidianInput
      v-if="fallback"
      as-text-area
      :model-value="modelValue"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A field that is Obsidian's note editor: live preview, the `[[` suggester, formatting, undo —
 * written exactly as the note will be. Should the editor not be there to borrow after all, the
 * field is a plain text box rather than nothing; the dialogs that use it check for the editor
 * before they open, so that is a fallback for a fallback.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ObsidianInput from './obsidian/Input.vue'
import { createEmbeddedEditor, type EmbeddedEditor } from '@/editor/embeddedEditor'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit'): void
}>()

const host = ref<HTMLElement | null>(null)
const fallback = ref(false)
let editor: EmbeddedEditor | null = null
// The last text the editor itself reported, so that writing it back as the model changes does
// not reset the cursor with every keystroke.
let echoed = props.modelValue

onMounted(() => {
  if (!host.value) return
  editor = createEmbeddedEditor(GlobalStore.getInstance().app, host.value, {
    value: props.modelValue,
    placeholder: props.placeholder,
    onChange: (value) => {
      echoed = value
      emit('update:modelValue', value)
    },
    onSubmit: () => emit('submit'),
  })
  if (!editor) fallback.value = true
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || value === echoed) return
    echoed = value
    editor.set(value)
  }
)

onBeforeUnmount(() => {
  editor?.destroy()
  editor = null
})

/** A press on the field below the last line puts the cursor at the end, as in a note. */
const onEmptyPress = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!editor || target.closest('.cm-content')) return
  event.preventDefault()
  editor.focusEnd()
}

defineExpose({
  focus: () => editor?.focus(),
})
</script>

<style lang="scss">
/**
 * The editor drawn as a field: the border and radius of Obsidian's own inputs around it, and
 * the note's typography inside. It grows with the text; the dialog's body is what scrolls.
 */
.abele-note-editor-field__editor {
  flex: 1 0 auto;
  min-height: 8em;
  border: var(--input-border-width) solid var(--background-modifier-border);
  border-radius: var(--input-radius);
  background: var(--background-modifier-form-field);
  cursor: text;

  &:focus-within {
    border-color: var(--background-modifier-border-focus);
    box-shadow: 0 0 0 var(--size-2-1) var(--background-modifier-border-focus);
  }

  .markdown-source-view.mod-cm6 .cm-scroller {
    padding: var(--size-4-2) var(--size-4-3);
  }

  // A note centres a readable column in a wide pane; a field is the column.
  .markdown-source-view.mod-cm6.is-readable-line-width .cm-sizer,
  .markdown-source-view.mod-cm6 .cm-sizer {
    max-width: none;
    margin: 0;
  }

  .markdown-source-view.mod-cm6 .cm-content {
    min-height: 6em;
  }
}
</style>
