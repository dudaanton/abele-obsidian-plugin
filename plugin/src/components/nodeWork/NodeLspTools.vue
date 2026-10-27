<template>
  <template v-if="analysisHost">
    <Teleport :to="analysisHost">
      <span
        v-show="!header || !Platform.isPhone"
        class="abele-analysis-action"
        data-lsp-analysis
        :data-state="analysisState"
      >
        <Icon
          ref="analysisButton"
          :icon="!header && Platform.isMobile ? 'more-horizontal' : 'scan-search'"
          :tooltip="analysisTooltip"
          @click="showAnalysis"
        >
          <StatusDot
            v-if="tone"
            :tone="tone"
            :label="analysisTooltip"
            :pulse="analysisState === 'starting'"
          />
        </Icon>
      </span>
    </Teleport>
    <Teleport v-if="glyphHost" :to="glyphHost">
      <Icon
        v-if="document?.diagnostics.length && !untrusted && !missing"
        ref="diagnosticsButton"
        data-lsp-diagnostics
        icon="circle-alert"
        :text-right="String(document.diagnostics.length)"
        :tooltip="t('node.lsp.count', { count: document.diagnostics.length })"
        :color="document.diagnostics.some((item) => item.severity === 1) ? 'red' : 'orange'"
        @click="showDiagnostics"
      />
    </Teleport>
  </template>
  <NodeReferenceResults
    v-if="
      referencesState && (!Platform.isMobile || referencesState.presenter === referencesPresenter)
    "
    :state="referencesState"
    @open="navigate([$event], referencesOrigin)"
  />
</template>
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Menu } from 'obsidian'
import StatusDot from '../obsidian/StatusDot.vue'
import Icon from '../obsidian/Icon.vue'
import { t } from '@/i18n'
import { openExternal } from '@/helpers/openExternal'
import { NodeService } from '@/node/NodeService'
import { NodePathMutations } from '@/node/NodePathMutations'
import { acquireLspDocument, type NodeLspDocument, type LspLocation } from '@/node/NodeLspDocument'
import { provideLsp } from '@/node/lspContext'
import type { PathTarget } from '@/node/NodePathModel'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'
import { openNodePathTab } from '@/node/nodePathNavigation'
import { GlobalStore } from '@/stores/GlobalStore'
import { Platform } from 'obsidian'
import { DefinitionPicker } from '@/github/search/definitionPicker'
import { LSP_CONNECTION } from '@/node/lspConnection'
import { lspMenuLabel } from '@/node/lspMenu'
import { lspLanguage } from '@/node/lspLanguage'
import { FILE_DESTINATION } from '@/node/fileNavigation'
import { ANALYSIS_HEADER } from '@/node/analysisHeader'
import NodeReferenceResults from './NodeReferenceResults.vue'
import { referenceResultsFor, findNodeReferences } from '@/node/referenceResults'
import { referencePreviewReader } from '@/node/referencePreview'
import { installDiffReferences } from '@/node/diffReferences'

const props = defineProps<{
  root?: HTMLElement
  glyphHost?: HTMLElement | null
  target: PathTarget
  path: string
  text: string
  mapPosition?: (position: {
    line: number
    character: number
  }) => { line: number; character: number } | undefined
  offline?: boolean
  disabledReason?: 'pastRevision' | 'comparison' | 'noConnection' | 'contentUnavailable'
}>()
const injectedConnection = inject(LSP_CONNECTION, undefined)
const fileDestination = inject(FILE_DESTINATION, undefined)
const header = inject(ANALYSIS_HEADER, undefined)
const analysisHost = computed(() => header?.host ?? props.glyphHost)
const connectionForTarget = () =>
  injectedConnection ?? NodeService.connectionIfKnown?.(props.target.registrationId)
