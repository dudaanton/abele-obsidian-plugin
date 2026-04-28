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

      <Setting name="Reasoning" desc="Enable reasoning/thinking for supported models.">
        <Checkbox
          :is-enabled="form.supportsReasoning"
          @toggle="form.supportsReasoning = !form.supportsReasoning"
        />
      </Setting>

      <div class="abele-model-edit__actions">
        <Button text="Save" :disabled="!form.id" @click="onSave" />
        <Button v-if="!isNew" text="Delete" @click="onDelete" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import type { AiModelConfig } from '@/ai/types'

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

const onSave = () => {
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
  width: min(500px, 90vw);
}

.abele-model-edit__actions {
  display: flex;
  gap: var(--size-4-2);
  justify-content: flex-end;
  padding-top: var(--size-4-3);
  border-top: 1px solid var(--background-modifier-border);
  margin-top: var(--size-4-2);
}
</style>
