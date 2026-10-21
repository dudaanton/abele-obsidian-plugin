<template>
  <p class="abele-node-tool-permissions">
    <span>{{ permissionLabel(policy) }}</span>
    <span v-if="refusal">{{ refusal }}</span>
    <Button
      v-if="refusal && nodeId"
      plain
      :text="t('streamB.permissionOpenSettings')"
      @click="openNodeAgentSettings(nodeId, nodeLabel, provider)"
    />
  </p>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { permissionLabel, permissionRefusal, type ToolPermissions } from '@/node/toolPermissions'
import { openNodeAgentSettings } from '@/node/openNodeAgentSettings'
import Button from './obsidian/Button.vue'
const props = defineProps<{
  policy?: ToolPermissions
  reason?: string | null
  nodeId?: string
  nodeLabel: string
  provider: string
}>()
const refusal = computed(
  () => permissionRefusal(props.reason) || permissionRefusal(props.policy?.reason)
)
</script>

<style scoped>
.abele-node-tool-permissions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-block: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
