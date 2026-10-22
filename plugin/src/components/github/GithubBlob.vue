<template>
  <div ref="blobRoot" class="abele-github-blob">
    <NodeLspTools
      v-if="lspTarget"
      :root="blobRoot"
      :glyph-host="glyphHost"
      :target="lspTarget"
      :path="file.path"
      :text="visibleText"
      :offline="offline"
    />
    <Teleport :to="glyphHost ?? 'body'" :disabled="!glyphHost">
      <!-- A node's markdown file: rendered or as code, one lit glyph like blame beside it. -->
      <Icon
        v-if="markdown && glyphSwitch"
        icon="book-open"
        :active="mode === 'preview' && !blaming"
        :label="t('streamB.preview.324b13')"
        :aria-pressed="mode === 'preview' && !blaming"
        :tooltip="
          mode === 'preview' && !blaming ? t('streamB.showAsCode') : t('streamB.showRendered')
        "
        @click="switchTo(mode === 'preview' && !blaming ? 'code' : 'preview')"
      />
      <!-- Who last changed each line, as a glyph lit while it is on. -->
      <Icon
        v-if="source"
        icon="git-commit-horizontal"
        :active="blaming"
        :label="t('streamB.toggleLineBlame.bcbda1')"
        :aria-pressed="blaming"
        :tooltip="
          blaming
            ? t('streamB.hideWhoChangedEachLine.062ce7')
            : t('streamB.showWhoLastChangedEachLine.e5d723')
        "
        @click="toggleBlame"
      />
    </Teleport>
    <Teleport :to="toolbarHost ?? 'body'" :disabled="!toolbarHost">
      <div v-if="(markdown && !glyphSwitch) || range" class="abele-github-blob__toolbar">
        <div v-if="range" class="abele-github-blob__range">
          {{ linesLabel({ from: range.start, to: range.end }) }}
          <span v-if="range.start > lineCount" class="abele-github-blob__warning">
            {{ t('streamBMeta.80a8f4615e', { p0: String(lineCount) }) }}
          </span>
        </div>
        <Tabs
          v-if="markdown && !glyphSwitch"
          class="abele-github-blob__modes"
          :model-value="blaming ? 'code' : mode"
          :tabs="modes"
          level="secondary"
          @update:model-value="switchTo"
        />
      </div>
    </Teleport>

    <template v-if="editor && editor.filePath.value === file.path">
      <NodeFileSaveState
        :model="editor"
        :offline="offline"
        :locked="!writable"
        :reload="reloadEditor"
        :keep-mine="keepMine"
      />
      <details
        v-if="
          editor.draft.value &&
          editor.document.value?.text !== undefined &&
          editor.draftText.value !== editor.document.value.text
        "
      >
        <summary>{{ t('streamB.lastLoadedVersion.43fdff') }}</summary>
        <GithubCode :text="editor.document.value.text" :path="file.path" />
      </details>
    </template>
    <div v-if="editorError" role="alert">{{ editorError }}</div>
    <div v-if="blaming && blameBusy" role="status" data-repository-blame-status>
      {{ t('streamB.loadingLineBlame.b1680c') }}
    </div>
    <GithubNotice
      v-if="blaming && blameError"
      :text="blameError"
      :busy="blameBusy"
      @retry="askBlame()"
    />

    <!-- A mapped source keeps its mounted debugger state while blame uses the ordinary viewer. -->
    <div v-if="$slots.code" v-show="!blaming"><slot name="code" /></div>
    <EmptyState
      v-if="mode === 'preview' && !blaming && !$slots.code && !text.trim()"
      class="abele-github-blob__empty"
      :text="t('streamB.fileEmpty')"
    />
    <GithubMarkdown
      v-else-if="mode === 'preview' && !blaming && !$slots.code"
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
      v-else-if="!$slots.code || blaming"
      ref="code"
      :text="visibleText"
      :path="file.path"
      :keep-visible-in-short-pane="source?.identity.provider === 'node'"
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
    <SelectionBar
      v-if="linker && !unsaved && !documentNote"
      :scope="blobRoot"
      within=".cm-content"
      :actions="linker.canAsk() ? [ASK, ADD, NOTE, LINK] : [ADD, NOTE, LINK]"
      @pick="onWords"
    />
  </div>
</template>

<script setup lang="ts">
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ChannelError } from '@abele/channel-protocol'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubNotice from './GithubNotice.vue'
import NodeFileSaveState from '../NodeFileSaveState.vue'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import type { FileDraftSnapshot } from '@/node/fileDrafts'
import type { BlameRange } from '@/repository/model'
import { useRepositorySource } from '@/repository/context'