const document = shallowRef<NodeLspDocument>()
const referencesState = computed(() => {
  const client = connectionForTarget()?.client
  return client
    ? referenceResultsFor(
        client,
        JSON.stringify([props.target.registrationId, props.target.kind, props.target.id])
      )
    : undefined
})
let referencesOrigin: { line: number; character: number } | undefined
const referencesPresenter = Symbol('references-presenter')
watch(
  [
    () => props.root,
    () => props.disabledReason,
    () => props.offline,
    () => props.path,
    () => JSON.stringify(props.target),
  ],
  (_values, _old, cleanup) => {
    const root = props.root
    if (!root || props.disabledReason !== 'comparison' || props.offline || !lspLanguage(props.path))
      return
    const connection = connectionForTarget()
    if (!connection) return
    const target = { ...props.target }
    const path = props.path
    let stopped = false
    const leases = new Set<() => Promise<void>>()
    const remove = installDiffReferences(
      root,
      () => props.text,
      (kind, symbol) => {
        void (async () => {
          await connection.connect()
          if (stopped) return
          const lease = acquireLspDocument(
            connection.client,
            target.kind === 'worktree' ? { worktree_id: target.id } : { workspace_id: target.id },
            path
          )
          leases.add(lease.release)
          try {
            const doc = lease.document
            const text = props.text
            await doc.open(text)
            if (stopped) return
            if (kind === 'definition') {
              const hits = await doc.query(kind, symbol.position, text)
              if (!stopped && hits.length) navigate(hits, symbol.position)
            } else {
              const state = referenceResultsFor(
                connection.client,
                JSON.stringify([target.registrationId, target.kind, target.id])
              )
              referencesOrigin = symbol.position
              state.presenter = referencesPresenter
              await findNodeReferences(
                state,
                doc,
                symbol.position,
                text,
                referencePreviewReader(connection.client, target),
                () =>
                  doc.status.some((s) => s.reason === 'untrusted_folder')
                    ? t('node.analysis.untrusted')
                    : doc.unavailableReason
                      ? t(`node.analysis.${doc.unavailableReason}`)
                      : doc.error,
                symbol.name
              )
            }
          } finally {
            leases.delete(lease.release)
            await lease.release()
          }
        })().catch((error) =>
          console.debug('[node] Comparison language navigation unavailable', error)
        )
      }
    )
    cleanup(() => {
      stopped = true
      remove()
      for (const release of leases) void release()
    })
  },
  { immediate: true, flush: 'post' }
)
async function findReferences(_name: string, position: { line: number; character: number }) {
  const doc = document.value
  const state = referencesState.value
  const connection = connectionForTarget()
  if (!doc || !state || !connection) return
  referencesOrigin = position
  state.presenter = referencesPresenter
  await findNodeReferences(
    state,
    doc,
    position,
    props.text,
    referencePreviewReader(connection.client, { ...props.target }),
    () => (untrusted.value ? t('node.analysis.untrusted') : offReason.value || failureReason.value),
    _name
  )
}
const analysisButton = ref<InstanceType<typeof Icon>>()
const diagnosticsButton = ref<InstanceType<typeof Icon>>()
const revision = ref(0)
const busy = ref(false)
const installing = ref(false)
const actionError = ref('')
const canInstall = ref(false)
const canTrust = ref(false)
const settled = ref(false)
const installCommand = 'abele-node lsp install --popular'
let removeContext: (() => void) | undefined
let releaseDocument: (() => Promise<void>) | undefined
let removeListener: (() => void) | undefined
let picker: DefinitionPicker | undefined
const statuses = computed(() => {
  void revision.value
  return document.value?.status ?? []
})
const language = computed(() => lspLanguage(props.path))
const offReason = computed(() => {
  if (props.disabledReason) return t(`node.analysis.${props.disabledReason}`)
  if (props.offline) return t('node.state.offline')
  if (!language.value) return t('node.analysis.unsupportedFile')
  const reason = document.value?.unavailableReason
  if (reason) return t(`node.analysis.${reason}`)
  if (settled.value && !document.value) return t('node.analysis.noConnection')
  return ''
})
const failureReason = computed(() => {
  if (document.value?.errorReason === 'lsp_document_limit') return t('node.analysis.documentLimit')
  return actionError.value || document.value?.error || ''
})
const relevant = computed(() =>
  statuses.value.filter(
    (s) =>
      s.language === language.value || (language.value === 'typescript' && s.language === 'eslint')
  )
)
const untrusted = computed(() => relevant.value.some((s) => s.reason === 'untrusted_folder'))
const missing = computed(() =>
  relevant.value.some((s) => s.language === language.value && !s.found)
)
const eslintMissing = computed(() =>
  relevant.value.some(
    (s) =>
      s.language === 'eslint' && (!s.found || (!!s.project_eslint && s.project_eslint !== 'found'))
  )
)
const analysisState = computed(() => {
  if (actionError.value || document.value?.error) return 'failed'
  if (offReason.value || (settled.value && !document.value?.supported)) return 'off'
  if (untrusted.value || missing.value || eslintMissing.value) return 'degraded'
  if (relevant.value.some((s) => s.diagnostic)) return 'failed'
  if (!settled.value || busy.value) return 'starting'
  return 'ready'
})
const tone = computed(() => {
  if (analysisState.value === 'failed') return 'red'
  if (analysisState.value === 'degraded') return 'orange'
  if (analysisState.value === 'starting') return 'faint'
  return undefined
})
const analyzerNames: Record<string, string> = { typescript: 'TypeScript', eslint: 'ESLint' }
function analyzerState(status: (typeof relevant.value)[number]) {
  if (offReason.value) return offReason.value
  if (status.reason === 'untrusted_folder') return t('node.analysis.untrusted')
  if (!status.found || (status.language === 'eslint' && eslintMissing.value))
    return t('node.analysis.notSetUp')
  const reason = status.diagnostic || failureReason.value
  if (reason) return t('node.analysis.stopped', { reason })
  return t(analysisState.value === 'starting' ? 'node.analysis.starting' : 'node.analysis.running')
}
function analyzerIcon(status: (typeof relevant.value)[number]) {
  if (offReason.value) return 'circle-off'
  if (status.reason === 'untrusted_folder') return 'shield-alert'
  if (!status.found || (status.language === 'eslint' && eslintMissing.value)) return 'circle-alert'
  if (status.diagnostic || actionError.value || document.value?.error) return 'circle-alert'
  return analysisState.value === 'starting' ? 'loader' : 'check'
}
const analysisTooltip = computed(() => {
  if (analysisState.value === 'starting') return t('node.analysis.loading')
  if (analysisState.value === 'off') return t('node.analysis.off')
  if (analysisState.value === 'failed') return t('node.analysis.error')
  if (untrusted.value) return t('node.analysis.trustNeeded')
  if (
    relevant.value.some((s) => s.language === 'typescript' && s.found) &&
    (eslintMissing.value || relevant.value.some((s) => s.language === 'eslint' && !s.found))
  )
    return t('node.analysis.typescriptOnly')
  return t('node.analysis.summary', {
    names: relevant.value
      .map(
        (s) =>
          `${analyzerNames[s.language] ?? s.language}${s.found ? '' : ` — ${analyzerState(s)}`}`
      )
      .join(', '),
  })
})
function populateAnalysis(menu: Menu) {
  for (const status of relevant.value)
    menu.addItem((item) =>
      item
        .setTitle(`${analyzerNames[status.language] ?? status.language} — ${analyzerState(status)}`)
        .setIcon(analyzerIcon(status))
        .setDisabled(true)
    )
  if (!relevant.value.length)
    menu.addItem((item) =>
      item
        .setTitle(offReason.value || analysisTooltip.value)
        .setIcon(
          analysisState.value === 'off'
            ? 'circle-off'
            : analysisState.value === 'failed'
              ? 'circle-alert'
              : 'loader'
        )
        .setDisabled(true)
    )
  // With no analyser status to carry it, the failure reason gets its own row.
  const failure = failureReason.value
  if (!relevant.value.length && failure) {
    menu.addSeparator()
    menu.addItem((item) => item.setTitle(failure).setDisabled(true))
  }
  const restart =
    document.value &&
    !offReason.value &&
    (analysisState.value === 'failed' ||
      document.value.diagnostics.some((item) => item.severity === 1))
  const setup =
    !untrusted.value &&
    (eslintMissing.value || relevant.value.some((s) => s.language === 'eslint' && !s.found))
  if (
    (untrusted.value && canTrust.value) ||
    restart ||
    (missing.value && !untrusted.value) ||
    setup
  )
    menu.addSeparator()
  if (untrusted.value && canTrust.value)
    menu.addItem((item) =>
      item.setTitle(t('node.analysis.trust')).setDisabled(busy.value).onClick(trust)
    )
  if (restart)
    menu.addItem((item) =>
      item.setTitle(t('node.analysis.restart')).setDisabled(busy.value).onClick(retry)
    )
  if (missing.value && !untrusted.value) {
    if (canInstall.value)
      menu.addItem((item) =>
        item
          .setTitle(t('node.lsp.install'))
          .setDisabled(busy.value || installing.value)
          .onClick(install)
      )
    menu.addItem((item) => item.setTitle(t('node.lsp.copy')).onClick(copyCommand))
  }
  if (setup)
    menu.addItem((item) =>
      item
        .setTitle(t('node.analysis.eslintHelp'))
        .onClick(() => openExternal('https://eslint.org/docs/latest/use/getting-started', '_blank'))
    )
}
function showAnalysis() {
  const button = analysisButton.value?.$el as HTMLElement | undefined
  if (!button) return
  const box = button.getBoundingClientRect()
  const show = (menu: Menu) =>
    menu.showAtPosition({ x: box.left, y: box.bottom }, button.ownerDocument)
  const menu = new Menu().setUseNativeMenu(false)
  if (Platform.isMobile && !header) addAnalysisEntry(menu)
  else populateAnalysis(menu)
  show(menu)
}
function addAnalysisEntry(menu: Menu) {
  menu.addItem((item) => {
    item
      .setTitle(t('node.analysis.title'))
      .setIcon('scan-search')
      .setSection('action')
      .onClick(() => {
        const submenu = new Menu().setUseNativeMenu(false)
        populateAnalysis(submenu)
        const anchor = header?.host ?? props.glyphHost ?? props.root
        if (!anchor) return
        const box = anchor.getBoundingClientRect()
        submenu.showAtPosition({ x: box.left, y: box.bottom }, anchor.ownerDocument)
      })
    // Menu icons are host-owned; reuse the shared status dot on this icon too.
    const iconEl = (item as unknown as { iconEl?: HTMLElement }).iconEl
    const dot = analysisHost.value?.querySelector('.abele-status-dot')
    if (iconEl && dot) {
      iconEl.classList.add('abele-analysis-menu-icon')
      iconEl.append(dot.cloneNode(true))
    }
  })
}
const removeHeaderMenu = header?.register(addAnalysisEntry)
function navigate(locations: LspLocation[], origin?: { line: number; character: number }) {
  if (injectedConnection?.navigate) {
    injectedConnection.navigate(locations)
    return
  }
  const target = props.target
  const open = (hit: LspLocation) => {
    if (fileDestination) {
      fileDestination(
        { kind: 'file', target, path: hit.path, line: hit.range.start.line + 1 },
        origin ? origin.line + 1 : undefined
      )
      return
    }
    void openNodePathTab(
      GlobalStore.getInstance().app.workspace,
      { kind: 'file', target, path: hit.path, line: hit.range.start.line + 1 },
      Platform.isMobile
    ).catch((error) => console.debug('[node] Language location unavailable', error))
  }
  if (locations.length === 1) open(locations[0])
  else {
    picker?.close()
    picker = new DefinitionPicker(
      GlobalStore.getInstance().app,
      locations.map((hit) => ({ path: hit.path, line: hit.range.start.line + 1, text: '' })),
      props.path,
      (hit) => {
        const location = locations.find(
          (l) => l.path === hit.path && l.range.start.line + 1 === hit.line
        )
        if (location) open(location)
      }
    )
    picker.setPlaceholder(t('node.lsp.locations', { count: locations.length }))
    picker.emptyStateText = t('node.lsp.noLocations')
    picker.open()
  }
}
function showDiagnostics() {
  const root = props.root
  const button = diagnosticsButton.value?.$el as HTMLElement | undefined
  if (!root || !button) return
  const menu = new Menu().setUseNativeMenu(false)
  const items = document.value?.diagnostics ?? []
  if (!items.length)
    menu.addItem((item) => item.setTitle(t('node.lsp.noDiagnostics')).setDisabled(true))
  for (const diagnostic of items)
    menu.addItem((item) =>
      item
        .setTitle(
          lspMenuLabel(
            root.ownerDocument,
            `${diagnostic.source} · ${diagnostic.range.start.line + 1}: ${diagnostic.message}`
          )
        )
        .onClick(() => navigate([{ path: props.path, range: diagnostic.range }]))
    )
  const box = button.getBoundingClientRect()
  menu.showAtPosition({ x: box.left, y: box.bottom }, root.ownerDocument)
}
async function action(run: () => Promise<unknown>) {
  busy.value = true
  actionError.value = ''
  try {
    await run()
    await document.value?.refreshStatus()
    await refresh()
  } catch (error) {
    console.debug('[node] Language setup unavailable', error)
    actionError.value = t('node.lsp.error', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy.value = false
  }
}
function copyCommand() {
  void action(() => navigator.clipboard.writeText(installCommand))
}
function retry() {
  void action(async () => {})
}
function trust() {
  const connection = connectionForTarget()
  if (!connection) return
  void action(() => new NodePathMutations(connection.client).trust(props.target.projectId))
}
function install() {
  const doc = document.value
  if (doc) {
    installing.value = true
    void action(() =>
      doc.client.lsp.install([
        'typescript',
        'python',
        'eslint',
        'json',
        'css',
        'html',
        'yaml',
        'bash',
        'go',
        'rust',
      ])
    ).finally(() => {
      installing.value = false
    })
  }
}
async function refresh() {
  if (!props.offline && !props.disabledReason) await document.value?.open(props.text)
}
watch(
  [
    () => props.root,
    () => JSON.stringify(props.target),
    () => props.path,
    () => props.offline,
    () => props.disabledReason,
  ],
  (_values, _old, cleanup) => {
    removeContext?.()
    removeContext = undefined
    removeListener?.()
    void releaseDocument?.()
    releaseDocument = undefined
    document.value = undefined
    settled.value = false
    actionError.value = ''
    canInstall.value = false
    canTrust.value = false
    if (!props.root || props.offline || props.disabledReason || !language.value) {
      settled.value = true
      return
    }
    const connection = connectionForTarget()
    if (!connection) {
      settled.value = true
      return
    }
    const root =
      props.target.kind === 'worktree'
        ? { worktree_id: props.target.id }
        : { workspace_id: props.target.id }
    const lease = acquireLspDocument(connection.client, root, props.path, () => props.text)
    const doc = lease.document
    releaseDocument = lease.release
    document.value = doc
    const listener = () => {
      ++revision.value
      document.value = doc
      triggerRevision()
    }
    doc.listeners.add(listener)
    removeListener = () => doc.listeners.delete(listener)
    removeContext = provideLsp(props.root, {
      document: doc,
      text: () => props.text,
      mapPosition: props.mapPosition,
      navigate,
      closeNavigation: () => picker?.close(),
      references: findReferences,
    })
    let stopped = false
    cleanup(() => {
      stopped = true
    })
    void connection
      .connect()
      .then(async () => {
        if (stopped) return
        canInstall.value = nodeAdvertisesMethod(connection.client, 'lsp.v1.install')
        canTrust.value = nodeAdvertisesMethod(connection.client, 'project.trust')
        await doc.open(props.text)
        if (!stopped) settled.value = true
      })
      .catch((error) => {
        if (!stopped) actionError.value = String(error)
      })
  },
  { immediate: true, flush: 'post' }
)
// The controller is intentionally independent of Vue; its revision drives this component.
import { triggerRef } from 'vue'
function triggerRevision() {
  triggerRef(document)
}
watch(
  () => props.text,
  (_text, _old, cleanup) => {
    const timer = window.setTimeout(() => {
      void refresh()
    }, 150)
    cleanup(() => window.clearTimeout(timer))
  }
)
onBeforeUnmount(() => {
  removeHeaderMenu?.()
  removeContext?.()
  picker?.close()
  removeListener?.()
  void releaseDocument?.()
})
</script>
<style scoped>
:global(.abele-analysis-header) {
  display: flex;
  align-items: center;
}
.abele-analysis-action {
  position: relative;
  order: -1;
  display: inline-flex;
  flex: 0 0 auto;
}
.abele-analysis-action :deep(.abele-status-dot) {
  position: absolute;
  width: var(--size-2-3);
  height: var(--size-2-3);
  inset-block-start: 0;
  inset-inline-end: 0;
  pointer-events: none;
}
:global(.abele-analysis-menu-icon) {
  position: relative;
}
:global(.abele-analysis-menu-icon .abele-status-dot) {
  position: absolute;
  width: var(--size-2-3);
  height: var(--size-2-3);
  inset-block-start: 0;
  inset-inline-end: 0;
}
</style>
