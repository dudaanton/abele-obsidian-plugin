<template>
  <section
    ref="root"
    class="abele-github-file"
    :class="{ 'abele-github-file_target': !!anchor }"
    :data-diff="file.hash"
  >
    <div
      class="abele-github-file__head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <Icon :icon="expanded ? 'chevron-down' : 'chevron-right'" no-hover />
      <span class="abele-github-file__path">
        <span v-if="file.previousPath" class="abele-github-file__previous"
          >{{ file.previousPath }} →
        </span>
        {{ file.path }}
      </span>
      <span class="abele-github-file__stats">
        <span class="abele-github-file__add">+{{ file.additions }}</span>
        <span class="abele-github-file__del">−{{ file.deletions }}</span>
      </span>
      <Badge v-if="file.status !== 'modified'" :text="file.status" />
      <Icon
        v-if="file.reviewComments.length"
        class="abele-github-file__comment-count"
        icon="message-square"
        :text-right="String(file.reviewComments.length)"
        no-hover
      />
    </div>

    <div v-if="expanded" class="abele-github-file__body">
      <div v-if="lines.length" ref="editorEl" class="abele-github-code" />
      <Teleport v-if="barHost && selectedSpan && linker?.item()" :to="barHost">
        <GithubSelectionBar
          :linker="linker"
          :label="selectedLabel"
          :link="selectedLink"
          :snippet="selectedSnippet"
        />
      </Teleport>
      <EmptyState v-else>
        {{
          file.diffNote
            ? file.diffNote
            : file.patch === undefined
              ? 'GitHub does not show this diff here — the file is binary or its diff is too large.'
              : 'No changes in the text of this file.'
        }}
      </EmptyState>
      <div v-if="anchor?.line && !highlight.length" class="abele-github-file__note">
        Line {{ anchor.line }} is in a part of the file the diff does not show.
      </div>
      <div v-if="file.reviewComments.length" class="abele-github-file__comments">
        <GithubComment
          v-for="c in file.reviewComments"
          :key="c.id"
          :comment="c"
          :target="commentAnchor"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubComment from './GithubComment.vue'
import GithubSelectionBar from './GithubSelectionBar.vue'
import { LINKER } from '@/github/linking'
import { diffSnippet, type SnippetBlock } from '@/github/snippetBlock'
import { diffLink, diffSpan, type DiffSpan, type GithubLink } from '@/github/permalinks'
import type { DiffFile } from '@/github/api'
import type { DiffFileAnchor } from '@/github/urls'
import { linesFor, parsePatch } from '@/github/patch'
import { mountDiff, type Viewer } from '@/github/codeViewer'
import { LINE_CONTEXT, elementTop, pinIntoView } from '@/github/scrollTo'

const props = withDefaults(
  defineProps<{
    file: DiffFile
    /** Open when first shown. A long list starts closed and draws a diff only when asked. */
    initiallyOpen?: boolean
    /** Set when the link pointed at this file: it opens, scrolls into view and marks the line. */
    anchor?: DiffFileAnchor
    /** The review comment a link pointed at, marked where it appears. */
    commentAnchor?: string
  }>(),
  { anchor: undefined, commentAnchor: undefined }
)

const root = ref<HTMLElement>()
const editorEl = ref<HTMLElement>()
const expanded = ref(props.initiallyOpen || !!props.anchor)

const lines = computed(() => (props.file.patch ? parsePatch(props.file.patch) : []))
const highlight = computed(() => {
  const a = props.anchor
  if (!a?.line || !a.side) return []
  return linesFor(lines.value, a.side, a.line, a.endLine ?? a.line)
})

let viewer: Viewer | null = null

const linker = inject(LINKER, null)
/** Where CodeMirror draws the selection's bar just now, and which lines the person selected. */
const barHost = shallowRef<HTMLElement | null>(null)
const selectedSpan = shallowRef<DiffSpan | null>(null)
/** The selection as the view counts lines, hunk headers included. */
const selectedLines = shallowRef<{ from: number; to: number } | null>(null)

const selectedLabel = computed(() => {
  const s = selectedSpan.value
  if (!s) return ''
  const lines = s.start === s.end ? `Line ${s.start}` : `Lines ${s.start}–${s.end}`
  return s.side === 'L' ? `${lines}, before the change` : lines
})

const selectedLink = (): GithubLink => {
  const item = linker?.item()
  if (!item || !selectedSpan.value) throw new Error('nothing is selected')
  return diffLink(item, props.file, selectedSpan.value)
}

