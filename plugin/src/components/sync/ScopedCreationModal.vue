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
      <p v-if="kind === 'asset' || !enabled">
        Native image bytes and an exact current intrinsic sponsor must be provided by the native
        paste adapter before upload. Missing paste evidence is a hold, not a media-folder
        permission.
      </p>
      <Button
        text="Review new-file choice"
        tooltip="Recheck current scope, root and destination before any local file creation"
        :disabled="busy || !enabled || !flow || kind === 'asset'"
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
} from '@/sync/scoped/scopedCreation'
const props = defineProps<{
    flow?: ScopedCreationFlow
    roots?: ApprovedRoot[]
    enabled?: boolean
  }>(),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? SCOPED_CREATION_ENABLED,
  roots = props.roots ?? []
const kind = ref<'note' | 'asset'>('note'),
  path = ref(''),
  rootId = ref(''),
  text = ref(''),
  busy = ref(false),
  error = ref(''),
  shown = ref<CreationReview | null>(null)
watch([kind, path, rootId, text], () => {
  shown.value = null
  props.flow?.close()
})
async function review() {
  if (!enabled || !props.flow || kind.value !== 'note') return
  busy.value = true
  error.value = ''
  try {
    shown.value = await props.flow.review({
      kind: 'note',
      path: path.value,
      text: text.value,
      rootId: rootId.value,
    })
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
