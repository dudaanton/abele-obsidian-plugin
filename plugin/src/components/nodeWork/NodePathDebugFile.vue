<template>
  <div ref="root" class="abele-file-view">
    <div class="abele-file-view__header">
      <span class="abele-file-view__path">{{ context.path }}</span>
      <span ref="glyphHost" class="abele-file-view__tools">
        <Icon
          v-if="repository && revision"
          icon="git-commit-horizontal"
          :label="t('streamB.toggleLineBlame.bcbda1')"
          :tooltip="t('streamB.showWhoLastChangedEachLine.e5d723')"
          :active="blaming"
          :aria-pressed="blaming"
          @click="toggleBlame"
        />
      </span>
    </div>
    <NodeFileTools
      :key="repository?.cacheNamespace ?? ''"
      :root="root"
      :glyph-host="glyphHost"
      :source="repository"
      :file="{ host: '', owner: '', repo: '', ref: revision ?? '', path: context.path }"
      :text="context.text"
    />
    <div v-if="blameError" role="alert">{{ blameError }}</div>
    <div ref="host" class="abele-node-debug-file" />
    <Teleport v-for="entry in blameHosts" :key="entry.id" :to="entry.element">
      <GithubBlameRange :commit="entry.range.commit" @open="openCommit" />
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ChannelError } from '@abele/channel-protocol'
import { EditorView } from '@codemirror/view'
import { Compartment, StateEffect } from '@codemirror/state'
import { blameGutter, type BlameHost } from '@/github/blameGutter'
import type { RepositorySource } from '@/repository/source'
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import Icon from '../obsidian/Icon.vue'
import GithubBlameRange from '../github/GithubBlameRange.vue'
import NodeFileTools from './NodeFileTools.vue'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { GlobalStore } from '@/stores/GlobalStore'
import type { Selected } from '../obsidian/SelectionBar.vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
import { mountNodePathDebugSource } from '@/node/NodePathDebugSource'
const props = defineProps<{
  context: DebugSourceContext
  repository?: RepositorySource
  revision?: string
  refresh?: () => Promise<void>
}>()
const emit = defineEmits<{
  reveal: [line: number]
  selection: [action: 'ask' | 'add' | 'note', selected: Selected & { path: string }]
}>()
const host = ref<HTMLElement>()
const root = ref<HTMLElement>()
const glyphHost = ref<HTMLElement>()
const blaming = ref(false)
const blameError = ref('')
const blameHosts = shallowRef<(BlameHost & { id: number })[]>([])
const blame = new Compartment()
let blameEditor: EditorView | undefined
let serial = 0
let hostId = 0
async function toggleBlame() {
  const request = ++serial
  blaming.value = !blaming.value
  blameError.value = ''
  try {
    let ranges
    try {
      ranges =
        blaming.value && props.repository && props.revision
          ? await props.repository.blame(props.revision, props.context.path)
          : []
    } catch (error) {
      if (
        !(error instanceof ChannelError) ||
        error.code !== 'stale_revision' ||
        !props.revision?.startsWith('working-') ||
        !props.refresh ||
        request !== serial
      )
        throw error
      console.debug('[debugger] Refreshing expired source before blame', props.context.path)
      await props.refresh()
      await nextTick()
      if (request !== serial || !props.repository || !props.revision) return
      ranges = await props.repository.blame(props.revision, props.context.path)
    }
    if (request !== serial || !host.value) return
    const element = host.value.querySelector<HTMLElement>('.cm-editor')
    const editor = element && EditorView.findFromDOM(element)
    if (!editor) return
    if (blameEditor !== editor) {
      editor.dispatch({ effects: StateEffect.appendConfig.of(blame.of([])) })
      blameEditor = editor
    }
    editor.dispatch({
      effects: blame.reconfigure(
        ranges.length
          ? blameGutter({
              ranges,
              add: (entry) => {
                blameHosts.value = [...blameHosts.value, { ...entry, id: ++hostId }]
              },
              remove: (element) => {
                blameHosts.value = blameHosts.value.filter((entry) => entry.element !== element)
              },
            })
          : []
      ),
    })
  } catch (error) {
    if (request === serial) blameError.value = presentUiError(error)
  }
}
function openCommit(sha: string) {
  const url = props.repository?.navigation.commit(sha)
  const target = url && parseNodeRepositoryLink(url)
  if (target) void openNodeRepositoryTarget(GlobalStore.getInstance().app, target)
}
let extension: ReturnType<typeof mountNodePathDebugSource> | undefined
onMounted(() => {
  if (host.value)
    extension = mountNodePathDebugSource(
      host.value,
      props.context,
      (line) => emit('reveal', line),
      (action, selected) => emit('selection', action, selected)
    )
})
watch(
  () => props.context.text,
  (text) => {
    ++serial
    blaming.value = false
    extension?.update(text)
  }
)
watch(
  () => props.context.line,
  (line) => {
    if (line) extension?.reveal(line)
  }
)
onBeforeUnmount(() => {
  ++serial
  extension?.destroy()
})
</script>
