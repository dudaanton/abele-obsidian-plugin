<template>
  <div v-if="actions.length" class="abele-node-debug-actions">
    <DebugActionCard
      v-for="action in actions"
      :key="action.id"
      :action="action"
      :disabled="!current || busy.has(action.id)"
      @allow="decide(action.id, true)"
      @deny="decide(action.id, false)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { DebuggerService } from './DebuggerService'
import DebugActionCard from '@/components/debugger/DebugActionCard.vue'
const props = withDefaults(
  defineProps<{ presenter: NodeChatPresenter; after?: number; before?: number }>(),
  { after: -Infinity, before: Infinity }
)
const binding = DebuggerService.instance.binding(props.presenter)
const actions = computed(() => {
  binding.revision.value
  return (
    binding.controller.actions
      .filter(
        (a) => (a.timestamp ?? Infinity) >= props.after && (a.timestamp ?? Infinity) < props.before
      )
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      // The protocol controller is plain data; fresh card props carry each revision into Vue.
      .map((action) => ({ ...action }))
  )
})
const current = computed(() => {
  binding.revision.value
  return binding.controller.current
})
const busy = reactive(new Set<string>())
async function decide(id: string, allow: boolean) {
  busy.add(id)
  try {
    await binding.controller.decide(id, allow)
    await binding.refresh()
  } catch (e) {
    binding.fail(e)
  } finally {
    busy.delete(id)
  }
}
</script>
<style>
.abele-node-debug-actions {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin: var(--size-4-2) var(--size-4-3);
}
</style>
