<template>
  <div v-if="!source || !target" class="abele-node-repository__unavailable">
    <GithubNotice
      v-if="error"
      :text="nodeErrorWords(error)"
      :title="error"
      :retry-tooltip="t('streamBMeta.afdea7c2c1')"
      @retry="load"
    />
    <EmptyState v-else :text="t('streamB.connectingToTheNode.2fcf9c')" />
  </div>
  <GithubItem
    v-else
    :model="presentation"
    :enabled="true"
    :source="source"
    :source-location="location"
    :document-model="documents"
    :editing-allowed="editingEnabled && !offline"
    :node-offline="offline"
    :keys="keys"
    :on-open="open"
    :on-title="updateTitle"
    :on-state="save"
  >
    <template #repository-controls="{ file, version: shownRef }">
      <div class="abele-node-repository__controls">
        <Icon
          v-if="fileRequests.available.value"
          icon="list-video"
          :tooltip="t('requests.file.openPanel')"
          @click="fileRequests.open"
        />
        <Icon
          class="clickable-icon abele-node-repository__picker"
          role="button"
          tabindex="0"
          icon="git-branch"
          :text-right="pickerLabel(shownRef)"
          :tooltip="t('streamB.chooseAWorkspaceOrVersion.2b9825')"
          :disabled="offline"
          @click="chooseRepository(file?.path)"
          @keydown.enter.prevent="chooseRepository(file?.path)"
        />
        <Icon
          class="clickable-icon"
          role="button"
          tabindex="0"
          icon="panel-left"
          :tooltip="t('streamB.showInTheNodePanel.2cb7ed')"
          @click="showInPanel"
          @keydown.enter.prevent="showInPanel"
        />
        <Icon
          class="clickable-icon"
          role="button"
          tabindex="0"
          icon="folder-git-2"
          :tooltip="t('streamB.repositoryActions.706113')"
          :disabled="offline || settingsBusy"
          @click="externalMenu"
          @keydown.enter.prevent="externalMenu"
        />
      </div>
    </template>
    <template #repository-details>
      <span v-if="offline" role="status">{{
        t('streamB.nodeOfflineReconnectToRefresh.bc3a90')
      }}</span>
      <Setting
        v-if="external && live"
        :name="t('streamB.externalWorkspaceEditing.87e932')"
        :desc="
          editingEnabled
            ? t('streamB.editingAllowedForThisWorktreeGitActions.a6e1ec')
            : t('streamB.readOnlyUntilYouAllowEditingFor.949b5a')
        "
      >
        <Checkbox
          class="abele-node-repository__editing"
          :is-enabled="editingEnabled"
          :aria-label="t('streamB.allowExternalWorkspaceEditing.057b47')"
          :aria-disabled="offline || settingsBusy"
          @toggle="toggleEditing"
        />
      </Setting>
      <span v-else-if="external" class="abele-node-repository__meta">{{
        t('streamB.externalWorkspaceHistoricalVersionReadOnly.326d23')
      }}</span>
      <template v-if="historyOpen">
        <div class="abele-node-repository__actions">
          <span>{{ t('streamB.fileHistory.9f9c57') }}</span
          ><Icon
            icon="x"
            :tooltip="t('streamB.closeFileHistory.60f34c')"
            @click="historyOpen = false"
          />
        </div>
        <EmptyState
          v-if="historyError"
          :text="nodeErrorWords(historyError)"
          :title="historyError"
        />
        <GithubCommits
          v-else
          :commits="history"
          @open="(sha) => open(source!.navigation.commit(sha))"
        />
      </template>
    </template>
  </GithubItem>
