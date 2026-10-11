<template>
  <Modal title="Select Template" @close="emit('close')">
    <div class="abele-template-select">
      <Input v-model="searchQuery" placeholder="Search templates..." />

      <!-- Breadcrumbs -->
      <div v-if="currentPath.length > 0 && !searchQuery" class="abele-template-select__breadcrumbs">
        <span
          class="abele-template-select__breadcrumb-item"
          role="button"
          tabindex="0"
          @click="navigateTo(-1)"
          @keydown.enter="navigateTo(-1)"
          >All</span
        >
        <template v-for="(segment, idx) in currentPath" :key="idx">
          <span class="abele-template-select__breadcrumb-separator">/</span>
          <span
            class="abele-template-select__breadcrumb-item"
            role="button"
            tabindex="0"
            @click="navigateTo(idx)"
            @keydown.enter="navigateTo(idx)"
            >{{
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
            role="option"
            tabindex="0"
            :aria-selected="selectedTemplate === template"
            @click="selectTemplate(template)"
            @dblclick="confirmSelection"
            @keydown.enter="selectedTemplate === template ? confirmSelection() : selectTemplate(template)"
          >
            <div class="abele-template-select__item-info">
              <span class="abele-template-select__item-name">{{ template.name }}</span>
              <span v-if="template.templateDir" class="abele-template-select__item-path">
                {{ template.templateDir }}
              </span>
            </div>
            <span class="abele-template-select__item-type">{{ template.templateFor }}</span>
          </div>
          <EmptyState
            v-if="searchResults.length === 0"
            variant="no-matches"
            text="No templates found"
          />
        </template>

        <!-- Browse mode: folders + templates -->
        <template v-else>
          <!-- Folders at current level -->
          <div
            v-for="folder in currentFolders"
            :key="'folder:' + folder"
            class="abele-template-select__item abele-template-select__item_folder"
            role="button"
            tabindex="0"
            @click="openFolder(folder)"
            @keydown.enter="openFolder(folder)"
          >
            <div class="abele-template-select__item-info abele-template-select__item-info_row">
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
            role="option"
            tabindex="0"
            :aria-selected="selectedTemplate === template"
            @click="selectTemplate(template)"
            @dblclick="confirmSelection"
            @keydown.enter="selectedTemplate === template ? confirmSelection() : selectTemplate(template)"
          >
            <div class="abele-template-select__item-info abele-template-select__item-info_row">
              <Icon icon="file-text" no-hover class="abele-template-select__folder-icon" />
              <span class="abele-template-select__item-name">{{ template.name }}</span>
            </div>
            <span class="abele-template-select__item-type">{{ template.templateFor }}</span>
          </div>

          <EmptyState
            v-if="currentFolders.length === 0 && currentTemplates.length === 0"
            text="No templates available"
          />
        </template>
      </div>
    </div>
    <template #footer>
      <Button
        text="Select"
        :disabled="!selectedTemplate"
        :accent="true"
        @click="confirmSelection"
      />
      <Button text="Cancel" @click="emit('close')" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'
import Modal from './obsidian/Modal.vue'
import Input from './obsidian/Input.vue'
import EmptyState from './obsidian/EmptyState.vue'
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
/* Obsidian's own picker in a window: a field, where you are, and rows as its suggestion list
   draws them, the chosen one tinted rather than filled, what a template is for faint on the right. */
.abele-template-select {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: min(28em, 100%);
}

.abele-template-select__list {
  display: flex;
  flex-direction: column;
  max-height: min(24em, 60vh);
  overflow-y: auto;
}

.abele-template-select__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border-radius: var(--radius-s);
  cursor: var(--cursor);
}

.abele-template-select__item:hover,
.abele-template-select__item_selected {
  background: var(--background-modifier-hover);
}

.abele-template-select__item_selected .abele-template-select__item-name {
  color: var(--text-normal);
  font-weight: var(--font-medium);
}

.abele-template-select__breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}

.abele-template-select__breadcrumb-item {
  padding: var(--size-2-1) var(--size-2-2);
  border-radius: var(--radius-s);
  cursor: var(--cursor);
}

.abele-template-select__breadcrumb-item:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.abele-template-select__breadcrumb-separator {
  color: var(--text-faint);
}

.abele-template-select__item-info {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}

.abele-template-select__item-info_row {
  flex-direction: row;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-template-select__folder-icon {
  color: var(--text-faint);
}

.abele-template-select__item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-template-select__item-path,
.abele-template-select__folder-count,
.abele-template-select__item-type {
  flex: 0 0 auto;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}
</style>
