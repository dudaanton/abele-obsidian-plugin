<template>
  <ObsidianModal title="Share a folder" size="tall" phone-sheet @close="emit('close')">
    <div class="abele-modal__body abele-folder-sharing">
      <p v-if="!enabled" role="status">
        Folder sharing is not active. Preview and credential creation are disabled until the scoped
        activation gates pass.
      </p>
      <label
        >Folder prefix<input
          v-model="prefix"
          aria-label="Folder prefix"
          placeholder="Sample folder/"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Share name<input v-model="label" aria-label="Share name" :disabled="busy || !enabled"
      /></label>
      <label
        >Role<select v-model="role" aria-label="Role" :disabled="busy || !enabled">
          <option value="reader">Reader</option>
          <option value="editor">Editor</option>
        </select></label
      >
      <Button
        text="Review current folder"
        tooltip="Refresh the exact folder paths and eligibility before any grant is created"
        :disabled="busy || !enabled"
        @click="review"
      />
      <template v-if="preview">
        <p>
          Exact prefix: <code>{{ preview.prefix }}</code
          >. Files keep their existing paths; no mount or remap is created.
        </p>
        <ul>
          <li v-for="file in preview.files" :key="file.path">
            <code>{{ file.path }}</code> —
            {{ file.eligible ? 'eligible' : 'excluded code or settings' }}
          </li>
        </ul>
        <label
          >Current account password<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            aria-label="Current account password"
            :disabled="busy || !enabled"
        /></label>
        <Button
          text="Create scoped receiver key"
          tooltip="Recheck the preview and authenticate the owner before issuing only a scoped machine key"
          :disabled="busy || !enabled || !password"
          accent
          @click="confirm"
        />
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="secret"
        ><p>
          This is a scoped machine secret, not a personal device credential. It is shown only in
          this review session.
        </p>
        <code class="abele-folder-sharing__secret">{{ secret.token }}</code></template
      >
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close this review and discard its password and displayed machine secret"
        @click="emit('close')"
      />
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import {
  OWNER_SHARING_ENABLED,
  type FolderSharingFlow,
  type FolderPreview,
  type MachineCredential,
} from '@/sync/sharing/folderSharing'
const props = defineProps<{ flow?: FolderSharingFlow; enabled?: boolean }>(),
  emit = defineEmits<{ close: [] }>()
const enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  prefix = ref('Sample folder/'),
  label = ref('Sample folder'),
  role = ref<'reader' | 'editor'>('editor'),
  password = ref(''),
  busy = ref(false),
  error = ref(''),
  preview = ref<FolderPreview | null>(null),
  secret = ref<MachineCredential | null>(null)
async function review() {
  if (!props.flow || !enabled) return
  busy.value = true
  error.value = ''
  secret.value = null
  try {
    preview.value = await props.flow.review(prefix.value, role.value, label.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Folder preview failed'
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!props.flow || !enabled) return
  busy.value = true
  error.value = ''
  try {
    secret.value = await props.flow.confirm(password.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Folder sharing failed'
  } finally {
    password.value = ''
    busy.value = false
  }
}
onUnmounted(() => {
  password.value = ''
  secret.value = null
  props.flow?.clear()
})
</script>
<style scoped>
.abele-folder-sharing label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-folder-sharing code {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.abele-folder-sharing__secret {
  display: block;
}
</style>
