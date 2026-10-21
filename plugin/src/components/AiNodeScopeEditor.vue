<template>
  <div ref="root" class="abele-node-scope-editor">
    <Setting
      class="abele-node-scope-editor__head"
      :name="t('streamB.nodeAccess.bc448d')"
      :desc="t('streamB.separateFromVaultAccessAWholeNode.da122f')"
    >
      <Icon icon="refresh-cw" :tooltip="t('streamB.refreshNodes.d0c8aa')" @click="loadNodes" />
    </Setting>
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
    <!-- What this chat may reach on its nodes, as the vault's places above it. -->
    <div class="abele-scope-mgr__entries" role="list" :aria-label="t('streamB.nodeAccess.bc448d')">
      <div
        v-for="entry in entries"
        :key="nodeScopeKey(entry)"
        class="abele-scope-mgr__entry"
        role="listitem"
      >
        <Icon :icon="entry.kind === 'node' ? 'server' : 'folder-git-2'" />
        <span class="abele-scope-mgr__entry-path">{{ label(entry) }}</span>
        <span class="abele-scope-mgr__entry-type">
          {{ entry.access === 'edit' ? t('streamB.readAndEdit.4067e8') : t('streamB.read.331634') }}
        </span>
        <Icon
          class="abele-scope-mgr__entry-remove"
          icon="x"
          :tooltip="t('streamB.removeFromChatAccess.f736f6', { v0: String(label(entry)) })"
          @click="remove(entry)"
        />
      </div>
      <EmptyState
        v-if="!entries.length && !loading && nodes.length"
        :text="t('streamB.noNodeAccessYet.e2bac7')"
      />
    </div>
    <template v-if="nodes.length">
      <Setting :name="t('streamB.node.e93372')">
        <Dropdown :model-value="node" :options="nodeOptions" @update:model-value="chooseNode" />
      </Setting>
      <Setting
        v-if="node"
        :name="t('streamB.folder.74ccd4')"
        :desc="t('streamB.wholeNodeIncludesEveryRegisteredFolderNow.3773fc')"
      >
        <Dropdown
          :model-value="project"
          :options="projectOptions"
          @update:model-value="chooseProject"
        />
      </Setting>
      <Setting
        v-if="project"
        :name="t('streamB.worktree.c893ba')"
        :desc="t('streamB.wholeFolderIncludesItsValidWorktreesChoosing.172ffc')"
      >
        <Dropdown
          :model-value="target"
          :options="targetOptions"
          @update:model-value="target = $event"
        />
      </Setting>
      <Setting
        v-if="node"
        :name="t('streamB.access.ec5ba0')"
        :desc="t('streamB.editPermitsFileChangesWhetherTheyAsk.f54437')"
      >
        <Dropdown
          :model-value="access"
          :options="accessOptions"
          @update:model-value="access = $event as 'read' | 'edit'"
        />
        <Button
          class="abele-node-scope-editor__add"
          :text="t('streamB.addAccess.94a120')"
          :accent="wanted"
          :disabled="busy || loading"
          @click="add"
        />
      </Setting>
    </template>
    <EmptyState
      v-else-if="!loading"
      :text="t('streamB.noNodesConnectedHereConnectOneFrom.a6484f')"
    />
    <Setting
      v-if="entries.length"
      :name="t('streamB.localApproval.1982d9')"
      :desc="
        folder
          ? t('chatTree.folderNodeApprovalHint')
          : t('streamB.confirmThisChatSConfiguredAccessOn.df414a')
      "
    >
      <Button :text="t('streamB.approveOnThisDevice.e68f82')" :disabled="busy" @click="approve" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue'
import {
  nodeScopeNames,
  nodeScopeTitle,
  folderLabels,
  shortBranch,
  type NodeScopeNames,
} from '@/ai/tools/node/scopeNames'
import { pendingNodeAccess } from './chat/nodeAccessPending'
import type { NodeScopeOwner } from '@/ai/tools/node/owner'
import { delegationBranchLabel } from '@/node/delegation'
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

const props = defineProps<{ session: NodeScopeOwner; folder?: boolean }>()
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
  { value: '', display: t('streamB.chooseANode.8e9aff') },
  ...nodes.value.map((entry) => ({ value: entry.id, display: entry.label })),
])
const projectOptions = computed(() => {
  // By name, as the node panel says a folder; its `~` path only where two share a name.
  const labels = folderLabels(projects.value.map((entry) => entry.label))
  return [
    { value: '', display: t('streamB.wholeNode.7eee73') },
    ...projects.value.map((entry, i) => ({ value: entry.id, display: labels[i] })),
  ]
})
const targetOptions = computed(() => [
  { value: '', display: t('streamB.wholeFolder.b38f07') },
  ...targets.value,
])
const accessOptions = [
  { value: 'read', display: t('streamB.read.9b9a8d') },
  { value: 'edit', display: t('streamB.readAndEdit.03b53d') },
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
    error.value = failure instanceof Error ? failure.message : t('streamB.couldNotLoadNodes.260985')
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
  // A refusal names the node as the node knows itself; the list holds this device's registrations.
  const registration =
    nodes.value.find((n) => n.id === want.node_id || n.node_id === want.node_id)?.id ?? want.node_id
  if (want.node_id) await chooseNode(registration)
  if (want.node_id && want.project_id) await chooseProject(want.project_id)
  if (want.node_id && want.target) target.value = nodeTargetId(want.target)
  access.value = 'edit'
  wanted.value = true
  await nextTick()
  // The press that opened the dialog was for this: the Add button takes the focus from the
  // vault's search field, which would otherwise open its list over the form.
  // It lands with the button in view: the place above it was chosen for the person already.
  const add = root.value?.querySelector<HTMLElement>('.abele-node-scope-editor__add')
  add?.scrollIntoView({ block: 'center' })
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
