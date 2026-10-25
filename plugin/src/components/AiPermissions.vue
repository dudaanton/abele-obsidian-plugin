<template>
  <div class="abele-permissions-modal">
    <ChatToolModes
      v-if="session"
      :tool-modes="session.toolModes.value"
      :raised-by="session.folderToolAccess?.value.raisedBy"
      :floor="session.folderToolFloor?.value"
      :registry="registry"
      @update-many="onUpdateMany"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChatToolModes from './ChatToolModes.vue'
import { getToolRegistry } from '@/ai/tools'
import { NODE_GROUP } from '@/ai/toolSections'
import { ChatService } from '@/ai/ChatService'
import type { ToolMode } from '@/ai/types'

const session = computed(() => ChatService.getInstance().activeSession.value)
// What the agent may do on a node is set once, by each node folder on the Access tab.
const registry = getToolRegistry().filter((tool) => tool.category !== NODE_GROUP)

const onUpdateMany = (modes: Record<string, ToolMode>) => {
  const s = session.value
  if (!s) return
  s.toolModes.value = { ...(s.ownToolModes?.value ?? s.toolModes.value), ...modes }
}
</script>
