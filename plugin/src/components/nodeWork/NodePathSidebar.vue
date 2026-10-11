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
    <template v-if="model">
      <FolderTree
        :folders="model.folders.value"
        :selected="model.selected.value"
        :selected-chat="model.selectedChat.value"
        :stale="node?.status !== 'connected'"
        @select="emit('select', $event)"
        @open-chat="emit('open-chat', $event)"
        @menu="(event, id) => emit('row-menu', event, id)"
      >
        <template #actions="{ id }">
          <Icon
            icon="more-horizontal"
            size="xs"
            tooltip="Folder menu"
            @click="emit('row-menu', $event, id)"
          />
        </template>
      </FolderTree>
      <MetaLine
        v-if="model.currentCopy.value"
        class="abele-node-sidebar__facts"
        :facts="[
          {
            key: 'lastCommit',
            label: 'Last commit',
            value: model.currentCopy.value.lastCommit,
            required: true,
          },
          { key: 'ahead', value: model.currentCopy.value.ahead, required: true },
          { key: 'behind', value: model.currentCopy.value.behind, required: true },
        ]"
      />
      <FileTree
        :key="model.current.value?.id"
        :entries="model.entries.value"
        :changes="model.changes.value"
        :mode="model.mode.value"
        :git="model.currentFolder.value?.git ?? false"
        :stale="node?.status !== 'connected'"
        :selected="file"
        @update:mode="model.mode.value = $event"
        @open="(path, stage) => emit('open-file', path, stage)"
        @menu="(event, path) => emit('file-menu', event, path)"
      />
    </template>
  </NodePanel>
</template>
<script setup lang="ts">
import type { NodePathModel } from '@/node/NodePathModel'
import NodePanel from './NodePanel.vue'
import FolderTree from './FolderTree.vue'
import FileTree from './FileTree.vue'
import Icon from '../obsidian/Icon.vue'
import MetaLine from '../obsidian/MetaLine.vue'
import type { NodeSummary } from './types'
withDefaults(
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
  select: [id: string]
  'open-chat': [id: string]
  'row-menu': [event: MouseEvent, id: string]
  'open-file': [path: string, stage?: 'staged' | 'unstaged']
  'file-menu': [event: MouseEvent, path: string]
}>()
</script>
<style lang="scss">
.abele-node-sidebar__facts {
  padding: var(--size-4-1) var(--size-4-3);
}
.abele-node-sidebar__error {
  padding: var(--size-4-2);
  color: var(--text-error);
  overflow-wrap: anywhere;
}
.abele-node-sidebar .abele-file-tree {
  flex: 1;
  min-height: 0;
}
.abele-node-sidebar .abele-folder-tree {
  flex: 0 0 auto;
  max-height: 45%;
  overflow: auto;
}
.abele-node-sidebar .abele-node-panel {
  height: 100%;
}
</style>
