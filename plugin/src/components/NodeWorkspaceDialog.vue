<template>
  <Modal title="Node workspaces" size="wide" @close="emit('close')">
    <div class="abele-node-workspaces">
      <p>{{ label }} · Isolated worktrees; original checkouts stay unchanged.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <details :open="!model.projects.value.length">
        <summary>Register a project</summary>
        <Setting
          name="Existing project path"
          desc="An absolute path on the node. Folders can be browsed; coding requires a Git repository with a commit."
        >
          <Input v-model="path" aria-label="Project path" placeholder="/path/to/sample-project" />
        </Setting>
        <Setting
          name="Trust this project for execution"
          desc="Claude and pi can execute commands and load configured resources with your user account. Only register code you trust."
        >
          <Checkbox :is-enabled="trusted" @toggle="trusted = !trusted" />
        </Setting>
        <Button
          text="Register project"
          :disabled="busy || !path.trim() || offline"
          @click="act(() => model.register(path.trim(), trusted))"
        />
      </details>
      <Setting name="Project">
        <select
          aria-label="Project"
          :title="project?.root_path"
          :value="model.projectId.value"
          :disabled="busy || offline"
          @change="selectProject"
        >
          <option value="">Choose a project</option>
          <option v-for="p in model.projects.value" :key="p.project_id" :value="p.project_id">
            {{ shortNodePath(p.root_path, 36) }}
          </option>
        </select>
      </Setting>
      <NodePath v-if="project" :path="project.root_path" label="Full project path" />
      <details>
        <summary>Claude permission settings</summary>
        <Setting
          name="Use repository Claude permissions"
          desc="Off by default. Turning this on lets this trusted repository's Claude settings authorize tools without a node approval. User settings can also authorize tools."
        >
          <Checkbox
            v-if="!busy && !offline && project?.trust === 'trusted'"
            :is-enabled="project.use_repository_claude_permissions"
            @toggle="repositoryPermissions"
          />
          <span v-else>Available for a connected trusted project</span>
        </Setting>
      </details>
      <Setting name="Base branch or commit">
        <Input v-model="base" aria-label="Workspace base" placeholder="HEAD" />
      </Setting>
      <div class="abele-node-workspaces__actions">
        <Button
          text="Create workspace"
          icon="plus"
          accent
          :disabled="busy || offline || !project?.repository_path"
          @click="act(() => model.createWorkspace(base.trim()))"
        />
        <Button
          text="Refresh"
          icon="refresh-cw"
          :disabled="busy || offline"
          @click="act(() => model.load())"
        />
      </div>
      <div v-if="latestJobs.length" aria-label="Workspace jobs" class="abele-node-workspaces__jobs">
        <div
          v-for="job in latestJobs"
          :key="job.job_id"
          class="abele-node-workspaces__job"
          role="status"
        >
          <Icon
            :icon="
              job.state === 'succeeded'
                ? 'check'
                : ['queued', 'running'].includes(job.state)
                  ? 'loader'
                  : 'circle-alert'
            "
            no-hover
          />
          <span
            >{{ nodeJobLabel(job)
            }}<template v-if="latestJobs.length > 1">
              ·
              {{
                shortNodePath(
                  model.workspaces.value.find((w) => w.workspace_id === job.workspace_id)?.branch ||
                    'Worktree',
                  26
                )
              }}</template
            ></span
          >
          <span v-if="job.error"> · {{ job.error.replace(/_/g, ' ') }}</span>
        </div>
      </div>
      <Setting name="Workspace">
        <select
          aria-label="Workspace"
          v-model="model.workspaceId.value"
          :title="workspace?.branch || workspace?.path"
          :disabled="busy || offline"
          @change="clearPreview"
        >
          <option value="">Choose a workspace</option>
          <option
            v-for="w in model.workspaces.value.filter((w) => w.state !== 'removed')"
            :key="w.workspace_id"
            :value="w.workspace_id"
          >
            {{ w.branch ? shortNodePath(w.branch, 28) : 'Original checkout' }} ·
            {{ workspaceStateLabels[w.state] }}
          </option>
        </select>
      </Setting>
      <NodePath v-if="workspace" :path="workspace.path" />
      <div class="abele-node-workspaces__actions">
        <Button
          text="Browse workspace files"
          :disabled="busy || offline || workspace?.state !== 'ready'"
          @click="browseFiles"
        />
        <Button
          text="Preview status and diff"
          :disabled="busy || offline || workspace?.state !== 'ready'"
          @click="act(() => model.preview())"
        />

        <Button
          v-if="attached"
          text="Open attached session"
          :disabled="busy"
          @click="emit('session', attached)"
        />
      </div>
      <details v-if="model.diff.value" open>
        <summary>Read-only status and HEAD diff</summary>
        <p>
          Tracked staged and unstaged changes against HEAD. Untracked paths are listed, but their
          contents are not in this diff. This is a current preview, not an immutable snapshot.
        </p>
        <ul>
          <li v-for="entry in model.status.value" :key="entry.path">
            <code>{{ entry.index }}{{ entry.worktree }}</code>
            {{ entry.original_path ? entry.original_path + ' → ' : '' }}{{ entry.path }}
          </li>
        </ul>
        <p v-if="!model.status.value.length">Clean workspace</p>
        <details>
          <summary>
            HEAD {{ model.diff.value.head_commit.slice(0, 8) }} · Base
            {{ model.diff.value.base_commit?.slice(0, 8) || '—' }}
          </summary>
          <code>{{ model.diff.value.head_commit }} · {{ model.diff.value.base_commit }}</code>
        </details>
        <pre>{{ model.diff.value.diff || 'No tracked changes' }}</pre>
      </details>
      <Setting name="Session title"
        ><Input v-model="title" aria-label="Node session title"
      /></Setting>
      <Setting name="Provider">
        <select v-model="provider" aria-label="Node provider">
          <option value="">Choose an available provider</option>
          <option
            v-for="p in providers"
            :key="p.provider"
            :value="p.provider"
            :disabled="!providerAvailable(p)"
          >
            {{ providerLabel(p.provider)
            }}{{ providerAvailable(p) ? '' : ' · ' + (p.diagnostic || 'Unavailable') }}
          </option>
        </select>
      </Setting>
      <Button
        text="Start session in workspace"
        accent
        :disabled="
          busy ||
          offline ||
          workspace?.kind !== 'managed' ||
          workspace?.state !== 'ready' ||
          !!attached ||
          !title.trim() ||
          !selectedProvider ||
          !providerAvailable(selectedProvider)
        "
        @click="start"
      />
      <details>
        <summary>Provider availability and effective configuration</summary>
        <p v-for="p in providers" :key="p.provider">
          {{ providerLabel(p.provider) }} · {{ providerAvailable(p) ? 'Available' : 'Unavailable'
          }}<template v-if="p.configuration?.model"> · {{ p.configuration.model }}</template
          ><template v-if="p.configuration?.profile">
            · {{ p.configuration.profile }} settings</template
          >
          <template v-if="p.diagnostic"> · {{ p.diagnostic }}</template>
        </p>
        <template v-for="p in providers" :key="`features-${p.provider}`">
          <p v-for="(gate, feature) in p.capabilities" :key="feature">
            {{ providerLabel(p.provider) }} · {{ feature }} · {{ gate.status }} ·
            {{ gate.status === 'supported' ? gate.evidence : gate.reason }}
          </p>
        </template>
        <details>
          <summary>Technical details</summary>
          <pre>{{
            JSON.stringify({ node: model.description.value, jobs: model.jobs.value }, null, 2)
          }}</pre>
        </details>
      </details>
      <details class="abele-node-workspaces__danger">
        <summary>Detach or remove</summary>
        <div class="abele-node-workspaces__actions">
          <Button
            v-if="attached"
            text="Detach session"
            :disabled="busy || offline"
            @click="detach"
          />
          <Button
            text="Remove unused workspace"
            warning
            :disabled="busy || offline || workspace?.kind !== 'managed' || !!attached"
            @click="removeWorkspace"
          />
          <Button
            text="Unregister project"
            warning
            :disabled="busy || offline || !project"
            @click="unregister"
          />
        </div>
      </details>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NodeFilesModel } from '@/node/NodeFilesModel'
