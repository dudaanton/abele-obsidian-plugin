<template>
  <Section
    title="Folder sharing and publication"
    desc="Owner-reviewed audiences, exact file identities and independent note sponsors."
  >
    <p v-if="!ownerContext" role="status">
      Scoped and recipient connections cannot manage owner publication or query private candidates.
    </p>
    <template v-else>
      <p v-if="!enabled" role="status">
        Sharing is not active. No credential, upload or publication request will be made until
        activation gates pass.
      </p>
      <Setting
        name="Folder receiver"
        desc="Review one current folder prefix. The receiver gets a scoped machine key, never this device's personal credential."
      >
        <Button
          text="Review folder sharing"
          tooltip="Open the current folder scope preview; creation remains disabled until activation gates pass"
          @click="folderOpen = true"
        />
      </Setting>
      <p>
        State: {{ stateLabel }}.
        <span v-if="!cacheComplete"
          >Link evidence is incomplete; missing-reference counts are unknown.</span
        >
      </p>
      <template v-if="view">
        <p>
          Audience: <code>{{ view.grantId }}</code
          >; publication revision {{ view.revision }}.
        </p>
        <h4>Owner-published extras</h4>
        <p v-if="!extras.length">No owner-published extras in this reviewed view.</p>
        <ul>
          <li v-for="entry in extras" :key="entry.target.fileId">
            <code>{{ entry.target.path }}</code>
            <p>Identity {{ entry.target.fileId }} · {{ entry.target.versionId }}</p>
            <p>Sponsors: {{ entry.sponsors.map((s) => s.fileId).join(', ') }}</p>
            <p>{{ reference(entry.target.fileId) }}</p>
            <Button
              text="Unshare…"
              tooltip="Review the exact published file identity and audiences before withdrawing extra authority"
              :disabled="!enabled || busy"
              @click="review(entry.target.fileId)"
            />
          </li>
        </ul>
        <h4>Grant-native assets</h4>
        <p>
          Native assets have their own scoped creator/upload authority. They are not owner
          attachment approvals.
        </p>
        <ul>
          <li v-for="entry in native" :key="entry.target.fileId">
            <code>{{ entry.target.path }}</code>
            <p>Sponsors: {{ entry.sponsors.map((s) => s.fileId).join(', ') }}</p>
            <Button
              text="Remove extra authority…"
              tooltip="Withdraw this native asset's extra sponsorship without changing independent folder or group access"
              :disabled="!enabled || busy"
              @click="review(entry.target.fileId)"
            />
          </li>
        </ul>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <Setting
        name="Group root and anchors"
        desc="Review stable group identities and explicit relations; no folder/remap or inferred anchor authority."
        ><Button
          text="Review group sharing"
          tooltip="Review the exact synced root and authenticate the owner"
          @click="groupOpen = true"
      /></Setting>
      <Setting
        name="Existing-image initial batch"
        desc="One exact target/sponsor/audience review, never a whole-list replacement."
        ><Button
          text="Review initial asset batch"
          tooltip="Inspect the disabled existing-file exposure batch"
          @click="batchOpen = true"
      /></Setting>
      <p>
        Renames preserve identity; delete/recreate never inherits approval. Removing extra authority
        does not remove independent folder/group access.
      </p>
    </template>
    <OwnerFolderSharingModal
      v-if="folderOpen"
      :flow="folderFlow"
      :enabled="enabled"
      @close="folderOpen = false"
    />
    <GroupSharingModal v-if="groupOpen" :root-flow="groupRootFlow" :enabled="enabled" @close="groupOpen = false" />
    <InitialAssetBatchModal v-if="batchOpen" :enabled="enabled" @close="batchOpen = false" />
    <ConfirmModal
      v-if="unshare"
      title="Unshare this exact file?"
      :message="
        'File ' +
        unshare.path +
        '. Audience ' +
        unshare.grantId +
        '. Identity ' +
        unshare.fileId +
        ' at version ' +
        unshare.versionId +
        '. Old retries cannot re-add withdrawn authority.'
      "
      confirm-text="Unshare"
      @confirm="confirm"
      @close="unshare = null"
    />
  </Section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Button from '../../obsidian/Button.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import OwnerFolderSharingModal from '../../sync/OwnerFolderSharingModal.vue'
import GroupSharingModal from '../../sync/GroupSharingModal.vue'
import InitialAssetBatchModal from '../../sync/InitialAssetBatchModal.vue'
import { OWNER_SHARING_ENABLED, type FolderSharingFlow } from '@/sync/sharing/folderSharing'
import type { AssetView } from '@/sync/sharing/sponsoredAssets'
import type { PublicationSettingsModel, UnshareReview } from '@/sync/sharing/publicationSettings'
import type { OwnerGroupRootFlow } from '@/sync/sharing/ownerGroupRoot'
const props = withDefaults(
  defineProps<{
    facet?: 'device' | 'scoped' | 'account'
    owner?: boolean
    view?: AssetView
    model?: PublicationSettingsModel
    folderFlow?: FolderSharingFlow
    groupRootFlow?: OwnerGroupRootFlow
    cacheComplete?: boolean
    referencedIds?: string[]
    state?: 'syncing' | 'scope-updating' | 'cache-unknown' | 'awaiting-confirmation' | 'idle'
    enabled?: boolean
  }>(),
  { owner: true, facet: 'device' }
)
const enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  ownerContext = computed(() => props.facet !== 'scoped' && (props.owner ?? true)),
  folderOpen = ref(false),
  groupOpen = ref(false),
  batchOpen = ref(false),
  error = ref(''),
  busy = ref(false),
  unshare = ref<UnshareReview | null>(null)
const extras = computed(() => props.view?.entries.filter((e) => e.kind === 'owner-extra') ?? []),
  native = computed(() => props.view?.entries.filter((e) => e.kind === 'native-asset') ?? [])
const stateLabel = computed(
  () =>
    ({
      syncing: 'content syncing',
      'scope-updating': 'scope updating',
      'cache-unknown': 'cache uncertain',
      'awaiting-confirmation': 'publication awaiting confirmation',
      idle: 'no pending publication',
    })[props.state ?? 'cache-unknown']
)
function reference(id: string) {
  return !props.cacheComplete
    ? 'Reference status unknown'
    : props.referencedIds?.includes(id)
      ? 'Currently referenced'
      : 'Published, no longer referenced — no automatic withdrawal'
}
function review(id: string) {
  if (!enabled || !props.model) return
  try {
    if (props.model.view?.grantId !== props.view?.grantId)
      throw new Error('Publication audience changed; refresh the displayed view')
    unshare.value = props.model.reviewUnshare(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Cannot review unshare'
  }
}
async function confirm() {
  if (!unshare.value || !props.model || !enabled) return
  busy.value = true
  try {
    await props.model.confirmUnshare(unshare.value)
    unshare.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unshare failed'
  } finally {
    busy.value = false
  }
}
</script>
<style scoped>
code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
li {
  margin-bottom: var(--size-4-3);
}
</style>