import Tabs from '../obsidian/Tabs.vue'
import GithubCode from './GithubCode.vue'
import GithubMarkdown from './GithubMarkdown.vue'
import GithubSelectionBar from './GithubSelectionBar.vue'
import SelectionBar, { type Selected } from '../obsidian/SelectionBar.vue'
import { ADD, ASK, NOTE, LINK } from '../obsidian/selectionActions'
import { addGithubSelection } from '@/github/addSelection'
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
import NodeLspTools from '../nodeWork/NodeLspTools.vue'
import type { PathTarget } from '@/node/NodePathModel'
import { NodeService } from '@/node/NodeService'

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
    /** The header's row of glyphs, where blame goes. */
    glyphHost?: HTMLElement | null
    editor?: NodeFilesModel
    writable?: boolean
    offline?: boolean
    contentId?: string | null
    documentNote?: string
    refresh?: () => Promise<unknown>
  }>(),
  {
    range: undefined,
    plain: false,
    mode: undefined,
    client: undefined,
    toolbarHost: null,
    glyphHost: null,
    editor: undefined,
    writable: false,
    offline: false,
    contentId: undefined,
    documentNote: undefined,
    refresh: undefined,
  }
)

const emit = defineEmits<{
  (e: 'mode', mode: BlobMode): void
  (e: 'open', url: string): void
}>()

