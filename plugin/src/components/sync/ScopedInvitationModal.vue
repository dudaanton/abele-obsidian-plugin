<template>
  <ObsidianModal title="Join a shared group" size="tall" phone-sheet @close="close">
    <div class="abele-modal__body abele-scoped-join">
      <p v-if="!enabled" role="status">
        Joining shared groups is not active. No connection will be made.
      </p>
      <p>
        Joining downloads shared notes without sharing your other files. Existing files are not
        replaced, and scripts from this shared vault cannot run.
      </p>
      <label
        >Server<input v-model="issuer" aria-label="Scoped server" :disabled="busy || !enabled"
      /></label>
      <label
        >Invitation code<input
          v-model="invitation"
          type="password"
          autocomplete="off"
          aria-label="Invitation code"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Your email<input
          v-model="email"
          type="email"
          autocomplete="username"
          aria-label="Your email"
          :disabled="busy || !enabled"
      /></label>
      <label
        >Device name<input v-model="name" aria-label="Device name" :disabled="busy || !enabled"
      /></label>
      <label
        >Your password<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          aria-label="Your password"
          :disabled="busy || !enabled"
      /></label>
      <Button
        text="Join group"
        tooltip="Download the shared notes without sharing your other files"
        :disabled="busy || !enabled || (!flow && !factory)"
        @click="join"
      />
      <p v-if="result" role="status">{{ result }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button text="Close" tooltip="Close and continue joining later" @click="close" />
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Platform } from 'obsidian'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage } from './sharingText'
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
  name = ref('This device'),
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
      {
        accepting: 'Checking the invitation.',
        enrolling: 'Connecting this device.',
        pulling: 'Downloading shared notes.',
        'collision-hold': 'Some files already exist here. They were not replaced.',
        'waiting-view': 'The group is still getting ready. Try joining again shortly.',
        joined: 'You have joined the shared group.',
      }[state.phase] +
      (state.collisions?.length ? ' Files to review: ' + state.collisions.join(', ') : '')
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not join this group. Check the invitation and try again.'
    )
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
