<template>
  <div class="abele-node-main abele-node-main_file">
    <div v-if="model.busy.value" role="status">{{ t('streamB.loadingFile.e937ad') }}</div>
    <div v-if="offline && !model.document.value" class="abele-node-file-state">
      <StateLine tone="faint" :text="t('node.file.waitingForNode')" />
    </div>
    <div
      v-else-if="model.error.value && !offline"
      :class="{ 'abele-node-file-state': !model.document.value }"
    >
      <NodeErrorLine
        :error="model.error.value"
        :registration-id="model.target.registrationId"
        :target="model.target"
        :operation="
          model.requestedPath
            ? t('node.error.readingFile', { path: model.requestedPath })
            : undefined
        "
        :location="sourceLocation"
        :disabled="model.busy.value"
        :refresh="() => model.refresh()"
      />
    </div>
    <div v-if="offline && model.document.value" role="status">
      {{ t('streamB.offlineRetainedVersion.ddf2fd') }}
    </div>
    <template v-if="model.document.value">
      <div
        v-if="line && (endLine ?? line) > model.document.value.text.split('\n').length"
        role="status"
      >
        {{ t('node.codeLineUnavailable') }}
      </div>
      <div
        v-if="admissionReason || pendingSource"
        class="setting-item-description"
        role="status"
        :title="admissionCode || undefined"
      >
        {{ admissionReason || t('debug.filePending') }}
      </div>
      <div v-if="model.document.value.note" role="status">
        {{ presentUiField(model.document.value, 'note') }}
      </div>
      <FileView
        :path="model.document.value.path"
        :text="model.document.value.text"
        :image="model.document.value.image"
        :change="model.document.value.change"
        :mode="model.mode.value"
        :repository="repository"
        :revision="revision"
        :line="line"
        :end-line="endLine"
        :match="match"
        :code-target="model.target"
        :offline="offline"
        :refresh="() => model.refresh()"
        :markdown-mode="markdownMode"
        @markdown-mode="emit('markdownMode', $event)"
        @find="model.mode.value = 'file'"
        @menu="(event, selection, lines) => emit('menu', event, selection, lines)"
        @ask="emit('ask', $event)"
        @add="emit('add', $event)"
        @note="emit('note', $event)"
      >
        <template v-if="effectiveDebug && !endLine" #code>
          <NodePathDebugFile
            :key="
              JSON.stringify([
                effectiveDebug.sourceId,
                effectiveDebug.debugSessionId,
                effectiveDebug.incarnation,
                effectiveDebug.path,
              ])
            "
            embedded
            :context="{
              ...effectiveDebug,
              ...(line ? { line } : {}),
              text: model.document.value.text,
            }"
            @reveal="revealSource"
            @selection="debugSelection"
          />
        </template>
        <template v-else-if="pendingSource && !endLine" #code>
          <DebugSource
            :text="model.document.value.text"
            :path="model.document.value.path"
            :breakpoints="pendingMarks"
            :line="line"
            :editing="pendingEditing"
            @breakpoint="togglePending"
            @margin-menu="pendingMenu"
            @selection="debugSelection"
          >
            <template #point-editor="{ line: pointLine }">
              <TracePointEditor
                :key="pointLine"
                :line="pointLine"
                :point="pendingMarks.find((point) => point.line === pointLine)"
                :in-scope="namesOnLine(model.document.value.text, pointLine)"
                @save="(edit) => savePendingRecord(pointLine, edit)"
                @cancel="pendingEditing = undefined"
                @remove="removePending(pointLine)"
                @to-breakpoint="savePendingRecord(pointLine, undefined)"
              />
            </template>
          </DebugSource>
        </template>
      </FileView>
    </template>
  </div>
</template>
<script setup lang="ts">
import StateLine from '@/components/obsidian/StateLine.vue'
import NodeErrorLine from './NodeErrorLine.vue'
import { presentUiField } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import type { NodePathFileModel } from '@/node/NodePathModel'
import FileView from './FileView.vue'
import NodePathDebugFile from './NodePathDebugFile.vue'
import DebugSource from '@/components/debugger/DebugSource.vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
import { computed, inject, provide, ref, watch } from 'vue'
import { FILE_NAVIGATION, MARKDOWN_FILE_NAVIGATION, fileNavigation } from '@/node/fileNavigation'
import { openNodeFileDestination, type NodePathTabState } from '@/node/nodePathNavigation'
import { GlobalStore } from '@/stores/GlobalStore'
import { Menu, Platform } from 'obsidian'
import TracePointEditor from '@/components/debugger/trace/TracePointEditor.vue'
import { namesOnLine } from '@/debugger/trace/panel'
import { promptDialog } from '@/components/obsidian/dialogs'
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
    endLine?: number
    match?: { column: number; length: number }
    markdownMode?: 'preview' | 'code'
  }>(),
  {
    offline: false,
    debug: undefined,
    repository: undefined,
    revision: undefined,
    line: undefined,
    endLine: undefined,
    match: undefined,
    markdownMode: undefined,
  }
)
const service = DebuggerService.instance
const sourceLocation = computed(
  () =>
    props.model.pathModel?.copy?.(props.model.target)?.path ??
    props.model.pathModel?.folders?.value.find(
      (folder) => folder.id === props.model.target.projectId
    )?.path ??
    props.model.target.projectId
)
async function retry() {
  try {
    await props.model.refresh()
  } catch (error) {
    console.debug('[node] File retry failed', error)
  }
}
watch(
  () => props.offline,
  (offline, wasOffline) => {
    if (wasOffline && !offline && !props.model.document.value && !props.model.busy.value)
      void retry()
  }
)
// Standalone file panes need the same code destination route as the main file view.
if (!inject(FILE_NAVIGATION, undefined))
  provide(FILE_NAVIGATION, (url) => {
    const state = fileNavigation(props.model.target, url)
    if (!state) return false
    void openNodeFileDestination(GlobalStore.getInstance().app.workspace, state, Platform.isMobile)
    return true
  })
