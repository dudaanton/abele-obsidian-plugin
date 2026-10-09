<template>
  <Modal title="Node delegation grants" @close="emit('close')">
    <div class="abele-node-grants">
      <p>{{ label }} · Owner approval for this device and parent chat only.</p>
      <p>
        Children run with the node's user account in their own workspaces, not a filesystem sandbox.
        Human permissions and extension questions stay in the child chat. Grants, task identities
        and mailboxes never transfer with settings.
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <Setting
        name="Parent chat"
        desc="Open the plugin chat to authorize, then choose it here. A copied chat needs its own grant."
      >
        <select v-model="parentId" aria-label="Delegation parent chat" :disabled="busy">
          <option value="">Choose a parent chat</option>
          <option v-for="parent in parents" :key="parent.id" :value="parent.id">
            {{ parent.title }}
          </option>
        </select>
      </Setting>
      <p v-if="parentId">Parent reference: {{ parentId }}</p>
      <Setting
        name="Project"
        desc="An explicit registered project on the node; no wildcard access."
      >
        <select v-model="projectId" aria-label="Delegation project" :disabled="busy">
          <option value="">Choose a project</option>
          <option v-for="project in projects" :key="project.project_id" :value="project.project_id">
            {{ project.root_path }}
          </option>
        </select>
      </Setting>
      <Setting
        name="Provider"
        desc="Only providers reported available by this node can be approved."
      >
        <select v-model="provider" aria-label="Delegation provider" :disabled="busy">
          <option value="">Choose a provider</option>
          <option v-for="item in available" :key="item.provider" :value="item.provider">
            {{ providerLabel(item.provider) }}
          </option>
        </select>
      </Setting>
      <Setting
        v-if="provider === 'fake'"
        name="Allow non-executing fake children"
        desc="Explicit fixture approval. Fake sessions do not execute code."
      >
        <Checkbox
          :is-enabled="allowFake"
          aria-label="Allow fake delegation"
          @toggle="allowFake = !allowFake"
        />
      </Setting>
      <Setting
        name="Approve controller actions"
        desc="Create tasks, send follow-ups, read status/mailbox and cancel. Does not grant permission-answer rights."
      >
        <Checkbox
          :is-enabled="confirmed"
          aria-label="Approve delegation actions"
          @toggle="confirmed = !confirmed"
        />
      </Setting>
      <div class="abele-node-grants__actions">
        <Button
          text="Approve grant"
          accent
          :disabled="
            busy ||
            !parentId ||
            !provider ||
            (!projectId && provider !== 'fake') ||
            (provider === 'fake' && !allowFake) ||
            !confirmed
          "
          @click="approve"
        />
        <Button text="Refresh" :disabled="busy" @click="load" />
      </div>
      <section aria-label="Approved delegation grants">
        <h3>Grants on this device</h3>
        <p v-if="!grants.length">
          No delegation grants. Enrollment alone does not authorize an agent.
        </p>
        <Setting
          v-for="grant in grants"
          :key="grant.grant_id"
          :name="parentTitle(grant.parent_id)"
          :desc="grantDescription(grant)"
        >
          <Button
            v-if="!grant.revoked"
            text="Revoke grant"
            :disabled="busy"
            @click="revoke(grant.grant_id)"
          />
        </Setting>
      </section>
      <p v-if="message" role="status">{{ message }}</p>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { DelegationGrant, Project } from '@abele/node-client'
import type { NodeDelegationController } from '@/node/NodeDelegationController'
import { nodePages } from '@/node/NodeWorkspaceModel'
import {
  nodeProviders,
  providerAvailable,
  providerLabel,
  type NodeProvider,
  type NodeProviderName,
} from '@/node/providers'
import Modal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Button from './obsidian/Button.vue'
const props = defineProps<{
  label: string
  controller: NodeDelegationController
  parents: { id: string; title: string }[]
  initialParentId?: string
}>()
const emit = defineEmits<{ close: [] }>()
const parentId = ref(props.initialParentId ?? '')
const projectId = ref('')
const provider = ref<NodeProviderName | ''>('')
const allowFake = ref(false)
const confirmed = ref(false)
watch([parentId, projectId, provider], () => {
  confirmed.value = false
  allowFake.value = false
})
const busy = ref(false)
const error = ref('')
const message = ref('')
const projects = ref<Project[]>([])
const providers = ref<NodeProvider[]>([])
const grants = ref<DelegationGrant[]>([])
const available = computed(() => providers.value.filter(providerAvailable))
const parentTitle = (id: string) => props.parents.find((p) => p.id === id)?.title ?? id
const grantDescription = (g: DelegationGrant) =>
  `${g.revoked ? 'Revoked' : 'Approved'} · ${g.providers.map(providerLabel).join(', ')} · ${g.project_ids.map((id) => projects.value.find((p) => p.project_id === id)?.root_path ?? id).join(', ') || 'No projects (fake only)'} · ${g.actions.join(', ')}`
const act = async (work: () => Promise<void>) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Node unavailable'
  } finally {
    busy.value = false
  }
}
const load = () =>
  act(async () => {
    await props.controller.restore()
    grants.value = await props.controller.grants()
    const [projectList, description] = await Promise.all([
      nodePages(
        (after) => props.controller.client.listProjects(after),
        (p) => p.project_id
      ),
      props.controller.client.describe(),
    ])
    projects.value = projectList
    providers.value = nodeProviders(description)
  })
const approve = () =>
  act(async () => {
    if (
      !confirmed.value ||
      !parentId.value ||
      !provider.value ||
      (provider.value === 'fake' && !allowFake.value)
    )
      throw new Error('Explicit approval required')
    await props.controller.approve({
      parent_id: parentId.value,
      project_ids: projectId.value ? [projectId.value] : [],
      providers: [provider.value],
      allow_fake: provider.value === 'fake' && allowFake.value,
    })
    grants.value = await props.controller.grants()
    confirmed.value = false
    message.value = 'Grant approved. Enable the Nodes tool group in this parent agent to delegate.'
  })
const revoke = (id: string) =>
  act(async () => {
    await props.controller.revoke(id)
    grants.value = await props.controller.grants()
    message.value =
      'Grant revoked. Active delegations are cancelled on the node; files and transcripts are retained.'
  })
onMounted(load)
</script>
<style scoped>
.abele-node-grants {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-node-grants select {
  max-width: 100%;
}
.abele-node-grants__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  padding: var(--size-4-1);
}
</style>