const editorError = ref('')
const unsaved = computed(
  () =>
    !!props.editor &&
    props.editor.filePath.value === props.file.path &&
    (props.editor.draftDirty.value ||
      !!props.editor.draft.value?.pending ||
      props.editor.document.value?.contentId !== props.contentId ||
      (props.editor.draft.value?.status !== 'saved' &&
        props.editor.draftText.value !== props.editor.document.value?.text))
)
const visibleText = computed(() =>
  props.editor?.filePath.value === props.file.path &&
  (unsaved.value || props.editor.draft.value?.status !== 'saved')
    ? props.editor.draftText.value
    : props.text
)
let editorGeneration = 0
const syncEditor = async () => {
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
const reloadEditor = async (shown: FileDraftSnapshot | null) => {
  const editor = props.editor
  if (!editor) return
  await editor.reloadCurrent(shown)
  editor.editing.value = !!props.writable && editor.fileEditable.value
  editorError.value = ''
  if (props.refresh) {
    await props.refresh()
    await syncEditor()
  }
}
const keepMine = async (shown: FileDraftSnapshot | null) => {
  if (!props.editor) return
  await props.editor.keepMine(shown)
  editorError.value = ''
  if (props.refresh) {
    await props.refresh()
    await syncEditor()
  }
}
const editText = (text: string) => {
  if (!props.writable || !props.editor) return
  props.editor.editing.value = true
  void props.editor.editText(text).catch((e: unknown) => {
    editorError.value =
      e instanceof Error ? presentUiError(e) : t('streamB.theLocalDraftCouldNotBeStored.2645b0')
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
      await syncEditor()
      if (mine === editorGeneration) editorError.value = ''
    } catch (e) {
      if (mine === editorGeneration)
        editorError.value =
          e instanceof Error
            ? presentUiError(e)
            : t('streamB.theLocalEditorCouldNotReloadThis.600b24')
    }
  },
  { immediate: true }
)
const source = useRepositorySource(
  () => props.client,
  () => props.file
)
const lspTarget = computed<PathTarget | undefined>(() => {
  const identity = source.value?.identity
  if (
    identity?.provider !== 'node' ||
    !(props.file.ref === 'Working tree' || props.file.ref.startsWith('working-'))
  )
    return undefined
  const nodeId = NodeService.connectionIfKnown?.(identity.node)?.client.target?.expected_node_id
  if (!nodeId) return undefined
  return {
    nodeId,
    registrationId: identity.node,
    projectId: identity.project,
    kind: 'worktree',
    id: identity.workspace,
  }
})
const blaming = ref(false)
const blameBusy = ref(false)
const blameError = ref('')
const blameRanges = shallowRef<BlameRange[] | null>(null)
let blameRequest = 0
// Set while an expired file is reread for blame, so its new revision keeps blame on.
let rereading = false
const askBlame = async (reread = true): Promise<void> => {
  const current = source.value
  if (!current) return
  const request = ++blameRequest
  blameBusy.value = true
  blameError.value = ''
  try {
    const ranges = await current.blame(props.file.ref, props.file.path)
    if (request === blameRequest) blameRanges.value = ranges
  } catch (error) {
    let shown: unknown = error
    // An expired working revision is reread once, then blamed at the fresh one.
    if (
      reread &&
      request === blameRequest &&
      props.refresh &&
      props.file.ref.startsWith('working-') &&
      error instanceof ChannelError &&
      error.code === 'stale_revision'
    ) {
      console.debug('[github] Refreshing expired file before blame', props.file.path)
      rereading = true
      try {
        await props.refresh()
        await nextTick()
        if (request === blameRequest && blaming.value) return askBlame(false)
        return
      } catch (failure) {
        shown = failure
      } finally {
        rereading = false
      }
    }
    if (request === blameRequest) blameError.value = presentUiError(shown)
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
  (values, previous) => {
    blameRanges.value = null
    if (rereading) return
    const keepBlame =
      blaming.value &&
      source.value?.identity.provider === 'node' &&
      values.slice(0, 4).every((value, index) => value === previous[index]) &&
      values[5] === previous[5] &&
      typeof values[4] === 'string' &&
      values[4].startsWith('working-') &&
      typeof previous[4] === 'string' &&
      previous[4].startsWith('working-')
    ++blameRequest
    blameBusy.value = false
    blameError.value = ''
    if (keepBlame) {
      console.debug('[github] Refreshing line blame for working file', props.file.path)
      void askBlame()
    } else blaming.value = false
  }
)
onBeforeUnmount(() => {
  ++blameRequest
})

const markdown = computed(() => isMarkdownPath(props.file.path))
/** On a node the file card's header row holds the switch, as a glyph; GitHub keeps its tabs. */
const glyphSwitch = computed(() => source.value?.identity.provider === 'node' && !!props.glyphHost)
/** What a node tab was switched to, when its owner keeps no state for it. */
const chosen = ref<BlobMode | undefined>()
const config = AbeleConfig.getInstance()
const mode = computed(() => {
  // Followed at once when the setting changes.
  void config.version.value
  return blobMode({
    path: props.file.path,
    lines: props.range,
    // A node file view always asks for plain text; for markdown the setting decides instead.
    plain: props.plain && source.value?.identity.provider !== 'node',
    stored: props.mode ?? chosen.value,
    setting: githubSettings().markdownView,
  })
})
const modes = [
  {
    id: 'preview',
    label: t('streamB.preview.324b13'),
    icon: 'eye',
    tooltip: t('streamB.theFileRenderedAsGithubShowsIt.e1d69b'),
  },
  {
    id: 'code',
    label: t('streamB.code.340f46'),
    icon: 'code',
    tooltip: t('streamB.theFileAsItIsWrittenLine.9867e9'),
  },
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
  if (!linker || !selected.value) throw new Error(t('streamB.nothingIsSelected.e695b9'))
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
        ? { path: props.file.path, label: linesLabel(s, false), code: selectedQuote().code }
        : null
    screen.selectionChat =
      s && linker && !unsaved.value ? { link: selectedLink, quote: selectedQuote } : null
  },
  { immediate: true }
)

const selectedSnippet = async () => {
  const span = selected.value
  if (!span) throw new Error(t('streamB.nothingIsSelected.e695b9'))
  return codeSnippet(await selectedLink(), props.file.path, props.text, span)
}

const blobRoot = ref<HTMLElement>()
async function onWords(action: string, words: Selected) {
  if (!linker || !words.from || !words.to) return
  const span = { from: words.from, to: words.to }
  const path = props.file.path
  const text = props.text
  const link = linker.blobLink(span)
  if (action === 'ask') await linker.ask(link, { code: words.text, path })
  else if (action === 'add') await addGithubSelection(link, { code: words.text, path })
  else if (action === 'link') await linker.copy(link)
  else if (action === 'note')
    await linker.insertSnippet(link.then((resolved) => codeSnippet(resolved, path, text, span)))
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
    // Still at the start: stay put, with the header and its switch in sight.
    focus.value = top && top > 1 ? { line: top, context: 0 } : null
  }
  blaming.value = false
  chosen.value = next
  emit('mode', next)
}
</script>

<style lang="scss">
// An empty markdown file says so in the middle of its card, as a pane with nothing in it does.
.abele-github-blob__empty {
  padding-block: var(--size-4-8);
  text-align: center;
}
body.is-phone .abele-github-blob > details > summary {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
  padding-block: var(--size-4-2);
  box-sizing: border-box;
  align-content: center;
}
.abele-github-blob {
  min-width: 0;
  // A rendered table may run out to the file's own width, measured from here.
  container-type: inline-size;
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
