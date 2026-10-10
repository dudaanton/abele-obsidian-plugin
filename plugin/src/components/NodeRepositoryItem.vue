<template>
  <div v-if="!source || !target" class="abele-node-repository__unavailable">
    <EmptyState :text="error || 'Connecting to the node…'" />
    <Button v-if="error" text="Try again" icon="refresh-cw" @click="load" />
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
          class="clickable-icon abele-node-repository__picker"
          role="button"
          tabindex="0"
          icon="git-branch"
          :text-right="pickerLabel(shownRef)"
          tooltip="Choose a workspace or version"
          :disabled="offline"
          @click="chooseRepository(file?.path)"
          @keydown.enter.prevent="chooseRepository(file?.path)"
        />
        <Icon
          class="clickable-icon"
          role="button"
          tabindex="0"
          icon="folder-git-2"
          tooltip="Repository actions"
          :disabled="offline || settingsBusy"
          @click="externalMenu"
          @keydown.enter.prevent="externalMenu"
        />
      </div>
    </template>
    <template #repository-details>
      <span v-if="offline" role="status">Node offline · reconnect to refresh.</span>
      <Setting
        v-if="external && live"
        name="External workspace editing"
        :desc="
          editingEnabled
            ? 'Editing allowed for this worktree. Git actions are not enabled.'
            : 'Read only until you allow editing for this worktree.'
        "
      >
        <Checkbox
          class="abele-node-repository__editing"
          :is-enabled="editingEnabled"
          aria-label="Allow external workspace editing"
          :aria-disabled="offline || settingsBusy"
          @toggle="toggleEditing"
        />
      </Setting>
      <span v-else-if="external" class="abele-node-repository__meta"
        >External workspace · historical version · read only</span
      >
      <template v-if="historyOpen">
        <div class="abele-node-repository__actions">
          <span>File history</span
          ><Icon icon="x" tooltip="Close file history" @click="historyOpen = false" />
        </div>
        <EmptyState v-if="historyError" :text="historyError" />
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
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { Menu, Notice, type PaneType } from 'obsidian'
import { confirmAction } from '@/modal/confirm'
import { changeExternalBrowsing } from '@/node/repositorySettings'
import GithubItem from './github/GithubItem.vue'
import GithubCommits from './github/GithubCommits.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import { RepositoryPicker } from '@/node/RepositoryPicker'
import { BasePicker } from '@/github/comparison/BasePicker'
import { basePins } from '@/github/comparison/pins'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
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
      !(await confirmAction(GlobalStore.getInstance().app, {
        title: enabled ? 'Allow editing in this worktree?' : 'Turn off worktree editing?',
        message: enabled
          ? `Allow current files in ${selected.value?.label || 'this external worktree'} to be saved by confirmed node owners? This applies only to this worktree identity, not agent execution or Git actions. Chat edits still require per-edit approval.`
          : 'Stop new saves in this external worktree? Local drafts and unresolved save evidence are kept.',
        confirmText: enabled ? 'Allow editing' : 'Turn off editing',
        confirmTooltip: enabled ? 'Allow saves for this worktree identity' : 'Stop new saves',
      }))
    )
      return
    current.assertCurrent()
    await transport.client.repository.editing({ worktree_id: current.identity.workspace, enabled })
    if (alive && current === source.value) await refreshMutable()
  } catch (e) {
    new Notice(e instanceof Error ? e.message : String(e))
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
const location = computed<RepositoryLocation>(() => {
  const at = target.value!.location,
    revision = target.value?.revision
  // Explicit frozen state stays fixed through a restart. Working tree aliases remain live.
  return revision?.kind === 'commit' && 'ref' in at && at.ref !== WORKING_TREE
    ? { ...at, ref: revision.commit }
    : at
})
const offline = computed(() => connection.value?.state.value !== 'connected')
const selected = computed(() =>
  workspaces.value.find((w) => w.id === target.value?.source.workspace)
)
const external = computed(() => selected.value?.kind === 'external')
const live = computed(() => 'ref' in location.value && location.value.ref === WORKING_TREE)
const projectName = ref('Project')
const updateTitle = () =>
  props.onTitle?.(`${projectName.value} · ${selected.value?.label || 'Workspace'}`)
const pickerLabel = (ref?: string) =>
  ref && /^[a-f\d]{40,64}$/i.test(ref)
    ? ref.slice(0, 7)
    : selected.value?.branch?.replace(/^refs\/heads\//, '') || 'Files'
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
    if (!registered)
      throw new Error('This node was removed. Reconnect it in Abele settings → Nodes.')
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
      throw new Error(
        'This node connection belongs to another installation. Open the repository again.'
      )
    const project = await transport.client.getProject(current.source.project)
    if (!project) throw new Error('This project is no longer registered on the node.')
    const authority = transport.authorizationGeneration
    const labels = {
      node: registered.label,
      project: project.root_path.split(/[\\/]/).pop() || 'Project',
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
        if (!editor) throw new Error('Repository editor unavailable')
        guard()
        if (
          editor.draftError.value ||
          (editor.draftDirty.value && editor.filePath.value === proposal.path)
        )
          throw new Error('Keep or discard the visible local draft before proposing another edit')
        const permission = await transport.client.repository.editingStatus({
          worktree_id: next.identity.workspace,
        })
        guard()
        if (!permission.enabled)
          throw new Error('Editing is off for this worktree; the owner must enable it first')
        const document = await editor.documents.read(proposal.path)
        guard()
        if (document.contentId !== proposal.expected_content_id)
          throw new Error('The proposed base changed; read the file and ask for new approval')
        const existing = await editor.documents.draft(proposal.path)
        guard()
        if (existing && existing.status !== 'saved')
          throw new Error('A local draft already exists. Review it before proposing another edit')
        if (existing) await editor.documents.discard(proposal.path, existing.revision)
        await editor.documents.edit(proposal.path, document, proposal.text, null, guard)
        guard()
        await editor.openFile(proposal.path, undefined, undefined, document)
        editor.editing.value = true
        open(next.navigation.file(WORKING_TREE, proposal.path))
        return 'Approved proposal retained as a local draft in the repository tab. The owner must explicitly Save; no node file was written.'
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
      error.value = `Node unavailable · ${reason instanceof Error ? reason.message : String(reason)}`
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
        confirmAction(GlobalStore.getInstance().app, {
          title: 'External workspace browsing',
          message: enabled
            ? 'Allow this project’s other Git worktrees to be browsed by confirmed node owners? They remain read only. This does not allow agent execution or editing.'
            : 'Stop browsing external workspaces for this project? Open external views and retained reads lose access.',
          confirmText: enabled ? 'Allow browsing' : 'Stop browsing',
          confirmTooltip: enabled
            ? 'Allow read-only browsing of external workspaces'
            : 'Stop external workspace reads',
        })
      )
      if (changed && alive) await load()
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    } finally {
      settingsBusy.value = false
    }
  }
  if (presentation.target?.kind === 'blob') {
    const at = location.value
    if (at.kind === 'file') {
      menu.addItem((item) =>
        item
          .setTitle('File history')
          .setIcon('git-commit-horizontal')
          .onClick(() => {
            void showHistory(at.ref, at.path)
          })
      )
    }
  }
  menu.addItem((item) =>
    item
      .setTitle('Repository home')
      .setIcon('home')
      .onClick(() => open(source.value!.navigation.home()))
  )
  menu.addItem((item) =>
    item
      .setTitle('Compare with another version')
      .setIcon('git-compare')
      .onClick(() =>
        new BasePicker(GlobalStore.getInstance().app, source.value!, presentation.target!).open()
      )
  )
  menu.addItem((item) =>
    item
      .setTitle('Chat about this')
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
        .setTitle('Swap versions')
        .setIcon('arrow-left-right')
        .onClick(() => open(source.value!.navigation.comparison(at.head, at.base!, true)))
    )
  }
  const pins = basePins(GlobalStore.getInstance().app)
  if (source.value && presentation.target && pins.get(presentation.target, source.value.identity))
    menu.addItem((item) =>
      item
        .setTitle('Stop comparing files')
        .setIcon('pin-off')
        .onClick(() => pins.unpin(presentation.target!, source.value!.identity))
    )
  if (presentation.target?.kind === 'blob')
    menu.addItem((item) =>
      item
        .setTitle(presentation.originalFile ? 'Show comparison' : 'Original file')
        .setIcon('file-text')
        .onClick(() => {
          presentation.originalFile = !presentation.originalFile
          save()
        })
    )
  menu.addItem((item) =>
    item
      .setTitle('Allow external workspace browsing')
      .setIcon('folder-git-2')
      .onClick(() => {
        void configure(true)
      })
  )
  menu.addItem((item) =>
    item
      .setTitle('Stop browsing external workspaces')
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
    history.value = await source.value!.commits(ref, path)
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : String(error)
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
              ?.label || 'Node'
          : 'Node',
        presentation.target?.repo || 'Project'
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
    if (!target.value || nodes.some((node) => node.id === target.value!.source.node)) return
    detachTools()
    source.value?.dispose()
    source.value = undefined
    error.value = 'This node was removed. Reconnect it before browsing.'
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
