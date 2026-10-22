<template>
  <div
    class="abele-node-tool-permissions abele-node-tool-permissions_quiet"
    data-codex-network-refusal
  >
    <div class="abele-node-tool-permissions__reason" role="alert">
      <span>{{ label }}</span>
    </div>
    <Button
      v-if="network?.supported && !network.enabled.value"
      :text="t('streamB.codexNetworkEnable')"
      :disabled="offline || network.busy.value"
      @click="enable"
    />
    <NodeErrorText v-if="error" :error="error" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import { NodeService } from '@/node/NodeService'
import { codexProjectNetwork } from '@/node/codexNetwork'
import Button from './obsidian/Button.vue'
import NodeErrorText from './NodeErrorText.vue'
const props = defineProps<{ nodeId?: string; projectId?: string; project?: string }>()
const error = ref('')
const connection = computed(() => {
  const service = NodeService.getInstance()
  const node = service.nodes.value.find(
    (n) => n.id === props.nodeId || n.expectedNodeId === props.nodeId
  )
  return node ? service.connection(node.id) : undefined
})
const network = computed(() =>
  props.projectId && connection.value
    ? codexProjectNetwork(connection.value.client, props.projectId)
    : undefined
)
const offline = computed(() => connection.value?.state.value !== 'connected')
watch(
  [network, offline],
  () => {
    if (network.value && !offline.value)
      void network.value.load().catch((e: unknown) => {
        error.value = e instanceof Error ? e.message : t('streamB.nodeActionFailed.35c41e')
      })
  },
  { immediate: true }
)
const label = computed(() =>
  network.value?.enabled.value
    ? t('streamB.codexNetworkRetry')
    : !network.value?.supported
      ? t('streamB.codexNetworkOwner')
      : t('streamB.codexNetworkRefusal', {
          project: props.project || network.value.name.value || props.projectId || '',
        })
)
async function enable() {
  error.value = ''
  try {
    await network.value?.set(true)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>
<style scoped>
.abele-node-tool-permissions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-1);
  margin: 0;
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
</style>
