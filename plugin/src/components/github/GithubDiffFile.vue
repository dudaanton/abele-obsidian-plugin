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
        <GithubComment v-for="c in file.reviewComments" :key="c.id" :comment="c" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubComment from './GithubComment.vue'
import type { DiffFile } from '@/github/api'
import type { DiffFileAnchor } from '@/github/urls'
import { linesFor, parsePatch } from '@/github/patch'
import { mountDiff, type Viewer } from '@/github/codeViewer'

const props = withDefaults(
  defineProps<{
    file: DiffFile
    /** Open when first shown. A long list starts closed and draws a diff only when asked. */
    initiallyOpen?: boolean
    /** Set when the link pointed at this file: it opens, scrolls into view and marks the line. */
    anchor?: DiffFileAnchor
  }>(),
  { anchor: undefined }
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

/** Safe to call twice in a row: each call replaces what the one before it drew. */
const draw = async () => {
  await nextTick()
  viewer?.destroy()
  viewer = null
  if (!expanded.value || !editorEl.value) return
  viewer = mountDiff(editorEl.value, lines.value, props.file.path, highlight.value)
}

/** After a frame: the scroll has to be measured against a laid-out pane. */
const reveal = async () => {
  await nextTick()
  const win = root.value?.win ?? window
  win.requestAnimationFrame(() => {
    if (highlight.value.length && viewer) viewer.reveal()
    else root.value?.scrollIntoView({ block: 'start' })
  })
}

const toggle = () => {
  expanded.value = !expanded.value
}

watch(expanded, (): void => void draw())
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
