<template>
  <div ref="root" class="abele-node-scope-editor">
    <Setting
      class="abele-node-scope-editor__head"
      name="Node access"
      desc="Separate from vault access. A whole node includes future registered folders."
    >
      <Icon icon="refresh-cw" tooltip="Refresh nodes" @click="loadNodes" />
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
    <!-- What this chat may reach on its nodes, as the vault's places above it. -->
    <div class="abele-scope-mgr__entries" role="list" aria-label="Node access">
      <div
        v-for="entry in entries"
        :key="nodeScopeKey(entry)"
        class="abele-scope-mgr__entry"
        role="listitem"
      >
        <Icon :icon="entry.kind === 'node' ? 'server' : 'folder-git-2'" />
        <span class="abele-scope-mgr__entry-path">{{ label(entry) }}</span>
        <span class="abele-scope-mgr__entry-type">
          {{ entry.access === 'edit' ? 'read and edit' : 'read' }}
        </span>
        <Icon
          class="abele-scope-mgr__entry-remove"
          icon="x"
          :tooltip="`Remove ${label(entry)} from chat access`"
          @click="remove(entry)"
        />
      </div>
      <EmptyState v-if="!entries.length && !loading && nodes.length" text="No node access yet." />
    </div>
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
        <Button
          class="abele-node-scope-editor__add"
          text="Add access"
          :accent="wanted"
          :disabled="busy || loading"
          @click="add"
        />
      </Setting>
    </template>
    <EmptyState
      v-else-if="!loading"
      text="No nodes connected here. Connect one from the Node panel."
    />
    <Setting
      v-if="entries.length"
      name="Local approval"
      desc="Confirm this chat's configured access on this device. Copied or synced settings do not grant access by themselves."
    >
      <Button text="Approve on this device" :disabled="busy" @click="approve" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue'
import { nodeScopeNames, nodeScopeTitle, type NodeScopeNames } from '@/ai/tools/node/scopeNames'
import { pendingNodeAccess } from './chat/nodeAccessPending'
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
  giveObsidianChatAccess,
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
  NodeScopeEntriesSchema.safeParse(props.session.overrides?.value.nodeScope ?? [])
)
const entries = computed(() => (parsed.value.success ? parsed.value.data : []))
const nodes = ref<{ id: string; label: string; node_id?: string }[]>([])
const projects = ref<{ id: string; label: string; git: boolean }[]>([])
const targets = ref<{ value: string; display: string; identity: NodeChatTarget }[]>([])
const node = ref(''),
  project = ref(''),
  target = ref(''),
  access = ref<'read' | 'edit'>('edit')
/** The form holds the place a refused call wanted. */
const wanted = ref(false)
const root = ref<HTMLElement>()
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
  if (!n) return entry.node_id
  return n.folder ? `${n.node} / ${nodeScopeTitle(n)}` : n.node
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
      const next = batch.at(-1).project_id
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
  const chat = props.session
  void perform(() => giveObsidianChatAccess(chat, entry))
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
/**
 * Opened from a refused node call: the place the agent wanted is chosen already, read and edit,
 * and the section is brought into view with its Add button ready — one press gives the access.
 */
onMounted(async () => {
  await loadNodes()
  const want = pendingNodeAccess.value
  if (!want) return
  pendingNodeAccess.value = null
  // A chat with no node access at all named no place: the form opens empty for the person to fill.
  if (want.node_id) await chooseNode(want.node_id)
  if (want.node_id && want.project_id) await chooseProject(want.project_id)
  if (want.node_id && want.target) target.value = nodeTargetId(want.target)
  access.value = 'edit'
  wanted.value = true
  await nextTick()
  // The press that opened the dialog was for this: the Add button takes the focus from the
  // vault's search field, which would otherwise open its list over the form.
  const add = root.value?.querySelector<HTMLElement>('.abele-node-scope-editor__add')
  root.value?.scrollIntoView({ block: 'start' })
  add?.focus({ preventScroll: true })
})
onUnmounted(() => {
  generation++
})
</script>

<style lang="scss">
/* Refresh stays beside the words, even where a setting's control drops under them. */
.abele-obsidian-setting.abele-node-scope-editor__head {
  grid-template-columns: minmax(0, 1fr) auto;
}

.abele-node-scope-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
</style>
