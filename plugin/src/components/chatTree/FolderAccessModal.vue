<template>
  <!-- A folder's access: the same tools tree as a chat's, for every chat in the folder. It only
       adds: what the default gives is the least each tool can be. -->
  <ObsidianModal :title="name" size="tall" modal-class="abele-folder-access" @close="emit('close')">
    <p class="abele-folder-access__about setting-item-description">
      {{ t('chatTree.accessHint') }}
    </p>
    <AiNodeScopeEditor v-if="nodeScopeOwner" :session="nodeScopeOwner" folder />
    <ChatToolModes
      :tool-modes="modes"
      :floor="floor"
      :autofocus="!nodeScopeOwner"
      @update-many="(m) => emit('update', m)"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed } from 'vue'
import { withFolderAccess } from '@/chats/chatTree'
import ObsidianModal from '../obsidian/Modal.vue'
import ChatToolModes from '../ChatToolModes.vue'
import AiNodeScopeEditor from '../AiNodeScopeEditor.vue'
import type { NodeScopeOwner } from '@/ai/tools/node/owner'
import type { ToolMode } from '@/ai/types'

const props = defineProps<{
  name: string
  /** What the default gives each tool. */
  floor: Record<string, ToolMode>
  /** What the folder raised. */
  access: Record<string, ToolMode>
  nodeScopeOwner?: NodeScopeOwner
}>()
const emit = defineEmits<{ close: []; update: [modes: Record<string, ToolMode>] }>()

const modes = computed(
  () =>
    withFolderAccess(props.floor, [
      { kind: 'folder', path: '', name: '', children: [], access: props.access },
    ]).modes
)
</script>

<style lang="scss">
.abele-folder-access__about {
  flex: none;
  margin: 0 0 var(--size-4-2);
}
</style>
