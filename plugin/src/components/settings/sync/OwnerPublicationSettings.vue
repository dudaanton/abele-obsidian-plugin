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
      <div v-if="manager" class="abele-sharing-management">
        <p>Sign in to see shared folders and groups, review their images, or stop sharing.</p>
        <label
          >Your email<input
            v-model="email"
            type="email"
            autocomplete="username"
            aria-label="Sharing account email"
            :disabled="busy"
        /></label>
        <label
          >Your password<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            aria-label="Sharing account password"
            :disabled="busy"
        /></label>
        <Button
          text="Show shared folders and groups"
          tooltip="Check sharing on the server"
          :disabled="busy || !enabled || !email || !password"
          @click="loadShares"
        />
        <Setting
          v-for="share in shares"
          :key="share.id"
          :name="share.label"
          :desc="share.kind === 'folder' ? 'Shared folder: ' + share.prefix : 'Shared group'"
        >
          <Button
            text="Review images"
            tooltip="See images shared here"
            :disabled="busy || !model"
            @click="reviewShare(share)"
          />
          <Button
            text="Stop sharing"
            tooltip="Stop access for all collaborators and connected apps"
            :disabled="busy || !enabled"
            @click="stopping = share"
          />
        </Setting>
        <p v-if="listed && !shares.length" role="status">No folders or groups are shared.</p>
      </div>
      <p>
        {{ stateLabel }}
        <span v-if="cacheComplete === false">Some links could not be checked yet.</span>
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
      :audience-names="batchAudienceNames"
      :enabled="enabled"
      @close="batchOpen = false"
    />
    <ConfirmModal
      v-if="stopping"
      title="Stop sharing?"
      :message="
        'Stop sharing ' +
        (stopping.kind === 'folder'
          ? stopping.prefix + ' (' + stopping.label + ')'
          : stopping.label) +
        '? All collaborators and connected apps using this shared ' +
        stopping.kind +
        ' will lose access. Files they already downloaded are not deleted. Other sharing is not changed.'
      "
      confirm-text="Stop sharing"
      @confirm="stopShare"
      @close="stopping = null"
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
import { computed, ref, shallowRef, onUnmounted, watch } from 'vue'
import type { OwnerFolderHttpPort, OwnerSharedGrant } from '@/sync/sharing/ownerHttp'
import type { OwnerSession } from '@/sync/sharing/folderSharing'
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
    manager?: OwnerFolderHttpPort
    folderFlow?: FolderSharingFlow
    groupRootFlow?: OwnerGroupRootFlow
    batchFlow?: InitialAssetBatch
    batchEntries?: BatchEntry[]
    batchAudiences?: string[]
    batchAudienceNames?: Record<string, string>
    cacheComplete?: boolean
    referencedIds?: string[]
    state?: 'syncing' | 'scope-updating' | 'cache-unknown' | 'awaiting-confirmation' | 'idle'
    enabled?: boolean
  }>(),
  { owner: true, facet: 'device', enabled: OWNER_SHARING_ENABLED, cacheComplete: undefined }
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
const email = ref(''),
  password = ref(''),
  shares = ref<OwnerSharedGrant[]>([]),
  listed = ref(false)
const stopping = ref<OwnerSharedGrant | null>(null),
  loadedView = ref<AssetView | null>(null),
  loadedName = ref('')
const session = shallowRef<OwnerSession | null>(null)
const view = computed(() => loadedView.value ?? props.view)
const shareName = computed(() => loadedName.value || props.shareName)
const extras = computed(() => view.value?.entries.filter((e) => e.kind === 'owner-extra') ?? []),
  native = computed(() => view.value?.entries.filter((e) => e.kind === 'native-asset') ?? [])
let closed = false
watch(
  () => [props.manager, props.model] as const,
  (_, previous) => {
    previous[0]?.close()
    password.value = ''
    session.value = null
    shares.value = []
    listed.value = false
    loadedView.value = null
    loadedName.value = ''
    stopping.value = null
    unshare.value = null
  }
)
async function loadView(share: OwnerSharedGrant) {
  const model = props.model
  if (!model) return
  const value = await model.load(share.id)
  if (closed || props.model !== model) return
  loadedView.value = value
  loadedName.value = share.label
}
async function reviewShare(share: OwnerSharedGrant) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await loadView(share)
  } catch (e) {
    if (!closed)
      error.value = sharingErrorMessage(e, 'Could not check the shared images. Try again.')
  } finally {
    busy.value = false
  }
}
async function loadShares() {
  const manager = props.manager
  if (!manager || busy.value || !enabled) return
  busy.value = true
  error.value = ''
  try {
    const authorized = await manager.authorize(password.value, email.value)
    if (closed || props.manager !== manager) {
      manager.close()
      return
    }
    const rows = await manager.list(authorized)
    if (closed || props.manager !== manager) {
      manager.close()
      return
    }
    session.value = authorized
    shares.value = rows.filter((row) => ['active', 'preparing'].includes(row.state))
    listed.value = true
    if (shares.value[0]) await loadView(shares.value[0])
  } catch (e) {
    if (!closed && props.manager === manager)
      error.value = sharingErrorMessage(e, 'Could not check sharing. Try again.')
  } finally {
    password.value = ''
    busy.value = false
  }
}
async function stopShare() {
  const share = stopping.value,
    authorized = session.value,
    manager = props.manager
  if (!share || !authorized || !manager || busy.value || !enabled) return
  busy.value = true
  error.value = ''
  try {
    await manager.revoke(authorized, share)
    if (closed || props.manager !== manager) return
    shares.value = shares.value.filter((row) => row.id !== share.id)
    if (loadedView.value?.grantId === share.id) {
      loadedView.value = null
      loadedName.value = ''
    }
    stopping.value = null
  } catch (e) {
    if (!closed && props.manager === manager)
      error.value = sharingErrorMessage(
        e,
        'Could not stop sharing. Sign in again and review the current sharing.'
      )
  } finally {
    busy.value = false
  }
}
onUnmounted(() => {
  closed = true
  password.value = ''
  session.value = null
  props.manager?.close()
})
const stateLabel = computed(
  () =>
    ({
      syncing: 'Syncing files.',
      'scope-updating': 'Getting shared files ready.',
      'cache-unknown': 'Checking which images are linked.',
      'awaiting-confirmation': 'Waiting for your sharing choice.',
      idle: 'Linked images are checked when notes sync.',
    })[props.state ?? 'idle']
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
    if (props.model.view?.grantId !== view.value?.grantId)
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
  const model = props.model
  if (!unshare.value || !model || !enabled) return
  busy.value = true
  try {
    const id = unshare.value.grantId
    await model.confirmUnshare(unshare.value)
    if (closed || props.model !== model) return
    if (props.manager) {
      const value = await model.load(id)
      if (closed || props.model !== model) return
      loadedView.value = value
    }
    unshare.value = null
  } catch (e) {
    if (!closed && props.model === model)
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
.abele-sharing-management label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
</style>
