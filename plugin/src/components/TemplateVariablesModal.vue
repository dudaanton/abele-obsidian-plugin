<template>
  <Modal title="Template variables" @close="emit('close')">
    <div class="template-variables-modal">
      <div class="variables-list">
        <div v-for="variable in variables" :key="variable.name" class="variable-item">
          <label class="variable-label">{{ variable.name }}</label>

          <!-- wiki_list: dynamic list with file suggest -->
          <div v-if="variable.type === 'wiki_list'" class="variable-wiki-list">
            <div
              v-for="(item, idx) in getListItems(variable.name)"
              :key="idx"
              class="variable-wiki-list__row"
            >
              <Search
                :model-value="item"
                :suggester="FileSuggest"
                placeholder="Search for a note..."
                @update:model-value="(v: string) => updateListItem(variable.name, idx, v)"
              />
              <button
                class="variable-wiki-list__remove clickable-icon"
                @click="removeListItem(variable.name, idx)"
              >
                <ObsidianIcon icon="x" />
              </button>
            </div>
            <button
              class="variable-wiki-list__add clickable-icon"
              @click="addListItem(variable.name)"
            >
              <ObsidianIcon icon="plus" />
              <span>Add</span>
            </button>
          </div>

          <!-- list: textarea, line per item -->
          <Input
            v-else-if="variable.type === 'list'"
            :model-value="getTextareaValue(variable.name)"
            :as-text-area="true"
            :placeholder="`One ${variable.name} per line`"
            @update:model-value="(v: string) => updateTextareaValue(variable.name, v)"
          />

          <!-- default: text input -->
          <Input
            v-else
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
import Search from './obsidian/Search.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { TemplateVariable } from '@/templates/TemplateParser'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'

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
  if (props.initialValues) {
    for (const [key, value] of props.initialValues) {
      values.value.set(key, value)
    }
  }
  // Initialize list variables with empty array if not set
  for (const v of props.variables) {
    if ((v.type === 'list' || v.type === 'wiki_list') && !values.value.has(v.name)) {
      values.value.set(v.name, '[]')
    }
  }
})

function updateValue(name: string, value: string) {
  values.value.set(name, value)
}

// --- list (textarea) helpers ---

function getTextareaValue(name: string): string {
  try {
    const items: string[] = JSON.parse(values.value.get(name) || '[]')
    return items.join('\n')
  } catch {
    return ''
  }
}

function updateTextareaValue(name: string, raw: string) {
  const items = raw.split('\n').filter((line) => line.trim() !== '')
  values.value.set(name, JSON.stringify(items))
}

// --- wiki_list helpers ---

function getListItems(name: string): string[] {
  try {
    return JSON.parse(values.value.get(name) || '[]')
  } catch {
    return []
  }
}

function updateListItem(name: string, idx: number, value: string) {
  const items = getListItems(name)
  items[idx] = value
  values.value.set(name, JSON.stringify(items))
}

function addListItem(name: string) {
  const items = getListItems(name)
  items.push('')
  values.value.set(name, JSON.stringify(items))
}

function removeListItem(name: string, idx: number) {
  const items = getListItems(name)
  items.splice(idx, 1)
  values.value.set(name, JSON.stringify(items))
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
  min-width: min(350px, 100%);
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

.variable-wiki-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.variable-wiki-list__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}

.variable-wiki-list__row .abele-obsidian-search {
  flex: 1;
}

.variable-wiki-list__remove {
  flex-shrink: 0;
  color: var(--text-muted);
}

.variable-wiki-list__add {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-small);
  align-self: flex-start;
  padding: 2px 6px;
  border-radius: var(--radius-s);
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}
</style>
