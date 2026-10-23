<template>
  <template v-if="document?.supported">
    <Teleport :to="glyphHost ?? 'body'" :disabled="!glyphHost">
      <Icon
        v-if="document.diagnostics.length && !untrusted && !missing"
        ref="diagnosticsButton"
        data-lsp-diagnostics
        icon="circle-alert"
        :text-right="String(document.diagnostics.length)"
        :tooltip="t('node.lsp.count', { count: document.diagnostics.length })"
        :color="document.diagnostics.some((item) => item.severity === 1) ? 'red' : 'orange'"
        @click="showDiagnostics"
      />
    </Teleport>
    <div v-if="document.loading" class="abele-lsp-status" role="status">
      {{ t('node.lsp.loading') }}
    </div>
    <div v-else-if="document.error" class="abele-lsp-status" role="alert">
      {{ t('node.lsp.error', { message: document.error }) }}
      <Button plain :text="t('node.lsp.retry')" @click="retry" />
    </div>
    <div v-if="untrusted" class="abele-lsp-status abele-lsp-notice" role="status">
      <span>{{ t('node.lsp.untrusted') }}</span>
      <Button plain :disabled="busy" :text="t('node.lsp.trust')" @click="trust" />
    </div>
    <div v-else-if="missing" class="abele-lsp-status" role="status">
      <div class="abele-lsp-notice">
        <span
          >{{ t('node.lsp.missing') }} <code>{{ installCommand }}</code></span
        >
        <Button plain :text="t('node.lsp.copy')" @click="copyCommand" />
      </div>
      <div class="abele-lsp-actions">
        <Button plain :disabled="busy" :text="t('node.lsp.retry')" @click="retry" />
        <Button
          v-if="canInstall"
          plain
          :disabled="busy"
          :text="t('node.lsp.install')"
          :loading="installing"
          @click="install"
        />
      </div>
    </div>
    <div
      v-if="
        eslintMissing && !untrusted && relevant.some((s) => s.language === 'typescript' && s.found)
      "
      class="abele-lsp-status"
      role="status"
    >
      {{ t('node.lsp.eslintMissing') }}
    </div>
    <div
      v-for="status in relevant.filter((s) => s.diagnostic)"
      :key="status.language"
      role="status"
      class="abele-lsp-status"
    >
      {{ t('node.lsp.error', { message: status.diagnostic ?? '' }) }}
    </div>
    <div v-if="actionError" role="alert">{{ actionError }}</div>
  </template>
</template>
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Menu } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import { t } from '@/i18n'
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

const props = defineProps<{
  root?: HTMLElement
  glyphHost?: HTMLElement | null
  target: PathTarget
  path: string
  text: string
  offline?: boolean
}>()
const injectedConnection = inject(LSP_CONNECTION, undefined)
const fileDestination = inject(FILE_DESTINATION, undefined)
const connectionForTarget = () =>
  injectedConnection ?? NodeService.connectionIfKnown?.(props.target.registrationId)
const document = shallowRef<NodeLspDocument>()
const diagnosticsButton = ref<InstanceType<typeof Icon>>()
const revision = ref(0)
const busy = ref(false)
const installing = ref(false)
const actionError = ref('')
const canInstall = ref(false)
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
  if (!props.offline) await document.value?.open(props.text)
}
watch(
  [() => props.root, () => JSON.stringify(props.target), () => props.path, () => props.offline],
  (_values, _old, cleanup) => {
    removeContext?.()
    removeListener?.()
    void releaseDocument?.()
    releaseDocument = undefined
    document.value = undefined
    if (!props.root || props.offline || !language.value) return
    const connection = connectionForTarget()
    if (!connection) return
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
      navigate,
      closeNavigation: () => picker?.close(),
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
        await doc.open(props.text)
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
  removeContext?.()
  picker?.close()
  removeListener?.()
  void releaseDocument?.()
})
</script>
<style scoped>
.abele-lsp-notice {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-lsp-notice > span {
  flex: 1 1 0;
  min-width: 0;
}
.abele-lsp-notice code {
  display: inline-block;
  max-width: 100%;
  overflow-x: auto;
  white-space: pre;
  overflow-wrap: normal;
  vertical-align: bottom;
}
.abele-lsp-notice > .abele-obsidian-button {
  flex-shrink: 0;
}
.abele-lsp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}
.abele-lsp-status {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}
</style>
