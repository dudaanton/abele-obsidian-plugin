<template>
  <ObsidianModal title="Books on an untrusted reader" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-books-setup">
      <p v-if="!enabled" role="status">
        Books group-only setup is not active. This preview sends no credential or content request.
      </p>
      <p role="status">State: {{ status.status }}. Effective role: {{ status.role }}.</p>
      <p v-if="status.status === 'revoked'">
        Access revoked. Downloaded bytes remain locally readable; no more downloads or writes.
      </p>
      <p v-if="status.status === 'unsupported-transport'">
        Native transport is unverified on this device. No unsafe fallback or personal token is used.
      </p>
      <p v-if="status.status === 'recovery'">
        Retained identity/ledger requires explicit recovery. No reinitialization or personal
        fallback.
      </p>
      <p>
        Authorized known files: {{ status.known }}; local materialized: {{ status.materialized }};
        omitted/known-not-materialized: {{ status.omitted }}. Omitted files are not remote deletions
        or local creates.
      </p>
      <p>
        This device may read and write only the owner-selected Books group. It is untrusted: only a
        scoped key/installation secret, never an account or personal device token. No whole-vault
        frontmatter discovery, second connection, owner publisher or script approval is available
        here.
      </p>
      <label
        >Issuer<input
          :value="input?.issuer ?? ''"
          readonly
          aria-label="Books issuer"
          :disabled="busy || !enabled" /></label
      ><label
        >Books grant identity<input
          :value="input?.grantId ?? ''"
          readonly
          aria-label="Books grant identity"
          :disabled="busy || !enabled" /></label
      ><label
        >Approved Books root<input
          :value="input?.rootFileId ?? ''"
          readonly
          aria-label="Books root identity"
          :disabled="busy || !enabled" /></label
      ><label
        >Scoped secret<input
          v-model="token"
          readonly
          type="password"
          autocomplete="off"
          aria-label="Books scoped secret"
          :disabled="busy || !enabled"
      /></label>
      <p>
        Required role: <strong>Editor — reads and writes</strong>. A reader ceiling is shown as a
        hold and requires owner renewal; the client cannot upgrade it locally.
      </p>
      <h4>Available actions</h4>
      <ul>
        <li>Read downloaded content: yes, even after revoke.</li>
        <li>
          Edit authorized note body: {{ can('edit-note') ? 'yes' : 'held' }}. Existing group/root
          fields stay protected.
        </li>
        <li>
          Create scoped-native note/image:
          {{ can('create-native') ? 'with current root/sponsor and own upload proof' : 'held' }}.
        </li>
        <li>
          Edit imported owner assets: refused. Make a genuinely new native copy at a free path
          instead.
        </li>
        <li>
          Publish extras, execute vault scripts, personal setup or change membership: refused.
        </li>
      </ul>
      <Button
        text="Set up this Books scoped installation"
        tooltip="Verify the exact Books/editor binding and protected ledger before manifest-only pull"
        :disabled="busy || !enabled || !flow || !input"
        @click="setup"
      />
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close the preview and discard the displayed scoped secret"
        @click="close"
      /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, onUnmounted, computed } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import {
  BOOX_BOOKS_ENABLED,
  booxPermission,
  type BooxBooksSetup,
  type BooksStatus,
  type BooksInput,
  type BooksAction,
} from '@/sync/scoped/booxSetup'
const props = defineProps<{
    flow?: BooxBooksSetup
    input?: BooksInput
    status?: BooksStatus
    enabled?: boolean
  }>(),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? BOOX_BOOKS_ENABLED,
  token = ref(''),
  busy = ref(false),
  error = ref(''),
  result = ref<BooksStatus | null>(null),
  status = computed(
    () =>
      result.value ??
      props.status ?? {
        status: 'unsupported-transport',
        role: 'editor',
        known: 0,
        materialized: 0,
        omitted: 0,
      }
  )
function can(action: BooksAction) {
  return (
    enabled &&
    booxPermission(
      status.value.role,
      status.value.status === 'ready' ? 'active' : status.value.status,
      action
    )
  )
}
async function setup() {
  if (!enabled || !props.flow || !props.input) return
  busy.value = true
  try {
    result.value = await props.flow.setup(props.input)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Books setup held'
  } finally {
    token.value = ''
    busy.value = false
  }
}
function close() {
  token.value = ''
  props.flow?.close()
  emit('close')
}
onUnmounted(() => {
  token.value = ''
  props.flow?.close()
})
</script>
<style scoped>
.abele-books-setup {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-books-setup label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-books-setup p {
  overflow-wrap: anywhere;
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
</style>
