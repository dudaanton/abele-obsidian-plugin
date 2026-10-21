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
    <template #lead
      ><StatusDot v-if="needsApproval" tone="orange" :label="t('chatTree.nodeApprovalTip')"
    /></template>
    <template #actions>
      <Icon
        class="abele-node-scope-editor__add"
        icon="plus"
        :disabled="busy || loading || preparing"
        :tooltip="t('chatTree.addNode')"
        @click="addMenu"
      />
      <Icon
        icon="refresh-cw"
        :disabled="busy"
        :tooltip="t('streamB.refreshNodes.d0c8aa')"
        @click="loadNodes"
      />
      <Icon
        v-if="needsApproval"
        class="abele-node-scope-editor__approve"
        icon="shield-check"
        :disabled="busy"
        :tooltip="t('chatTree.nodeApprovalTip')"
        @click="approve"
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
      <div
        v-for="entry in entries"
        :key="nodeScopeKey(entry)"
        class="abele-scope-mgr__entry"
        role="listitem"
      >
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
        <Icon
          class="abele-node-scope-editor__mode"
          :icon="entry.access === 'edit' ? 'pencil' : 'eye'"
          :interactive="!inheritedFrom(entry)"
          :tooltip="
            inheritedFrom(entry)
              ? t('chatTree.inheritedNodeModeTip', { name: inheritedFrom(entry) })
              : entry.access === 'edit'
                ? t('streamB.readAndEdit.4067e8')
                : t('streamB.read.331634')
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
      <EmptyState
        v-if="!entries.length && !nodes.length && !loading"
        :text="t('streamB.noNodesConnectedHereConnectOneFrom.a6484f')"
      />
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
import type { NodeScopeOwner } from '@/ai/tools/node/owner'
import { Menu } from 'obsidian'
import { useChatTreeSource } from '@/chats/chatTree'
import type { NodeAgentHost } from '@/ai/tools/node/agent'
import { delegationBranchLabel } from '@/node/delegation'
import {
  NodeScopeEntriesSchema,
  nodeScopeKey,
  type NodeScopeEntry,
  type NodeChatTarget,
} from '@/ai/nodeScope'
import {
  nodeAgentHost,
  giveObsidianChatAccess,
  setObsidianChatNodeScope,
  removeObsidianChatNodeAccess,
  approveObsidianChatNodeAccess,
} from '@/ai/tools/node/owner'
import Section from './obsidian/Section.vue'
import StatusDot from './obsidian/StatusDot.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'

const props = defineProps<{ session: NodeScopeOwner; folder?: boolean }>()
const parsed = computed(() =>
  NodeScopeEntriesSchema.safeParse(props.session.overrides?.value.nodeScope ?? [])
)
const inheritedFrom = (entry: NodeScopeEntry) =>
  props.session.inheritedNodeScopes?.find((source) =>
    source.entries.some((value) => nodeScopeKey(value) === nodeScopeKey(entry))
  )?.folder
const entries = computed(() => [
  ...new Map(
    [
      ...(parsed.value.success ? parsed.value.data : []),
      ...(props.session.inheritedNodeScopes ?? []).flatMap((source) => source.entries),
    ].map((entry) => [nodeScopeKey(entry), entry])
  ).values(),
])
const nodes = ref<{ id: string; label: string; node_id?: string }[]>([])
const projects = ref<{ id: string; label: string; git: boolean }[]>([])
const targets = ref<{ value: string; display: string; identity: NodeChatTarget }[]>([])
const node = ref('')
/** The form holds the place a refused call wanted. */
const wanted = ref<NodeScopeEntry>()
const preparing = ref(!!pendingNodeAccess.value)
const tree = useChatTreeSource()
const host = shallowRef<NodeAgentHost>()
const states = ref<Record<string, { connected: boolean; approved: boolean }>>({})
const needsApproval = computed(() =>
  entries.value.some((entry) => !states.value[nodeScopeKey(entry)]?.approved)
)
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
        : { entries: await connection.client.listWorkspaces(value, cursor), cursor: null }
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
function refreshStatus() {
  const current = host.value
  if (!current) return
  states.value = Object.fromEntries(
    entries.value.map((entry) => {
      try {
        const connection = current.connection(entry.node_id, props.session)
        return [
          nodeScopeKey(entry),
          {
            connected: connection.client.connected,
            approved: current.ledger
              .approvedEntries(props.session, entry.node_id, connection.principal())
              .some((value) => nodeScopeKey(value) === nodeScopeKey(entry)),
          },
        ]
      } catch {
        return [nodeScopeKey(entry), { connected: false, approved: false }]
      }
    })
  )
}
watch(entries, refreshStatus)
function openFolder(entry: NodeScopeEntry) {
  const folder = inheritedFrom(entry)
  if (folder) tree.value?.folderAccess(folder)
}
function give(entry: NodeScopeEntry) {
  void perform(() => giveObsidianChatAccess(props.session, entry))
}
function addMenu(event: MouseEvent) {
  const menu = new Menu()
  if (wanted.value) {
    const entry = { ...wanted.value }
    menu.addItem((item) =>
      item
        .setTitle(label(entry))
        .setIcon('folder-plus')
        .onClick(() => give(entry))
    )
    menu.addSeparator()
  }
  if (!nodes.value.length)
    menu.addItem((item) => item.setTitle(t('chatTree.connectNode')).setDisabled(true))
  for (const node of nodes.value) {
    const granted = entries.value.some((entry) => entry.node_id === (node.node_id ?? node.id))
    menu.addItem((item) =>
      item
        .setTitle(node.label)
        .setIcon('server')
        .setChecked(granted)
        .onClick(() => {
          if (!granted) give({ kind: 'node', node_id: node.id, access: 'edit' })
          else void locationMenu({ kind: 'node', node_id: node.id, access: 'edit' }, event, true)
        })
    )
  }
  menu.showAtMouseEvent(event)
}
function modeMenu(entry: NodeScopeEntry, event: MouseEvent) {
  if (inheritedFrom(entry) || busy.value) return
  const menu = new Menu()
  for (const access of ['read', 'edit'] as const)
    menu.addItem((item) =>
      item
        .setTitle(access === 'read' ? t('streamB.read.331634') : t('streamB.readAndEdit.4067e8'))
        .setIcon(access === 'read' ? 'eye' : 'pencil')
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
function approve() {
  const chat = props.session,
    current = [...entries.value]
  void perform(() => approveObsidianChatNodeAccess(chat, current))
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
.abele-node-scope-editor__source {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
