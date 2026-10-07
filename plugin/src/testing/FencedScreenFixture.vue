<template>
  <OwnerFolderSharingModal
    v-if="screen === 'folder'"
    :preview="folder"
    :enabled="false"
    @close="emit('close')"
  />
  <GroupSharingModal
    v-else-if="screen === 'group'"
    :preview="group"
    :enabled="false"
    @close="emit('close')"
  />
  <InitialAssetBatchModal
    v-else-if="screen === 'initial-batch'"
    :preview="batch"
    :audience-names="{ [audience]: 'Sample shared group' }"
    :state="state"
    :enabled="false"
    @close="emit('close')"
  />
  <ScopedInvitationModal
    v-else-if="screen === 'invitation'"
    :enabled="false"
    @close="emit('close')"
  />
  <ScopedCreationModal
    v-else-if="screen === 'creation'"
    :roots="roots"
    :enabled="false"
    @close="emit('close')"
  />
  <ObsidianModal
    v-else-if="screen === 'publication'"
    title="Sharing"
    size="tall"
    phone-sheet
    @close="emit('close')"
    ><div class="abele-modal__body abele-fenced-state">
      <p>Read-only preview. No files will be shared.</p>
      <p>
        {{
          state === 'offline'
            ? 'The server is not connected.'
            : state === 'scope-updating'
              ? 'Getting shared files ready.'
              : 'No connection or file changes will be made.'
        }}
      </p>
      <OwnerPublicationSettings
        :view="assets"
        share-name="Sample group"
        :cache-complete="false"
        :state="state === 'scope-updating' ? 'scope-updating' : 'cache-unknown'"
        :enabled="false"
      />
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close the readonly synthetic fixture"
        @click="emit('close')"
      /></div
  ></ObsidianModal>
  <ConfirmModal
    v-else-if="screen === 'unshare'"
    title="Unshare this file?"
    :message="
      'Stop sharing ' +
      longPath +
      ' with Sample group? Other folders or groups that share it are not changed. Read-only preview.'
    "
    confirm-text="Unshare"
    :read-only="true"
    @close="emit('close')"
  />
  <ScriptApprovalModal
    v-else-if="screen === 'script-approval'"
    :request="script"
    :read-only="true"
  />
  <PluginCodeModal
    v-else-if="screen === 'plugin-code'"
    :changes="codeChanges"
    :names="codeNames"
    :question-key="1"
    :read-only="true"
    @close="emit('close')"
  />
  <JoinVaultModal
    v-else-if="screen === 'personal-join'"
    :question="join"
    :busy="true"
    error="Read-only synthetic join inspection. No personal connection request."
    @close="emit('close')"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { FencedScreen, FencedState } from './fencedScreens'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import OwnerFolderSharingModal from '@/components/sync/OwnerFolderSharingModal.vue'
import GroupSharingModal from '@/components/sync/GroupSharingModal.vue'
import InitialAssetBatchModal from '@/components/sync/InitialAssetBatchModal.vue'
import ScopedInvitationModal from '@/components/sync/ScopedInvitationModal.vue'
import ScopedCreationModal from '@/components/sync/ScopedCreationModal.vue'
import OwnerPublicationSettings from '@/components/settings/sync/OwnerPublicationSettings.vue'
import ScriptApprovalModal from '@/components/ScriptApprovalModal.vue'
import PluginCodeModal from '@/components/sync/PluginCodeModal.vue'
import JoinVaultModal from '@/components/settings/sync/JoinVaultModal.vue'
import type { ChangeItem } from '@abele/sync-protocol'
import type { GroupReview, BatchReview } from '@/sync/sharing/groupSharing'
import type { AssetView } from '@/sync/sharing/sponsoredAssets'
import type { ScriptApprovalDialog } from '@/scripting/trust/scriptApprovalPrompt'
import type { JoinQuestion } from '@/sync/join'
const props = defineProps<{ screen: FencedScreen; state: FencedState }>(),
  emit = defineEmits<{ close: [] }>()
const longPath =
    'Scattered/Sample long folder with spaces/Another sample folder/An existing image with a deliberately long filename and no inherited permission.png',
  audience = 'sample-long-reviewed-audience-identity',
  note = {
    fileId: 'sample-root',
    versionId: 'sample-root-version',
    sha: 'a'.repeat(64),
    path: 'Scattered/Sample root project with a long name.md',
    eligible: true,
  }
