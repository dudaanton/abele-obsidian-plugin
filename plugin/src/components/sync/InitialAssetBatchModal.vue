<template>
  <ObsidianModal title="Share selected images" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-initial-batch">
      <p v-if="!enabled" role="status">Image sharing is not active. No images will be shared.</p>
      <p>These images are private. Review where they will be shared before confirming.</p>
      <p>{{ batchState }}</p>
      <p>Once shared, images stay shared until you unshare them, even if a link is removed.</p>
      <h4>Shared folders and groups</h4>
      <ul>
        <li v-for="a in namedAudiences" :key="a.grantId" :title="a.grantId">
          {{ a.name || 'Shared folder or group name unavailable' }}
        </li>
      </ul>
      <p v-if="missingNames" role="alert">
        Names of some shared folders or groups are missing. Review your selection before sharing.
      </p>
      <h4>Selected images</h4>
      <ul>
        <li v-for="e in entries" :key="e.target.fileId">
          <code :title="e.target.fileId + ' / ' + e.target.versionId">{{ e.target.path }}</code>
          <p :title="e.sponsors.map((s) => s.fileId).join(', ')">
            Shared through {{ e.sponsors.length }} shared
            {{ e.sponsors.length === 1 ? 'note' : 'notes' }}.
          </p>
          <p>
            {{
              e.target.eligible ? 'Available to share.' : 'This image still needs to be checked.'
            }}
          </p>
        </li>
      </ul>
      <Button
        text="Review selected images"
        tooltip="Check these images and shared folders or groups before continuing"
        :disabled="busy || !enabled || !flow"
        @click="review"
      /><Button
        text="Share selected images"
        tooltip="Share only the selected images in this review"
        :disabled="busy || !enabled || !flow || !shown || !allNamed"
        @click="confirm"
      />
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button text="Close" tooltip="Close without sharing these images" @click="close" /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage } from './sharingText'
import { OWNER_SHARING_ENABLED } from '@/sync/sharing/folderSharing'
import type { InitialAssetBatch, BatchReview, BatchEntry } from '@/sync/sharing/groupSharing'
const batchStateLabels: Record<string, string> = {
  'awaiting exact confirmation': 'Review the selected images before sharing.',
  pending: 'Waiting for your sharing choice.',
  preparing: 'Getting the selected images ready.',
  'scope-updating': 'Getting shared files ready.',
  offline: 'Reconnect to the server before sharing images.',
  'cache-unknown': 'Some images still need to be checked.',
  'awaiting-confirmation': 'Waiting for your sharing choice.',
  idle: 'No images are waiting to be shared.',
}
const props = withDefaults(
    defineProps<{
      flow?: InitialAssetBatch
      preview?: BatchReview
      entries?: BatchEntry[]
      audiences?: string[]
      /** Group note titles, folder paths or collaborator names, keyed by the reviewed ID. */
      audienceNames?: Record<string, string>
      enabled?: boolean
      state?: string
    }>(),
    {
      enabled: OWNER_SHARING_ENABLED,
      state: 'awaiting exact confirmation',
      flow: undefined,
      preview: undefined,
      entries: () => [],
      audiences: () => [],
      audienceNames: () => ({}),
    }
  ),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  batchState = computed(
    () => batchStateLabels[props.state] ?? 'Review the selected images before sharing.'
  ),
  busy = ref(false),
  error = ref(''),
  shown = ref<BatchReview | null>(null),
  display = computed(() => shown.value ?? props.preview),
  namedAudiences = computed(() =>
    (display.value?.audiences ?? props.audiences.map((grantId) => ({ grantId }))).map((a) => {
      const name = props.audienceNames[a.grantId]
      return { grantId: a.grantId, name: typeof name === 'string' ? name.trim() : '' }
    })
  ),
  missingNames = computed(() => namedAudiences.value.some((a) => !a.name)),
  allNamed = computed(() => namedAudiences.value.length > 0 && !missingNames.value),
  entries = computed(() => display.value?.entries ?? props.entries ?? [])
async function review() {
  if (!enabled || !props.flow) return
  busy.value = true
  try {
    shown.value = await props.flow.review(props.entries ?? [], props.audiences ?? [])
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not review these images. Check your selection and try again.'
    )
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!enabled || !props.flow || !shown.value || !allNamed.value) return
  busy.value = true
  try {
    await props.flow.confirm(shown.value)
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not share these images. Review them and try again.')
  } finally {
    busy.value = false
  }
}
function close() {
  props.flow?.close()
  shown.value = null
  emit('close')
}
onUnmounted(() => props.flow?.close())
</script>
<style scoped>
.abele-initial-batch {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-initial-batch p,
.abele-initial-batch code {
  overflow-wrap: anywhere;
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
</style>
