<template>
  <ObsidianModal title="Tool Permissions" @close="emit('close')">
    <div class="abele-permissions-modal">
      <AgentOverrideNotice
        field="toolModes"
        from-agent="Tool modes come from this chat's agent."
        overridden="Tool modes are overridden for this chat."
      />
      <ToolModesEditor v-if="session" :tool-modes="session.toolModes.value" @update="onUpdate" />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import ToolModesEditor from './ToolModesEditor.vue'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import { ChatService } from '@/ai/ChatService'
import type { ToolMode } from '@/ai/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const session = computed(() => ChatService.getInstance().activeSession.value)

const onUpdate = (toolName: string, mode: ToolMode) => {
  const s = session.value
  if (!s) return
  s.toolModes.value = { ...s.toolModes.value, [toolName]: mode }
}
</script>

<style lang="scss">
.modal:has(.abele-permissions-modal) {
  width: min(500px, 90vw);
}
</style>
