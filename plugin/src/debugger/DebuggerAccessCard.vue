<template>
  <RequestCard class="abele-debugger-access-card" :waiting="!decision">
    <strong>Let the agent use the debugger in {{ request.folder || 'this chat’s folder' }}</strong>
    <span>{{ request.program }} · {{ request.access }}</span>
    <span class="setting-item-description"
      >This run and program only. Expressions still require separate approval.</span
    >
    <span v-if="decision" role="status">{{
      decision === 'allow'
        ? 'Debugger access allowed. The agent can retry its call.'
        : 'Debugger access denied.'
    }}</span>
    <span v-else-if="expired" role="status">This request expired. Ask the agent to try again.</span>
    <div v-else class="abele-debugger-access-card__actions">
      <Button text="Allow" :disabled="disabled" @click="emit('decide', 'allow')" />
      <Button text="Deny" :disabled="disabled" @click="emit('decide', 'deny')" />
    </div>
  </RequestCard>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import RequestCard from '@/components/obsidian/RequestCard.vue'
import Button from '@/components/obsidian/Button.vue'
import { useDisplayClock } from '@/composables/useDisplayClock'
import type { DebuggerAccessRequest } from './access'
const props = defineProps<{
  request: DebuggerAccessRequest
  disabled?: boolean
  decision?: 'allow' | 'deny'
}>()
const emit = defineEmits<{ (e: 'decide', decision: 'allow' | 'deny'): void }>()
const now = useDisplayClock('second', () => !props.decision)
const expired = computed(() => Date.parse(props.request.expires_at) <= now.value)
</script>
<style lang="scss">
.abele-debugger-access-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}
</style>
