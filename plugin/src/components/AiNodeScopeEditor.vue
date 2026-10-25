<template>
  <Section
    class="abele-node-scope-editor"
    :title="t('streamB.nodes.7ac362')"
    :tooltip="
      [t('chatTree.nodesHeadingTip'), folder ? t('chatTree.accessHint') : '']
        .filter(Boolean)
        .join(' ')
    "
  >
    <template #actions>
      <Icon
        class="abele-node-scope-editor__add"
        icon="plus"
        :disabled="busy || loading || preparing"
        :tooltip="t('chatTree.addNodeFolder')"
        @click="addFolder"
      />
      <Icon
        icon="refresh-cw"
        :disabled="busy"
        :tooltip="t('streamB.refreshNodes.d0c8aa')"
        @click="loadNodes"
      />
    </template>
    <EmptyState v-if="loading" variant="loading" :text="t('streamB.loadingNodeFolders.1fb024')" />
    <EmptyState v-if="error" variant="error" :text="error" />
    <EmptyState
      v-if="!parsed.success"
      variant="error"
      :text="t('streamB.invalidNodeScopeClearItAndChoose.50b4c7')"
    >
      <template #action
        ><Button :text="t('streamB.clearNodeAccess.cf2e5c')" @click="clear"
      /></template>
    </EmptyState>
    <div class="abele-scope-mgr__entries" role="list" :aria-label="t('streamB.nodeAccess.bc448d')">
      <template v-for="entry in entries" :key="nodeScopeKey(entry)">
        <div class="abele-scope-mgr__entry" role="listitem">
          <Icon
            :icon="entry.kind === 'node' ? 'server' : 'folder-git-2'"
            :interactive="!inheritedFrom(entry)"
            :tooltip="
              entry.kind === 'node'
                ? t('streamB.wholeNodeIncludesEveryRegisteredFolderNow.3773fc')
                : label(entry)
            "
            @click="(event) => locationMenu(entry, event)"
          />
          <span class="abele-scope-mgr__entry-path"
            >{{ label(entry) }}
            <span
              v-if="inheritedFrom(entry)"
              class="abele-scope-mgr__entry-type abele-node-scope-editor__source"
              >{{ t('chatTree.fromFolder', { name: inheritedFrom(entry) }) }}</span
            >
          </span>
          <StatusDot
            v-if="!states[nodeScopeKey(entry)]?.connected"
            tone="faint"
            :label="t('chatTree.nodeDisconnected')"
          />
          <StatusDot
            v-if="stillAsks(entry)"
            tone="orange"
            :label="t('chatTree.nodeStillAsks', { node: nodeName(entry) })"
          />
          <!-- What the agent may do here, one level: read, edit, or edit and run commands and hand
             tasks to the node's agents. Whether it asks first is the chat's one switch below. -->
          <Icon
            class="abele-node-scope-editor__mode"
            :icon="LEVEL[entry.access].icon"
            :interactive="!inheritedFrom(entry)"
            :tooltip="
              inheritedFrom(entry)
                ? t('chatTree.inheritedNodeModeTip', { name: inheritedFrom(entry) })
                : LEVEL[entry.access].said
            "
            @click="(event) => modeMenu(entry, event)"
          />
          <Icon
            v-if="inheritedFrom(entry)"
            class="abele-node-scope-editor__folder"
            icon="folder"
            :tooltip="t('chatTree.inheritedNodeModeTip', { name: inheritedFrom(entry) })"
            @click="openFolder(entry)"
          />
          <Icon
            v-else
            class="abele-scope-mgr__entry-remove"
            icon="x"
            :disabled="busy"
            :tooltip="t('streamB.removeFromChatAccess.f736f6', { v0: String(label(entry)) })"
            @click="remove(entry)"
          />
        </div>
        <!-- Commands without asking that the node itself turns back into questions: why, and the
           node's own switch as a command to copy, under the folder's name. -->
        <div v-if="stillAsks(entry)" class="abele-node-scope-editor__under">
          <Icon class="abele-node-scope-editor__room" icon="x" interactive disabled />
          <div class="abele-node-scope-editor__note abele-node-scope-editor__note_stack">
            <span class="abele-node-scope-editor__why">{{
              t('chatTree.nodeStillAsks', { node: nodeName(entry) })
            }}</span>
            <NodeBypassHelp :expanded="bypassHelpOpen ?? true" />
          </div>
          <Icon class="abele-node-scope-editor__room" icon="x" interactive disabled />
        </div>
      </template>
      <EmptyState
        v-if="!entries.length && !nodes.length && !loading"
        :text="t('streamB.noNodesConnectedHereConnectOneFrom.a6484f')"
      />
      <EmptyState v-else-if="!entries.length && !loading" :text="t('chatTree.nodeNone')">
        <template #action
          ><Button
            icon="folder-plus"
            :text="t('chatTree.addNodeFolder')"
            :disabled="busy || preparing"
            @click="addFolder"
        /></template>
      </EmptyState>
    </div>
  </Section>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref, shallowRef, onMounted, onUnmounted, watch } from 'vue'
