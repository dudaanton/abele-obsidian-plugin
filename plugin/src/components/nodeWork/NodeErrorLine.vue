<template>
  <StateLine
    :tone="state.tone"
    :text="text || state.text"
    :pulse="state.pulse"
    :action="actionLabel"
    :disabled="busy || disabled"
    :details="facts"
    :log="logAvailable"
    :footer="footer"
    :expanded="expanded"
    :details-label="original ? t('node.error.original') : undefined"
    @action="act"
    @copy="copy"
    @log="openLog"
  />
</template>
<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { NODE_ERROR_CONTEXT } from '@/node/errorContext'
import StateLine from '@/components/obsidian/StateLine.vue'
import { nodeErrorState, nodeErrorActionLabel } from '@/node/errorState'
import { recoverNodeError } from '@/node/errorRecovery'
import { NodeService } from '@/node/NodeService'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'
import type { PathTarget } from '@/node/NodePathModel'
import { t } from '@/i18n'

const props = defineProps<{
  error?: string
  text?: string
  registrationId?: string
  target?: PathTarget
  operation?: string
  location?: string
  offline?: boolean
  reconnecting?: boolean
  slowSince?: number
  footer?: boolean
  expanded?: boolean
  disabled?: boolean
  refresh?: () => Promise<unknown> | void
  /** Chat retries have their own receipt identity; never substitute a refresh for them. */
  retry?: () => Promise<unknown> | void
  original?: boolean
  at?: number
  lastSeen?: string
}>()
const context = inject(NODE_ERROR_CONTEXT, undefined)
const registrationId = computed(() => props.registrationId ?? context?.registrationId)
const target = computed(() => props.target ?? context?.target)
const refresh = () => (props.refresh ?? context?.refresh)?.()
const busy = ref(false),
  actionError = ref(''),
  at = ref(props.at ?? Date.now()),
  now = ref(Date.now())
let clock: number | undefined
watch(
  () => props.slowSince,
  (since) => {
    window.clearInterval(clock)
    now.value = Date.now()
    if (since)
      clock = window.setInterval(() => {
        now.value = Date.now()
      }, 1000)
  },
  { immediate: true }
)
onUnmounted(() => window.clearInterval(clock))
watch(
  () => props.error,
  () => {
    at.value = props.at ?? Date.now()
    actionError.value = ''
  }
)
const connection = computed(() => {
  if (!registrationId.value) return undefined
  return NodeService.peekConnection(registrationId.value)
})
const raw = computed(() => actionError.value || props.error || '')
const state = computed(() =>
  nodeErrorState(raw.value, {
    offline: props.offline,
    reconnecting: props.reconnecting,
    slow: !!props.slowSince && !raw.value,
    elapsed: props.slowSince ? now.value - props.slowSince : 0,
  })
)
const actionLabel = computed(() => {
  const action = state.value.action
  if (
    action === 'trust' &&
    (!target.value || !nodeAdvertisesMethod(connection.value?.client, 'project.trust'))
  )
    return undefined
  if (action === 'retry' && !props.retry && !props.refresh) return undefined
  if (action === 'refresh' && !props.refresh && !context?.refresh) return undefined
  if (action === 'reconnect' && !connection.value) return undefined
  return nodeErrorActionLabel(action)
})
const facts = computed(() => {
  const values: { label: string; value: string; code?: boolean }[] = []
  if (props.offline && props.lastSeen)
    values.push({ label: t('streamB.asOf.431575'), value: props.lastSeen })
  if (props.operation) values.push({ label: t('node.error.what'), value: props.operation })
  if (props.location) values.push({ label: t('node.error.where'), value: props.location })
  if (raw.value) {
    values.push({ label: t('node.error.when'), value: new Date(at.value).toLocaleString() })
    const code =
      raw.value.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i)?.[0] ??
      raw.value.match(/^[a-z][a-z0-9_-]*$/i)?.[0]
    if (code) values.push({ label: t('node.error.code'), value: code, code: true })
    if (raw.value !== code) values.push({ label: t('node.error.original'), value: raw.value })
  }
  return values
})
const logAvailable = computed(() => {
  void connection.value?.state.value
  return nodeAdvertisesMethod(connection.value?.client, 'node.log.v1.tail')
})
async function act() {
  if (busy.value || !actionLabel.value || !state.value.action) return
  busy.value = true
  try {
    const action = state.value.action
    if (action === 'retry') await (props.retry ?? props.refresh)?.()
    else if (action === 'refresh') await refresh()
    else {
      await recoverNodeError(action, registrationId.value, target.value)
      if (action === 'trust' || action === 'reconnect') await refresh()
    }
  } catch (error) {
    console.debug('[node] Recovery action failed', error)
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
async function copy() {
  await navigator.clipboard.writeText(facts.value.map((f) => `${f.label}: ${f.value}`).join('\n'))
}
async function openLog() {
  if (!registrationId.value) return
  const { openNodeLog } = await import('@/node/nodeLog')
  openNodeLog(registrationId.value, at.value)
}
</script>
