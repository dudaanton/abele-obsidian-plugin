<template>
  <ObsidianModal :title="title" :modal-class="modalClass" close-in-footer @close="emit('close')">
    <p v-if="message" class="abele-prompt__message">{{ message }}</p>
    <Input
      ref="field"
      v-model="value"
      class="abele-prompt__field"
      :placeholder="placeholder"
      :aria-label="label ?? placeholder"
      :invalid="!!error"
      @commit="submit"
    />
    <p v-if="error" class="mod-warning abele-prompt__error">{{ error }}</p>
    <template #footer>
      <Button :text="t('kit.cancel')" :tooltip="cancelTooltip" @click="emit('close')" />
      <Button :text="submitText" :tooltip="submitTooltip" accent @click="submit" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { nextTick, onMounted, ref } from 'vue'
import ObsidianModal from './Modal.vue'
import Input from './Input.vue'
import Button from './Button.vue'

/**
 * Asks for one line of text — the name of something about to be made, an address. Answers with
 * the trimmed text, or with what `validate` makes of it; a `validate` that throws keeps the dialog
 * open with its message under the field. Without `validate`, an empty field answers nothing.
 *
 * Opened through `promptDialog()`; any other way of closing it is no answer.
 */
const props = withDefaults(
  defineProps<{
    title: string
    message?: string
    placeholder?: string
    /** The field's name for a screen reader; the placeholder when not given. */
    label?: string
    /** What the field holds to begin with, for a name being changed. */
    value?: string
    submitText?: string
    submitTooltip?: string
    cancelTooltip?: string
    validate?: (value: string) => string
    modalClass?: string | string[]
    /** Puts the caret in the field on open; off where the person taps the field first. */
    autofocus?: boolean
  }>(),
  {
    autofocus: true,
    placeholder: () => t('kit.filename'),
    value: '',
    submitText: () => t('kit.create'),
    submitTooltip: () => t('kit.submitTooltip'),
    cancelTooltip: () => t('kit.cancelTooltip'),
  }
)

const emit = defineEmits<{
  (e: 'answer', value: string): void
  (e: 'close'): void
}>()

const value = ref(props.value)
const error = ref('')
const field = ref<InstanceType<typeof Input>>()

function submit(): void {
  const text = value.value.trim()
  if (!props.validate) {
    if (!text) return
    emit('answer', text)
    emit('close')
    return
  }
  try {
    const answer = props.validate(text)
    emit('answer', answer)
    emit('close')
  } catch (cause) {
    error.value = String(cause)
  }
}

onMounted(() => void nextTick(() => props.autofocus && field.value?.focus()))
</script>

<style>
.abele-prompt__field {
  width: 100%;
}
</style>
