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

          <!-- wikilink: single file picker -->
          <Search
            v-else-if="variable.type === 'wikilink'"
            :model-value="values.get(variable.name) || ''"
            :suggester="FileSuggest"
            placeholder="Search for a note..."
            @update:model-value="(v: string) => updateValue(variable.name, v)"
          />

          <!-- select: dropdown with options -->
          <select
            v-else-if="variable.type === 'select' && variable.options"
            :value="values.get(variable.name) || ''"
            class="dropdown"
            @change="
              (e: Event) => updateValue(variable.name, (e.target as HTMLSelectElement).value)
            "
          >
            <option value="" disabled>Select {{ variable.name }}</option>
            <option v-for="opt in variable.options" :key="opt" :value="opt">{{ opt }}</option>
          </select>

          <!-- image: pick from vault, disk, or clipboard -->
          <div v-else-if="variable.type === 'image'" class="variable-image">
            <div v-if="values.get(variable.name)" class="variable-image__preview">
              <img :src="imageUrls.get(variable.name)" class="variable-image__thumb" />
              <span class="variable-image__path">{{
                getFileName(values.get(variable.name)!)
              }}</span>
              <button
                class="variable-image__clear clickable-icon"
                @click="clearImage(variable.name)"
              >
                <ObsidianIcon icon="x" />
              </button>
            </div>
            <div class="variable-image__actions">
              <button class="clickable-icon" @click="pickImageFromVault(variable.name)">
                <ObsidianIcon icon="vault" />
                <span>Vault</span>
              </button>
              <button class="clickable-icon" @click="pickImageFromDisk(variable.name)">
                <ObsidianIcon icon="hard-drive" />
                <span>Disk</span>
              </button>
              <button class="clickable-icon" @click="pickImageFromClipboard(variable.name)">
                <ObsidianIcon icon="clipboard-paste" />
                <span>Clipboard</span>
              </button>
            </div>
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
import { Notice, TFile } from 'obsidian'
import Modal from './obsidian/Modal.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import Search from './obsidian/Search.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { TemplateVariable } from '@/templates/TemplateParser'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { pickImageFile } from '@/helpers/suggesters/ImagePicker'
import { importExternalFile, importClipboardImage } from '@/ai/attachments'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  variables: TemplateVariable[]
  initialValues?: Map<string, string>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', values: Map<string, string>): void
}>()

const values = ref<Map<string, string>>(new Map())
const imageUrls = ref<Map<string, string>>(new Map())

onMounted(() => {
  // Apply variable defaults first
  for (const v of props.variables) {
    if (v.defaultValue !== undefined) {
      values.value.set(v.name, v.defaultValue)
    }
  }
  // Override with external initialValues (e.g. selected text)
  if (props.initialValues) {
    for (const [key, value] of props.initialValues) {
      values.value.set(key, value)
    }
  }
  // Initialize list variables with empty array if still unset
  for (const v of props.variables) {
    if ((v.type === 'list' || v.type === 'wiki_list') && !values.value.has(v.name)) {
      values.value.set(v.name, '[]')
    }
  }
  // Resolve preview URLs for pre-filled image values
  for (const v of props.variables) {
    if (v.type === 'image' && values.value.has(v.name)) {
      resolveImageUrl(v.name, values.value.get(v.name)!)
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

// --- image helpers ---

function resolveImageUrl(name: string, path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    imageUrls.value.set(name, app.vault.getResourcePath(file))
  }
}

function setImageValue(name: string, path: string) {
  values.value.set(name, path)
  resolveImageUrl(name, path)
}

function clearImage(name: string) {
  values.value.delete(name)
  imageUrls.value.delete(name)
}

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

async function pickImageFromVault(name: string) {
  const { app } = GlobalStore.getInstance()
  const file = await pickImageFile(app)
  if (file) setImageValue(name, file.path)
}

function pickImageFromDisk(name: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const created = await importExternalFile(file)
    setImageValue(name, created.path)
  }
  input.click()
}

async function pickImageFromClipboard(name: string) {
  try {
    const path = await importClipboardImage()
    if (path) {
      setImageValue(name, path)
    } else {
      new Notice('No images found in clipboard')
    }
  } catch {
    new Notice('Could not read clipboard')
  }
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

.variable-image {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.variable-image__preview {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1);
  border-radius: var(--radius-s);
  background: var(--background-secondary);
}

.variable-image__thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: var(--radius-s);
  flex-shrink: 0;
}

.variable-image__path {
  flex: 1;
  font-size: var(--font-small);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-image__clear {
  flex-shrink: 0;
  color: var(--text-muted);
}

.variable-image__actions {
  display: flex;
  gap: var(--size-4-1);
}

.variable-image__actions .clickable-icon {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  font-size: var(--font-small);
  padding: 2px 8px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}
</style>