import { openNodeFiles } from '@/node/openFiles'
import type { NodeWorkspaceModel, NodeSession } from '@/node/NodeWorkspaceModel'
import type { NodeConnection } from '@/node/NodeService'
import {
  nodeProviders,
  providerAvailable,
  providerLabel,
  type NodeProviderName,
} from '@/node/providers'
import { nodeJobLabel, shortNodePath, workspaceStateLabels } from '@/node/presentation'
import Icon from './obsidian/Icon.vue'
import NodePath from './NodePath.vue'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
const confirm = (options: Parameters<typeof confirmAction>[1]) =>
  confirmAction(GlobalStore.getInstance().app, {
    ...options,
    confirmText: 'Confirm',
    confirmTooltip: 'Confirm this action',
  })
import Modal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
const browseFiles = async () => {
  const selected = workspace.value
  if (!selected || selected.state !== 'ready' || offline.value || busy.value) return
  await act(async () => {
    const nodeId = await props.connection.client.store.transaction((s) => s.node_id)
    if (!nodeId) throw new Error('Reconnect before browsing files')
    const model = new NodeFilesModel(props.connection.client, nodeId, selected.workspace_id)
    emit('close')
    openNodeFiles(model, props.connection)
  })
}
const props = defineProps<{
  model: NodeWorkspaceModel
  connection: NodeConnection
  label: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'session', session: NodeSession): void }>()
