<template>
  <NodePanel
    :phase="phase"
    :node="node"
    :empty="!model?.folders.value.length"
    :here="model?.currentCopy.value?.branch ?? model?.currentFolder.value?.name"
    :git="model?.currentFolder.value?.git"
    :updated="node?.seen"
    :chat-available="model?.capabilities.value.includes('node_path_execution') ?? false"
    :error="error ?? model?.error.value"
    @connect="emit('connect')"
    @connect-other="emit('pair')"
    @open-folder="emit('open-folder')"
    @new-chat="emit('new-chat')"
    @history="emit('history')"
    @refresh="emit('refresh')"
    @retry="emit('retry')"
    @menu="emit('node-menu', $event)"
    @copy="emit('copy', $event)"
  >
    <!-- The panel's modes stand in its header, as the file explorer's buttons do; what stood
         there as glyphs is in the place's menu. -->
    <template v-if="model?.current.value" #nav>
      <NodeModes
        v-model:mode="model.panelMode.value"
        header
        :git="git"
        :pulls="git"
        :changes="changeCount"
        :open-pulls="pulls?.pulls.length ?? 0"
      />
    </template>
    <template v-if="model">
      <NodePlace
        :node="node?.name ?? 'the node'"
        :folder="model.currentFolder.value?.name"
        :branch="git ? model.currentCopy.value?.branch : undefined"
        :busy="model.busy.value"
        @pick="emit('pick-place')"
        @menu="emit('place-menu', $event)"
      />
      <div v-if="!model.current.value" class="search-empty-state">
        Choose a folder on {{ node?.name ?? 'the node' }} in the row above.
      </div>
      <FileTree
        v-else-if="mode === 'files' || mode === 'changes'"
        :key="`${model.current.value?.id}:${mode}`"
        :entries="model.entries.value"
        :cursors="model.treeCursors.value"
        :progress="model.treeProgress.value"
        :changes="model.changes.value"
        :mode="mode === 'files' ? 'all' : 'changed-tree'"
        :modes="false"
        :git="git"
        :stale="node?.status !== 'connected'"
        :selected="file"
        :label="`Files of ${model.currentCopy.value?.branch ?? model.currentFolder.value?.name}`"
        @retry="model.refreshCurrent().catch((error) => model.report(error))"
        @expand="(path) => model.loadFolder(path).catch((error) => model.report(error))"
        @more="(path) => model.loadMore(path).catch((error) => model.report(error))"
        @open="(path, stage) => emit('open-file', path, stage === 'committed' ? undefined : stage)"
        @menu="(event, path) => emit('file-menu', event, path)"
      />
      <div v-else-if="mode === 'history'" class="abele-node-sidebar__history">
        <div v-if="history?.error.value" class="abele-node-sidebar__error" role="alert">
          {{ history.error.value }}
        </div>
        <HistoryView
          :commits="history?.commits.value ?? []"
          :copy="model.currentCopy.value"
          :head="false"
          :more="!!history?.cursor.value"
          :base="model.inspection.value?.base"
          @open-commit="(hash) => emit('open-commit', hash)"
          @more="history?.load(true).catch((error) => model?.report(error))"
        />
      </div>
      <NodePullList
        v-else
        :pulls="pulls?.pulls ?? []"
        :connected="pulls?.connected ?? false"
        :remote="!!pulls?.remote"
        @open="(n) => emit('open-pull', n)"
        @connect="emit('connect-service')"
      />
    </template>
  </NodePanel>
</template>
<script setup lang="ts">
// The node's side panel: one place (a folder and its branch) chosen from a row that opens the
// search of all of them, and the place's files, changes, history or pull requests under it.
import { computed, watch } from 'vue'
import type { NodePathModel } from '@/node/NodePathModel'
import NodePanel from './NodePanel.vue'
import NodePlace from './NodePlace.vue'
import NodeModes from './NodeModes.vue'
import NodePullList from './NodePullList.vue'
import FileTree from './FileTree.vue'
import HistoryView from './HistoryView.vue'
import type { NodeSummary } from './types'
const props = withDefaults(
  defineProps<{
    model?: NodePathModel
    phase: 'looking' | 'found' | 'connecting' | 'not-found' | 'remote' | 'ready'
    node?: NodeSummary
    file?: string
    error?: string
  }>(),
  { model: undefined, node: undefined, file: undefined, error: undefined }
)
const emit = defineEmits<{
  connect: []
  pair: []
  'open-folder': []
  'new-chat': []
  history: []
  refresh: []
  retry: []
  'node-menu': [event: MouseEvent]
  copy: [text: string]
  'pick-place': []
  'place-menu': [event: MouseEvent]
  'open-file': [path: string, stage?: 'staged' | 'unstaged']
  'file-menu': [event: MouseEvent, path: string]
  'open-commit': [hash: string]
  'open-pull': [number: number]
  'connect-service': []
}>()
const git = computed(() => props.model?.currentFolder.value?.git ?? false)
/** A folder without git has its files only, whatever mode was last chosen. */
const mode = computed(() => (git.value ? props.model?.panelMode.value : 'files'))
const changeCount = computed(
  () => new Set((props.model?.changes.value ?? []).map((c) => c.path)).size
)
const history = computed(() => props.model?.panelHistory.value)
const pulls = computed(() => props.model?.panelPulls.value)
// History and pull requests are read when their mode is shown, for the place shown.
watch(
  () => [props.model, mode.value, props.model?.current.value?.id] as const,
  ([model, shown]) => {
    if (!model) return
    if (shown === 'history') void model.loadPanelHistory().catch((e) => model.report(e))
    if (shown === 'pulls') void model.loadPanelPulls().catch((e) => model.report(e))
  },
  { immediate: true }
)
</script>
<style lang="scss">
.abele-node-sidebar__error {
  padding: var(--size-4-2);
  color: var(--text-error);
  overflow-wrap: anywhere;
}
// The place, then a step, then the mode's content to the foot.
.abele-node-sidebar .abele-node-place {
  padding-top: var(--size-4-2);
}
.abele-node-sidebar__history,
.abele-node-sidebar .abele-node-pulls {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: var(--size-4-4);
}
// Room at the sides, so a commit's light is not cut by the scrolling edge.
.abele-node-sidebar__history {
  padding-inline: var(--size-4-2);
}
// On a computer the panel itself does not scroll: its header, the place and the files' search
// stay where they are, and only the files under them move, as the file explorer keeps its header.
.abele-node-sidebar .abele-file-tree {
  flex: 1;
  min-height: 0;
}
.abele-node-sidebar .abele-file-tree__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
// One hairline in the panel, where the files start to scroll under the header. The header's
// groups (place, its action, the search) stand a step apart; inside a group things touch.
.abele-node-sidebar .abele-file-tree__bar {
  padding-top: var(--size-4-4);
  border-top: none;
  border-bottom: var(--border-width) solid var(--background-modifier-border);
}
// A phone's drawer is too short to hold the header and the place still with room for files
// under them: there the whole panel scrolls and only the files' search stays, at the top, so it
// can always be reached. The drawer then pads the end of the panel clear of its floating buttons.
body.is-phone .abele-node-sidebar {
  .abele-node-panel {
    height: auto;
  }

  .abele-file-tree {
    flex: none;
  }

  .abele-file-tree__body {
    overflow: visible;
  }

  .abele-file-tree__bar {
    position: sticky;
    top: 0;
    z-index: 1;
    // The drawer's own colour, so the files passing under it do not show through.
    background-color: var(--mobile-sidebar-background, var(--background-secondary));
  }
}
.abele-node-sidebar .abele-node-panel {
  height: 100%;
}
</style>
