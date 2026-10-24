<template>
  <div ref="editorEl" class="abele-github-code abele-github-blob__code" />
  <Teleport v-for="host in blameHosts" :key="host.id" :to="host.element">
    <GithubBlameRange :commit="host.range.commit" @open="(sha) => emit('commit', sha)" />
  </Teleport>
  <Teleport v-if="barHost && hasBar" :to="barHost">
    <slot name="bar" />
  </Teleport>
</template>

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { FILE_LENS } from '@/requests/fileLens'
import type { LineSpan } from '@/github/permalinks'
import type { LineRange } from '@/github/urls'
import { mountCode, type CodeViewer, type CodeComparison } from '@/github/codeViewer'
import { LINE_CONTEXT, pinIntoView } from '@/github/scrollTo'
import type { BlameRange } from '@/repository/model'
import type { BlameHost } from '@/github/blameGutter'
import GithubBlameRange from './GithubBlameRange.vue'

/**
 * A file at a ref, as code: its lines numbered, the lines a link named marked, and lines
 * selected by their numbers. What is selected belongs to the file view above, which shows the
 * same selection in the rendered view of a markdown file.
 */
const props = withDefaults(
  defineProps<{
    text: string
    path: string
    /** Opt-in workspace editor; ordinary GitHub code/diff views remain read only. */
    editable?: boolean
    comparison?: CodeComparison
    keepVisibleInShortPane?: boolean
    blame?: BlameRange[] | null
    /** The lines the link named. */
    range?: LineRange
    /** Lines the person selected before this view was drawn — in the rendered view, say. */
    selected?: LineSpan | null
    /** A line to bring into view when drawn, rather than the first marked one. */
    focus?: { line: number; context: number } | null
  }>(),
  {
    range: undefined,
    selected: null,
    focus: null,
    blame: null,
    editable: false,
    comparison: undefined,
    keepVisibleInShortPane: false,
  }
)

const emit = defineEmits<{
  (e: 'select', span: LineSpan | null): void
  (e: 'commit', sha: string): void
  (e: 'change', text: string): void
}>()

const editorEl = ref<HTMLElement>()
let viewer: CodeViewer | null = null
let unpin = () => {}
let hostId = 0
const blameHosts = shallowRef<(BlameHost & { id: number })[]>([])
const applyBlame = () =>
  viewer?.blame(
    props.blame
      ? {
          ranges: props.blame,
          add: (host) => {
            blameHosts.value = [...blameHosts.value, { ...host, id: ++hostId }]
          },
          remove: (el) => {
            blameHosts.value = blameHosts.value.filter((h) => h.element !== el)
          },
        }
      : null
  )
watch(() => props.blame, applyBlame)
// A file of requests, read only: its send glyphs, from whoever shows requests here.
const lens = inject(FILE_LENS, null)?.(props.path) ?? null
const applyLens = () => {
  if (lens && !props.editable) viewer?.requests(lens.value)
}
if (lens) watch(lens, applyLens)

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
    focus?.line,
    props.editable ? (text) => emit('change', text) : undefined,
    true,
    props.comparison
  )
  viewer = drawn
  applyBlame()
  applyLens()
  if (focus) {
    unpin = pinIntoView(editorEl.value, () => drawn.lineTop(focus.line), {
      context: focus.context,
      keepVisibleInShortPane: props.keepVisibleInShortPane,
    })
  } else if (props.range) {
    unpin = pinIntoView(editorEl.value, () => drawn.targetTop(), {
      ...LINE_CONTEXT,
      keepVisibleInShortPane: props.keepVisibleInShortPane,
    })
  }
}

onMounted((): void => void draw(props.focus))
watch(
  () => props.text,
  (): void => {
    if (props.editable && viewer) viewer.setText(props.text)
    else void draw(null)
  }
)
watch(
  [() => props.editable, () => props.comparison?.original, () => props.comparison?.split],
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
    unpin = pinIntoView(editorEl.value, () => drawn.targetTop(), {
      ...LINE_CONTEXT,
      keepVisibleInShortPane: props.keepVisibleInShortPane,
    })
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

<style lang="scss">
.abele-github-code {
  // Blame belongs to this pane, which may be much narrower than the window.
  container-type: inline-size;
}
.abele-github-code:has(.abele-github-blame) .cm-content {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
}

.abele-github-code .cm-mergeView {
  min-width: 0;
}
.abele-github-code .cm-mergeViewEditor {
  min-width: 0;
}
.abele-github-code .cm-merge-a {
  color: var(--text-muted);
}
</style>

<style lang="scss">
// A request's send glyph between the line numbers and the code, as an IDE's run glyph: Obsidian's
// own clickable icon, a step smaller than the text, lit on hover. Its last answer is faint words at
// the end of the method line, red when it failed.
// On the request's first line, however far a narrow pane wraps it.
.abele-file-lens {
  .cm-gutterElement {
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
}
.abele-file-lens__send {
  height: calc(var(--line-height-normal) * 1em);
  padding: 0 var(--size-2-1);
  color: var(--text-faint);
  --icon-size: var(--icon-xs);

  &:hover {
    color: var(--text-accent);
  }
  &.is-sending {
    color: var(--text-accent);
    cursor: default;
  }
}
.abele-file-lens__outcome {
  margin-inline-start: var(--size-4-3);
  color: var(--text-faint);
  font-family: var(--font-interface);
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
  cursor: var(--cursor);

  &:hover {
    color: var(--text-muted);
    text-decoration: underline;
  }
  &.is-error {
    color: var(--text-error);
  }
}
// A finger's width on a phone; its height is the code line's, as the line numbers' are.
body.is-phone .abele-file-lens__send {
  min-width: var(--size-4-9);
}
</style>
