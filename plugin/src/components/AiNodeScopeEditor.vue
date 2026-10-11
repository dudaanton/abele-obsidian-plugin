<template>
  <div class="abele-node-scope-editor">
    <Setting
      name="Node access"
      desc="Separate from vault access. A whole node includes future registered folders; scope still needs approval on this device."
    >
      <Icon icon="refresh-cw" with-bg tooltip="Refresh nodes" @click="loadNodes" />
    </Setting>
    <EmptyState v-if="loading" variant="loading" text="Loading node folders…" />
    <EmptyState v-if="error" variant="error" :text="error" />
    <EmptyState
      v-if="!parsed.success"
      variant="error"
      text="Invalid node scope. Clear it and choose access again."
    >
      <template #action><Button text="Clear node access" @click="clear" /></template>
    </EmptyState>
    <EmptyState
      v-if="!nodes.length && !loading"
      text="No nodes connected. Connect one from the Node panel."
    />
    <template v-if="nodes.length">
      <Setting name="Node">
        <Dropdown :model-value="node" :options="nodeOptions" @update:model-value="chooseNode" />
      </Setting>
      <Setting
        v-if="node"
        name="Folder"
        desc="Whole node includes every registered folder, now and in the future."
      >
        <Dropdown
          :model-value="project"
          :options="projectOptions"
          @update:model-value="chooseProject"
        />
      </Setting>
      <Setting
        v-if="project"
        name="Worktree"
        desc="Whole folder includes its valid worktrees. Choosing one does not give access to the others."
      >
        <Dropdown
          :model-value="target"
          :options="targetOptions"
          @update:model-value="target = $event"
        />
      </Setting>
      <Setting
        v-if="node"
        name="Access"
        desc="Edit permits file changes; whether they ask first follows this chat's permission mode."
      >
        <Dropdown
          :model-value="access"
          :options="accessOptions"
          @update:model-value="access = $event as 'read' | 'edit'"
        />
        <Button text="Add access" :disabled="busy || loading" @click="add" />
      </Setting>
    </template>
    <Setting
      v-for="entry in entries"
      :key="nodeScopeKey(entry)"
      :name="label(entry)"
      :desc="`${entry.kind === 'node' ? 'Whole node · ' : ''}${entry.access}`"
    >
      <Icon
        icon="x"
        with-bg
        :tooltip="`Remove ${label(entry)} from chat access`"
        @click="remove(entry)"
      />
    </Setting>
    <Setting
      v-if="entries.length"
      name="Local approval"
      desc="Confirm this chat's configured access on this device. Copied or synced settings do not grant access by themselves."
    >
      <Button text="Approve on this device" :disabled="busy" @click="approve" />
    </Setting>
    <EmptyState
      v-else-if="!loading"
      text="This chat has no node access. Full vault access does not include nodes."
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import {
  NodeScopeEntriesSchema,
  nodeScopeKey,
  nodeTargetId,
  type NodeScopeEntry,
  type NodeChatTarget,
} from '@/ai/nodeScope'
import {
  nodeAgentHost,
  setObsidianChatNodeScope,
  removeObsidianChatNodeAccess,
} from '@/ai/tools/node/owner'
import Setting from './obsidian/Setting.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'

const props = defineProps<{ session: ChatSession }>()
const parsed = computed(() =>
  NodeScopeEntriesSchema.safeParse(props.session.overrides.value.nodeScope ?? [])
)
const entries = computed(() => (parsed.value.success ? parsed.value.data : []))
const nodes = ref<{ id: string; label: string; node_id?: string }[]>([])
const projects = ref<{ id: string; label: string; git: boolean }[]>([])
const targets = ref<{ value: string; display: string; identity: NodeChatTarget }[]>([])
const node = ref(''),
  project = ref(''),
  target = ref(''),
  access = ref<'read' | 'edit'>('edit')
const loading = ref(false),
  busy = ref(false),
  error = ref('')
