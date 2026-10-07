<template>
  <Modal title="Node workspaces" size="wide" @close="emit('close')">
    <div class="abele-node-workspaces">
      <p>
        {{ label }} · Each session has its own worktree and branch. The original checkout stays
        unchanged.
      </p>
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
          desc="Claude can execute commands and load configured resources with your user account. Only register code you trust."
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
          :value="model.projectId.value"
          :disabled="busy || offline"
          @change="selectProject"
        >
          <option value="">Choose a project</option>
          <option v-for="p in model.projects.value" :key="p.project_id" :value="p.project_id">
            {{ p.root_path }} · {{ p.trust }}
          </option>
        </select>
      </Setting>
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
          :disabled="busy || offline || !project?.repository_path"
          @click="act(() => model.createWorkspace(base.trim()))"
        />
        <Button text="Refresh" :disabled="busy || offline" @click="act(() => model.load())" />
        <Button
          text="Unregister project"
          :disabled="busy || offline || !project"
          @click="unregister"
        />
      </div>
      <p v-if="model.reservation.value" role="status">
        Workspace reserved · Job {{ model.reservation.value.job_id }}. A session can start only
        after provisioning succeeds.
      </p>
      <ul v-if="model.jobs.value.length" aria-label="Workspace jobs">
        <li v-for="job in model.jobs.value" :key="job.job_id">
          {{
            model.workspaces.value.find((w) => w.workspace_id === job.workspace_id)?.branch ||
            job.workspace_id
          }}
          · {{ job.kind }} · {{ job.state }} · {{ job.phase
          }}<template v-if="job.error"> · {{ job.error }}</template>
        </li>
      </ul>
      <Setting name="Workspace">
        <select
          aria-label="Workspace"
          v-model="model.workspaceId.value"
          :disabled="busy || offline"
          @change="clearPreview"
        >
          <option value="">Choose a workspace</option>
          <option
            v-for="w in model.workspaces.value.filter((w) => w.state !== 'removed')"
            :key="w.workspace_id"
            :value="w.workspace_id"
          >
            {{ w.branch || 'Original checkout (browse only)' }} · {{ w.state }}
          </option>
        </select>
      </Setting>
      <p v-if="workspace">{{ workspace.path }}</p>
      <div class="abele-node-workspaces__actions">
        <Button
          text="Preview status and diff"
          :disabled="busy || offline || workspace?.state !== 'ready'"
          @click="act(() => model.preview())"
        />
        <Button
          text="Remove unused workspace"
          :disabled="busy || offline || workspace?.kind !== 'managed' || !!attached"
          @click="removeWorkspace"
        />
        <Button
          v-if="attached"
          text="Open attached session"
          :disabled="busy"
          @click="emit('session', attached)"
        />
        <Button v-if="attached" text="Detach session" :disabled="busy || offline" @click="detach" />
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
        <p>HEAD {{ model.diff.value.head_commit }} · Base {{ model.diff.value.base_commit }}</p>
        <pre>{{ model.diff.value.diff || 'No tracked changes' }}</pre>
      </details>
      <Setting name="Session title"
        ><Input v-model="title" aria-label="Node session title"
      /></Setting>
      <Setting name="Provider">
        <select v-model="provider" aria-label="Node provider">
          <option value="claude">Claude Code</option>
          <option value="fake">Fake (non-executing)</option>
        </select>
      </Setting>
      <Button
        text="Start session in workspace"
        :disabled="
          busy ||
          offline ||
          workspace?.kind !== 'managed' ||
          workspace?.state !== 'ready' ||
          !!attached ||
          !title.trim()
        "
        @click="start"
      />
      <p>
        Messages are serialized; follow-ups queue while a turn runs. Steering and interactive
        questions are not supported yet.
      </p>
      <details>
        <summary>Provider availability and effective configuration</summary>
        <pre>{{ JSON.stringify(model.description.value, null, 2) }}</pre>
      </details>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { NodeWorkspaceModel, NodeSession } from '@/node/NodeWorkspaceModel'
import type { NodeConnection } from '@/node/NodeService'
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
const provider = ref<'claude' | 'fake'>('claude')
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
    if (
      !project.value ||
      !(await confirm({
        title: 'Unregister project?',
        message: 'The original checkout is retained. Remove managed workspaces first.',
      }))
    )
      return
    await props.model.client.removeProject(project.value.project_id)
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
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    padding: var(--size-4-1);
  }
}
</style>
