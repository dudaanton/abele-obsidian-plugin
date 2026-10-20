<template>
  <div class="abele-permissions-modal">
    <ChatToolModes
      v-if="session"
      :tool-modes="session.toolModes.value"
      :raised-by="session.folderToolAccess?.value.raisedBy"
      :floor="session.folderToolFloor?.value"
      @update-many="onUpdateMany"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChatToolModes from './ChatToolModes.vue'
import { ChatService } from '@/ai/ChatService'
import type { ToolMode } from '@/ai/types'

const session = computed(() => ChatService.getInstance().activeSession.value)

const onUpdateMany = (modes: Record<string, ToolMode>) => {
  const s = session.value
  if (!s) return
  s.toolModes.value = { ...(s.ownToolModes?.value ?? s.toolModes.value), ...modes }
}
</script>
