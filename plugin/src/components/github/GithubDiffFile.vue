<template>
  <section
    ref="root"
    class="abele-github-file"
    :class="{ 'abele-github-file_target': !!anchor }"
    :data-diff="file.hash"
    :data-path="file.path"
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
        <!-- A real link, so hovering shows where it goes and a right click offers what a link
             does. The click itself is Obsidian's link handling, which the GitHub tabs take. -->
        <a
          v-if="openUrl"
          ref="pathLink"
          class="abele-github-file__path-link"
          :href="openUrl"
          @pointerdown="refreshLink"
          @mouseenter="refreshLink"
          @focus="refreshLink"
          @click.stop
          @keydown.enter.stop
          >{{ file.path }}</a
        >
        <template v-else>{{ file.path }}</template>
      </span>
      <span class="abele-github-file__stats">
        <span class="abele-github-file__add">+{{ file.additions }}</span>
        <span class="abele-github-file__del">−{{ file.deletions }}</span>
      </span>
      <Badge v-if="file.status !== 'modified'" :text="file.status" />
      <Icon
        v-if="openUrl"
        class="abele-github-file__open"
        icon="file-text"
        :tooltip="openTooltip"
        @click.stop="openFile"
      />
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
      <!-- After the empty note, not between it and the diff: `v-else` pairs with its neighbour. -->
      <Teleport v-if="barHost && selectedSpan && linker?.item()" :to="barHost">
        <GithubSelectionBar
          :linker="linker"
          :label="selectedLabel"
          :link="selectedLink"
          :snippet="selectedSnippet"
          :quote="selectedQuote"
        />
      </Teleport>
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
import { SCREEN, diffCode, markExpanded } from '@/github/screen'
import type { Quote } from '@/github/chatAbout'
import { diffLink, diffSpan, type DiffSpan, type GithubLink } from '@/github/permalinks'
import type { DiffFile } from '@/github/api'
import type { DiffFileAnchor } from '@/github/urls'
import { linesFor, parsePatch } from '@/github/patch'
import { mountDiff, type Viewer } from '@/github/codeViewer'
import { LINE_CONTEXT, elementTop, pinIntoView } from '@/github/scrollTo'
import { fileUrl, lineOnSide } from '@/github/permalinks'
import { paneForClick } from '@/github/links'
import type { PaneType } from 'obsidian'

const props = withDefaults(
  defineProps<{
    file: DiffFile
    /** Open when first shown. A long list starts closed and draws a diff only when asked. */
    initiallyOpen?: boolean
    /** Set when the link pointed at this file: it opens, scrolls into view and marks the line. */
    anchor?: DiffFileAnchor
    /** The review comment a link pointed at, marked where it appears. */
    commentAnchor?: string
    /**
     * The commits the diff is between: the file is opened whole at `head`, or at `base` when the
     * change deleted it. Without them there is no "Open file".
     */
    refs?: { head?: string; base?: string }
  }>(),
  { anchor: undefined, commentAnchor: undefined, refs: undefined }
)

const emit = defineEmits<{
  /** Opens a GitHub URL: `false` by the usual rule, a pane type in a new tab, split or window. */
  open: [url: string, pane: PaneType | false]
}>()

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

const selectedQuote = (): Quote => {
  const r = selectedLines.value
  return { code: r ? diffCode(lines.value, r.from, r.to) : '', path: props.file.path, diff: true }
}

/** The tab's record of what is on screen, which an agent reads. */
const screen = inject(SCREEN, null)

/** This file's selection leaves the record, and only this file's. */
const clearOwnSelection = () => {
  if (screen?.selection?.path === props.file.path) screen.selection = null
}

const selectionHooks = {
  onSelect: (span: { from: number; to: number } | null) => {
    selectedSpan.value = span ? diffSpan(lines.value, span.from - 1, span.to - 1) : null
    selectedLines.value = span
    if (!screen) return
    if (!span || !selectedSpan.value) return clearOwnSelection()
    let url: string | undefined
    try {
      url = selectedLink().url
    } catch {
      url = undefined
    }
    screen.selection = {
      path: props.file.path,
      label: selectedLabel.value,
      code: selectedQuote().code,
      url,
    }
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
  selectedLines.value = null
  clearOwnSelection()
  barHost.value = null
  viewer = mountDiff(editorEl.value, lines.value, props.file.path, highlight.value, selectionHooks)
}

/**
 * "Open file": the whole file at the commit the diff is of — before it, for a deleted file — at
 * the first selected line, else at the line at the top of the tab when the person has scrolled
 * into this diff. Otherwise at no line, so a markdown file opens rendered.
 */
const deleted = computed(() => props.file.status === 'removed')
const openUrl = computed(() => urlAt(undefined))
const openTooltip = computed(() =>
  deleted.value ? 'Open the whole file as it was before the change' : 'Open the whole file'
)

function urlAt(line: number | undefined): string | null {
  const item = linker?.item()
  const sha = deleted.value ? props.refs?.base : props.refs?.head
  if (!item || !sha) return null
  return fileUrl(item, sha, props.file.path, line)
}

/** The line to open at, now: the selection's, or the one in view. */
function currentLine(): number | undefined {
  const side = deleted.value ? 'old' : 'new'
  const picked = selectedLines.value?.from ?? viewer?.lineInView() ?? null
  return picked === null ? undefined : lineOnSide(lines.value, picked - 1, side)
}

const currentUrl = () => urlAt(currentLine())

const pathLink = ref<HTMLAnchorElement>()
/** The link's address follows the selection and the scroll; it is read when it is used. */
const refreshLink = () => {
  const url = currentUrl()
  if (url && pathLink.value) pathLink.value.setAttribute('href', url)
}

const openFile = (evt: MouseEvent) => {
  const url = currentUrl()
  if (!url) return
  const pane = paneForClick(evt, false)
  if (pane === null) window.open(url)
  else emit('open', url, pane)
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

watch(expanded, (open): void => {
  if (screen) markExpanded(screen, props.file.path, open)
  if (!open) clearOwnSelection()
  void draw()
})
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
  if (screen && expanded.value) markExpanded(screen, props.file.path, true)
  await draw()
  if (props.anchor) await reveal()
})

onBeforeUnmount(() => {
  unpin()
  viewer?.destroy()
  viewer = null
  if (screen) markExpanded(screen, props.file.path, false)
  clearOwnSelection()
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

  &__path-link {
    color: inherit;
    text-decoration: none;

    &:hover {
      color: var(--link-external-color-hover);
      text-decoration: underline;
    }
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
