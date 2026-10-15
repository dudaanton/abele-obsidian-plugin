<template>
  <ObsidianModal title="Send saved keys?" @close="emit('close')">
    <!-- Which keys, and where to: two facts as a settings window lists them, the names and the
         address in code type; then what pressing Allow means, in one quiet paragraph. -->
    <dl class="abele-key-request__facts">
      <dt>{{ names.length === 1 ? 'Key' : 'Keys' }}</dt>
      <dd>
        <code v-for="key in names" :key="key">{{ key }}</code>
      </dd>
      <dt>Sent to</dt>
      <dd>
        <code>{{ origin }}</code>
      </dd>
    </dl>
    <p class="abele-key-request__note">
      The saved values go into the request; they are never shown here. Allowing remembers this
      address for {{ missing.join(', ') }} on this device, so it will not ask again here. Other
      devices will still ask.
    </p>
    <!-- One line for a failure, said again in place rather than piled up on every try. -->
    <p class="abele-key-request__error" role="alert" :hidden="!failed">
      {{ failed ? FAILURE : '' }}
    </p>
    <template #footer>
      <Button
        text="Cancel"
        tooltip="Send nothing and leave the permissions as they are"
        @click="emit('close')"
      />
      <Button
        text="Allow address and send"
        accent
        :disabled="saving"
        :tooltip="`Remember ${origin} for these keys on this device, then send the request`"
        @click="onAllow"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'

/**
 * Asks before a script's request carries saved keys to an address not yet allowed for them on
 * this device. `allow` saves the permission and lets the request go; it is the opener's, so
 * this dialog only says what is asked and how it went. Answers true once `allow` has finished;
 * a failure stays open with one line saying so, and any other way of closing is no.
 *
 * Opened through `approveScriptKeyRequest()`.
 */
const props = defineProps<{
  /** Every saved key the request names. */
  names: string[]
  /** Where it is sent. */
  origin: string
  /** The keys this address is not yet allowed for. */
  missing: string[]
  allow: () => Promise<void>
}>()

const emit = defineEmits<{
  (e: 'answer', value: true): void
  (e: 'close'): void
}>()

const FAILURE =
  'Could not save this key permission, so nothing was sent. Check key destinations and try again.'

const saving = ref(false)
const failed = ref(false)

async function onAllow(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await props.allow()
  } catch {
    failed.value = true
    return
  } finally {
    saving.value = false
  }
  emit('answer', true)
  emit('close')
}
</script>
