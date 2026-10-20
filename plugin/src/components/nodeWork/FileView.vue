<template>
  <div ref="root" class="abele-file-view" @contextmenu="onMenu">
    <NodeLspTools
      v-if="codeTarget && !repository && !image && !metadataNote && (mode === 'file' || !change)"
      :root="root"
      :glyph-host="glyphHost"
      :target="codeTarget"
      :path="path"
      :text="text"
      :offline="offline"
    />
    <NodeFileTools
      v-if="!image && !metadataNote && (mode === 'file' || !change)"
      :key="repository?.cacheNamespace ?? ''"
      :root="root"
      :glyph-host="glyphHost"
      :source="repository"
      :file="repositoryFile"
      :text="text"
    />
    <Diff
      v-if="!image && !metadataNote && mode === 'diff' && change"
      :text-left="change.before"
      :text-right="change.after"
      :path="path"
      :layout="layout"
      class="abele-file-view__card"
    >
      <template #title>
        <span class="abele-file-view__title">
          <ChangeCodes :change="change" />
          <span class="abele-file-view__path"
            >{{ change.from ? `${change.from} → ` : '' }}{{ path }}</span
          >
          <span v-if="change.when" class="abele-file-view__when">{{ change.when }}</span>
        </span>
      </template>
    </Diff>

    <div v-else class="abele-file-view__card abele-file-view__file">
      <div class="abele-file-view__header">
        <span class="abele-file-view__title">
          <ChangeCodes v-if="change" :change="change" />
          <span class="abele-file-view__path">{{ path }}</span>
          <span v-if="change?.when" class="abele-file-view__when">{{ change.when }}</span>
        </span>
        <span v-if="!metadataNote || image" class="abele-file-view__size">
          {{
            image ? plural(image.bytes.byteLength, 'byte') : plural(text.split('\n').length, 'line')
          }}
        </span>
        <span ref="glyphHost" class="abele-file-view__tools" />
      </div>
      <div v-if="metadataNote && !image" class="abele-file-view__metadata abele-file-view__size">
        {{ metadataNote }}
      </div>
      <Image v-if="imageUrl" :src="imageUrl" :alt="path" fit="contain" />
      <GithubBlob
        v-else-if="repository && revision && !metadataNote && !image"
        :key="repository.cacheNamespace"
        :text="text"
        :file="repositoryFile"
        :glyph-host="glyphHost"
        plain
        :offline="offline"
        :range="linkedRange"
        @open="openRepositoryLink"
      />
      <!-- The plugin's code viewer: the file's own colours, line numbers, selection, search. -->
      <div
        v-else-if="!metadataNote && !image"
        ref="code"
        class="abele-github-code abele-file-view__code"
      />
    </div>

    <SelectionBar
      v-if="!image && !metadataNote"
      :scope="root"
      within=".cm-content, .abele-diff__text"
      under=".abele-file-view__header, .abele-diff__header"
      :actions="
        codeTarget && (mode === 'file' || !change) ? [ASK, ADD, NOTE, LINK] : [ASK, ADD, NOTE]
      "
      @pick="send"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import type { PathTarget } from '@/node/NodePathModel'
import { nodeCodeLink } from '@/node/codeLinks'
import { pinIntoView, LINE_CONTEXT } from '@/github/scrollTo'
// A file of the node in the main area. A changed file opens on its comparison, the way a commit
// page does; the whole file is one switch away in the view's header, beside opening it in the
// code editor and the arrows to the previous and next changed file. Selected text — in the
// comparison or in the file — gets a small bar over it to ask the agent about it or add it to the
// chat or insert it into a note, on a phone as on a computer.
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { RepositorySource } from '@/repository/source'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { GlobalStore } from '@/stores/GlobalStore'
import NodeFileTools from './NodeFileTools.vue'
import NodeLspTools from './NodeLspTools.vue'
import GithubBlob from '../github/GithubBlob.vue'
import { fileSelection, type FileSelection } from './fileSelection'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import Diff from '../Diff.vue'
import SelectionBar from '../obsidian/SelectionBar.vue'
import { ADD, ASK, NOTE, LINK } from '../obsidian/selectionActions'
import ChangeCodes from './ChangeCodes.vue'
import Image from '../obsidian/Image.vue'
import { plural } from './codes'
import type { FileChange, NodeImagePreview } from './types'

const props = withDefaults(
  defineProps<{
    path: string
    /** The file as it is now; the last version, for a deleted file. */
    text: string
    change?: FileChange
    image?: NodeImagePreview
    mode?: 'diff' | 'file'
    layout?: 'unified' | 'split'
    repository?: RepositorySource
    revision?: string
    line?: number
    endLine?: number
    codeTarget?: PathTarget
    offline?: boolean
  }>(),
  {
    change: undefined,
    image: undefined,
    mode: 'diff',
    layout: 'unified',
    repository: undefined,
    revision: undefined,
    line: undefined,
    endLine: undefined,
    codeTarget: undefined,
    offline: false,
  }
)

const emit = defineEmits<{
  /** The context menu, with the selected text, or empty for the whole file. */
  (e: 'menu', event: MouseEvent, selection: string, lines?: FileSelection): void
  /** Selected text to ask about in a new chat, or to add to the open one. */
  (e: 'ask', selection: FileSelection): void
  (e: 'add', selection: FileSelection): void
  (e: 'note', selection: FileSelection): void
}>()