const path = ref(''),
  base = ref('HEAD'),
  title = ref('Coding task'),
  trusted = ref(false)
const provider = ref<NodeProviderName | ''>('claude')
const busy = ref(false),
  error = ref('')
const offline = computed(() => props.connection.state.value !== 'connected')
const project = computed(() =>
  props.model.projects.value.find((p) => p.project_id === props.model.projectId.value)
)
const workspace = computed(() =>
  props.model.workspaces.value.find(
    (w) => w.workspace_id === props.model.workspaceId.value && w.state !== 'removed'
  )
)
const latestJobs = computed(() => {
  const byWorkspace = new Map<string, (typeof props.model.jobs.value)[number]>()
  for (const job of props.model.jobs.value) {
    const previous = byWorkspace.get(job.workspace_id)
    if (!previous || previous.created_at < job.created_at) byWorkspace.set(job.workspace_id, job)
  }
  return [...byWorkspace.values()]
})
const providers = computed(() => nodeProviders(props.model.description.value))
const selectedProvider = computed(() => providers.value.find((p) => p.provider === provider.value))
watch(providers, (reports) => {
  if (!reports.some((p) => p.provider === provider.value && providerAvailable(p)))
    provider.value = reports.find(providerAvailable)?.provider ?? ''
})
const attached = computed(() =>
  props.model.sessions.value.find((s) => s.workspace_id === props.model.workspaceId.value)
)
const act = async (work: () => Promise<unknown>) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Node request failed'
  } finally {
    busy.value = false
  }
}
const clearPreview = () => {
  props.model.diff.value = undefined
  props.model.status.value = []
}
const selectProject = (e: Event) => {
  clearPreview()
  void act(() => props.model.selectProject((e.target as HTMLSelectElement).value))
}
const start = () =>
  act(async () => {
    if (!provider.value || !selectedProvider.value || !providerAvailable(selectedProvider.value))
      return
    emit('session', await props.model.startSession(title.value.trim(), provider.value))
  })
const repositoryPermissions = () =>
  act(async () => {
    if (!project.value) return
    await props.model.client.setProjectClaudePermissions(
      project.value.project_id,
      !project.value.use_repository_claude_permissions
    )
    await props.model.load()
  })
const removeWorkspace = () =>
  act(async () => {
    const target = workspace.value
    if (
      !target ||
      target.kind !== 'managed' ||
      !(await confirm({
        title: 'Remove unused workspace?',
        message: 'Only a clean, unused managed worktree can be removed. Its branch is retained.',
      }))
    )
      return
    // A catalog refresh must not retarget the action that was confirmed.
    if (workspace.value?.workspace_id !== target.workspace_id) return
    props.model.reservation.value = await props.model.client.removeWorkspace(target.workspace_id)
    clearPreview()
    await props.model.load()
  })
const unregister = () =>
  act(async () => {
    const target = project.value
    if (
      !target ||
      !(await confirm({
        title: 'Unregister project?',
        message: 'The original checkout is retained. Remove managed workspaces first.',
      }))
    )
      return
    if (project.value?.project_id !== target.project_id) return
    await props.model.client.removeProject(target.project_id)
    await props.model.load()
  })
const detach = () =>
  act(async () => {
    if (
      !attached.value ||
      !(await confirm({
        title: 'Detach session?',
        message:
          'Release this workspace without deleting the session history. Running or queued work must settle first.',
      }))
    )
      return
    await props.model.client.detachSession(attached.value.session_id)
    await props.model.load()
  })
let stop: (() => void) | undefined
let dirty = false
const reload = async () => {
  dirty = true
  if (busy.value) return
  await act(async () => {
    while (dirty) {
      dirty = false
      await props.model.load()
    }
  })
}
watch(busy, (value) => {
  if (!value && dirty) void reload()
})
watch(() => [props.model.projectId.value, props.model.workspaceId.value], clearPreview)
watch(props.connection.state, (state) => {
  if (state === 'connected') void act(subscribe)
})
const subscribe = async () => {
  await props.model.client.subscribe('catalog')
  dirty = false
  await props.model.load()
}
onMounted(() => {
  stop = props.model.client.onEvent((e) => {
    if (e.stream_id === 'catalog') void reload()
  })
  void act(async () => {
    await props.connection.connect()
    await subscribe()
  })
})
onUnmounted(() => {
  stop?.()
  dirty = false
})
</script>
<style lang="scss">
.abele-node-workspaces {
  min-width: 0;
  overflow-wrap: anywhere;
  select {
    max-width: 100%;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .setting-item {
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }
  .setting-item-control {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
  }
  &__job {
    display: flex;
    align-items: center;
    gap: var(--size-4-1);
    margin-block: var(--size-4-1);
    color: var(--text-muted);
  }
  &__danger {
    margin-top: var(--size-4-4);
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    padding: var(--size-4-1);
  }
}
</style>
