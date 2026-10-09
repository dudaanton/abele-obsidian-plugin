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
    :keys="keys"
    :on-open="open"
    :on-title="onTitle"
    :on-state="save"
  >
    <template #repository-actions="{ file }">
      <div class="abele-node-repository__actions">
        <Button text="Repository" icon="folder-git-2" @click="open(source.navigation.home())" />
        <Dropdown
          :model-value="target.source.workspace"
          :options="workspaceOptions"
          aria-label="Workspace"
          @update:model-value="(workspace) => open(source!.navigation.workspace!(workspace))"
        />
        <Button
          v-if="file"
          text="History"
          icon="git-commit-horizontal"
          @click="showHistory(file.ref, file.path)"
        />
        <Button
          v-if="file && live && managedWorkspace"
          text="Edit file"
          icon="pencil"
          :disabled="offline"
          @click="edit(file.path)"
        />
        <Icon class="clickable-icon" role="button" tabindex="0" icon="folder-git-2" tooltip="External workspace browsing" :disabled="offline || settingsBusy" @click="externalMenu" @keydown.enter.prevent="externalMenu" />
        <span v-if="offline" role="status">Node offline · reconnect to refresh.</span>
        <span v-else-if="external" class="abele-node-repository__meta"
          >External workspace · read only</span
        >
      </div>
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
import Dropdown from './obsidian/Dropdown.vue'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { GlobalStore } from '@/stores/GlobalStore'
import type { GithubViewModel } from '@/github/model'
import type { GithubTarget } from '@/github/urls'
import type { RepositoryLocation, RepositoryWorkspace } from '@/repository/source'
import type { CommitSummary } from '@/repository/model'
import { NodeFilesModel } from '@/node/NodeFilesModel'
import { openNodeFiles } from '@/node/openFiles'
const props = defineProps<{
  model: GithubViewModel
  keys?: { find: number }
  onTitle?: (title: string) => void
  onState?: () => void
}>()
const source = shallowRef<NodeRepositorySource>()
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
const managedWorkspace = computed(() => selected.value?.workspaceId)
const live = computed(() => 'ref' in location.value && location.value.ref === WORKING_TREE)
const workspaceOptions = computed(() =>
  workspaces.value.map((w) => ({
    value: w.id,
    display: `${w.label}${w.kind === 'external' ? ' · External' : ''}${w.dirty ? ' · Changes' : ''}${w.availability !== 'available' ? ` · ${w.availability}` : ''}`,
  }))
)
const presentation: GithubViewModel = reactive({
  url: '',
  target: null,
  nonce: 0,
  screen: props.model.screen,
})
let generation = 0
let alive = true
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
    const labels = {
      node: registered.label,
      project: project.root_path.split(/[\\/]/).pop() || 'Project',
      isCurrent: () =>
        alive &&
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
    source.value?.dispose()
    source.value = next
    workspaces.value = catalog
    setPresentation(labels.node, labels.project)
    void next.startWatching()
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
    const current = source.value, transport = connection.value
    if (!current || !transport) return
    settingsBusy.value = true
    try {
      const changed = await changeExternalBrowsing(transport.client, current, enabled, () => confirmAction(GlobalStore.getInstance().app, {
        title: 'External workspace browsing',
        message: enabled ? 'Allow this project’s other Git worktrees to be browsed by confirmed node owners? They remain read only. This does not allow agent execution or editing.' : 'Stop browsing external workspaces for this project? Open external views and retained reads lose access.',
        confirmText: enabled ? 'Allow browsing' : 'Stop browsing',
        confirmTooltip: enabled ? 'Allow read-only browsing of external workspaces' : 'Stop external workspace reads',
      }))
      if (changed && alive) await load()
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)) }
    finally { settingsBusy.value = false }
  }
  menu.addItem(item => item.setTitle('Allow external workspace browsing').setIcon('folder-git-2').onClick(() => { void configure(true) }))
  menu.addItem(item => item.setTitle('Stop browsing external workspaces').setIcon('folder-closed').onClick(() => { void configure(false) }))
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
const edit = (path: string) => {
  if (external.value || !managedWorkspace.value || !connection.value) return
  const shownSource = source.value
  openNodeFiles(
    new NodeFilesModel(
      connection.value.client,
      connection.value.client.target.expected_node_id || '',
      managedWorkspace.value
    ),
    connection.value,
    path,
    undefined,
    (listener) => shownSource?.subscribe(() => listener()) ?? (() => {})
  )
}
watch(
  () => target.value && JSON.stringify(target.value.source),
  () => {
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
watch(
  () => NodeService.getInstance().nodes.value,
  (nodes) => {
    if (!target.value || nodes.some((node) => node.id === target.value!.source.node)) return
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
    void source.value.startWatching()
  }
  wasOffline = isOffline
})
onBeforeUnmount(() => {
  alive = false
  ++generation
  source.value?.dispose()
})
</script>
<style lang="scss">
.abele-node-repository__unavailable {
  padding: var(--size-4-4);
}
.abele-node-repository__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  min-width: 0;
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
