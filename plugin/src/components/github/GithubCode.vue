<template>
  <div ref="editorEl" class="abele-github-code abele-github-blob__code" />
  <Teleport v-if="barHost && hasBar" :to="barHost">
    <slot name="bar" />
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { LineSpan } from '@/github/permalinks'
import type { LineRange } from '@/github/urls'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import { LINE_CONTEXT, pinIntoView } from '@/github/scrollTo'

/**
 * A file at a ref, as code: its lines numbered, the lines a link named marked, and lines
 * selected by their numbers. What is selected belongs to the file view above, which shows the
 * same selection in the rendered view of a markdown file.
 */
const props = withDefaults(
  defineProps<{
    text: string
    path: string
    /** The lines the link named. */
    range?: LineRange
    /** Lines the person selected before this view was drawn — in the rendered view, say. */
    selected?: LineSpan | null
    /** A line to bring into view when drawn, rather than the first marked one. */
    focus?: { line: number; context: number } | null
  }>(),
  { range: undefined, selected: null, focus: null }
)

const emit = defineEmits<{
  (e: 'select', span: LineSpan | null): void
}>()

const editorEl = ref<HTMLElement>()
let viewer: CodeViewer | null = null
let unpin = () => {}

/** Where CodeMirror draws the selection's bar just now, and whether there is one. */
const barHost = shallowRef<HTMLElement | null>(null)
const hasBar = ref(false)

const selectionHooks = {
  onSelect: (span: LineSpan | null) => {
    hasBar.value = !!span
    emit('select', span)
  },
  onBarHost: (host: HTMLElement | null, removed?: HTMLElement) => {
    if (host) barHost.value = host
    else if (barHost.value === removed) barHost.value = null
  },
}

const draw = async (focus: { line: number; context: number } | null) => {
  await nextTick()
  unpin()
  viewer?.destroy()
  viewer = null
  if (!editorEl.value) return
  barHost.value = null
  const carried = props.selected
  hasBar.value = !!carried
  const marked = carried ? { start: carried.from, end: carried.to } : props.range
  const drawn = mountCode(
    editorEl.value,
    props.text,
    props.path,
    marked,
    { ...selectionHooks, initialBar: !!carried },
    focus?.line
  )
  viewer = drawn
  if (focus) {
    unpin = pinIntoView(editorEl.value, () => drawn.lineTop(focus.line), {
      context: focus.context,
    })
  } else if (props.range) {
    unpin = pinIntoView(editorEl.value, () => drawn.targetTop(), LINE_CONTEXT)
  }
}

onMounted((): void => void draw(props.focus))
watch(
  () => props.text,
  (): void => void draw(null)
)
// A link to lines of the same file — the same lines again, a new range object, or others — marks
// them in the editor already drawn and scrolls back to them. Drawn afresh, the editor would be
// gone for a moment, the tab's scroll cut short to what was left, and the new one would open on
// lines it had not drawn.
watch(
  () => props.range,
  (range): void => {
    if (!viewer || !range || !editorEl.value) return void draw(null)
    unpin()
    hasBar.value = false
    viewer.mark(range)
    const drawn = viewer
    unpin = pinIntoView(editorEl.value, () => drawn.targetTop(), LINE_CONTEXT)
  }
)
onBeforeUnmount(() => {
  unpin()
  viewer?.destroy()
})

defineExpose({
  /** The line at the top of the tab, for the rendered view to open at. */
  topLine: (): number | null => viewer?.topLine() ?? null,
  shows: (span: LineSpan): boolean => viewer?.shows(span.from, span.to) ?? false,
})
</script>
