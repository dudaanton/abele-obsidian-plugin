<template>
  <Modal :title="t('streamB.nodeDelegationGrants.1272e9')" @close="emit('close')">
    <div class="abele-node-grants">
      <p>{{ t('streamBMeta.3f37debec2', { p0: String(label) }) }}</p>
      <p>{{ t('streamB.childrenRunWithTheNodeSUser.8cdc22') }}</p>
      <p v-if="error" role="alert"><NodeErrorText :error="error" /></p>
      <Setting
        :name="t('streamB.parentChat.1620e0')"
        :desc="t('streamB.openThePluginChatToAuthorizeThen.e18cb4')"
      >
        <select
          v-model="parentId"
          :aria-label="t('streamB.delegationParentChat.463b32')"
          :disabled="busy"
        >
          <option value="">{{ t('streamB.chooseAParentChat.c09df4') }}</option>
          <option v-for="parent in parents" :key="parent.id" :value="parent.id">
            {{ parent.title }}
          </option>
        </select>
      </Setting>
      <p v-if="parentId">{{ t('streamBMeta.a664ea62e3', { p0: String(parentId) }) }}</p>
      <Setting
        :name="t('streamB.project.985959')"
        :desc="t('streamB.anExplicitRegisteredProjectOnTheNode.b5d07e')"
      >
        <select
          v-model="projectId"
          :aria-label="t('streamB.delegationProject.baacde')"
          :disabled="busy"
        >
          <option value="">{{ t('streamB.chooseAProject.8ba607') }}</option>
          <option v-for="project in projects" :key="project.project_id" :value="project.project_id">
            {{ project.root_path }}
          </option>
        </select>
      </Setting>
      <NodePath
        v-if="selectedProject"
        :path="selectedProject.root_path"
        :label="t('streamB.fullDelegationProjectPath.c833d0')"
      />
      <Setting
        :name="t('streamB.provider.472590')"
        :desc="t('streamB.onlyProvidersReportedAvailableByThisNode.9de37b')"
      >
        <select
          v-model="provider"
          :aria-label="t('streamB.delegationProvider.303067')"
          :disabled="busy"
        >
          <option value="">{{ t('streamB.chooseAProvider.e1d36c') }}</option>
          <option v-for="item in available" :key="item.provider" :value="item.provider">
            {{ providerLabel(item.provider) }}
          </option>
        </select>
      </Setting>
      <Setting
        v-if="provider === 'fake'"
        :name="t('streamB.allowNonExecutingFakeChildren.58349d')"
        :desc="t('streamB.explicitFixtureApprovalFakeSessionsDoNot.77d477')"
      >
        <Checkbox
          :is-enabled="allowFake"
          :aria-label="t('streamB.allowFakeDelegation.18dbe3')"
          @toggle="allowFake = !allowFake"
        />
      </Setting>
      <Setting
        :name="t('streamB.approveControllerActions.82e918')"
        :desc="t('streamB.createTasksSendFollowUpsReadStatus.d2c283')"
      >
        <Checkbox
          :is-enabled="confirmed"
          :aria-label="t('streamB.approveDelegationActions.c4bad7')"
          @toggle="confirmed = !confirmed"
        />
      </Setting>
      <div class="abele-node-grants__actions">
        <Button
          :text="t('streamB.approveGrant.136382')"
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
        <Button :text="t('streamB.refresh.0e9161')" :disabled="busy" @click="load" />
      </div>
      <section :aria-label="t('streamB.approvedDelegationGrants.bedd70')">
        <h3>{{ t('streamB.grantsOnThisDevice.4c0616') }}</h3>
        <p v-if="!grants.length">
          {{ t('streamB.noDelegationGrantsEnrollmentAloneDoesNot.58c8bb') }}
        </p>
        <Setting
          v-for="grant in grants"
          :key="grant.grant_id"
          :name="parentTitle(grant.parent_id)"
          :desc="grantDescription(grant)"
        >
          <Button
            v-if="!grant.revoked"
            :text="t('streamB.revokeGrant.f90e3f')"
            :disabled="busy"
            @click="revoke(grant.grant_id)"
          />
        </Setting>
      </section>
      <p v-if="message" role="status"><NodeErrorText :error="message" /></p>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import type { DelegationGrant, Project } from '@abele/node-client'
import type { NodeDelegationController } from '@/node/NodeDelegationController'
import { nodePages } from '@/node/nodePages'
import {
  delegatable,
  nodeProviders,
  providerAvailable,
  providerLabel,
  type NodeProvider,
  type NodeProviderName,
} from '@/node/providers'
import Modal from './obsidian/Modal.vue'
import NodePath from './NodePath.vue'
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
const selectedProject = computed(() => projects.value.find((p) => p.project_id === projectId.value))
const providers = ref<NodeProvider[]>([])
const grants = ref<DelegationGrant[]>([])
const available = computed(() => providers.value.filter(providerAvailable))
const parentTitle = (id: string) => props.parents.find((p) => p.id === id)?.title ?? id
const grantDescription = (g: DelegationGrant) =>
  `${g.revoked ? t('streamB.revoked.f6f738') : t('streamB.approved.87b42e')} · ${g.providers.map(providerLabel).join(', ')} · ${g.project_ids.map((id) => projects.value.find((p) => p.project_id === id)?.root_path ?? id).join(', ') || t('streamB.noProjectsFakeOnly.1c6fc2')} · ${g.actions.join(', ')}`
const act = async (work: () => Promise<void>) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = e instanceof Error ? presentUiError(e) : t('streamB.nodeUnavailable.14c28f')
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
    providers.value = nodeProviders(description).filter(delegatable)
  })
const approve = () =>
  act(async () => {
    if (
      !confirmed.value ||
      !parentId.value ||
      !provider.value ||
      (provider.value === 'fake' && !allowFake.value)
    )
      throw new Error(t('streamB.explicitApprovalRequired.eebe04'))
    await props.controller.approve({
      parent_id: parentId.value,
      project_ids: projectId.value ? [projectId.value] : [],
      providers: [provider.value],
      allow_fake: provider.value === 'fake' && allowFake.value,
    })
    grants.value = await props.controller.grants()
    confirmed.value = false
    message.value = t('streamB.grantApprovedEnableTheNodesToolGroup.261be9')
  })
const revoke = (id: string) =>
  act(async () => {
    await props.controller.revoke(id)
    grants.value = await props.controller.grants()
    message.value = t('streamB.grantRevokedActiveDelegationsAreCancelledOn.42cb77')
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
