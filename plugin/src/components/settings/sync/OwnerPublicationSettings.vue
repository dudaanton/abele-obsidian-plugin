<template>
  <Section
    title="Sharing"
    desc="Share folders, groups and linked images without moving your files."
  >
    <p v-if="!ownerContext" role="status">Only the vault owner can change what is shared.</p>
    <template v-else>
      <p v-if="!enabled" role="status">Sharing is not active. Your files will stay private.</p>
      <Setting name="Share a folder" desc="Let another app read or edit notes in a folder.">
        <Button
          text="Share a folder…"
          tooltip="Check which files will be shared before continuing"
          @click="folderOpen = true"
        />
      </Setting>
      <p>
        {{ stateLabel }}
        <span v-if="!cacheComplete">Some links could not be checked yet.</span>
      </p>
      <template v-if="view">
        <p :title="view.grantId">Shared with: {{ shareName || 'this folder or group' }}</p>
        <h4>Images you shared</h4>
        <p v-if="!extras.length">No extra images have been shared here.</p>
        <ul>
          <li v-for="entry in extras" :key="entry.target.fileId">
            <code :title="entry.target.fileId + ' / ' + entry.target.versionId">{{
              entry.target.path
            }}</code>
            <p :title="entry.sponsors.map((s) => s.fileId).join(', ')">
              Shared through {{ entry.sponsors.length }} shared
              {{ entry.sponsors.length === 1 ? 'note' : 'notes' }}.
            </p>
            <p>{{ reference(entry.target.fileId) }}</p>
            <Button
              text="Unshare…"
              tooltip="Review this file before stopping sharing"
              :disabled="!enabled || busy"
              @click="review(entry.target.fileId)"
            />
          </li>
        </ul>
        <h4>Images added by collaborators</h4>
        <p>These images were added directly to the shared folder or group.</p>
        <ul>
          <li v-for="entry in native" :key="entry.target.fileId">
            <code :title="entry.target.fileId + ' / ' + entry.target.versionId">{{
              entry.target.path
            }}</code>
            <p :title="entry.sponsors.map((s) => s.fileId).join(', ')">
              Shared through {{ entry.sponsors.length }} shared
              {{ entry.sponsors.length === 1 ? 'note' : 'notes' }}.
            </p>
            <Button
              text="Unshare…"
              tooltip="Stop sharing this image without changing other shared folders or groups"
              :disabled="!enabled || busy"
              @click="review(entry.target.fileId)"
            />
          </li>
        </ul>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <Setting
        name="Share a group"
        desc="Choose the note that represents your group. Notes stay in their current folders."
        ><Button
          text="Share a group…"
          tooltip="Review the group before sharing it"
          @click="groupOpen = true"
      /></Setting>
      <Setting
        v-if="hasBatch"
        name="Share existing images"
        desc="Review selected images and where they will be shared."
        ><Button
          text="Review images…"
          tooltip="Review each selected image before sharing"
          @click="batchOpen = true"
      /></Setting>
      <p>Renaming a file keeps its sharing choices. A new file needs a new choice.</p>
    </template>
    <OwnerFolderSharingModal
      v-if="folderOpen"
      :flow="folderFlow"
      :enabled="enabled"
      @close="folderOpen = false"
    />
    <GroupSharingModal
      v-if="groupOpen"
      :root-flow="groupRootFlow"
      :enabled="enabled"
      @close="groupOpen = false"
    />
    <InitialAssetBatchModal
      v-if="batchOpen && hasBatch"
      :flow="batchFlow"
      :entries="batchEntries"
      :audiences="batchAudiences"
      :enabled="enabled"
      @close="batchOpen = false"
    />
    <ConfirmModal
      v-if="unshare"
      title="Unshare this file?"
      :message="
        'Stop sharing ' +
        unshare.path +
        ' with ' +
        (shareName || 'this folder or group') +
        '? Other folders or groups that share it are not changed.'
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
import type { InitialAssetBatch, BatchEntry } from '@/sync/sharing/groupSharing'
import { sharingErrorMessage } from '../../sync/sharingText'
const props = withDefaults(
  defineProps<{
    facet?: 'device' | 'scoped' | 'account'
    owner?: boolean
    view?: AssetView
    shareName?: string
    model?: PublicationSettingsModel
    folderFlow?: FolderSharingFlow
    groupRootFlow?: OwnerGroupRootFlow
    batchFlow?: InitialAssetBatch
    batchEntries?: BatchEntry[]
    batchAudiences?: string[]
    cacheComplete?: boolean
    referencedIds?: string[]
    state?: 'syncing' | 'scope-updating' | 'cache-unknown' | 'awaiting-confirmation' | 'idle'
    enabled?: boolean
  }>(),
  { owner: true, facet: 'device', enabled: OWNER_SHARING_ENABLED }
)
const enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  ownerContext = computed(() => props.facet !== 'scoped' && (props.owner ?? true)),
  hasBatch = computed(
    () => !!props.batchFlow && !!props.batchEntries?.length && !!props.batchAudiences?.length
  ),
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
      syncing: 'Syncing files.',
      'scope-updating': 'Getting shared files ready.',
      'cache-unknown': 'Checking which images are linked.',
      'awaiting-confirmation': 'Waiting for your sharing choice.',
      idle: 'Sharing is up to date.',
    })[props.state ?? 'cache-unknown']
)
function reference(id: string) {
  return !props.cacheComplete
    ? 'Links have not been checked yet.'
    : props.referencedIds?.includes(id)
      ? 'Linked from a shared note.'
      : 'No longer linked here. It stays shared until you unshare it.'
}
function review(id: string) {
  if (!enabled || !props.model) return
  try {
    if (props.model.view?.grantId !== props.view?.grantId)
      throw new Error('The shared folder or group changed. Refresh this view before unsharing.')
    unshare.value = props.model.reviewUnshare(id)
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'The shared folder or group changed. Refresh this view before unsharing.'
    )
  }
}
async function confirm() {
  if (!unshare.value || !props.model || !enabled) return
  busy.value = true
  try {
    await props.model.confirmUnshare(unshare.value)
    unshare.value = null
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not stop sharing this file. Try again.')
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