let generation = 0
const nodeOptions = computed(() => [
  { value: '', display: 'Choose a node' },
  ...nodes.value.map((entry) => ({ value: entry.id, display: entry.label })),
])
const projectOptions = computed(() => [
  { value: '', display: 'Whole node' },
  ...projects.value.map((entry) => ({ value: entry.id, display: entry.label })),
])
const targetOptions = computed(() => [{ value: '', display: 'Whole folder' }, ...targets.value])
const accessOptions = [
  { value: 'read', display: 'Read' },
  { value: 'edit', display: 'Read and edit' },
]
function label(entry: NodeScopeEntry) {
  const parts = [
    nodes.value.find((node) => node.id === entry.node_id || node.node_id === entry.node_id)
      ?.label ?? entry.node_id,
  ]
  if (entry.kind !== 'node')
    parts.push(
      projects.value.find((project) => project.id === entry.project_id)?.label ?? entry.project_id
    )
  if (entry.kind === 'target')
    parts.push(
      targets.value.find(
        (target) =>
          target.identity.kind === entry.target.kind &&
          nodeTargetId(target.identity) === nodeTargetId(entry.target)
      )?.display ?? nodeTargetId(entry.target)
    )
  return parts.join(' / ')
}
async function loadNodes() {
  try {
    nodes.value = (await nodeAgentHost()).nodes()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not load nodes'
  }
}
async function chooseNode(value: string) {
  node.value = value
  project.value = ''
  target.value = ''
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
      throw new Error('Node offline. Reconnect before choosing folders.')
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
      const next = batch.at(-1)!.project_id
      if (next === after) throw new Error('Invalid folder cursor')
      after = next
    }
    throw new Error('Too many folders to list')
  } catch (failure) {
    if (generation === version)
      error.value = failure instanceof Error ? failure.message : 'Could not load folders'
  } finally {
    if (generation === version) loading.value = false
  }
}
async function chooseProject(value: string) {
  project.value = value
  target.value = ''
  targets.value = []
  const version = ++generation,
    nodeId = node.value
  if (!value) return
  loading.value = true
  error.value = ''
  try {
    const connection = (await nodeAgentHost()).connection(nodeId)
    if (!connection.client.connected)
      throw new Error('Node offline. Reconnect before choosing worktrees.')
    const git = projects.value.find((project) => project.id === value)?.git
    let cursor: string | undefined
    for (let page = 0; page < 64; page++) {
      const result = git
        ? await connection.client.repository.worktrees({ project_id: value, cursor })
        : { entries: await connection.client.listWorkspaces(value, cursor), cursor: null }
      if (generation !== version) return
      targets.value.push(
        ...result.entries.map((entry) =>
          'worktree_id' in entry
            ? {
                value: entry.worktree_id,
                display: entry.branch ? `${entry.branch} · ${entry.path_label}` : entry.path_label,
                identity: { kind: 'worktree' as const, worktree_id: entry.worktree_id },
              }
            : {
                value: entry.workspace_id,
                display: entry.path,
                identity: { kind: 'workspace' as const, workspace_id: entry.workspace_id },
              }
        )
      )
      if (!result.cursor) return
      if (cursor === result.cursor) throw new Error('Invalid worktree cursor')
      cursor = result.cursor
    }
    throw new Error('Too many worktrees to list')
  } catch (failure) {
    if (generation === version)
      error.value = failure instanceof Error ? failure.message : 'Could not load worktrees'
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
    error.value = failure instanceof Error ? failure.message : 'Could not save node scope'
  } finally {
    busy.value = false
  }
}
function add() {
  const selected = targets.value.find((entry) => entry.value === target.value)
  if (!node.value || (target.value && !selected)) return
  const entry: NodeScopeEntry = !project.value
    ? { kind: 'node', node_id: node.value, access: access.value }
    : selected
      ? {
          kind: 'target',
          node_id: node.value,
          project_id: project.value,
          target: selected.identity,
          access: access.value,
        }
      : { kind: 'project', node_id: node.value, project_id: project.value, access: access.value }
  const chat = props.session,
    next = [...entries.value.filter((value) => nodeScopeKey(value) !== nodeScopeKey(entry)), entry]
  void perform(() => setObsidianChatNodeScope(chat, next))
}
function clear() {
  const chat = props.session
  void perform(() => setObsidianChatNodeScope(chat, []))
}
function approve() {
  const chat = props.session,
    current = [...entries.value]
  void perform(() => setObsidianChatNodeScope(chat, current))
}
function remove(entry: NodeScopeEntry) {
  const chat = props.session
  void perform(() => removeObsidianChatNodeAccess(chat, entry))
}
onMounted(loadNodes)
onUnmounted(() => {
  generation++
})
</script>

<style lang="scss">
.abele-node-scope-editor {
  min-width: 0;
}
</style>
