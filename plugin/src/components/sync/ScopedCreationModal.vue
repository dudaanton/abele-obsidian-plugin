<template>
  <ObsidianModal title="New scoped file" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-scoped-create">
      <p v-if="!enabled" role="status">
        Scoped creation is not active. This preview places or uploads no file.
      </p>
      <p>
        Choose a new allowed path and an approved root or intrinsic sponsor. Received files keep
        their original paths. A private or occupied destination is never replaced, adopted or
        remapped.
      </p>
      <label
        >Kind<select v-model="kind" aria-label="Scoped file kind" :disabled="busy || !enabled">
          <option value="note">New note</option>
          <option value="asset">Pasted image</option>
        </select></label
      >
      <label
        >Exact new-file path<input
          v-model="path"
          aria-label="Scoped new-file path"
          placeholder="Scattered/sample.md"
          :disabled="busy || !enabled"
      /></label>
      <template v-if="kind === 'note'"
        ><label
          >Approved root<select
            v-model="rootId"
            aria-label="Approved group root"
            :disabled="busy || !enabled"
          >
            <option v-for="r in roots" :key="r.fileId" :value="r.fileId">
              {{ r.label }} — {{ r.fileId }} / {{ r.versionId }}
            </option>
          </select></label
        ><label
          >Note body<textarea
            v-model="text"
            aria-label="New scoped note body"
            :disabled="busy || !enabled"
          /></label
      ></template>
      <template v-if="kind === 'asset'">
        <label
          >New image bytes<input
            type="file"
            accept="image/*"
            aria-label="New scoped image"
            :disabled="busy || !enabled"
            @change="chooseAsset"
        /></label>
        <label
          >Intrinsic sponsor<select
            v-model="sponsorId"
            aria-label="Scoped image sponsor"
            :disabled="busy || !enabled"
          >
            <option v-for="sponsor in sponsors" :key="sponsor.fileId" :value="sponsor.fileId">
              {{ sponsor.label }} — {{ sponsor.versionId }}
            </option>
          </select></label
        >
        <p>
          The selected image's bytes and this exact current intrinsic sponsor are reviewed before
          upload. Existing paths are never adopted or replaced.
        </p>
      </template>
      <Button
        text="Review new-file choice"
        tooltip="Recheck current scope, root and destination before any local file creation"
        :disabled="busy || !enabled || !flow || (kind === 'asset' && !assetBytes)"
        @click="review"
      />
      <template v-if="shown"
        ><p>
          Exact target: <code>{{ shown.path }}</code
          >. SHA: <code>{{ shown.sha }}</code>
        </p>
        <p v-if="shown.root">
          Approved root: {{ shown.root.label }} — {{ shown.root.fileId }} /
          {{ shown.root.versionId }}
        </p>
        <Button
          text="Create reviewed file"
          tooltip="Persist the exact native operation handle before placing or uploading bytes"
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
        throw new Error('Choose new image bytes and a current intrinsic sponsor')
      const { label: _label, ...sponsor } = selected
      shown.value = await props.flow.review({
        kind: 'asset',
        path: path.value,
        bytes: assetBytes.value,
        sponsor,
      })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Scoped file choice held'
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
    error.value = e instanceof Error ? e.message : 'Scoped creation held'
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
