<template>
  <section ref="root" class="abele-github-pinned abele-github-file" :data-path="file.path">
    <div class="abele-github-file__head">
      <span class="abele-github-file__path"
        >{{ file.change.previousPath ? `${file.change.previousPath} → ` : '' }}{{ file.path }}</span
      >
      <Badge :text="file.change.status" />
      <span class="abele-github-file__stats">
        <span class="abele-github-file__add">+{{ file.text?.additions ?? '—' }}</span>
        <span class="abele-github-file__del">−{{ file.text?.deletions ?? '—' }}</span>
      </span>
      <span v-if="file.change.base"
        >Base:
        {{
          file.change.base.size === undefined ? 'unknown size' : formatSize(file.change.base.size)
        }}
        · {{ file.change.base.mode ?? 'unknown mode' }}</span
      >
      <span v-if="file.change.target"
        >Target:
        {{
          file.change.target.size === undefined
            ? 'unknown size'
            : formatSize(file.change.target.size)
        }}
        · {{ file.change.target.mode ?? 'unknown mode' }}</span
      >
      <Button
        v-if="file.change.base"
        text="Open base"
        icon="external-link"
        tooltip="Open the base side on GitHub"
        @click="openSide('base')"
      />
      <Button
        v-if="file.change.target"
        text="Open target"
        icon="external-link"
        tooltip="Open the target side on GitHub"
        @click="openSide('target')"
      />
    </div>
    <EmptyState v-if="file.note" :text="file.note" />
    <Button
      v-if="file.canLoadLarge"
      :text="busy ? 'Computing diff…' : 'Load large diff'"
      :disabled="busy"
      icon="file-diff"
      tooltip="Compute this file's diff beyond the automatic budget"
      @click="emit('large')"
    />
    <EmptyState
      v-if="file.text && !file.text.additions && !file.text.deletions"
      text="No changes in the text of this file."
    />
    <div v-if="file.text?.lines.length" ref="editor" class="abele-github-code" />
    <Teleport v-if="barHost && selected && linker" :to="barHost">
      <GithubSelectionBar
        :linker="linker"
        :label="label"
        :link="selectedLink"
        :snippet="selectedSnippet"
        :quote="selectedQuote"
      />
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubSelectionBar from './GithubSelectionBar.vue'
import type { PinnedFile } from '@/repository/model'
import type { Repository } from '@/github/comparison/pins'
import { blobLink, diffSpan, fileUrl, type DiffSpan, type LineSpan } from '@/github/permalinks'
import { mountDiff, type Viewer } from '@/github/codeViewer'
import { linesFor } from '@/github/patch'
import { SCREEN, diffCode, markExpanded } from '@/github/screen'
import { LINKER } from '@/github/linking'
import { diffSnippet } from '@/github/snippetBlock'
import { LINE_CONTEXT, pinIntoView } from '@/github/scrollTo'
import { formatSize } from '@/github/tree/folder'
import { openExternal } from '@/helpers/openExternal'
import type { LineRange } from '@/github/urls'
import { useRepositorySource } from '@/repository/context'

const props = defineProps<{
  file: PinnedFile
  repo: Repository
  range?: LineRange
  nonce: number
  busy?: boolean
}>()
const emit = defineEmits<{ large: []; open: [url: string] }>()
const source = useRepositorySource()
const root = ref<HTMLElement>(),
  editor = ref<HTMLElement>()
const linker = inject(LINKER, null),
  screen = inject(SCREEN, null)
const selected = shallowRef<DiffSpan | null>(null),
  picked = shallowRef<LineSpan | null>(null)
const barHost = shallowRef<HTMLElement | null>(null)
const lines = computed(() => props.file.text?.lines ?? [])
const label = computed(() =>
  selected.value
    ? `Lines ${selected.value.start}–${selected.value.end}${selected.value.side === 'L' ? ', base' : ', target'}`
    : ''
)
const selectedLink = () => {
  const s = selected.value
  if (!s) throw new Error('No lines selected.')
  return source.value
    ? source.value.navigation.blobLink(
        s.side === 'L' ? props.file.baseSha : props.file.targetSha,
        s.side === 'L' ? props.file.change.base.path : props.file.path,
        { from: s.start, to: s.end }
      )
    : blobLink(
        props.repo,
        s.side === 'L' ? props.file.baseSha : props.file.targetSha,
        s.side === 'L' ? props.file.change.base.path : props.file.path,
        { from: s.start, to: s.end }
      )
}
const selectedQuote = () => ({
  code: picked.value ? diffCode(lines.value, picked.value.from, picked.value.to) : '',
  path: props.file.path,
  diff: true,
})
const selectedSnippet = () => {
  if (!picked.value) throw new Error('No lines selected.')
  return diffSnippet(selectedLink(), props.file.path, lines.value, picked.value)
}
const clear = () => {
  selected.value = null
  picked.value = null
  barHost.value = null
  if (screen?.selection?.path === props.file.path) {
    screen.selection = null
    screen.selectionChat = null
  }
}
const openSide = (side: 'base' | 'target') => {
  const ref = side === 'base' ? props.file.baseSha : props.file.targetSha
  const path = side === 'base' ? props.file.change.base.path : props.file.path
  const url = source.value?.navigation.file(ref, path) ?? fileUrl(props.repo, ref, path)
  if (source.value?.identity.provider === 'node') emit('open', url)
  else openExternal(url)
}

let viewer: Viewer | null = null,
  unpin = () => {},
  generation = 0
const draw = async () => {
  const mine = ++generation
  await nextTick()
  if (mine !== generation) return
  unpin()
  viewer?.destroy()
  viewer = null
  clear()
  if (!editor.value || !lines.value.length) return
  const highlight = props.range
    ? linesFor(lines.value, 'R', props.range.start, props.range.end)
    : []
  const drawn = mountDiff(
    editor.value,
    lines.value,
    props.file.path,
    highlight,
    {
      onSelect: (span) => {
        picked.value = span
        selected.value = span ? diffSpan(lines.value, span.from - 1, span.to - 1) : null
        if (!screen) return
        screen.selection = selected.value
          ? {
              path: props.file.path,
              label: label.value,
              code: selectedQuote().code,
              url: selectedLink().url,
              side: selected.value.side === 'L' ? 'base' : 'target',
              sha: selected.value.side === 'L' ? props.file.baseSha : props.file.targetSha,
            }
          : null
        screen.selectionChat = selected.value ? { link: selectedLink, quote: selectedQuote } : null
      },
      onBarHost: (host, removed) => {
        if (host) barHost.value = host
        else if (barHost.value === removed) barHost.value = null
      },
    },
    true
  )
  viewer = drawn
  if (highlight.length) unpin = pinIntoView(editor.value, () => drawn.targetTop(), LINE_CONTEXT)
}
onMounted(() => {
  if (screen) markExpanded(screen, props.file.path, true)
  void draw()
})
watch(
  () => [props.file, props.range, props.nonce],
  () => void draw()
)
onBeforeUnmount(() => {
  generation++
  unpin()
  viewer?.destroy()
  clear()
  if (screen) markExpanded(screen, props.file.path, false)
})
</script>
