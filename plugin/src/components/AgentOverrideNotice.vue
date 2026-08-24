<template>
  <div v-if="agentName" class="abele-override-notice">
    <Icon :icon="isOverridden ? 'pencil' : 'bot'" no-hover />
    <span class="abele-override-notice__text">
      {{ isOverridden ? overridden : fromAgent }}
    </span>
    <Icon
      v-if="isOverridden"
      class="abele-override-notice__reset"
      icon="undo-2"
      :text-right="`Reset to ${agentName}`"
      @click="reset"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from './obsidian/Icon.vue'
import { ChatService } from '@/ai/ChatService'
import type { OverrideKey } from '@/ai/agents/types'

/**
 * Says whether a setting is the agent's or this chat's, and offers the way back.
 *
 * Without it a chat that narrowed its scope once looks identical to one following its agent,
 * and editing the agent would appear to do nothing.
 */
const props = defineProps<{
  field: OverrideKey
  fromAgent: string
  overridden: string
}>()

const session = computed(() => ChatService.getInstance().activeSession.value)
const agentName = computed(() => session.value?.agent.value?.name ?? '')
const isOverridden = computed(() => session.value?.isOverridden(props.field) ?? false)

function reset() {
  const s = session.value
  if (!s) return
  s.clearOverride(props.field)
  // The model pair is two fields but one choice, so resetting either resets both.
  if (props.field === 'modelId') s.clearOverride('providerId')
  s.save()
}
</script>

<style lang="scss">
.abele-override-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin-bottom: var(--size-4-2);
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  background: var(--background-secondary);
  color: var(--text-muted);
  font-size: var(--font-smallest);
}

.abele-override-notice__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-override-notice__reset {
  flex: 0 0 auto;
}
</style>