const selectedSnippet = (): SnippetBlock => {
  if (!selectedLines.value) throw new Error('nothing is selected')
  return diffSnippet(selectedLink(), props.file.path, lines.value, selectedLines.value)
}

const selectionHooks = {
  onSelect: (span: { from: number; to: number } | null) => {
    selectedSpan.value = span ? diffSpan(lines.value, span.from - 1, span.to - 1) : null
    selectedLines.value = span
  },
  onBarHost: (host: HTMLElement | null, removed?: HTMLElement) => {
    if (host) barHost.value = host
    else if (barHost.value === removed) barHost.value = null
  },
}

/** Safe to call twice in a row: each call replaces what the one before it drew. */
const draw = async () => {
  await nextTick()
  viewer?.destroy()
  viewer = null
  if (!expanded.value || !editorEl.value) return
  selectedSpan.value = null
  barHost.value = null
  viewer = mountDiff(editorEl.value, lines.value, props.file.path, highlight.value, selectionHooks)
}

let unpin = () => {}

/** The marked line, or the file itself when the link names no line the diff shows. */
const reveal = async () => {
  await nextTick()
  unpin()
  if (!root.value) return
  const drawn = viewer
  unpin =
    highlight.value.length && drawn
      ? pinIntoView(root.value, () => drawn.targetTop(), LINE_CONTEXT)
      : pinIntoView(
          root.value,
          elementTop(() => root.value)
        )
}

const toggle = () => {
  expanded.value = !expanded.value
}

watch(expanded, (): void => void draw())
// Pointed at a review comment in this file after it was drawn closed.
watch(
  () => props.initiallyOpen,
  (open) => {
    if (open) expanded.value = true
  }
)
watch(
  () => props.anchor,
  async (a) => {
    if (!a) return
    expanded.value = true
    await draw()
    await reveal()
  }
)

onMounted(async () => {
  await draw()
  if (props.anchor) await reveal()
})

onBeforeUnmount(() => {
  unpin()
  viewer?.destroy()
  viewer = null
})
</script>

<style lang="scss">
.abele-github-file {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  overflow: hidden;

  &_target {
    border-color: var(--interactive-accent);
  }

  &__head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-1) var(--size-4-2);
    padding: var(--size-4-2);
    background: var(--background-secondary);
    cursor: var(--cursor);
    font-size: var(--font-ui-small);
  }

  &__path {
    flex: 1 1 12em;
    min-width: 0;
    font-family: var(--font-monospace);
    overflow-wrap: anywhere;
  }

  &__previous {
    color: var(--text-muted);
  }

  &__stats {
    display: flex;
    gap: var(--size-4-1);
    font-family: var(--font-monospace);
  }

  &__add {
    color: var(--color-green);
  }

  &__del {
    color: var(--color-red);
  }

  &__comment-count {
    color: var(--text-muted);
  }

  &__note {
    padding: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__comments {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
    padding: var(--size-4-2);
    border-top: 1px solid var(--background-modifier-border);
  }
}

.abele-github-code {
  font-size: var(--code-size);

  .cm-editor {
    background: var(--background-primary);
  }

  .cm-editor.cm-focused {
    outline: none;
  }

  .cm-content,
  .cm-gutters {
    font-family: var(--font-monospace);
  }

  .cm-gutters {
    background: var(--background-primary-alt);
    color: var(--text-faint);
    border-right: 1px solid var(--background-modifier-border);
  }

  .cm-gutterElement {
    padding: 0 var(--size-4-1);
    text-align: right;
  }

  // A line number selects its line, as on GitHub.
  .abele-github-code__gutter .cm-gutterElement,
  .cm-lineNumbers .cm-gutterElement {
    cursor: var(--cursor-link);
  }

  // The bar under a selection sits in the editor's text, which keeps its spacing.
  &__bar {
    white-space: normal;
    cursor: default;
  }

  &__line_add {
    background: color-mix(in srgb, var(--color-green) 15%, transparent);
  }

  &__line_del {
    background: color-mix(in srgb, var(--color-red) 15%, transparent);
  }

  &__line_hunk {
    background: color-mix(in srgb, var(--color-blue) 10%, transparent);

    &,
    & span {
      color: var(--text-muted);
    }
  }

  &__line_target {
    box-shadow: inset var(--size-4-1) 0 0 var(--interactive-accent);
    background: color-mix(in srgb, var(--color-yellow) 20%, transparent);
  }
}
</style>
