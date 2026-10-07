<template>
  <ObsidianModal title="New shared file" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-scoped-create">
      <p v-if="!enabled" role="status">
        Shared file creation is not active. No file will be created.
      </p>
      <p>Choose a new file path and a shared group or note. Existing files are never replaced.</p>
      <label
        >Kind<select v-model="kind" aria-label="File kind" :disabled="busy || !enabled">
          <option value="note">New note</option>
          <option value="asset">New image</option>
        </select></label
      >
      <label
        >File path<input
          v-model="path"
          aria-label="New file path"
          placeholder="Scattered/sample.md"
          :disabled="busy || !enabled"
      /></label>
      <template v-if="kind === 'note'"
        ><label
          >Group note<select v-model="rootId" aria-label="Group note" :disabled="busy || !enabled">
            <option
              v-for="r in roots"
              :key="r.fileId"
              :value="r.fileId"
              :title="r.fileId + ' / ' + r.versionId"
            >
              {{ r.label }}
            </option>
          </select></label
        ><label
          >Note text<textarea
            v-model="text"
            aria-label="Note text"
            :disabled="busy || !enabled"
          /></label
      ></template>
      <template v-if="kind === 'asset'">
        <label
          >Image file<input
            type="file"
            accept="image/*"
            aria-label="Image file"
            :disabled="busy || !enabled"
            @change="chooseAsset"
        /></label>
        <label
          >Linked shared note<select
            v-model="sponsorId"
            aria-label="Linked shared note"
            :disabled="busy || !enabled"
          >
            <option
              v-for="sponsor in sponsors"
              :key="sponsor.fileId"
              :value="sponsor.fileId"
              :title="sponsor.fileId + ' / ' + sponsor.versionId"
            >
              {{ sponsor.label }}
            </option>
          </select></label
        >
        <p>The new image will be linked to this shared note. Existing files are not replaced.</p>
      </template>
      <Button
        text="Review new file"
        tooltip="Check the new path and shared group before creating a file"
        :disabled="busy || !enabled || !flow || (kind === 'asset' && !assetBytes)"
        @click="review"
      />
      <template v-if="shown"
        ><p>
          New file: <code>{{ shown.path }}</code
          >.
        </p>
        <p v-if="shown.root">
          Group note:
          <span :title="shown.root.fileId + ' / ' + shown.root.versionId">{{
            shown.root.label
          }}</span
          >.
        </p>
        <Button
          text="Create file"
          tooltip="Create this new file without replacing existing files"
          :disabled="busy || !enabled"
          @click="confirm"
      /></template>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close this review without changing any existing file"
        @click="close"
      /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage } from './sharingText'
import {
  SCOPED_CREATION_ENABLED,
  type ScopedCreationFlow,
  type ApprovedRoot,
  type CreationReview,
  type NativeSponsor,
} from '@/sync/scoped/scopedCreation'
const props = withDefaults(
    defineProps<{
      flow?: ScopedCreationFlow
      roots?: ApprovedRoot[]
      sponsors?: (NativeSponsor & { label: string })[]
      enabled?: boolean
    }>(),
    { enabled: SCOPED_CREATION_ENABLED }
  ),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? SCOPED_CREATION_ENABLED,
  roots = props.roots ?? [],
  sponsors = props.sponsors ?? []
const kind = ref<'note' | 'asset'>('note'),
  path = ref(''),
  rootId = ref(roots[0]?.fileId ?? ''),
  sponsorId = ref(sponsors[0]?.fileId ?? ''),
  assetBytes = ref<Uint8Array | null>(null),
  text = ref(''),
  busy = ref(false),
  error = ref(''),
  shown = ref<CreationReview | null>(null)
watch([kind, path, rootId, text, sponsorId, assetBytes], () => {
  shown.value = null
  props.flow?.close()
})
async function chooseAsset(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  assetBytes.value = file ? new Uint8Array(await file.arrayBuffer()) : null
}
async function review() {
  if (!enabled || !props.flow) return
  busy.value = true
  error.value = ''
  try {
    if (kind.value === 'note')
      shown.value = await props.flow.review({
        kind: 'note',
        path: path.value,
        text: text.value,
        rootId: rootId.value,
      })
    else {
      const selected = sponsors.find((sponsor) => sponsor.fileId === sponsorId.value)
      if (!selected || !assetBytes.value)
        throw new Error('Choose an image file and a linked shared note')
      const { label: _label, ...sponsor } = selected
      shown.value = await props.flow.review({
        kind: 'asset',
        path: path.value,
        bytes: assetBytes.value,
        sponsor,
      })
    }
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not review this file. Check the path and shared note, then try again.'
    )
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!enabled || !props.flow || !shown.value) return
  busy.value = true
  error.value = ''
  try {
    await props.flow.confirm(shown.value)
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not create this file. Review it and try again.')
  } finally {
    busy.value = false
  }
}
function close() {
  props.flow?.close()
  shown.value = null
  assetBytes.value = null
  emit('close')
}
onUnmounted(() => props.flow?.close())
</script>
<style scoped>
.abele-scoped-create {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
.abele-scoped-create label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-scoped-create p,
.abele-scoped-create code {
  overflow-wrap: anywhere;
}
</style>
