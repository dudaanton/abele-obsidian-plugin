<template>
  <!-- In a setting row's controls, only the way back, and only once the chat has its own
       value: the row says what the setting is, the glyph that it is this chat's. -->
  <Icon
    v-if="compact"
    v-show="agentName && isOverridden"
    class="abele-override-notice__reset"
    icon="rotate-ccw"
    :tooltip="t('streamB.thisChatSOwnSettingFollowAgain.1f60fd', { v0: String(agentName) })"
    @click="reset"
  />
  <div v-else-if="agentName" class="abele-override-notice setting-item-description">
    <span class="abele-override-notice__text">
      {{ isOverridden ? overridden : fromAgent }}
    </span>
    <Icon
      v-if="isOverridden && showReset"
      class="abele-override-notice__reset"
      icon="undo-2"
      :tooltip="t('streamB.dropThisChatSOwnSettingAnd.942697', { v0: String(agentName) })"
      @click="reset"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
const props = withDefaults(
  defineProps<{
    field: OverrideKey
    fromAgent?: string
    /** Only the reset glyph, for a setting row's controls. */
    compact?: boolean
    overridden?: string
    showReset?: boolean
  }>(),
  {
    fromAgent: '',
    overridden: () => t('streamB.overriddenForThisChat.82e726'),
    showReset: true,
    compact: false,
  }
)

const session = computed(() => ChatService.getInstance().activeSession.value)
const agentName = computed(() => session.value?.agent.value?.name ?? '')
const isOverridden = computed(() => {
  const current = session.value
  if (
    props.field === 'permissionMode' &&
    current?.permissionMode.value === current?.agent.value?.permissionMode
  )
    return false
  if (
    props.field === 'scope' &&
    current?.agent.value &&
    JSON.stringify(current.scopeResolver.entries.value) ===
      JSON.stringify(current.agent.value.scope) &&
    current.scopeResolver.fullVaultAccess.value === (current.agent.value.fullVaultAccess ?? false)
  )
    return false
  return current?.isOverridden(props.field) ?? false
})

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
  // Native description rows clip text; this row also contains a focusable reset action.
  overflow: visible;
  gap: var(--size-2-2);
  margin: 0;
  /* Native descriptions clip their contents; the reset action needs ring paint room. */
  padding: var(--size-4-1);
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