const metadataNote = computed(() =>
  props.change?.pending
    ? t('streamB.loadingChanges.99f48f')
    : props.change?.binary
      ? t('streamB.binaryFileNoTextDiff.1dcb4a')
      : props.change?.previewNote
)
const imageUrl = ref('')
const releaseImage = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}
watch(
  () => props.image,
  (image) => {
    releaseImage()
    if (image) imageUrl.value = URL.createObjectURL(new Blob([image.bytes], { type: image.mime }))
  },
  { immediate: true }
)

const root = ref<HTMLElement>()
// The file may have shrunk since the citation; expand only lines that still exist.
const linkedRange = computed(() => {
  const count = props.text.split('\n').length
  return props.line && props.line <= count
    ? { start: props.line, end: Math.min(props.endLine ?? props.line, count) }
    : undefined
})
const glyphHost = ref<HTMLElement>()
provide(
  REPOSITORY_SOURCE,
  computed(() => props.repository ?? null)
)
const repositoryFile = computed(() => ({
  host: '',
  owner: '',
  repo: '',
  ref: props.revision ?? '',
  path: props.path,
}))
function openRepositoryLink(url: string) {
  const target = parseNodeRepositoryLink(url)
  if (target) void openNodeRepositoryTarget(GlobalStore.getInstance().app, target, false)
}
const code = ref<HTMLElement>()
let viewer: CodeViewer | undefined
let unpin: (() => void) | undefined
let stopped = false

async function draw() {
  lastSelection = null
  await nextTick()
  if (stopped) return
  unpin?.()
  viewer?.destroy()
  viewer = undefined
  if (code.value) {
    viewer = mountCode(code.value, props.text, props.path, linkedRange.value)
    if (props.line) {
      const drawn = viewer
      unpin = pinIntoView(code.value, () => drawn.targetTop(), {
        ...LINE_CONTEXT,
        keepVisibleInShortPane: true,
      })
    }
  }
}
onMounted(draw)
watch(
  () => [
    props.text,
    props.path,
    props.mode,
    props.change,
    props.image,
    props.repository,
    props.revision,
    props.line,
    props.endLine,
  ],
  draw
)

let lastSelection: FileSelection | null = null
let selectionDocument: Document | undefined
function rememberSelection() {
  const selection = root.value
    ? fileSelection(root.value, root.value.ownerDocument.getSelection())
    : null
  if (selection) lastSelection = selection
}
onMounted(() => {
  selectionDocument = root.value?.ownerDocument
  selectionDocument?.addEventListener('selectionchange', rememberSelection)
})
onBeforeUnmount(() => {
  selectionDocument?.removeEventListener('selectionchange', rememberSelection)
  stopped = true
  unpin?.()
  releaseImage()
  viewer?.destroy()
})

function send(action: string) {
  // Read before SelectionBar clears the native range: retain exact text, line and diff side.
  const selection =
    (root.value ? fileSelection(root.value, root.value.ownerDocument.getSelection()) : null) ??
    lastSelection
  lastSelection = null
  if (!selection) return
  if (action === 'link' && props.codeTarget) {
    void navigator.clipboard
      .writeText(
        nodeCodeLink(props.codeTarget, props.path, { start: selection.from, end: selection.to })
      )
      .catch((error) => console.debug('[node] Copy code link unavailable', error))
    return
  }
  if (action === 'ask') emit('ask', selection)
  else if (action === 'add') emit('add', selection)
  else if (action === 'note') emit('note', selection)
}

function onMenu(e: MouseEvent) {
  if (e.defaultPrevented) return
  const selection = root.value
    ? fileSelection(root.value, root.value.ownerDocument.getSelection())
    : null
  if (selection) return
  e.preventDefault()
  emit('menu', e, '', undefined)
}
</script>

<style lang="scss">
.abele-file-view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
}
// Obsidian makes its interface unselectable and gives selection back only to a note; a file here
// is there to be read, quoted and handed to the agent, so it gives it back itself — code and
// comparison. Line numbers, signs and buttons stay out, so a drag copies the text alone.
.abele-file-view {
  user-select: text;
  -webkit-user-select: text;

  button,
  [role='button'],
  .abele-obsidian-icon,
  .cm-gutters,
  .abele-diff__gutter,
  .abele-diff__sign {
    user-select: none;
    -webkit-user-select: none;
  }
}
.abele-file-view__title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-file-view__path {
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-file-view__when {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

// The whole file in the same card as the comparison: header band, then the code viewer.
.abele-file-view__file {
  min-width: 0;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  background-color: var(--background-primary);
}
.abele-file-view__header {
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
}
.abele-file-view__size {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-file-view__tools {
  display: flex;
  align-items: center;
}
.abele-file-view__metadata {
  padding: var(--size-4-2) var(--size-4-3);
}
.abele-file-view__code {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);

  .cm-gutters {
    border: none;
    background-color: var(--background-primary);
    color: var(--text-faint);
  }
}
.abele-file-view {
  container-type: inline-size;
}
// A narrow pane: the path wraps rather than hides, and when it changed takes a line of its own.
@container (max-width: 30em) {
  .abele-file-view__title {
    flex-wrap: wrap;
  }
  .abele-file-view__path {
    flex: 1 1 12ch;
    white-space: normal;
    overflow: visible;
    overflow-wrap: anywhere;
  }
  .abele-file-view__when {
    flex-basis: 100%;
    color: var(--text-muted);
    font-weight: var(--font-normal);
  }
}
</style>
