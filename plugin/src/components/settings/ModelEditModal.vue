<template>
  <ObsidianModal
    :title="
      isNew
        ? t('settings.ModelEditModal.add_model.7060e824')
        : t('settings.ModelEditModal.edit_model.e76cc0ba')
    "
    @close="emit('close')"
  >
    <div class="abele-model-edit">
      <Setting
        :name="t('settings.ModelEditModal.model_id.089ef2b6')"
        :desc="t('settings.ModelEditModal.api_model_identifier_e_g.5c0e2892')"
      >
        <Input
          v-model:model-value="form.id"
          :placeholder="
            t('settings.ModelEditModal.e_g_gpt_o.c6a41eb7', { literal0: String('gpt-4o') })
          "
        />
      </Setting>

      <Setting
        :name="t('settings.ModelEditModal.display_name.2b7f6a84')"
        :desc="t('settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f')"
      >
        <Input
          v-model:model-value="form.name"
          :placeholder="
            t('settings.ModelEditModal.e_g_gpt_o.c9f23b2e', { literal0: String('GPT-4o') })
          "
        />
      </Setting>

      <Setting
        :name="t('settings.ModelEditModal.context_window.7696d085')"
        :desc="t('settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14')"
      >
        <Input
          :model-value="String(form.contextWindow)"
          @update:model-value="form.contextWindow = parseInt($event) || 0"
        />
      </Setting>

      <Setting
        :name="t('settings.ModelEditModal.max_output_tokens.397dda07')"
        :desc="t('settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9')"
      >
        <Input
          :model-value="String(form.maxTokens)"
          @update:model-value="form.maxTokens = parseInt($event) || 0"
        />
      </Setting>

      <Setting
        :name="t('settings.ModelEditModal.request_timeout_seconds.1b1b1d08')"
        :desc="t('settings.ModelEditModal.wait_for_the_first_response.08adebcb')"
      >
        <Input
          :model-value="timeoutInput"
          :aria-invalid="timeoutError ? 'true' : undefined"
          :placeholder="t('settings.ModelEditModal.global_timeout.542c2bf3')"
          @update:model-value="setRequestTimeout($event)"
        />
        <div v-if="timeoutError" class="setting-item-description" role="alert">
          {{ timeoutError }}
        </div>
      </Setting>

      <Setting
        :name="t('settings.ModelEditModal.reasoning.d8211e24')"
        :desc="t('settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996')"
      >
        <Checkbox :is-enabled="form.supportsReasoning" @toggle="toggleReasoning" />
      </Setting>

      <Setting
        v-if="form.supportsReasoning"
        :name="t('settings.ModelEditModal.thinking_effort.264c28cb')"
        :desc="t('settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5')"
      >
        <Dropdown
          :model-value="form.reasoningEffort || ''"
          :options="[
            { value: '', display: t('settings.ModelEditModal.default.21b111cb') },
            { value: 'low', display: t('settings.ModelEditModal.low.f793de20') },
            { value: 'medium', display: t('settings.ModelEditModal.medium.8e588cd1') },
            { value: 'high', display: t('settings.ModelEditModal.high.c4ebc6d4') },
          ]"
          @update:model-value="form.reasoningEffort = $event || undefined"
        />
      </Setting>
    </div>

    <ConfirmModal
      v-if="confirming"
      :title="t('settings.ModelEditModal.delete_model.b7828ba0')"
      :message="
        t('settings.ModelEditModal.delete_value_agents_using_it.c65217d0', {
          value0: String(form.name || form.id),
        })
      "
      :confirm-tooltip="
        t('settings.ModelEditModal.delete_value.8782b778', { value0: String(form.name || form.id) })
      "
      @confirm="onDelete"
      @close="confirming = false"
    />
    <template #footer>
      <Button
        :text="t('settings.ModelEditModal.save.1509f561')"
        :disabled="!form.id || !!timeoutError"
        :tooltip="t('settings.ModelEditModal.keep_these_settings_and_close.88a64dfa')"
        @click="onSave"
      />
      <Button
        v-if="!isNew"
        :text="t('settings.ModelEditModal.delete.e2d0a549')"
        warning
        :tooltip="t('settings.ModelEditModal.remove_this_model_from_the.2838dd4b')"
        @click="confirming = true"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, reactive, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import type { AiModelConfig } from '@/ai/types'
import { MAX_REQUEST_TIMEOUT_SECONDS } from '@/ai/requestTimeout'

const props = defineProps<{
  model: AiModelConfig
  isNew?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', model: AiModelConfig): void
  (e: 'delete'): void
}>()

const form = reactive<AiModelConfig>({ ...props.model })
const toggleReasoning = () => {
  form.supportsReasoning = !form.supportsReasoning
  if (form.supportsReasoning) delete form.reasoningDisabled
  else form.reasoningDisabled = true
}
const timeoutInput = ref(
  form.requestTimeoutSeconds === undefined ? '' : String(form.requestTimeoutSeconds)
)
const timeoutError = computed(() => {
  const seconds = Number(timeoutInput.value)
  return timeoutInput.value.trim() !== '' &&
    (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_REQUEST_TIMEOUT_SECONDS)
    ? t('settings.ModelEditModal.enter_seconds_correct_this_value.508147a7')
    : ''
})

const setRequestTimeout = (value: string) => {
  timeoutInput.value = value
  if (value.trim() === '') {
    timeoutInput.value = ''
    delete form.requestTimeoutSeconds
    return
  }
  const seconds = Number(value)
  if (timeoutError.value) return
  form.requestTimeoutSeconds = seconds
}

/** Held open until the question is answered — see docs/Design.md. */
const confirming = ref(false)

const onSave = () => {
  if (timeoutError.value) return
  emit('save', { ...form })
  emit('close')
}

const onDelete = () => {
  emit('delete')
  emit('close')
}
</script>

<style lang="scss">
.modal:has(.abele-model-edit) {
  width: min(31rem, 90vw);
}
</style>
