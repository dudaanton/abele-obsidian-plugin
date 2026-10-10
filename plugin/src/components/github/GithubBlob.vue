<template>
  <div class="abele-github-blob">
    <Teleport :to="toolbarHost ?? 'body'" :disabled="!toolbarHost">
      <div v-if="markdown || range || source" class="abele-github-blob__toolbar">
        <Button
          v-if="source"
          text="Blame"
          icon="git-commit-horizontal"
          aria-label="Toggle line blame"
          :aria-pressed="blaming"
          tooltip="Toggle line blame"
          @click="toggleBlame"
        />
        <div v-if="range" class="abele-github-blob__range">
          {{ linesLabel({ from: range.start, to: range.end }) }}
          <span v-if="range.start > lineCount" class="abele-github-blob__warning">
            — the file has only {{ lineCount }} lines.
          </span>
        </div>
        <Tabs
          v-if="markdown"
          class="abele-github-blob__modes"
          :model-value="blaming ? 'code' : mode"
          :tabs="modes"
          level="secondary"
          @update:model-value="switchTo"
        />
      </div>
    </Teleport>

    <template v-if="editor && editor.filePath.value === file.path">
      <div v-if="changedOnDisk" class="abele-github-blob__changed" role="status">
        <span>Changed on disk · your local draft is kept.</span>
        <Button text="Reload" :disabled="!!editor.draft.value?.pending" @click="reloadDraft" />
        <Button text="Keep mine" @click="keptContent = contentId" />
      </div>
      <NodeFileSaveState
        :model="editor"
        :offline="offline"
        :locked="!writable"
        :reload="reloadEditor"
      />
      <details v-if="editor.draft.value && editor.draftText.value !== text">
        <summary>Last loaded version</summary>
        <GithubCode :text="text" :path="file.path" />
      </details>
    </template>
    <div v-if="editorError" role="alert">{{ editorError }}</div>
    <div v-if="blaming && blameBusy" role="status">Loading line blame…</div>
    <GithubNotice
      v-if="blaming && blameError"
      :text="blameError"
      :busy="blameBusy"
      @retry="askBlame"
    />

    <GithubMarkdown
      v-if="mode === 'preview' && !blaming"
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
      :text="visibleText"
      :path="file.path"
      :editable="
        !!editor &&
        editor.filePath.value === file.path &&
        writable &&
        (editor.fileEditable.value ||
          (!!editor.draft.value && editor.draft.value.status !== 'saved')) &&
        !offline &&
        !editor.saving.value &&
        !editor.draft.value?.pending
      "
      :blame="blaming && !unsaved ? blameRanges : null"
      :range="range"
      :selected="selected"
      :focus="focus"
      @select="onSelect"
      @change="editText"
      @commit="(sha) => emit('open', source!.navigation.commit(sha))"
    >
      <template #bar>
        <GithubSelectionBar
          v-if="linker && selected && !unsaved"
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
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import Button from '../obsidian/Button.vue'
import GithubNotice from './GithubNotice.vue'
import NodeFileSaveState from '../NodeFileSaveState.vue'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import type { BlameRange } from '@/repository/model'
import { useRepositorySource } from '@/repository/context'

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
import { githubSettings } from '@/github/GithubService'
import { AbeleConfig } from '@/services/AbeleConfig'

/**
 * A file at a ref. Markdown opens rendered or as its source, as the settings say, with a switch
 * between the two; anything else is code.
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
    /** In a tab, file actions sit below the pinned path; standalone previews stay inline. */
    toolbarHost?: HTMLElement | null
    editor?: NodeFilesModel
    writable?: boolean
    offline?: boolean
    contentId?: string | null
    documentNote?: string
  }>(),
  {
    range: undefined,
    plain: false,
    mode: undefined,
    client: undefined,
    toolbarHost: null,
    editor: undefined,
    writable: false,
    offline: false,
    contentId: undefined,
    documentNote: undefined,
  }
)

const emit = defineEmits<{
  (e: 'mode', mode: BlobMode): void
  (e: 'open', url: string): void
}>()

const editorError = ref(''),
  keptContent = ref<string | null>()
