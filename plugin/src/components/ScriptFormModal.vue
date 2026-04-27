<template>
  <ObsidianModal title="Script Parameters" @close="onCancel">
    <div class="abele-script-form">
      <div v-for="field in fields" :key="field.name" class="abele-script-form__field">
        <label class="abele-script-form__label">
          {{ field.label }}
          <span v-if="field.required" class="abele-script-form__required">*</span>
        </label>
        <select
          v-if="field.type === 'select' && field.options"
          v-model="values[field.name]"
          class="dropdown"
        >
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <textarea
          v-else-if="field.type === 'textarea'"
          v-model="values[field.name]"
          class="abele-script-form__textarea"
          rows="4"
        />
        <Checkbox
          v-else-if="field.type === 'boolean'"
          :is-enabled="values[field.name] === 'true'"
          @toggle="values[field.name] = values[field.name] === 'true' ? 'false' : 'true'"
        />
        <input v-else v-model="values[field.name]" type="text" class="abele-script-form__input" />
      </div>
      <div class="abele-script-form__actions">
        <button class="mod-cta" @click="onSubmit">Run</button>
        <button @click="onCancel">Cancel</button>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Checkbox from './obsidian/Checkbox.vue'
import type { FormField } from '@/scripting/types'

const props = defineProps<{
  fields: FormField[]
  resolve: (result: Record<string, string> | null) => void
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const values = reactive<Record<string, string>>({})
for (const field of props.fields) {
  values[field.name] = field.default ?? (field.type === 'boolean' ? 'false' : '')
}

function onSubmit() {
  props.resolve({ ...values })
  emit('close')
}

function onCancel() {
  props.resolve(null)
  emit('close')
}
</script>

<style lang="scss">
.abele-script-form {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding-top: var(--size-4-2);
}

.abele-script-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-script-form__label {
  font-weight: var(--font-semibold);
}

.abele-script-form__required {
  color: var(--text-error);
}

.abele-script-form__input,
.abele-script-form__textarea {
  width: 100%;
}

.abele-script-form__actions {
  display: flex;
  gap: var(--size-4-2);
  justify-content: flex-end;
}
</style>
