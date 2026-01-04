<template>
  <Modal title="Template variables" @close="emit('close')">
    <div class="template-variables-modal">
      <div class="variables-list">
        <div v-for="variable in variables" :key="variable.name" class="variable-item">
          <label class="variable-label">{{ variable.name }}</label>
          <Input
            :model-value="values.get(variable.name) || ''"
            :placeholder="getPlaceholder(variable)"
            @update:model-value="(v: string) => updateValue(variable.name, v)"
          />
        </div>
      </div>

      <div class="modal-buttons">
        <Button text="Cancel" @click="emit('close')" />
        <Button text="Apply" :accent="true" @click="confirmValues" />
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Modal from './obsidian/Modal.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import { TemplateVariable } from '@/templates/TemplateParser'

const props = defineProps<{
  variables: TemplateVariable[]
  initialValues?: Map<string, string>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', values: Map<string, string>): void
}>()

const values = ref<Map<string, string>>(new Map())

onMounted(() => {
  // Initialize with any provided initial values
  if (props.initialValues) {
    for (const [key, value] of props.initialValues) {
      values.value.set(key, value)
    }
  }
})

function updateValue(name: string, value: string) {
  values.value.set(name, value)
}

function getPlaceholder(variable: TemplateVariable): string {
  if (variable.type === 'plugin') {
    return `Enter value for ${variable.name}`
  }
  return `Enter ${variable.name}`
}

function confirmValues() {
  emit('confirm', values.value)
}
</script>

<style scoped>
.template-variables-modal {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 350px;
}

.variables-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.variable-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.variable-label {
  font-weight: var(--font-medium);
  font-size: var(--font-small);
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}
</style>
