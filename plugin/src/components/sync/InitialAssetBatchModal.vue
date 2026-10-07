<template>
  <ObsidianModal title="Review initial shared images" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-initial-batch">
      <p v-if="!enabled" role="status">
        Initial publication is not active. This preview creates no exposure or upload.
      </p>
      <p>
        Existing private images need one explicit exact-target decision for every audience. A body
        link, similar filename or incomplete cache is not publication authority. Independent
        intrinsic note sponsors are mandatory.
      </p>
      <p>
        Batch state: {{ state }}. Missing link/reference facts remain unknown; no automatic
        withdrawal.
      </p>
      <h4>Audience exposures</h4>
      <ul>
        <li v-for="a in display?.audiences ?? []" :key="a.grantId">
          <code>{{ a.grantId }}</code> · CAS {{ a.revision }} / withdrawal
          {{ a.withdrawalGeneration }}
        </li>
      </ul>
      <h4>Exact existing targets</h4>
      <ul>
        <li v-for="e in entries" :key="e.target.fileId">
          <code>{{ e.target.path }}</code>
          <p>{{ e.target.fileId }} / {{ e.target.versionId }} · {{ e.target.sha }}</p>
          <p>
            Sponsors:
            {{
              e.sponsors
                .map(
                  (s) => s.fileId + ' / ' + s.versionId + ' / admission ' + s.admissionGeneration
                )
                .join('; ')
            }}
          </p>
          <p>{{ e.target.eligible ? 'Known eligible target' : 'Eligibility unknown — hold' }}</p>
        </li>
      </ul>
      <Button
        text="Review selected exposures"
        tooltip="Refresh exact targets/sponsors and each audience before recording the batch decision"
        :disabled="busy || !enabled || !flow"
        @click="review"
      /><Button
        text="Confirm this exact batch"
        tooltip="Persist stable per-audience deltas; never replace another device’s whole list"
        :disabled="busy || !enabled || !flow || !shown"
        @click="confirm"
      />
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Discard the displayed review without publishing a hidden batch"
        @click="close"
      /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { OWNER_SHARING_ENABLED } from '@/sync/sharing/folderSharing'
import type { InitialAssetBatch, BatchReview, BatchEntry } from '@/sync/sharing/groupSharing'
const props = withDefaults(
    defineProps<{
      flow?: InitialAssetBatch
      preview?: BatchReview
      entries?: BatchEntry[]
      audiences?: string[]
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
    }
  ),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  busy = ref(false),
  error = ref(''),
  shown = ref<BatchReview | null>(null),
  display = computed(() => shown.value ?? props.preview),
  entries = computed(() => display.value?.entries ?? props.entries ?? [])
async function review() {
  if (!enabled || !props.flow) return
  busy.value = true
  try {
    shown.value = await props.flow.review(props.entries ?? [], props.audiences ?? [])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Initial batch held'
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!enabled || !props.flow || !shown.value) return
  busy.value = true
  try {
    await props.flow.confirm(shown.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Initial batch held'
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