import {
  nodeScopeNames,
  nodeScopeTitle,
  folderLabels,
  shortBranch,
  type NodeScopeNames,
} from '@/ai/tools/node/scopeNames'
import { pendingNodeAccess } from './chat/nodeAccessPending'
import { nodeProviders } from '@/node/providers'
import type { NodeScopeOwner } from '@/ai/tools/node/owner'
import { Menu } from 'obsidian'
import { useChatTreeSource } from '@/chats/chatTree'
import type { NodeAgentHost } from '@/ai/tools/node/agent'
import { delegationBranchLabel } from '@/node/delegation'
import {
  NodeScopeEntriesSchema,
  combineNodeScopeEntries,
  nodeScopeKey,
  type NodeScopeEntry,
  type NodeChatTarget,
} from '@/ai/nodeScope'
import {
  nodeAgentHost,
  giveObsidianChatAccess,
  setObsidianChatNodeScope,
  removeObsidianChatNodeAccess,
} from '@/ai/tools/node/owner'
import Section from './obsidian/Section.vue'
import StatusDot from './obsidian/StatusDot.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'
import NodeBypassHelp from './NodeBypassHelp.vue'
import { NodeFolderPicker, nodeFolderChoices } from './nodeFolderPicker'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  session: NodeScopeOwner & { permissionMode?: { value: string } }
  folder?: boolean
  /** The node's own switch shown open, as after a press on the orange line. */
  bypassHelpOpen?: boolean
}>()

/** One level per folder, as a glyph and in words, from reading to running commands there. */
const LEVEL = {
  read: { icon: 'eye', said: t('streamB.read.331634') },
  edit: { icon: 'pencil', said: t('streamB.readAndEdit.4067e8') },
  run: { icon: 'square-terminal', said: t('chatTree.nodeEditRun') },
} as const
/** A folder where commands go without asking by the chat, but its node asks anyway. */
const stillAsks = (entry: NodeScopeEntry) =>
  entry.access === 'run' &&
  props.session.permissionMode?.value === 'allow-all' &&
  states.value[nodeScopeKey(entry)]?.bypass === false
const nodeName = (entry: NodeScopeEntry) => names.value[nodeScopeKey(entry)]?.node ?? label(entry)
const parsed = computed(() =>
  NodeScopeEntriesSchema.safeParse(
    props.session.overrides?.value.nodeScope ?? props.session.agent?.value?.nodeScope ?? []
  )
)
const inheritedFrom = (entry: NodeScopeEntry) =>
  props.session.inheritedNodeScopes?.find((source) =>
    source.entries.some((value) => nodeScopeKey(value) === nodeScopeKey(entry))
  )?.folder
const entries = computed(() =>
  combineNodeScopeEntries([
    ...(parsed.value.success ? parsed.value.data : []),
    ...(props.session.inheritedNodeScopes ?? []).flatMap((source) => source.entries),
  ])
)
const nodes = ref<{ id: string; label: string; node_id?: string }[]>([])
const projects = ref<{ id: string; label: string; git: boolean }[]>([])
const targets = ref<{ value: string; display: string; identity: NodeChatTarget }[]>([])
const node = ref('')
/** The form holds the place a refused call wanted. */
const wanted = ref<NodeScopeEntry>()
const preparing = ref(!!pendingNodeAccess.value)
const tree = useChatTreeSource()
const host = shallowRef<NodeAgentHost>()
const states = ref<Record<string, { connected: boolean; bypass?: boolean }>>({})
const loading = ref(false),
  busy = ref(false),
  error = ref('')
