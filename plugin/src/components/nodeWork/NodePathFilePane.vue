<template>
  <div class="abele-node-main">
    <div v-if="model.busy.value" role="status">{{ t('streamB.loadingFile.e937ad') }}</div>
    <div v-if="model.error.value" role="alert"><NodeErrorText :error="model.error.value" /></div>
    <div v-if="offline" role="status">{{ t('streamB.offlineRetainedVersion.ddf2fd') }}</div>
    <template v-if="model.document.value">
      <div v-if="admissionReason" role="status" :title="admissionCode || undefined">
        {{ admissionReason }}
      </div>
      <div v-if="model.document.value.note" role="status">
        {{ presentUiField(model.document.value, 'note') }}
      </div>
      <NodePathDebugFile
        v-if="effectiveDebug"
        v-show="model.mode.value === 'file'"
        :key="
          JSON.stringify([
            effectiveDebug.sourceId,
            effectiveDebug.debugSessionId,
            effectiveDebug.incarnation,
            effectiveDebug.path,
          ])
        "
        :context="{ ...effectiveDebug, ...(line ? { line } : {}), text: model.document.value.text }"
        @reveal="revealSource"
        @selection="debugSelection"
      />
      <FileView
        v-if="!effectiveDebug || model.mode.value !== 'file'"
        :path="model.document.value.path"
        :text="model.document.value.text"
        :image="model.document.value.image"
        :change="model.document.value.change"
        :mode="model.mode.value"
        :repository="repository"
        :revision="revision"
        :line="line"
        @menu="(event, selection) => emit('menu', event, selection)"
        @ask="emit('ask', $event)"
        @add="emit('add', $event)"
        @note="emit('note', $event)"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiField } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import type { NodePathFileModel } from '@/node/NodePathModel'
import FileView from './FileView.vue'
import NodePathDebugFile from './NodePathDebugFile.vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
import { computed, provide, ref, watch } from 'vue'
import { FILE_NAVIGATION, fileNavigation } from '@/node/fileNavigation'
import { openNodePathTab } from '@/node/nodePathNavigation'
import { GlobalStore } from '@/stores/GlobalStore'
import { Platform } from 'obsidian'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { RepositorySource } from '@/repository/source'
const props = withDefaults(
  defineProps<{
    model: NodePathFileModel
    offline?: boolean
    debug?: DebugSourceContext
    repository?: RepositorySource
    revision?: string
    line?: number
  }>(),
  { offline: false, debug: undefined, repository: undefined, revision: undefined, line: undefined }
)
const service = DebuggerService.instance
provide(FILE_NAVIGATION, (url) => {
  const state = fileNavigation(props.model.target, url)
  if (!state) return false
  void openNodePathTab(GlobalStore.getInstance().app.workspace, state, Platform.isMobile).catch(
    (e) => console.debug('[node] File navigation unavailable', e)
  )
  return true
})
const admissionReason = ref('')
const admissionCode = ref('')
const effectiveDebug = computed(() => {
  void service.sourceRevision.value
  const doc = props.model.document.value
  if (!doc) return undefined
  if (!doc.target) return props.debug
  // Observe this folder's session revision as well as its mapping changes.
  const binding = service.folderBinding(doc.target)
  const debug = service.debugFor(doc.target, doc.path)
  return debug
    ? { ...debug, registrationId: doc.target.registrationId, path: doc.path, text: doc.text }
    : binding
      ? undefined
      : props.debug
})
watch(
  () =>
    effectiveDebug.value &&
    JSON.stringify([
      effectiveDebug.value.debugSessionId,
      effectiveDebug.value.incarnation,
      effectiveDebug.value.sourceId,
    ]),
  (source) => {
    if (source) props.model.mode.value = 'file'
  },
  { immediate: true }
)
watch(
  [
    () => props.model.document.value,
    () => effectiveDebug.value?.sourceId,
    () => {
      const target = props.model.document.value?.target
      const binding = target && service.folderBinding(target)
      return binding
        ? JSON.stringify([
            binding.sessionId,
            binding.controller.snapshot?.incarnation,
            binding.connection.authorizationGeneration,
          ])
        : ''
    },
  ],
  (_value, _previous, cleanup) => {
    const doc = props.model.document.value
    admissionReason.value = ''
    admissionCode.value = ''
    if (!doc?.target || effectiveDebug.value || !service.folderBinding(doc.target)) return
    let cancelled = false
    cleanup(() => {
      cancelled = true
    })
    void service.admitFile(doc.target, doc.path).then((reason) => {
      if (!cancelled) {
        admissionReason.value = reason.message
        admissionCode.value = reason.code ?? ''
      }
    })
  },
  { immediate: true }
)
import type { FileSelection } from './fileSelection'
const emit = defineEmits<{
  reveal: [line: number]
  menu: [event: MouseEvent, selection: string]
  ask: [selection: FileSelection]
  add: [selection: FileSelection]
  note: [selection: FileSelection]
}>()
function revealSource(line: number) {
  props.model.mode.value = 'file'
  emit('reveal', line)
}
import type { Selected } from '../obsidian/SelectionBar.vue'
function debugSelection(action: 'ask' | 'add' | 'note', selected: Selected) {
  if (!selected.from || !selected.to) return
  const selection: FileSelection = {
    text: selected.text,
    from: selected.from,
    to: selected.to,
    side: 'after',
  }
  if (action === 'ask') emit('ask', selection)
  else if (action === 'add') emit('add', selection)
  else emit('note', selection)
}
</script>
<style lang="scss">
.abele-node-content__pane {
  height: 100%;
  min-height: 0;
}
.abele-node-content__chat {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
body.is-phone .abele-node-content__chat {
  padding-block-end: calc(
    var(--navbar-height, 0px) + var(--navbar-bottom-offset, 0px) + var(--size-4-2)
  );
}
.abele-node-main {
  padding: var(--size-4-4);
  min-width: 0;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.abele-node-main > [role='alert'] {
  color: var(--text-error);
  overflow-wrap: anywhere;
  margin-block-end: var(--size-4-2);
}
.abele-node-main > [role='status'] {
  color: var(--text-muted);
  margin-block-end: var(--size-4-2);
}
</style>