const folder = {
  prefix: 'Sample folder/',
  generation: 'sample-exact-cache-generation',
  complete: true,
  files: Array.from({ length: 8 }, (_, i) => ({
    path: 'Sample folder/Deep sample path/' + i + '/' + longPath,
    fileId: 'sample-file-' + i,
    versionId: 'sample-version-' + i,
    eligible: false,
    eligibility: 'unknown' as const,
  })),
}
const group = computed<GroupReview>(() => ({
  id: 'sample-review',
  label: 'Sample group',
  role: 'editor',
  fingerprint: 'b'.repeat(64),
  preview: {
    root: note,
    generation: 'sample-certified-generation',
    complete: props.state !== 'scope-updating',
    certified: props.state !== 'scope-updating',
    notes: Array.from({ length: 8 }, (_, i) => ({
      ...note,
      fileId: 'sample-member-' + i,
      path: 'Scattered member ' + i + '/' + longPath + '.md',
    })),
    anchors: [
      { ...note, fileId: 'sample-subgroup', path: 'Elsewhere/Sample approved subgroup.md' },
    ],
    relations: [],
    uncertain: props.state === 'scope-updating' ? ['Uncertain binding; approval remains held'] : [],
  },
}))
const sponsor = {
    fileId: 'sample-note',
    versionId: 'sample-note-version',
    admissionGeneration: 1,
    inScope: true as const,
    intrinsic: true as const,
  },
  target = {
    fileId: 'sample-image',
    versionId: 'sample-image-version',
    sha: 'c'.repeat(64),
    path: longPath,
    eligible: true,
  }
const batch: BatchReview = {
  id: 'sample-batch-review',
  entries: Array.from({ length: 6 }, (_, i) => ({
    target: { ...target, fileId: 'sample-image-' + i, path: longPath + '-' + i },
    sponsors: [sponsor],
    reason: 'initial-batch',
  })),
  audiences: [
    { grantId: audience, revision: 12, withdrawalGeneration: 3 },
    { grantId: 'sample-second-audience', revision: 4, withdrawalGeneration: 0 },
  ],
}
const assets: AssetView = {
  grantId: audience,
  revision: 12,
  withdrawalGeneration: 3,
  active: true,
  role: 'editor',
  entries: [
    { target, sponsors: [sponsor], reason: 'initial-batch', kind: 'owner-extra' },
    {
      target: { ...target, fileId: 'sample-native', path: 'sample-native-root-image.png' },
      sponsors: [sponsor],
      reason: 'native-create',
      kind: 'native-asset',
    },
  ],
}
const roots = [
  {
    fileId: note.fileId,
    versionId: note.versionId,
    label: 'Sample shared group note',
    spelling: 'Sample shared group',
    approved: true,
  },
]
const script: ScriptApprovalDialog = {
  id: 1,
  path: 'Scripts/sample-reviewed-code-with-a-long-name.js',
  sha: 'd'.repeat(64),
  source:
    '// Anonymous readonly inspection\n' +
    Array.from({ length: 32 }, (_, i) => '// sample inert line ' + i).join('\n'),
  identity: {
    fileId: 'sample-script-file',
    binding: {
      localVault: 'sample-local',
      endpoint: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal',
      grantId: null,
    },
  },
  answer: () => emit('close'),
}
const configDir = GlobalStore.getInstance().app.vault.configDir
const codeChanges: ChangeItem[] = Array.from({ length: 5 }, (_, i) => ({
  seq: i + 1,
  op: 'modify',
  file_id: 'sample-code-' + i,
  version_id: 'sample-code-version-' + i,
  path: configDir + '/plugins/sample-plugin-' + i + '/main.js',
  prev_path: null,
  sha: 'e'.repeat(64),
  size: 10,
  mtime: 1,
  kind: 'settings',
  actor: { kind: 'device', id: 'sample-device', name: 'Sample peer' },
  at: '2026-01-01T00:00:00.000Z',
}))
const codeNames = Object.fromEntries(
  Array.from({ length: 5 }, (_, i) => [
    'sample-plugin-' + i,
    'Sample plugin ' + i + ' with a deliberately long review label',
  ])
)
const join: JoinQuestion = {
  kind: 'choose',
  here: { files: 24, settings: 1 },
  there: { files: 48, settings: 2 },
  vaultName: 'Sample shared vault',
}
</script>
<style scoped>
.abele-fenced-state {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-fenced-state p {
  overflow-wrap: anywhere;
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
</style>