let generation = 0
/** Each entry by its names — node, folder, branch — looked up from the node, never its ids. */
const names = ref<Record<string, NodeScopeNames>>({})
watch(
  entries,
  async (list) => {
    const found = await Promise.all(
      list.map(async (e) => [nodeScopeKey(e), await nodeScopeNames(e)] as const)
    )
    names.value = Object.fromEntries(found)
  },
  { immediate: true }
)
function label(entry: NodeScopeEntry) {
  const n = names.value[nodeScopeKey(entry)]
  if (!n) {
    const known = nodes.value.find(
      (node) => node.id === entry.node_id || node.node_id === entry.node_id
    )
    return known?.label ?? entry.node_id
  }
  return n.folder ? `${n.node} / ${nodeScopeTitle(n)}` : n.node
}
async function loadNodes() {
  try {
    host.value = await nodeAgentHost()
    nodes.value = host.value.nodes()
    refreshStatus()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('streamB.couldNotLoadNodes.260985')
  }
}
async function chooseNode(value: string) {
  node.value = value
  projects.value = []
  targets.value = []
  const version = ++generation
  if (!value) return
  loading.value = true
  error.value = ''
  try {
    const host = await nodeAgentHost(),
      connection = host.connection(value)
    if (!connection.client.connected)
      throw new Error(t('streamB.nodeOfflineReconnectBeforeChoosingFolders.e3c368'))
    let after: string | undefined
    for (let page = 0; page < 64; page++) {
      const batch = await connection.client.listProjects(after)
      if (generation !== version) return
      projects.value.push(
        ...batch.map((entry) => ({
          id: entry.project_id,
          label: entry.root_path,
          git: !!entry.repository_path,
        }))
      )
      if (batch.length < 100) return
      const next = batch.at(-1).project_id
      if (next === after) throw new Error(t('streamB.invalidFolderCursor.8d7983'))
      after = next
    }
    throw new Error(t('streamB.tooManyFoldersToList.7ffc78'))
  } catch (failure) {
    if (generation === version)
      error.value =
        failure instanceof Error ? failure.message : t('streamB.couldNotLoadFolders.d44279')
  } finally {
    if (generation === version) loading.value = false
  }
}
async function chooseProject(value: string) {
  targets.value = []
  const version = ++generation,
    nodeId = node.value
  if (!value) return
  loading.value = true
  error.value = ''
  try {
    const connection = (await nodeAgentHost()).connection(nodeId)
    if (!connection.client.connected)
      throw new Error(t('streamB.nodeOfflineReconnectBeforeChoosingWorktrees.a20c86'))
    const git = projects.value.find((project) => project.id === value)?.git
    let cursor: string | undefined
    for (let page = 0; page < 64; page++) {
      const result = git
        ? await connection.client.repository.worktrees({ project_id: value, cursor })
        : {
            entries: await connection.client.listWorkspaces(value, cursor),
            cursor: null as string | null,
          }
      if (generation !== version) return
      targets.value.push(
        ...result.entries.map((entry) => {
          if ('worktree_id' in entry) {
            const parent = props.session.delegationParentId
            const title =
              parent && entry.workspace_id
                ? connection.childTitle?.(parent, entry.workspace_id)
                : undefined
            return {
              value: entry.worktree_id,
              display: title
                ? [title, delegationBranchLabel(entry.branch)].filter(Boolean).join(' · ')
                : entry.branch
                  ? `${shortBranch(entry.branch)} · ${entry.path_label}`
                  : entry.path_label,
              identity: { kind: 'worktree' as const, worktree_id: entry.worktree_id },
            }
          }
          return {
            value: entry.workspace_id,
            display: entry.path,
            identity: { kind: 'workspace' as const, workspace_id: entry.workspace_id },
          }
        })
      )
      if (!result.cursor) return
      if (cursor === result.cursor) throw new Error(t('streamB.invalidWorktreeCursor.cb1bdb'))
      cursor = result.cursor
    }
    throw new Error(t('streamB.tooManyWorktreesToList.543350'))
  } catch (failure) {
    if (generation === version)
      error.value =
        failure instanceof Error ? failure.message : t('streamB.couldNotLoadWorktrees.b82e5c')
  } finally {
    if (generation === version) loading.value = false
  }
}
async function perform(work: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : t('streamB.couldNotSaveNodeScope.b43acb')
  } finally {
    busy.value = false
    refreshStatus()
  }
}
let refreshingStatus = false
async function refreshStatus() {
  const current = host.value
  if (!current || refreshingStatus) return
  refreshingStatus = true
  const snapshot = entries.value
  const descriptions = new Map<string, Promise<unknown>>()
  try {
    const result = await Promise.all(
      snapshot.map(async (entry) => {
        try {
          const connection = current.connection(entry.node_id, props.session)
          if (!connection.client.connected) return [nodeScopeKey(entry), { connected: false }]
          let description = descriptions.get(entry.node_id)
          if (!description) {
            description = connection.client.describe()
            descriptions.set(entry.node_id, description)
          }
          const providers = nodeProviders(await description).filter(
            (provider) => provider.available !== false
          )
          const modes = providers.flatMap(
            (provider) =>
              provider.configuration?.permission_modes ?? provider.permission_modes ?? []
          )
          return [
            nodeScopeKey(entry),
            {
              connected: connection.client.connected,
              bypass: modes.length ? modes.includes('bypassPermissions') : undefined,
            },
          ]
        } catch {
          return [nodeScopeKey(entry), { connected: false }]
        }
      })
    )
    if (entries.value === snapshot) states.value = Object.fromEntries(result)
  } finally {
    refreshingStatus = false
  }
}
watch(entries, refreshStatus)
function openFolder(entry: NodeScopeEntry) {
  const folder = inheritedFrom(entry)
  if (folder) tree.value?.folderAccess(folder)
}
function give(entry: NodeScopeEntry) {
  void perform(() => giveObsidianChatAccess(props.session, entry))
}
/** Every folder of the connected nodes, searchable; one press gives the chat that place. */
async function addFolder() {
  try {
    const choices = await nodeFolderChoices(host.value ?? (await nodeAgentHost()))
    new NodeFolderPicker(GlobalStore.getInstance().app, choices, (choice) =>
      give(choice.entry)
    ).open()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('streamB.couldNotLoadNodes.260985')
  }
}
function modeMenu(entry: NodeScopeEntry, event: MouseEvent) {
  if (inheritedFrom(entry) || busy.value) return
  const menu = new Menu()
  for (const access of ['read', 'edit', 'run'] as const)
    menu.addItem((item) =>
      item
        .setTitle(LEVEL[access].said)
        .setIcon(LEVEL[access].icon)
        .setChecked(entry.access === access)
        .onClick(() => give({ ...entry, access }))
    )
  menu.showAtMouseEvent(event)
}
async function replace(entry: NodeScopeEntry, next: NodeScopeEntry, append = false) {
  await perform(async () => {
    if (!append && nodeScopeKey(entry) !== nodeScopeKey(next))
      await removeObsidianChatNodeAccess(props.session, entry)
    await giveObsidianChatAccess(props.session, next)
  })
}
async function locationMenu(entry: NodeScopeEntry, event: MouseEvent, append = false) {
  if (inheritedFrom(entry) || busy.value) return
  await chooseNode(entry.node_id)
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.wholeNode.7eee73'))
      .setIcon('server')
      .setChecked(entry.kind === 'node')
      .onClick(() => {
        void replace(entry, { kind: 'node', node_id: entry.node_id, access: entry.access }, append)
      })
  )
  const labels = folderLabels(projects.value.map((project) => project.label))
  for (const [index, project] of projects.value.entries())
    menu.addItem((item) =>
      item
        .setTitle(labels[index])
        .setIcon('folder-git-2')
        .setChecked(entry.kind !== 'node' && entry.project_id === project.id)
        .onClick(() => {
          void projectMenu(entry, project.id, event, append)
        })
    )
  menu.showAtMouseEvent(event)
}
async function projectMenu(
  entry: NodeScopeEntry,
  project: string,
  event: MouseEvent,
  append = false
) {
  await chooseProject(project)
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.wholeFolder.b38f07'))
      .setIcon('folder')
      .setChecked(entry.kind === 'project' && entry.project_id === project)
      .onClick(() => {
        void replace(
          entry,
          {
            kind: 'project',
            node_id: entry.node_id,
            project_id: project,
            access: entry.access,
          },
          append
        )
      })
  )
  for (const target of targets.value)
    menu.addItem((item) =>
      item
        .setTitle(target.display)
        .setIcon('git-branch')
        .setChecked(
          entry.kind === 'target' &&
            JSON.stringify(entry.target) === JSON.stringify(target.identity)
        )
        .onClick(() => {
          void replace(entry, {
            kind: 'target',
            node_id: entry.node_id,
            project_id: project,
            target: target.identity,
            access: entry.access,
          })
        })
    )
  menu.showAtMouseEvent(event)
}
function clear() {
  const chat = props.session
  void perform(() => setObsidianChatNodeScope(chat, []))
}
function remove(entry: NodeScopeEntry) {
  const chat = props.session
  void perform(() => removeObsidianChatNodeAccess(chat, entry))
}
let statusTimer: number | undefined
onMounted(async () => {
  try {
    statusTimer = window.setInterval(refreshStatus, 1000)
    await loadNodes()
    const want = pendingNodeAccess.value
    if (!want) return
    pendingNodeAccess.value = null
    const registration =
      nodes.value.find((node) => node.id === want.node_id || node.node_id === want.node_id)?.id ??
      want.node_id
    if (!registration) return
    await chooseNode(registration)
    if (want.project_id) await chooseProject(want.project_id)
    wanted.value = !want.project_id
      ? { kind: 'node', node_id: registration, access: want.access ?? 'edit' }
      : want.target
        ? {
            kind: 'target',
            node_id: registration,
            project_id: want.project_id,
            target: want.target,
            access: want.access ?? 'edit',
          }
        : {
            kind: 'project',
            node_id: registration,
            project_id: want.project_id,
            access: want.access ?? 'edit',
          }
    names.value = {
      ...names.value,
      [nodeScopeKey(wanted.value)]: await nodeScopeNames(wanted.value),
    }
  } finally {
    preparing.value = false
  }
})
onUnmounted(() => {
  generation++
  if (statusTimer) window.clearInterval(statusTimer)
})
</script>

