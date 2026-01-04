<template>
  <div ref="el" class="abele-diff" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

const props = defineProps<{
  textLeft: string
  textRight: string
}>()

const el = ref<HTMLElement>()
const editor = ref<MergeView>()

const updateEditor = (force = false) => {
  if (el.value) {
    if (!editor.value || force) {
      editor.value?.destroy()

      editor.value = new MergeView({
        a: {
          doc: '',
          extensions: [
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            EditorView.lineWrapping,
          ],
        },
        b: {
          doc: '',
          extensions: [
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            EditorView.lineWrapping,
          ],
        },
        parent: el.value,
      })
    }

    editor.value.a.dispatch({
      changes: {
        from: 0,
        to: editor.value.a.state.doc.length,
        insert: props.textLeft,
      },
    })

    editor.value.b.dispatch({
      changes: {
        from: 0,
        to: editor.value.b.state.doc.length,
        insert: props.textRight,
      },
    })
  }
}

onMounted(() => {
  updateEditor()
})
watch(
  () => [props.textLeft, props.textRight],
  () => {
    updateEditor()
  }
)

onUnmounted(() => {
  editor.value?.destroy()
  editor.value = null
})
</script>

<style lang="scss">
@media (max-width: 600px) {
  .abele-diff {
    .cm-mergeViewEditors {
      flex-direction: column;

      .cm-mergeViewEditor {
        width: 100%;
        flex-basis: auto;
      }
    }
  }
}
</style>
