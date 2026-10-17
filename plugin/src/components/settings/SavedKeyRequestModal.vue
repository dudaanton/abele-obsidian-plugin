<template>
  <ObsidianModal
    :title="t('settings.SavedKeyRequestModal.send_saved_keys.618ddec9')"
    @close="emit('close')"
  >
    <!-- Which keys, and where to: two facts as a settings window lists them, the names and the
         address in code type; then what pressing Allow means, in one quiet paragraph. -->
    <dl class="abele-key-request__facts">
      <dt>
        {{
          names.length === 1
            ? t('settings.SavedKeyRequestModal.key.99a52df3')
            : t('settings.SavedKeyRequestModal.keys.f0d66a79')
        }}
      </dt>
      <dd>
        <code v-for="key in names" :key="key">{{ key }}</code>
      </dd>
      <dt>{{ t('settings.SavedKeyRequestModal.sent_to.4e7201c7') }}</dt>
      <dd>
        <code>{{ origin }}</code>
      </dd>
    </dl>
    <p class="abele-key-request__note">
      {{ t('settings.sentence.2de766f4c2331579', { value0: String(missing.join(', ')) }) }}
    </p>
    <!-- One line for a failure, said again in place rather than piled up on every try. -->
    <p class="abele-key-request__error" role="alert" :hidden="!failed">
      {{ failed ? FAILURE : '' }}
    </p>
    <template #footer>
      <Button
        :text="t('settings.SavedKeyRequestModal.cancel.19766ed6')"
        :tooltip="t('settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8')"
        @click="emit('close')"
      />
      <Button
        :text="t('settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17')"
        accent
        :disabled="saving"
        :tooltip="
          t('settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3', {
            value0: String(origin),
          })
        "
        @click="onAllow"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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

const FAILURE = t('settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82')

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