<style lang="scss">
// One quiet line under the folders: an orange dot, why, and the button or switch that helps.
.abele-node-scope-editor__note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-2) var(--size-4-2);
  font-size: var(--font-ui-small);
}
// Why the node still asks, and its own switch under it, the two on the edge of the rows above.
.abele-node-scope-editor__note_stack {
  flex-direction: column;
  align-items: stretch;
  flex: 1 1 auto;
  min-width: 0;
  margin-block-end: var(--size-4-2);
}
.abele-node-scope-editor__note_stack .abele-node-scope-editor__why {
  flex: none;
}
.abele-node-scope-editor__why {
  flex: 1 1 12em;
  color: var(--text-muted);
}
.abele-node-scope-editor__actions {
  display: flex;
  flex-direction: column;
}
// What the agent may do besides files reads as the folders read: the same row, a glyph for what
// it is, the mode in the column of the folders' read or edit.
.abele-node-scope-editor__kind.abele-obsidian-icon_disabled {
  opacity: 1;
  color: var(--text-faint);
  cursor: default;
}
// What belongs to a row stands under its words and ends under its mode: the row's own columns,
// the glyph places kept empty.
// A phone gives the note the row's last column too: a command to copy needs the width.
body.is-phone .abele-node-scope-editor__under > .abele-node-scope-editor__room:last-child {
  display: none;
}
.abele-node-scope-editor__under {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: 0 var(--size-4-1) 0 var(--size-4-2);
}
.abele-node-scope-editor__action_off .abele-scope-mgr__entry-path {
  color: var(--text-faint);
}
.abele-node-scope-editor__room {
  visibility: hidden;
}
.abele-node-scope-editor__source {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