</template>
<script setup lang="ts">
import { useFileRequests } from '@/requests/useFileRequests'
import { nodeErrorNotice } from '@/node/errorNotice'
import { nodeErrorWords } from '@/node/errorWords'
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { Menu, type PaneType } from 'obsidian'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { changeExternalBrowsing, externalBrowsingConfirm } from '@/node/repositorySettings'
import GithubItem from './github/GithubItem.vue'
import GithubCommits from './github/GithubCommits.vue'
import EmptyState from './obsidian/EmptyState.vue'
import GithubNotice from './github/GithubNotice.vue'
import Icon from './obsidian/Icon.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import { RepositoryPicker } from '@/node/RepositoryPicker'
import { BasePicker } from '@/github/comparison/BasePicker'
import { basePins } from '@/github/comparison/pins'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget, revealNodePlace } from '@/node/openRepository'
import { GlobalStore } from '@/stores/GlobalStore'
import type { GithubViewModel } from '@/github/model'
import type { GithubTarget } from '@/github/urls'
import type { RepositoryLocation, RepositoryWorkspace } from '@/repository/source'
import type { CommitSummary } from '@/repository/model'
import { NodeFilesModel, NodeDocumentSource } from '@/node/NodeFilesModel'
import { attachNodeRepositoryToolsTab } from '@/node/repositoryToolsTab'
const props = defineProps<{
  model: GithubViewModel
  keys?: { find: number }
  onTitle?: (title: string) => void
  onState?: () => void
}>()
const source = shallowRef<NodeRepositorySource>()
const documents = shallowRef<NodeFilesModel>()
const editingEnabled = ref(false)
let stopMutable = () => {}
let mutableGeneration = 0
const refreshMutable = async () => {
  const current = source.value,
    transport = connection.value
  if (!current || !transport || !live.value) return
  const mine = ++mutableGeneration
  try {
    const [catalog, permission] = await Promise.all([
      current.workspaces(),
      transport.client.repository.editingStatus({ worktree_id: current.identity.workspace }),
    ])
    if (!alive || mine !== mutableGeneration || current !== source.value) return
    current.assertCurrent()
    workspaces.value = catalog
    editingEnabled.value = permission.enabled
    updateTitle()
  } catch {
    if (mine === mutableGeneration) editingEnabled.value = false
  }
}
const toggleEditing = async () => {
  const current = source.value,
    transport = connection.value
  if (!current || !transport || offline.value || settingsBusy.value || !external.value) return
  const enabled = !editingEnabled.value
  settingsBusy.value = true
  try {
    if (
      !(await confirmDialog({
        title: enabled
          ? t('streamB.allowEditingInThisWorktree.0b5778')
          : t('streamB.turnOffWorktreeEditing.6f96b7'),
        message: enabled
          ? t('streamB.allowCurrentFilesInToBeSaved.1b8dd3', {
              v0: String(selected.value?.label || t('streamB.thisExternalWorktree.15dcfe')),
            })
          : t('streamB.stopNewSavesInThisExternalWorktree.e3beec'),
        confirmText: enabled
          ? t('streamB.allowEditing.8195ed')
          : t('streamB.turnOffEditing.b065b8'),
        confirmTooltip: enabled
          ? t('streamB.allowSavesForThisWorktreeIdentity.2a5187')
          : t('streamB.stopNewSaves.fcebed'),
      }))
    )
      return
    current.assertCurrent()
    await transport.client.repository.editing({ worktree_id: current.identity.workspace, enabled })
    if (alive && current === source.value) await refreshMutable()
  } catch (e) {
    nodeErrorNotice(e)
  } finally {
    settingsBusy.value = false
  }
}
const connection = shallowRef<NodeConnection>()
const workspaces = shallowRef<RepositoryWorkspace[]>([])
const error = ref('')
const target = computed(() =>
  props.model.sourceTarget?.provider === 'node' ? props.model.sourceTarget : null
)
const fileRequests = useFileRequests(target)
const location = computed<RepositoryLocation>(() => {
  const at = target.value.location,
    revision = target.value?.revision
  // A node has no home page of its own (its places are the node panel's): an old link to one
  // shows the folder's top level.
  const shown: RepositoryLocation =
    at.kind === 'home' ? { kind: 'folder', ref: at.ref ?? WORKING_TREE, path: '' } : at
  // Explicit frozen state stays fixed through a restart. Working tree aliases remain live.
  return revision?.kind === 'commit' && 'ref' in shown && shown.ref !== WORKING_TREE
    ? { ...shown, ref: revision.commit }
    : shown
})
const offline = computed(() => connection.value?.state.value !== 'connected')
const selected = computed(() =>
  workspaces.value.find((w) => w.id === target.value?.source.workspace)
)
const external = computed(() => selected.value?.kind === 'external')
const live = computed(() => 'ref' in location.value && location.value.ref === WORKING_TREE)
const projectName = ref(t('streamB.project.985959'))
const updateTitle = () =>
  props.onTitle?.(
    `${projectName.value} · ${selected.value?.label || t('streamB.workspace.87bb59')}`
  )
