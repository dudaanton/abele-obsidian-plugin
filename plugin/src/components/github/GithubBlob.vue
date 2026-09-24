<template>
  <div class="abele-github-blob">
    <div v-if="markdown || range" class="abele-github-blob__toolbar">
      <div v-if="range" class="abele-github-blob__range">
        {{ linesLabel({ from: range.start, to: range.end }) }}
        <span v-if="range.start > lineCount" class="abele-github-blob__warning">
          — the file has only {{ lineCount }} lines.
        </span>
      </div>
      <Tabs
        v-if="markdown"
        class="abele-github-blob__modes"
        :model-value="mode"
        :tabs="modes"
        level="secondary"
        @update:model-value="switchTo"
      />
    </div>

    <GithubMarkdown
      v-if="mode === 'preview'"
      ref="preview"
      :text="text"
      :file="file"
      :range="range"
      :selected="selected"
      :focus="focus"
      :client="client"
      @select="onSelect"
      @open="(url) => emit('open', url)"
    >
      <template #bar>
        <GithubSelectionBar
          v-if="linker && selected"
          :linker="linker"
          :label="linesLabel(selected)"
          :link="selectedLink"
          :snippet="selectedSnippet"
          :quote="selectedQuote"
        />
      </template>
    </GithubMarkdown>

    <GithubCode
      v-else
      ref="code"
      :text="text"
      :path="file.path"
      :range="range"
      :selected="selected"
      :focus="focus"
      @select="onSelect"
    >
      <template #bar>
        <GithubSelectionBar
          v-if="linker && selected"
          :linker="linker"
          :label="linesLabel(selected)"
          :link="selectedLink"
          :snippet="selectedSnippet"
          :quote="selectedQuote"
        />
      </template>
    </GithubCode>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, shallowRef, watch } from 'vue'
import Tabs from '../obsidian/Tabs.vue'
import GithubCode from './GithubCode.vue'
import GithubMarkdown from './GithubMarkdown.vue'
import GithubSelectionBar from './GithubSelectionBar.vue'
import { LINKER } from '@/github/linking'
import { codeSnippet } from '@/github/snippetBlock'
import { SCREEN, blobCode } from '@/github/screen'
import type { Quote } from '@/github/chatAbout'
import type { LineSpan } from '@/github/permalinks'
import type { LineRange } from '@/github/urls'
import type { GithubClient } from '@/github/client'
import type { RepoFile } from '@/github/markdownLinks'
import { LINE_CONTEXT } from '@/github/scrollTo'
import { blobMode, isMarkdownPath, linesLabel, type BlobMode } from '@/github/markdownPreview'

/**
 * A file at a ref. Markdown opens rendered, with a switch to its source; anything else is code.
 * Lines selected in either view are the same selection, shown in both, with the same bar for
 * linking to them.
 */
const props = withDefaults(
  defineProps<{
    text: string
    file: RepoFile
    /** The lines the link named. */
    range?: LineRange
    /** The link asked for the source: `?plain=1`. */
    plain?: boolean
    /** What the tab was switched to, kept in its state; unset follows the link. */
    mode?: BlobMode
    client?: GithubClient
  }>(),
  { range: undefined, plain: false, mode: undefined, client: undefined }
)

const emit = defineEmits<{
  (e: 'mode', mode: BlobMode): void
  (e: 'open', url: string): void
}>()

const markdown = computed(() => isMarkdownPath(props.file.path))
const mode = computed(() =>
  blobMode({ path: props.file.path, lines: props.range, plain: props.plain, stored: props.mode })
)
const modes = [
  {
    id: 'preview',
    label: 'Preview',
    icon: 'eye',
    tooltip: 'The file rendered, as GitHub shows it',
  },
  { id: 'code', label: 'Code', icon: 'code', tooltip: 'The file as it is written, line by line' },
]
const lineCount = computed(() => props.text.split('\n').length)

const linker = inject(LINKER, null)
const selected = ref<LineSpan | null>(null)
/** Where the view switched to opens: at the selection when it is in sight, else where this was. */
const focus = ref<{ line: number; context: number } | null>(null)
const onSelect = (span: LineSpan | null) => {
  selected.value = span
}
// A new file, or a link to other lines of it: what was selected before is gone, and the view
// opens where the link says rather than where the last switch left off.
watch(
  () => [props.text, props.range],
  () => {
    selected.value = null
    focus.value = null
  }
)

const selectedLink = () => {
  if (!linker || !selected.value) throw new Error('nothing is selected')
  return linker.blobLink(selected.value)
}
const selectedQuote = (): Quote => {
  const s = selected.value
  return { code: s ? blobCode(props.text, s.from, s.to) : '', path: props.file.path }
}

/**
 * The tab's record of what is on screen, which an agent reads: the selected lines and their code,
 * whichever view they were selected in.
 */
const screen = inject(SCREEN, null)
watch(
  selected,
  (s) => {
    if (!screen) return
    screen.selection = s
      ? { path: props.file.path, label: linesLabel(s), code: selectedQuote().code }
      : null
  },
  { immediate: true }
)

const selectedSnippet = async () => {
  const span = selected.value
  if (!span) throw new Error('nothing is selected')
  return codeSnippet(await selectedLink(), props.file.path, props.text, span)
}

interface View {
  topLine(): number | null
  shows(span: LineSpan): boolean
}
const preview = shallowRef<View | null>(null)
const code = shallowRef<View | null>(null)

const switchTo = (next: string) => {
  if (next === mode.value || (next !== 'preview' && next !== 'code')) return
  const view = mode.value === 'code' ? code.value : preview.value
  const lines =
    selected.value ?? (props.range ? { from: props.range.start, to: props.range.end } : null)
  if (lines && view?.shows(lines)) {
    focus.value = { line: lines.from, context: LINE_CONTEXT.context ?? 0 }
  } else {
    const top = view?.topLine() ?? null
    focus.value = top ? { line: top, context: 0 } : null
  }
  emit('mode', next)
}
</script>

<style lang="scss">
.abele-github-blob {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
  }

  &__range {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__modes {
    margin-inline-start: auto;
  }

  &__warning {
    color: var(--text-error);
  }

  &__code {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
}
</style>
