<template>
  <div class="abele-node-debugger-access">
    <Section v-if="model.error">
      <template #actions>
        <Icon
          icon="rotate-cw"
          :tooltip="t('debuggerAccess.refreshRequests')"
          :disabled="offline || model.busy"
          @click="refresh"
        />
      </template>
    </Section>
    <p
      v-if="presenter.debuggerAvailable.value && !model.supported"
      class="setting-item-description"
    >
      {{ t('debuggerAccess.updateNode') }}
    </p>
    <DebuggerAccessCard
      v-for="request in requests"
      :key="request.request_id"
      :request="request"
      :decision="model.decisions[request.request_id]"
      :disabled="offline || model.busy"
      @decide="model.decide(request.request_id, $event)"
    />
    <p v-if="model.error" role="alert">{{ model.error }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, reactive, watch, onUnmounted } from 'vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { DebuggerAccess } from './access'
import { useI18n } from '@/i18n/useI18n'
const { t } = useI18n()
import DebuggerAccessCard from './DebuggerAccessCard.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Section from '@/components/obsidian/Section.vue'
const props = defineProps<{ presenter: NodeChatPresenter }>()
const model = reactive(
  new DebuggerAccess((method, params) => props.presenter.connection.client.request(method, params))
)
const offline = computed(() => props.presenter.connection.state.value !== 'connected')
const requests = computed(() =>
  model.requests.filter((r) => r.conversation_id === props.presenter.reference.sessionId)
)
let disposed = false
let loading = false
let dirty = false
async function refresh() {
  dirty = true
  if (loading || offline.value || disposed) return
  loading = true
  try {
    while (dirty && !disposed && !offline.value) {
      dirty = false
      await model.load(props.presenter.nodeDescription.value)
    }
  } catch (error) {
    model.error = error instanceof Error ? error.message : t('debuggerAccess.unavailable')
  } finally {
    loading = false
  }
}
const stop = props.presenter.connection.client.onEvent((event) => {
  const kind = (event.data as { update?: { kind?: string } } | undefined)?.update?.kind
  if (
    (event.type === 'session.update' && kind === 'debugger_access_requested') ||
    event.type === 'turn.completed'
  )
    void refresh()
})
watch(
  () => [props.presenter.nodeDescription.value, offline.value],
  () => void refresh(),
  { immediate: true }
)
onUnmounted(() => {
  disposed = true
  stop()
})
</script>
<style lang="scss">
.abele-node-debugger-access {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
</style>