const pickerLabel = (ref?: string) =>
  ref && /^[a-f\d]{40,64}$/i.test(ref)
    ? ref.slice(0, 7)
    : selected.value?.branch?.replace(/^refs\/heads\//, '') || t('streamB.files.abc7e9')
const chooseRepository = (path?: string) => {
  if (!source.value || offline.value) return
  new RepositoryPicker(
    GlobalStore.getInstance().app,
    source.value,
    workspaces.value,
    open,
    path
  ).open()
}
const presentation: GithubViewModel = reactive({
  url: '',
  target: null,
  nonce: 0,
  screen: props.model.screen,
})
let generation = 0
let alive = true
let detachTools = () => {}
const load = async () => {
  const current = target.value
  if (!current) return
  const mine = ++generation
  error.value = ''
  try {
    const service = NodeService.getInstance(),
      registered = service.nodes.value.find((node) => node.id === current.source.node)
    if (!registered) throw new Error(t('streamB.thisNodeWasRemovedReconnectItIn.0c8327'))
    const transport = service.connection(registered.id)
    connection.value = transport
    await transport.connect()
    const principal = await transport.client.store.transaction((state) => ({
      node: state.node_id,
      installation: state.installation_id,
    }))
    if (
      principal.installation !== current.source.installation ||
      principal.node !== registered.expectedNodeId
    )
      throw new Error(t('streamB.thisNodeConnectionBelongsToAnotherInstallation.8f2100'))
    const project = await transport.client.getProject(current.source.project)
    if (!project) throw new Error(t('streamB.thisProjectIsNoLongerRegisteredOn.ffde6b'))
    const authority = transport.authorizationGeneration
    const labels = {
      node: registered.label,
      project: project.root_path.split(/[\\/]/).pop() || t('streamB.project.985959'),
      isCurrent: () =>
        alive &&
        transport.authorizationGeneration === authority &&
        service.nodes.value.some(
          (node) => node.id === registered.id && node.expectedNodeId === registered.expectedNodeId
        ),
    }
    const next = new NodeRepositorySource(
      transport.client,
      current.source as Extract<typeof current.source, { provider: 'node' }>,
      labels,
      current.revision
    )
    const catalog = await next.workspaces()
    if (!alive || mine !== generation) {
      next.dispose()
      return
    }
    detachTools()
    source.value?.dispose()
    stopMutable()
    source.value = next
    editingEnabled.value = false
    documents.value = new NodeFilesModel(
      transport.client,
      principal.node || '',
      current.source.workspace,
      undefined,
      new NodeDocumentSource(transport.client, current.source.workspace, true)
    )
    stopMutable = next.subscribe((change) => {
      if (change.kind === 'authority') {
        editingEnabled.value = false
        return
      }
      void refreshMutable()
    })
    detachTools = attachNodeRepositoryToolsTab(next, transport, {
      target: () => ({
        source: next.identity,
        location: location.value,
        ...(presentation.sourceRevision ? { revision: presentation.sourceRevision } : {}),
      }),
      selection: () => props.model.screen.selection,
      proposeEdit: async (proposal, guard) => {
        const editor = documents.value
        if (!editor) throw new Error(t('streamB.repositoryEditorUnavailable.0080d2'))
        guard()
        if (
          presentUiField(editor.draftError, 'value') ||
          (editor.draftDirty.value && editor.filePath.value === proposal.path)
        )
          throw new Error(t('streamB.keepOrDiscardTheVisibleLocalDraft.00265b'))
        const permission = await transport.client.repository.editingStatus({
          worktree_id: next.identity.workspace,
        })
        guard()
        if (!permission.enabled) throw new Error(t('streamB.editingIsOffForThisWorktreeThe.f829ed'))
        const document = await editor.documents.read(proposal.path)
        guard()
        if (document.contentId !== proposal.expected_content_id)
          throw new Error(t('streamB.theProposedBaseChangedReadTheFile.26cdf8'))
        const existing = await editor.documents.draft(proposal.path)
        guard()
        if (existing && existing.status !== 'saved')
          throw new Error(t('streamB.aLocalDraftAlreadyExistsReviewIt.d70337'))
        if (existing) await editor.documents.discard(proposal.path, existing.revision)
        await editor.documents.edit(proposal.path, document, proposal.text, null, guard)
        guard()
        await editor.openFile(proposal.path, undefined, undefined, document)
        editor.editing.value = true
        open(next.navigation.file(WORKING_TREE, proposal.path))
        return t('streamB.approvedProposalRetainedAsALocalDraft.b372ef')
      },
    })
    workspaces.value = catalog
    projectName.value = labels.project
    updateTitle()
    setPresentation(labels.node, labels.project)
    if (live.value) await refreshMutable()
    void next.startWatching(live.value)
  } catch (reason) {
    if (alive && mine === generation) {
      error.value = t('streamB.nodeUnavailable.8856e0', {
        v0: String(presentUiError(reason)),
      })
      props.model.screen.error = error.value
    }
  }
}
const setPresentation = (node: string, project: string) => {
  if (!target.value) return
  const at = location.value,
    repo = { host: 'node.invalid', owner: node, repo: project }
  const shown: GithubTarget =
    at.kind === 'home'
      ? { ...repo, kind: 'repo', ref: at.ref }
      : at.kind === 'file' || at.kind === 'folder'
        ? {
            ...repo,
            kind: at.kind === 'file' ? 'blob' : 'tree',
            rest: [at.ref, at.path],
            ...(at.lines ? { lines: { start: at.lines.from, end: at.lines.to } } : {}),
          }
        : at.kind === 'commit'
          ? { ...repo, kind: 'commit', sha: at.commit }
          : { ...repo, kind: 'compare', base: at.base, head: at.head, direct: at.direct }
  presentation.target = shown
  presentation.nonce = props.model.nonce
  presentation.tree = props.model.tree
  presentation.originalFile = props.model.originalFile
  presentation.mode = props.model.mode
}
const save = () => {
  props.model.tree = presentation.tree
  props.model.mode = presentation.mode
  props.model.originalFile = presentation.originalFile
  props.model.sourceRevision = presentation.sourceRevision
  // Persist only frozen commit revisions. Live observations are leases; restart must observe anew.
  if (target.value && presentation.sourceRevision?.kind === 'commit')
    target.value.revision = presentation.sourceRevision
  props.onState?.()
}
const open = (url: string, pane: PaneType | false = false) => {
  const next = parseNodeRepositoryLink(url)
  if (next) void openNodeRepositoryTarget(GlobalStore.getInstance().app, next, pane)
}
/** The place this tab is in, opened in the node panel, where its files and changes are. */
const showInPanel = () => {
  const at = target.value?.source
  if (at) void revealNodePlace(at.node, at.workspace).catch((e: unknown) => nodeErrorNotice(e))
}
const settingsBusy = ref(false)
const externalMenu = (event?: MouseEvent | KeyboardEvent) => {
  if (offline.value || settingsBusy.value) return
  const menu = new Menu()
  const configure = async (enabled: boolean) => {
    const current = source.value,
      transport = connection.value
    if (!current || !transport) return
    settingsBusy.value = true
    try {
      const changed = await changeExternalBrowsing(transport.client, current, enabled, () =>
        confirmDialog(externalBrowsingConfirm(enabled))
      )
      if (changed && alive) await load()
    } catch (error) {
      nodeErrorNotice(error)
    } finally {
      settingsBusy.value = false
    }
  }
  if (presentation.target?.kind === 'blob') {
    const at = location.value
    if (at.kind === 'file') {
      menu.addItem((item) =>
        item
          .setTitle(t('streamB.fileHistory.9f9c57'))
          .setIcon('git-commit-horizontal')
          .onClick(() => {
            void showHistory(at.ref, at.path)
          })
      )
    }
  }
  menu.addItem((item) =>
    item.setTitle(t('streamB.showInTheNodePanel.2cb7ed')).setIcon('panel-left').onClick(showInPanel)
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.compareWithAnotherVersion.505d39'))
      .setIcon('git-compare')
      .onClick(() => {
        const at = location.value,
          head = 'ref' in at ? at.ref : WORKING_TREE
        // A node tab has no base bar to show or undo a pinned base: open the comparison itself,
        // and drop a base an earlier version of this menu pinned out of sight.
        const app = GlobalStore.getInstance().app,
          repo = presentation.target
        new BasePicker(app, source.value, repo, (pin) => {
          basePins(app).unpin(repo, source.value.identity)
          open(
            source.value.navigation.comparison(pin.baseSha, head, true, undefined, pin.enteredRef)
          )
        }).open()
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.chatAboutThis.b6a19c'))
      .setIcon('message-square-plus')
      .onClick(() => {
        void import('@/github/GithubView').then(({ GithubView }) =>
          GlobalStore.getInstance().app.workspace.getActiveViewOfType(GithubView)?.chatAbout()
        )
      })
  )
  const frozen = props.model.screen.link && parseNodeRepositoryLink(props.model.screen.link.url)
  if (
    frozen?.location.kind === 'comparison' &&
    frozen.location.base &&
    !frozen.location.head.startsWith('working-')
  ) {
    const at = frozen.location
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.swapVersions.b4c982'))
        .setIcon('arrow-left-right')
        .onClick(() => open(source.value.navigation.comparison(at.head, at.base, true)))
    )
  }
  const pins = basePins(GlobalStore.getInstance().app)
  if (source.value && presentation.target && pins.get(presentation.target, source.value.identity))
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.stopComparingFiles.20cf7a'))
        .setIcon('pin-off')
        .onClick(() => pins.unpin(presentation.target, source.value.identity))
    )
  if (presentation.target?.kind === 'blob')
    menu.addItem((item) =>
      item
        .setTitle(
          presentation.originalFile
            ? t('streamB.showComparison.ca884c')
            : t('streamB.originalFile.0ee08b')
        )
        .setIcon('file-text')
        .onClick(() => {
          presentation.originalFile = !presentation.originalFile
          save()
        })
    )
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.allowExternalWorkspaceBrowsing.565667'))
      .setIcon('folder-git-2')
      .onClick(() => {
        void configure(true)
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.stopBrowsingExternalWorkspaces.03d51a'))
      .setIcon('folder-closed')
      .onClick(() => {
        void configure(false)
      })
  )
  if (event && 'clientX' in event) menu.showAtMouseEvent(event)
  else {
    const rect = (event?.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    menu.showAtPosition({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 })
  }
}
const historyOpen = ref(false),
  historyError = ref(''),
  history = shallowRef<CommitSummary[]>([])
const showHistory = async (ref: string, path: string) => {
  historyOpen.value = true
  historyError.value = ''
  try {
    history.value = await source.value.commits(ref, path)
  } catch (error) {
    historyError.value = presentUiError(error)
  }
}
watch(
  () => target.value && JSON.stringify(target.value.source),
  () => {
    detachTools()
    stopMutable()
    ++mutableGeneration
    editingEnabled.value = false
    documents.value = undefined
    source.value?.dispose()
    source.value = undefined
    void load()
  },
  { immediate: true }
)
watch(
  () => [target.value?.location, props.model.nonce],
  () => {
    if (source.value)
      setPresentation(
        source.value.identity.node === target.value?.source.node
          ? NodeService.getInstance().nodes.value.find((n) => n.id === target.value?.source.node)
              ?.label || t('streamB.node.e93372')
          : t('streamB.node.e93372'),
        presentation.target?.repo || t('streamB.project.985959')
      )
  }
)
watch(live, (isLive) => {
  if (!source.value) return
  if (isLive) {
    source.value.reconnect()
    void refreshMutable()
    void source.value.startWatching()
  } else source.value.stopWatching()
})
watch(
  () => NodeService.getInstance().nodes.value,
  (nodes) => {
    if (!target.value || nodes.some((node) => node.id === target.value.source.node)) return
    detachTools()
    source.value?.dispose()
    source.value = undefined
    error.value = t('streamB.thisNodeWasRemovedReconnectItBefore.514170')
    Object.assign(props.model.screen, {
      link: null,
      selection: null,
      selectionChat: null,
      title: '',
      error: error.value,
    })
  }
)
let wasOffline = true
watch(offline, (isOffline) => {
  if (!isOffline && wasOffline && source.value) {
    source.value.reconnect()
    if (live.value) {
      void refreshMutable()
      void source.value.startWatching()
    }
  }
  wasOffline = isOffline
})
onBeforeUnmount(() => {
  alive = false
  ++generation
  detachTools()
  stopMutable()
  ++mutableGeneration
  source.value?.dispose()
})
</script>
<style lang="scss">
.abele-node-repository__unavailable {
  padding: var(--size-4-4);
}
.abele-node-repository__controls {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
  flex: 1 1 auto;
}
.abele-node-repository__picker {
  min-width: 0;
  flex: 0 1 auto;
  justify-content: flex-start;
  margin-inline-end: auto;
}
.abele-node-repository__picker .abele-obsidian-icon__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.abele-node-repository__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  min-width: 0;
}
body.is-phone .abele-node-repository__editing {
  min-width: calc(var(--size-4-10) + var(--size-4-1));
}
body.is-phone .abele-node-repository__actions .clickable-icon {
  min-width: calc(var(--size-4-10) + var(--size-4-1));
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}
.abele-node-repository__actions select {
  max-width: 100%;
}
.abele-node-repository__meta {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
