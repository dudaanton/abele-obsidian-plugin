<template>
  <ObsidianModal :title="isNew ? 'Add Model' : 'Edit Model'" @close="emit('close')">
    <div class="abele-model-edit">
      <Setting name="Model ID" desc="API model identifier (e.g. gpt-4o, claude-sonnet-4-20250514).">
        <Input v-model:model-value="form.id" placeholder="e.g. gpt-4o" />
      </Setting>

      <Setting name="Display name" desc="Optional label shown in model selector.">
        <Input v-model:model-value="form.name" placeholder="e.g. GPT-4o" />
      </Setting>

      <Setting name="Context window" desc="Maximum input tokens the model supports.">
        <Input
          :model-value="String(form.contextWindow)"
          @update:model-value="form.contextWindow = parseInt($event) || 0"
        />
      </Setting>

      <Setting name="Max output tokens" desc="Maximum tokens in a single response.">
        <Input
          :model-value="String(form.maxTokens)"
          @update:model-value="form.maxTokens = parseInt($event) || 0"
        />
      </Setting>

      <Setting
        name="Request timeout (seconds)"
        desc="Wait for the first response or next chunk, not the whole answer. 1–3600 seconds; empty uses the global timeout. Applies to chat and background work with this model."
      >
        <Input
          :model-value="timeoutInput"
          :aria-invalid="timeoutError ? 'true' : undefined"
          placeholder="Global timeout"
          @update:model-value="setRequestTimeout($event)"
        />
        <div v-if="timeoutError" class="setting-item-description" role="alert">
          {{ timeoutError }}
        </div>
      </Setting>

      <Setting name="Reasoning" desc="Enable reasoning/thinking for supported models.">
        <Checkbox
          :is-enabled="form.supportsReasoning"
          @toggle="form.supportsReasoning = !form.supportsReasoning"
        />
      </Setting>

      <Setting
        v-if="form.supportsReasoning"
        name="Thinking effort"
        desc="Controls how much reasoning the model does. Leave at Default for model's own behavior."
      >
        <Dropdown
          :model-value="form.reasoningEffort || ''"
          :options="[
            { value: '', display: 'Default' },
            { value: 'low', display: 'Low' },
            { value: 'medium', display: 'Medium' },
            { value: 'high', display: 'High' },
          ]"
          @update:model-value="form.reasoningEffort = $event || undefined"
        />
      </Setting>
    </div>

    <ConfirmModal
      v-if="confirming"
      title="Delete model"
      :message="`Delete ${form.name || form.id}? Agents using it will have no model until one is
        chosen again.`"
      :confirm-tooltip="`Delete ${form.name || form.id}`"
      @confirm="onDelete"
      @close="confirming = false"
    />
    <template #footer>
      <Button
        text="Save"
        :disabled="!form.id || !!timeoutError"
        tooltip="Keep these settings and close"
        @click="onSave"
      />
      <Button
        v-if="!isNew"
        text="Delete"
        warning
        tooltip="Remove this model from the provider"
        @click="confirming = true"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
const timeoutInput = ref(
  form.requestTimeoutSeconds === undefined ? '' : String(form.requestTimeoutSeconds)
)
const timeoutError = computed(() => {
  const seconds = Number(timeoutInput.value)
  return timeoutInput.value.trim() !== '' &&
    (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_REQUEST_TIMEOUT_SECONDS)
    ? 'Enter 1–3600 seconds. Correct this value before saving.'
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
