<template>
  <ObsidianModal title="Share a folder" size="tall" phone-sheet @close="emit('close')">
    <div class="abele-modal__body abele-folder-sharing">
      <p v-if="!enabled" role="status">Folder sharing is not active. No files will be shared.</p>
      <label
        >Folder path<input
          v-model="prefix"
          aria-label="Folder path"
          placeholder="Sample folder/"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Share name<input v-model="label" aria-label="Share name" :disabled="busy || !enabled"
      /></label>
      <label
        >Access<select v-model="role" aria-label="Folder access" :disabled="busy || !enabled">
          <option value="reader">Can view</option>
          <option value="editor">Can edit</option>
        </select></label
      >
      <Button
        text="Review folder"
        tooltip="Check the folder's files before sharing"
        :disabled="busy || !enabled"
        @click="review"
      />
      <template v-if="display">
        <p>
          Folder: <code>{{ display.prefix }}</code
          >. Files stay in their current folders.
        </p>
        <p role="status">
          Folder checked: {{ display.files.filter((file) => file.eligible).length }} files included;
          {{ display.files.filter((file) => file.eligibility === 'excluded').length }} excluded.
        </p>
        <ul>
          <li v-for="file in display.files" :key="file.path">
            <code>{{ file.path }}</code> —
            {{
              file.eligibility === 'excluded'
                ? 'Scripts and settings are not shared.'
                : file.eligible
                  ? 'Included.'
                  : 'Will be checked before sharing.'
            }}
          </li>
        </ul>
        <label
          >Your account email<input
            v-model="email"
            type="email"
            autocomplete="username"
            aria-label="Owner account email"
            :disabled="busy || !enabled"
        /></label>
        <label
          >Your password<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            aria-label="Current account password"
            :disabled="busy || !enabled"
        /></label>
        <Button
          text="Create connection code"
          tooltip="Confirm this folder and create a code for another app"
          :disabled="busy || !enabled || !password"
          :accent="enabled"
          @click="confirm"
        />
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="secret"
        ><p>
          Use this connection code in the other app to access this folder. Copy it before closing.
        </p>
        <code class="abele-folder-sharing__secret">{{ secret.token }}</code></template
      >
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close without keeping the password or connection code on screen"
        @click="emit('close')"
      />
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { ref, onUnmounted, watch, computed } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage } from './sharingText'
import {
  OWNER_SHARING_ENABLED,
  type FolderSharingFlow,
  type FolderPreview,
  type MachineCredential,
} from '@/sync/sharing/folderSharing'
const props = withDefaults(
    defineProps<{
      flow?: FolderSharingFlow
      enabled?: boolean
      preview?: FolderPreview
    }>(),
    { enabled: OWNER_SHARING_ENABLED }
  ),
  emit = defineEmits<{ close: [] }>()
const enabled = props.enabled ?? OWNER_SHARING_ENABLED,
  prefix = ref('Sample folder/'),
  label = ref('Sample folder'),
  role = ref<'reader' | 'editor'>('editor'),
  email = ref(''),
  password = ref(''),
  busy = ref(false),
  error = ref(''),
  preview = ref<FolderPreview | null>(null),
  secret = ref<MachineCredential | null>(null),
  display = computed(() => preview.value ?? props.preview)
watch([prefix, label, role], () => {
  preview.value = null
  password.value = ''
  secret.value = null
  error.value = ''
  props.flow?.clear()
})
async function review() {
  if (!props.flow || !enabled) return
  busy.value = true
  error.value = ''
  secret.value = null
  try {
    preview.value = await props.flow.review(prefix.value, role.value, label.value)
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not review this folder. Check its path and try again.'
    )
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!props.flow || !enabled) return
  busy.value = true
  error.value = ''
  try {
    if (!preview.value) throw new Error('Review the displayed folder first')
    secret.value = await props.flow.confirm(password.value, email.value || undefined, preview.value)
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not share this folder. Review it and try again.')
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
.abele-folder-sharing {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
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