provide(MARKDOWN_FILE_NAVIGATION, (url) => {
  const state = fileNavigation(props.model.target, url)
  if (!state) return false
  emit('navigate', state)
  return true
})
const admissionReason = ref('')
const admissionCode = ref('')
const checkingSource = ref(false)
const pendingSource = computed(() => {
  const doc = props.model.document.value
  return (
    !!doc?.target &&
    /\.(?:[cm]?[jt]s|[jt]sx)$/.test(doc.path) &&
    !/\.d\.[cm]?ts$/.test(doc.path) &&
    !effectiveDebug.value
  )
})
const pendingMarks = computed(() => {
  const doc = props.model.document.value
  return doc?.target
    ? service.pendingBreakpoints(doc.target, doc.path).map((line) => ({
        file: doc.path,
        line,
        state:
          service.pendingPoint(doc.target, doc.path, line)?.enabled === false
            ? ('disabled' as const)
            : ('pending' as const),
        ...(service.pendingPoint(doc.target, doc.path, line)?.record
          ? {
              kind: 'record' as const,
              ...service.pendingPoint(doc.target, doc.path, line)?.record,
              when: service.pendingPoint(doc.target, doc.path, line)?.condition,
            }
          : {}),
      }))
    : []
})
const pendingEditing = ref<number>()
function removePending(line: number) {
  togglePending(line)
  pendingEditing.value = undefined
}
function savePendingRecord(line: number, edit?: { take: string[]; when?: string; note?: string }) {
  const doc = props.model.document.value
  if (doc?.target)
    service.editPendingPoint(doc.target, doc.path, line, {
      record: edit ? { take: edit.take, note: edit.note } : undefined,
      condition: edit?.when,
    })
  pendingEditing.value = undefined
}
function pendingMenu(line: number, event: MouseEvent) {
  const doc = props.model.document.value
  if (!doc?.target) return
  const target = doc.target
  const point = service.pendingPoint(target, doc.path, line)
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t(point ? 'streamC.d7f159f16e10153a' : 'streamC.0bb179c57e2cf318'))
      .setIcon(point ? 'trash-2' : 'circle')
      .onClick(() => togglePending(line))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('settings.metadata.bf774e203130976f'))
      .setIcon('diamond')
      .onClick(() => {
        pendingEditing.value = line
      })
  )
  if (point) {
    for (const field of ['condition', 'hitCondition'] as const) {
      const label = t(field === 'condition' ? 'debug.editCondition' : 'debug.editHitCount')
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setIcon('pencil')
          .onClick(async () => {
            const value = await promptDialog({
              title: label,
              label,
              value: point[field] ?? '',
              placeholder: label,
              submitText: t('settings.GithubConnectionEditor.save.1509f561'),
            })
            if (value !== null) service.editPendingPoint(target, doc.path, line, { [field]: value })
          })
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(
          point.record
            ? t(point.enabled ? 'debug.disableRecordPoint' : 'debug.enableRecordPoint')
            : t(point.enabled ? 'debug.disableBreakpoint' : 'debug.enableBreakpoint')
        )
        .setIcon('circle')
        .onClick(() =>
          service.editPendingPoint(target, doc.path, line, { enabled: !point.enabled })
        )
    )
  }
  menu.showAtMouseEvent(event)
}
function togglePending(line: number) {
  const doc = props.model.document.value
  if (doc?.target) service.togglePendingBreakpoint(doc.target, doc.path, line)
}
const effectiveDebug = computed(() => {
  void service.sourceRevision.value
  const doc = props.model.document.value
  if (!doc) return undefined
  if (!doc.target) return props.debug
  if (checkingSource.value || admissionReason.value) return undefined
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
    checkingSource.value = false
    if (!doc?.target || !service.folderBinding(doc.target)) return
    checkingSource.value = true
    let cancelled = false
    cleanup(() => {
      cancelled = true
    })
    void service.admitFile(doc.target, doc.path, true).then((reason) => {
      if (!cancelled) {
        admissionReason.value = reason.message
        admissionCode.value = reason.code ?? ''
        checkingSource.value = false
      }
    })
  },
  { immediate: true }
)
import type { FileSelection } from './fileSelection'
const emit = defineEmits<{
  navigate: [state: NodePathTabState]
  markdownMode: [mode: 'preview' | 'code']
  reveal: [line: number]
  menu: [event: MouseEvent, selection: string, lines?: FileSelection]
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
body.is-phone .abele-node-content__chat,
body.is-phone .abele-node-main_file {
  padding-block-end: calc(
    var(--navbar-height, 0px) + var(--navbar-bottom-offset, 0px) + var(--size-4-2)
  );
}
.abele-node-main_file {
  display: flex;
  flex-direction: column;
}
.abele-node-main {
  padding: var(--size-4-4);
  min-width: 0;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.abele-node-file-state {
  display: flex;
  min-height: 100%;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: var(--size-4-4);
}
.abele-node-file-state > .abele-state-line {
  width: min(100%, 34em);
}
.abele-node-main > [role='alert'] {
  color: var(--text-error);
  overflow-wrap: anywhere;
  margin-block-end: var(--size-4-2);
}
.abele-node-main > [role='status'] {
  flex: 0 0 auto;
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin-block-end: var(--size-4-2);
}
</style>
