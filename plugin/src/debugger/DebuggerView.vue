<template>
  <div class="abele-debug-view">
    <DrawerViewSwitch v-if="!binding" icon="bug-play" :name="t('streamC.1a03bd2fd107c453')" />
    <EmptyState
      v-if="!binding"
      icon="bug"
      :title="t('streamC.50fc3bac49e8e935')"
      :text="t('debug.empty')"
    />
    <template v-else>
      <div v-if="peers.length" class="abele-debug-view__sessions">
        <Dropdown
          :model-value="binding.sessionId ?? ''"
          :options="
            peers.map((peer) => ({
              value: peer.sessionId!,
              display: `${peer.controller.session.program} · ${peerState(peer)} · ${peer.sessionId?.slice(0, 8)}`,
            }))
          "
          :aria-label="t('streamC.95b22255ddc6fba2')"
          @update:model-value="chooseSession"
        />
      </div>
      <div v-if="error" class="abele-debug-view__error" role="alert">
        <NodeErrorText :error="error" />
      </div>
      <DebugPanel
        :session="session!"
        :exception-filters="binding.controller.exceptionFilters"
        :exceptions-available="exceptionsAvailable"
        :mode-available="!!binding.controller.grantId"
        :mode-unavailable-reason="binding.controller.modeUnavailableReason"
        :busy="busy"
        :recording="recording"
        :runs="runs"
        :open-run="openRunId"
        :restart-available="!!binding.rerun"
        :reattach-available="!!binding.reattach"
        @open-run="openRunTab"
        @run-menu="(id, e) => runMenu(binding!, id, e)"
        @show-folder="folderMenu(binding!)"
        @browser-menu="browserMenu"
        @command="command($event)"
        @mode="run(() => binding!.controller.setMode($event))"
        @frame="selectFrame"
        @inspect="run(() => binding!.controller.inspect($event))"
        @open-value="openValue"
        @watch="run(() => binding!.controller.watch($event))"
        @unwatch="run(() => binding!.controller.unwatch($event))"
        @breakpoint="breakpoint"
        @breakpoint-menu="breakpointMenu"
        @remove-breakpoints="run(() => binding!.controller.removeAllBreakpoints())"
        @exceptions="run(() => binding!.controller.setExceptionFilters($event))"
        @reveal="(file, line) => service.reveal(binding!, file, line)"
        @retry="retry"
      >
        <template #approvals>
          <DebugActionCard
            v-for="action in actions"
            :key="action.id"
            :action="action"
            :disabled="!binding.controller.current || deciding.has(action.id)"
            @allow="decide(action.id, true)"
            @deny="decide(action.id, false)"
          />
        </template>
      </DebugPanel>
    </template>
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'

import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import DebugActionCard from '@/components/debugger/DebugActionCard.vue'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import { DebuggerService, type DebuggerBinding } from './DebuggerService'
import { openDebugValue } from './DebugValueTab'
import { browserMenu, folderMenu, openRun, runMenu, marginMenu } from './trace/panel'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'
const service = DebuggerService.instance
const binding = service.active
function peerState(peer: DebuggerBinding) {
  const session = peer.controller.session
  return session.status === 'paused'
    ? t('streamC.e159b06187d369a0')
    : session.status === 'running'
      ? t('streamC.f4ccae29e1bb0c20')
      : session.status === 'starting'
        ? t('streamC.bbe5fc3b9ef39f99')
        : session.status === 'exited'
          ? session.detached && session.attached
            ? t('streamC.4fc04649a9497a39')
            : session.exitCode === undefined
              ? t('streamC.a35ec6a4c0b7f680')
              : t('streamC.c0d03c6c706a16bc', { v1: String(session.exitCode) })
          : t('streamC.24b289c6dcaf78b5', { v1: session.seen ?? '' })
}
const peers = computed(() => {
  if (!binding.value) return []
  const peers = service
    .peers(binding.value)
    .sort(
      (a, b) =>
        Number(a.controller.session.status === 'exited') -
        Number(b.controller.session.status === 'exited')
    )
  for (const peer of peers) void peer.revision.value
  return peers.length > 1 ? peers : []
})
async function chooseSession(sessionId: string) {
  const peer = peers.value.find((peer) => peer.sessionId === sessionId)
  if (!peer) return
  const owner = service.owner(peer)
  if (!owner || !peer.sessionId) return
  const { showSession } = await import('./register')
  await showSession(owner, peer.sessionId)
}
const exceptionsAvailable = computed(
  () =>
    !!binding.value &&
    nodeAdvertisesMethod(binding.value.connection?.client, 'debugger.v1.exceptionBreakpoints.set')
)
function breakpointMenu(file: string, line: number, event: MouseEvent) {
  const b = binding.value
  const point = b?.controller.knownBreakpoints().find((p) => p.file === file && p.line === line)
  if (b && point) marginMenu(b, point.sourceId, line, event)
}
const actions = computed(() => {
  binding.value?.revision.value
  return (binding.value?.controller.actions ?? [])
    .filter(
      (action, index, all) =>
        action.status === 'asked' ||
        action.status === 'unknown' ||
        (action.status !== 'done' && index === all.length - 1)
    )
    .map((action) => ({ ...action }))
})
const deciding = reactive(new Set<string>())
async function decide(id: string, allow: boolean) {
  const b = binding.value
  if (!b || deciding.has(id)) return
  deciding.add(id)
  try {
    await b.controller.decide(id, allow)
    await b.refresh()
  } catch (error) {
    b.fail(error)
  } finally {
    deciding.delete(id)
  }
}
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
function selectFrame(index: number) {
  const b = binding.value
  if (!b) return
  void run(async () => {
    const epoch = b.controller.snapshot?.stop_epoch
    const incarnation = b.controller.snapshot?.incarnation
    await b.controller.selectFrame(index)
    if (
      binding.value !== b ||
      !b.controller.current ||
      b.controller.snapshot?.stop_epoch !== epoch ||
      b.controller.snapshot?.incarnation !== incarnation
    )
      return
    const frame = b.controller.session.frames[index]
    if (frame) service.reveal(b, frame.file, frame.line)
  })
}
function command(action: string) {
  const b = binding.value
  if (!b) return
  if (action === 'reattach' && b.reattach) return void run(b.reattach)
  if (action !== 'restart' || !b.rerun) return void run(() => b.controller.command(action))
  // Restart stops a program still going, then starts it again with its points.
  void run(b.rerun)
}
function breakpoint(file: string, line: number) {
  const b = binding.value
  const point = b?.controller.knownBreakpoints().find((p) => p.file === file && p.line === line)
  if (!b || !point) return
  // A record point goes with what it takes; a breakpoint is only taken off.
  if (b.trace?.points.some((p) => p.breakpoint_id === point.id))
    void run(() => b.trace?.removePoint(point.id) ?? Promise.resolve())
  else void run(() => b.controller.removeBreakpoint(point.id))
}
function retry() {
  const b = binding.value
  console.debug('[debugger] Reconnect requested', b?.sessionId)
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
.abele-debug-view__sessions {
  padding: var(--size-4-2) var(--size-4-3);
}
</style>
