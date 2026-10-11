<template>
  <div class="abele-debug-view">
    <EmptyState
      v-if="!binding"
      text="No debug session. Open Debug from a node chat to select a session."
    />
    <template v-else>
      <div v-if="error" class="abele-debug-view__error" role="alert">{{ error }}</div>
      <DebugPanel
        :session="session!"
        :mode-available="!!binding.controller.grantId"
        :mode-unavailable-reason="binding.controller.modeUnavailableReason"
        :busy="busy"
        @command="run(() => binding!.controller.command($event))"
        @mode="run(() => binding!.controller.setMode($event))"
        @frame="run(() => binding!.controller.selectFrame($event))"
        @inspect="run(() => binding!.controller.inspect($event))"
        @watch="run(() => binding!.controller.watch($event))"
        @unwatch="run(() => binding!.controller.unwatch($event))"
        @breakpoint="breakpoint"
        @reveal="(file, line) => service.reveal(binding!, file, line)"
        @retry="retry"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { DebuggerService } from './DebuggerService'
const service = DebuggerService.instance
const binding = service.active
const session = computed(() => {
  binding.value?.revision.value
  return binding.value ? { ...binding.value.controller.session } : undefined
})
const error = computed(() => {
  binding.value?.revision.value
  return binding.value?.controller.error
})
const busy = ref(false)
async function run(work: () => Promise<unknown>) {
  if (busy.value || !binding.value) return
  busy.value = true
  try {
    await work()
    await binding.value.refresh()
  } catch (e) {
    binding.value?.fail(e)
  } finally {
    busy.value = false
  }
}
function breakpoint(file: string, line: number) {
  const b = binding.value
  const point = b?.controller.snapshot?.breakpoints.find(
    (p) =>
      (b.controller.path(p.source_id) ?? p.source_id) === file &&
      (p.resolved_line ?? p.line) === line
  )
  if (b && point) void run(() => b.controller.toggleBreakpoint(point.source_id, point.line))
}
function retry() {
  const b = binding.value
  if (b?.sessionId)
    void b.connection
      .connect()
      .then(() => b.open(b.sessionId))
      .catch((e) => b.fail(e))
}
</script>
<style>
.abele-debug-view {
  height: 100%;
  overflow: auto;
  min-width: 0;
}
.abele-debug-view__error {
  padding: var(--size-4-2) var(--size-4-3);
  color: var(--text-error);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}
</style>