const unsaved = computed(
  () =>
    !!props.editor &&
    props.editor.filePath.value === props.file.path &&
    (props.editor.draftDirty.value || !!props.editor.draft.value?.pending)
)
const visibleText = computed(() =>
  props.editor?.filePath.value === props.file.path &&
  (unsaved.value || props.editor.draft.value?.status !== 'saved')
    ? props.editor.draftText.value
    : props.text
)
const changedOnDisk = computed(
  () =>
    unsaved.value &&
    props.contentId !== props.editor?.draft.value?.baseContentId &&
    keptContent.value !== props.contentId
)
let editorGeneration = 0
const reloadEditor = async () => {
  const editor = props.editor
  if (!editor) return
  await editor.openFile(props.file.path, undefined, props.range, {
    text: props.documentNote ? undefined : props.text,
    contentId: props.contentId ?? null,
    size: new TextEncoder().encode(props.text).length,
    binary: !!props.documentNote,
    large: false,
    tooLarge: !!props.documentNote,
  })
  editor.editing.value = (!!props.writable && editor.fileEditable.value) || !!editor.draft.value
}
const reloadDraft = async () => {
  try {
    await props.editor?.discardDraft()
    await reloadEditor()
    keptContent.value = undefined
  } catch (e) {
    editorError.value =
      e instanceof Error ? e.message : 'The local editor could not reload this draft'
  }
}
const editText = (text: string) => {
  if (!props.writable) return
  void props.editor?.editText(text).catch((e: unknown) => {
    editorError.value = e instanceof Error ? e.message : 'The local draft could not be stored'
  })
}
watch(
  () => [
    props.editor,
    props.file.path,
    props.file.ref,
    props.text,
    props.contentId,
    props.documentNote,
  ],
  async () => {
    const mine = ++editorGeneration
    if (props.editor?.draftError.value && props.editor.filePath.value === props.file.path) return
    try {
      await reloadEditor()
      if (mine === editorGeneration) editorError.value = ''
    } catch (e) {
      if (mine === editorGeneration)
        editorError.value =
          e instanceof Error ? e.message : 'The local editor could not reload this draft'
    }
  },
  { immediate: true }
)
const source = useRepositorySource(
  () => props.client,
  () => props.file
)
const blaming = ref(false)
const blameBusy = ref(false)
const blameError = ref('')
const blameRanges = shallowRef<BlameRange[] | null>(null)
let blameRequest = 0
const askBlame = async () => {
  const current = source.value
  if (!current) return
  const request = ++blameRequest
  blameBusy.value = true
  blameError.value = ''
  try {
    const ranges = await current.blame(props.file.ref, props.file.path)
    if (request === blameRequest) blameRanges.value = ranges
  } catch (error) {
    if (request === blameRequest)
      blameError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === blameRequest) blameBusy.value = false
  }
}
const toggleBlame = () => {
  blaming.value = !blaming.value
  if (blaming.value) void askBlame()
}
watch(
  () => [
    props.client,
    props.file.host,
    props.file.owner,
    props.file.repo,
    props.file.ref,
    props.file.path,
    props.text,
  ],
  () => {
    ++blameRequest
    blaming.value = false
    blameRanges.value = null
    blameBusy.value = false
    blameError.value = ''
  }
)
onBeforeUnmount(() => {
  ++blameRequest
})

const markdown = computed(
  () => source.value?.identity.provider !== 'node' && isMarkdownPath(props.file.path)
)
const config = AbeleConfig.getInstance()
const mode = computed(() => {
  // Followed at once when the setting changes.
  void config.version.value
  if (source.value?.identity.provider === 'node') return 'code'
  return blobMode({
    path: props.file.path,
    lines: props.range,
    plain: props.plain,
    stored: props.mode,
    setting: githubSettings().markdownView,
  })
})
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
  () => [props.text, props.range, props.file.path, source.value?.cacheNamespace] as const,
  (next, previous) => {
    // A live observation replaces bytes of the same file, not the user's line selection.
    if (
      source.value?.identity.provider === 'node' &&
      next[1] === previous[1] &&
      next[2] === previous[2] &&
      next[3] === previous[3]
    )
      return
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
  [selected, () => props.text, unsaved],
  ([s]) => {
    if (!screen) return
    screen.selection =
      s && !unsaved.value
        ? { path: props.file.path, label: linesLabel(s), code: selectedQuote().code }
        : null
    screen.selectionChat =
      s && linker && !unsaved.value ? { link: selectedLink, quote: selectedQuote } : null
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
  if ((!blaming.value && next === mode.value) || (next !== 'preview' && next !== 'code')) return
  const view = mode.value === 'code' || blaming.value ? code.value : preview.value
  const lines =
    selected.value ?? (props.range ? { from: props.range.start, to: props.range.end } : null)
  if (lines && view?.shows(lines)) {
    focus.value = { line: lines.from, context: LINE_CONTEXT.context ?? 0 }
  } else {
    const top = view?.topLine() ?? null
    focus.value = top ? { line: top, context: 0 } : null
  }
  blaming.value = false
  emit('mode', next)
}
</script>

<style lang="scss">
body.is-phone .abele-github-blob > details > summary {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
  padding-block: var(--size-4-2);
  box-sizing: border-box;
  align-content: center;
}
.abele-github-blob {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
  }

  &__changed {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
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
