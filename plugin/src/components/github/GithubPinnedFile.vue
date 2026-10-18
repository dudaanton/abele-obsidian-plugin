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
      <span v-if="file.change.base">{{
        t('streamBMeta.0b656ed5b2', {
          p0: String(
            file.change.base.size === undefined
              ? t('streamB.unknownSize.f5d2f9')
              : formatSize(file.change.base.size)
          ),
          p1: String(file.change.base.mode ?? t('streamB.unknownMode.08641d')),
        })
      }}</span>
      <span v-if="file.change.target">{{
        t('streamBMeta.f1b4d3b037', {
          p0: String(
            file.change.target.size === undefined
              ? t('streamB.unknownSize.f5d2f9')
              : formatSize(file.change.target.size)
          ),
          p1: String(file.change.target.mode ?? t('streamB.unknownMode.08641d')),
        })
      }}</span>
      <Button
        v-if="file.change.base"
        :text="t('streamB.openBase.48e652')"
        icon="external-link"
        :tooltip="t('streamB.openTheBaseSideOnGithub.857fdc')"
        @click="openSide('base')"
      />
      <Button
        v-if="file.change.target"
        :text="t('streamB.openTarget.d2e00c')"
        icon="external-link"
        :tooltip="t('streamB.openTheTargetSideOnGithub.00e8b3')"
        @click="openSide('target')"
      />
    </div>
    <EmptyState v-if="file.note" :text="presentUiField(file, 'note')" />
    <Button
      v-if="file.canLoadLarge"
      :text="busy ? t('streamB.computingDiff.f5db61') : t('streamB.loadLargeDiff.3c64be')"
      :disabled="busy"
      icon="file-diff"
      :tooltip="t('streamB.computeThisFileSDiffBeyondThe.b8edc1')"
      @click="emit('large')"
    />
    <EmptyState
      v-if="file.text && !file.text.additions && !file.text.deletions"
      :text="t('streamB.noChangesInTheTextOfThis.e4d45d')"
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
import { presentUiField } from '@/i18n/streamBErrors'

import { t } from '@/i18n'
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
    ? t('streamB.lines.0c6261', {
        v0: String(selected.value.start),
        v1: String(selected.value.end),
        v2: String(
          selected.value.side === 'L' ? t('streamBMeta.78b994fe44') : t('streamBMeta.3598f24e4d')
        ),
      })
    : ''
)
const selectedLink = () => {
  const s = selected.value
  if (!s) throw new Error(t('streamB.noLinesSelected.8564d5'))
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
  if (!picked.value) throw new Error(t('streamB.noLinesSelected.8564d5'))
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
