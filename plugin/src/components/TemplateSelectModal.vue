<template>
  <Modal title="Select Template" @close="emit('close')">
    <div class="abele-template-select">
      <Input v-model="searchQuery" placeholder="Search templates..." />

      <!-- Breadcrumbs -->
      <div v-if="currentPath.length > 0 && !searchQuery" class="abele-template-select__breadcrumbs">
        <span class="abele-template-select__breadcrumb-item" @click="navigateTo(-1)">All</span>
        <template v-for="(segment, idx) in currentPath" :key="idx">
          <span class="abele-template-select__breadcrumb-separator">/</span>
          <span class="abele-template-select__breadcrumb-item" @click="navigateTo(idx)">{{
            segment
          }}</span>
        </template>
      </div>

      <div class="abele-template-select__list">
        <!-- Search mode: flat list -->
        <template v-if="searchQuery">
          <div
            v-for="template in searchResults"
            :key="template.file.path"
            class="abele-template-select__item"
            :class="{ 'abele-template-select__item_selected': selectedTemplate === template }"
            @click="selectTemplate(template)"
            @dblclick="confirmSelection"
          >
            <div class="abele-template-select__item-info">
              <span class="abele-template-select__item-name">{{ template.name }}</span>
              <span v-if="template.templateDir" class="abele-template-select__item-path">
                {{ template.templateDir }}
              </span>
            </div>
            <span class="abele-template-select__item-type">{{ template.templateFor }}</span>
          </div>
          <div v-if="searchResults.length === 0" class="abele-template-select__empty">
            No templates found
          </div>
        </template>

        <!-- Browse mode: folders + templates -->
        <template v-else>
          <!-- Folders at current level -->
          <div
            v-for="folder in currentFolders"
            :key="'folder:' + folder"
            class="abele-template-select__item abele-template-select__item_folder"
            @click="openFolder(folder)"
          >
            <div class="abele-template-select__item-info abele-template-select__item-info_folder">
              <Icon icon="folder" class="abele-template-select__folder-icon" />
              <span class="abele-template-select__item-name">{{ folder }}</span>
            </div>
            <span class="abele-template-select__folder-count">{{ getFolderCount(folder) }}</span>
          </div>

          <!-- Templates at current level -->
          <div
            v-for="template in currentTemplates"
            :key="template.file.path"
            class="abele-template-select__item"
            :class="{ 'abele-template-select__item_selected': selectedTemplate === template }"
            @click="selectTemplate(template)"
            @dblclick="confirmSelection"
          >
            <div class="abele-template-select__item-info">
              <span class="abele-template-select__item-name">{{ template.name }}</span>
            </div>
            <span class="abele-template-select__item-type">{{ template.templateFor }}</span>
          </div>

          <div
            v-if="currentFolders.length === 0 && currentTemplates.length === 0"
            class="abele-template-select__empty"
          >
            No templates available
          </div>
        </template>
      </div>

      <div class="abele-template-select__buttons">
        <Button text="Cancel" @click="emit('close')" />
        <Button
          text="Select"
          :disabled="!selectedTemplate"
          :accent="true"
          @click="confirmSelection"
        />
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'
import Modal from './obsidian/Modal.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import { UserTemplate } from '@/templates/UserTemplate'

const props = defineProps<{
  templates: UserTemplate[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', template: UserTemplate): void
}>()

const searchQuery = ref('')
const selectedTemplate = shallowRef<UserTemplate | null>(null)
const currentPath = ref<string[]>([])

// Search results (flat list)
const searchResults = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return props.templates.filter(
    (t) =>
      t.name.toLowerCase().includes(query) ||
      t.templateFor.toLowerCase().includes(query) ||
      t.templateDir?.toLowerCase().includes(query)
  )
})

// Get current path as string for comparison
const currentPathStr = computed(() => currentPath.value.join('/'))

// Templates at current folder level (exact match)
const currentTemplates = computed(() => {
  return props.templates.filter((t) => {
    const dir = t.templateDir ?? ''
    return dir === currentPathStr.value
  })
})

// Subfolders at current level
const currentFolders = computed(() => {
  const folders = new Set<string>()
  const prefix = currentPathStr.value ? currentPathStr.value + '/' : ''

  for (const t of props.templates) {
    const dir = t.templateDir ?? ''
    if (!dir.startsWith(prefix) && prefix !== '') continue
    if (dir === currentPathStr.value) continue

    // Extract next segment after current path
    const rest = prefix ? dir.slice(prefix.length) : dir
    if (!rest) continue

    const nextSegment = rest.split('/')[0]
    if (nextSegment) folders.add(nextSegment)
  }

  return Array.from(folders).sort()
})

// Count templates in a folder (recursive)
function getFolderCount(folder: string): number {
  const prefix = currentPathStr.value ? `${currentPathStr.value}/${folder}` : folder
  return props.templates.filter((t) => {
    const dir = t.templateDir ?? ''
    return dir === prefix || dir.startsWith(prefix + '/')
  }).length
}

function openFolder(folder: string) {
  currentPath.value = [...currentPath.value, folder]
  selectedTemplate.value = null
}

function navigateTo(idx: number) {
  if (idx < 0) {
    currentPath.value = []
  } else {
    currentPath.value = currentPath.value.slice(0, idx + 1)
  }
  selectedTemplate.value = null
}

function selectTemplate(template: UserTemplate) {
  selectedTemplate.value = template
}

function confirmSelection() {
  if (selectedTemplate.value) {
    emit('select', selectedTemplate.value)
  }
}
</script>

<style>
.abele-template-select {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 400px;
}

.abele-template-select__list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-template-select__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-4-2) var(--size-4-3);
  cursor: pointer;
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-template-select__item:last-child {
  border-bottom: none;
}

.abele-template-select__item:hover {
  background: var(--background-modifier-hover);
}

.abele-template-select__item_selected {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.abele-template-select__breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  font-size: var(--font-smaller);
  color: var(--text-muted);
}

.abele-template-select__breadcrumb-item {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-s);
}

.abele-template-select__breadcrumb-item:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.abele-template-select__breadcrumb-separator {
  opacity: 0.5;
}

.abele-template-select__item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.abele-template-select__item-info_folder {
  flex-direction: row;
  align-items: center;
  gap: var(--size-2-2);
}

.abele-template-select__folder-count {
  font-size: var(--font-smaller);
  color: var(--text-muted);
}

.abele-template-select__item-name {
  font-weight: var(--font-medium);
}

.abele-template-select__item-path {
  font-size: var(--font-smaller);
  opacity: 0.7;
}

.abele-template-select__item-type {
  font-size: var(--font-smaller);
  padding: 2px 6px;
  background: var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-template-select__item_selected .abele-template-select__item-type {
  background: var(--text-on-accent);
  color: var(--interactive-accent);
}

.abele-template-select__empty {
  padding: var(--size-4-4);
  text-align: center;
  opacity: 0.7;
}

.abele-template-select__buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
