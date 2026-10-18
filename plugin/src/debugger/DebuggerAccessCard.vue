<template>
  <RequestCard class="abele-debugger-access-card" :waiting="!decision">
    <strong>{{
      t('debuggerAccess.request', { folder: request.folder || t('debuggerAccess.chatFolder') })
    }}</strong>
    <span>{{ request.program }} · {{ debuggerAccessLabel(request.access) }}</span>
    <span class="setting-item-description">{{ t('debuggerAccess.scope') }}</span>
    <span v-if="decision" role="status">{{
      decision === 'allow' ? t('debuggerAccess.allowed') : t('debuggerAccess.denied')
    }}</span>
    <span v-else-if="expired" role="status">{{ t('debuggerAccess.expiredRequest') }}</span>
    <div v-else class="abele-debugger-access-card__actions">
      <Button
        :text="t('debuggerAccess.allow')"
        accent
        :disabled="disabled"
        @click="emit('decide', 'allow')"
      />
      <Button
        :text="t('debuggerAccess.deny')"
        :disabled="disabled"
        @click="emit('decide', 'deny')"
      />
    </div>
  </RequestCard>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import RequestCard from '@/components/obsidian/RequestCard.vue'
import Button from '@/components/obsidian/Button.vue'
import { useDisplayClock } from '@/composables/useDisplayClock'
import type { DebuggerAccessRequest } from './access'
import { debuggerAccessLabel } from './access'
import { useI18n } from '@/i18n/useI18n'
const { t } = useI18n()
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
