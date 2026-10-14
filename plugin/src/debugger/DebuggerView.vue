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
        :recording="recording"
        :runs="runs"
        :open-run="openRunId"
        :restart-available="!!binding.rerun"
        @open-run="openRunTab"
        @run-menu="(id, e) => runMenu(binding!, id, e)"
        @show-folder="folderMenu(binding!)"
        @browser-menu="browserMenu"
        @command="command($event)"
        @mode="run(() => binding!.controller.setMode($event))"
        @frame="run(() => binding!.controller.selectFrame($event))"
        @inspect="run(() => binding!.controller.inspect($event))"
        @open-value="openValue"
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
import { computed, onBeforeUnmount, ref } from 'vue'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { DebuggerService } from './DebuggerService'
import { openDebugValue } from './DebugValueTab'
import { browserMenu, folderMenu, openRun, runMenu } from './trace/panel'
const service = DebuggerService.instance
const binding = service.active
const session = computed(() => {
  binding.value?.revision.value
  const b = binding.value
  if (!b) return undefined
  const trace = b.trace
  const s = { ...b.controller.session }
  if (!trace) return s
  // A stop on record points only lasts as long as the values take: it reads as running.
  return {
    ...s,
    breakpoints: trace.breakpoints(),
    ...(s.status === 'paused' && trace.isRecordStop() ? { status: 'running' as const } : {}),
  }
})
// While a run is written its time goes on by the second.
const now = ref(Date.now())
const clock = window.setInterval(() => {
  if (binding.value?.trace?.status?.recording) now.value = Date.now()
}, 1000)
onBeforeUnmount(() => window.clearInterval(clock))
const recording = computed(() => {
  binding.value?.revision.value
  return binding.value?.trace?.recording(now.value)
})
const runs = computed(() => {
  binding.value?.revision.value
  return binding.value?.trace?.summaries()
})
const openRunId = ref<string>()
function openRunTab(id: string) {
  openRunId.value = id
  if (binding.value) openRun(binding.value, id)
}
const error = computed(() => {
  binding.value?.revision.value
  return binding.value?.controller.error
})
const busy = ref(false)
function openValue(name: string, value: string, type?: string) {
  void openDebugValue(name, value, type).catch((e) => binding.value?.fail(e))
}
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
function command(action: string) {
  const b = binding.value
  if (!b) return
  if (action !== 'restart' || !b.rerun) return void run(() => b.controller.command(action))
  // Restart stops a program still going, then starts it again with its points.
  void run(b.rerun)
}
function breakpoint(file: string, line: number) {
  const b = binding.value
  const point = b?.controller.snapshot?.breakpoints.find(
    (p) =>
      (b.controller.path(p.source_id) ?? p.source_id) === file &&
      (p.resolved_line ?? p.line) === line
  )
  if (!b || !point) return
  // A record point goes with what it takes; a breakpoint is only taken off.
  if (b.trace?.points.some((p) => p.breakpoint_id === point.breakpoint_id))
    void run(() => b.trace?.removePoint(point.breakpoint_id) ?? Promise.resolve())
  else void run(() => b.controller.toggleBreakpoint(point.source_id, point.line))
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
