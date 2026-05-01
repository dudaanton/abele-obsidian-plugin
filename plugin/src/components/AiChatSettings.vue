<template>
  <ObsidianModal title="Chat Settings" @close="emit('close')">
    <div class="abele-chat-settings">
      <Setting name="Hide reasoning" desc="Show only a spinner while the model is thinking.">
        <Checkbox :is-enabled="hideReasoning" @toggle="toggleHideReasoning" />
      </Setting>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import { AgentService } from '@/ai/AgentService'

const emit = defineEmits<{ close: [] }>()

const session = computed(() => AgentService.getInstance().activeSession.value)

const hideReasoning = computed(() => session.value?.hideReasoning.value ?? false)

const toggleHideReasoning = () => {
  if (session.value) {
    session.value.hideReasoning.value = !session.value.hideReasoning.value
  }
}
</script>

<style lang="scss">
.abele-chat-settings {
  padding: 8px 0;
}
</style>
