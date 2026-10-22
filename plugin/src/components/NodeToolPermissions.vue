<template>
  <Icon
    v-if="policy && !hideMode"
    class="abele-node-tool-permissions__mode"
    :icon="policy.permission_mode === 'bypassPermissions' ? 'shield-off' : 'shield'"
    :tooltip="modeTooltip"
    :aria-label="modeTooltip"
  />
  <div
    v-if="refusal && !modeOnly"
    class="abele-node-tool-permissions"
    :class="{ 'abele-node-tool-permissions_quiet': quietReason }"
  >
    <div class="abele-node-tool-permissions__reason" role="alert">
      <StatusDot v-if="!quietReason" tone="red" :label="refusal" /><span :title="refusal">{{
        refusal
      }}</span>
    </div>
    <NodeBypassHelp v-if="needsNodeOptIn" />
    <Button
      v-if="nodeId"
      :text="t('streamB.permissionOpenSettings')"
      @click="
        openNodeAgentSettings(
          nodeId,
          nodeLabel,
          provider,
          needsNodeOptIn ? reason || policy?.reason : undefined
        )
      "
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { permissionLabel, permissionRefusal, type ToolPermissions } from '@/node/toolPermissions'
import { openNodeAgentSettings } from '@/node/openNodeAgentSettings'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import StatusDot from './obsidian/StatusDot.vue'
import NodeBypassHelp from './NodeBypassHelp.vue'
const props = defineProps<{
  policy?: ToolPermissions
  reason?: string | null
  nodeId?: string
  nodeLabel: string
  provider: string
  quietReason?: boolean
  modeOnly?: boolean
  hideMode?: boolean
}>()
const modeTooltip = computed(() =>
  props.modeOnly
    ? t('streamB.permissionModeHint', { mode: permissionLabel(props.policy) })
    : permissionLabel(props.policy)
)
const refusal = computed(() => {
  const reason = props.reason || props.policy?.reason
  return props.quietReason &&
    props.provider === 'codex' &&
    reason?.includes('interactive_approval_unsupported')
    ? t('streamB.delegationCodexRefused')
    : permissionRefusal(reason)
})
const needsNodeOptIn = computed(() =>
  /bypass.*(disabled|unsupported|not_allowed|not_enabled)|allow.bypass/.test(
    props.reason || props.policy?.reason || ''
  )
)
</script>
<style scoped>
.abele-node-tool-permissions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-2);
  margin-block: var(--size-4-1);
  font-size: var(--font-ui-small);
}
.abele-node-tool-permissions_quiet {
  margin: 0;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-node-tool-permissions__reason {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;
  max-width: 100%;
}
.abele-node-tool-permissions__reason span {
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
}
.abele-node-tool-permissions__mode {
  display: inline-flex;
  vertical-align: middle;
  margin-inline-start: var(--size-4-1);
}
</style>
