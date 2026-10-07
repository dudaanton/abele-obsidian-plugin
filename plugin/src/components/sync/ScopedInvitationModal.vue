<template>
  <ObsidianModal title="Join a shared group" size="tall" phone-sheet @close="close">
    <div class="abele-modal__body abele-scoped-join">
      <p v-if="!enabled" role="status">
        Scoped invitation join is not active. No account login, installation or local upload is
        performed until activation gates pass.
      </p>
      <p>
        One connection per local vault. Received notes keep their exact paths; unrelated local files
        are never published by joining. Occupied incoming paths are held for recovery, not replaced
        or remapped. Vault scripts are refused on a scoped installation.
      </p>
      <label
        >Server<input v-model="issuer" aria-label="Scoped server" :disabled="busy || !enabled"
      /></label>
      <label
        >Invitation secret<input
          v-model="invitation"
          type="password"
          autocomplete="off"
          aria-label="Invitation secret"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Recipient account<input
          v-model="email"
          type="email"
          autocomplete="username"
          aria-label="Recipient account"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Installation name<input
          v-model="name"
          aria-label="Installation name"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Account password<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          aria-label="Recipient password"
          :disabled="busy || !enabled"
      /></label>
      <Button
        text="Accept invitation and join"
        tooltip="Resume the same scoped installation without publishing local files"
        :disabled="busy || !enabled || (!flow && !factory)"
        @click="join"
      />
      <p v-if="result" role="status">{{ result }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close without forgetting the durable join attempt"
        @click="close"
      />
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Platform } from 'obsidian'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { SCOPED_JOIN_ENABLED, type ScopedJoinFlow } from '@/sync/scoped/scopedJoin'
const props = withDefaults(
    defineProps<{
      flow?: ScopedJoinFlow
      factory?: (issuer: string) => ScopedJoinFlow
      enabled?: boolean
    }>(),
    { enabled: SCOPED_JOIN_ENABLED }
  ),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? SCOPED_JOIN_ENABLED
const issuer = ref(''),
  invitation = ref(''),
  email = ref(''),
  name = ref('Sample scoped device'),
  password = ref(''),
  busy = ref(false),
  result = ref(''),
  error = ref('')
let active: ScopedJoinFlow | undefined
let activeIssuer = ''
async function join() {
  if (!enabled || (!props.flow && !props.factory) || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (props.flow) active = props.flow
    else if (!active || activeIssuer !== issuer.value) {
      active?.close()
      active = props.factory!(issuer.value)
      activeIssuer = issuer.value
    }
    if (invitation.value)
      await active.begin({
        issuer: issuer.value,
        token: invitation.value,
        email: email.value,
        name: name.value,
        role: 'editor',
        platform: Platform.isMobile ? 'mobile' : 'desktop',
      })
    const state = await active.resume(password.value)
    result.value =
      state.phase +
      (state.collisions?.length ? ': held local paths ' + state.collisions.join(', ') : '')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Scoped join failed'
  } finally {
    password.value = ''
    invitation.value = ''
    busy.value = false
  }
}
function close() {
  password.value = ''
  invitation.value = ''
  active?.close()
  props.flow?.close()
  emit('close')
}
onUnmounted(() => {
  password.value = ''
  invitation.value = ''
  active?.close()
  props.flow?.close()
})
</script>
<style scoped>
.abele-scoped-join {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
.abele-scoped-join label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-scoped-join p {
  overflow-wrap: anywhere;
}
</style>
