<template>
  <Modal title="Select Prompt" @close="emit('close')">
    <div class="abele-prompt-picker">
      <Input v-model="search" placeholder="Search prompts..." />

      <div class="abele-prompt-picker__list">
        <div
          v-for="prompt in filtered"
          :key="prompt.path"
          class="abele-prompt-picker__item"
          :class="{ 'abele-prompt-picker__item_selected': selected?.path === prompt.path }"
          @click="selected = prompt"
          @dblclick="confirm"
        >
          <span class="abele-prompt-picker__item-name">{{ prompt.name }}</span>
          <span v-if="prompt.description" class="abele-prompt-picker__item-desc">{{
            prompt.description
          }}</span>
        </div>
        <div v-if="filtered.length === 0" class="abele-prompt-picker__empty">No prompts found</div>
      </div>

      <div class="abele-prompt-picker__buttons">
        <Button text="Cancel" @click="emit('close')" />
        <Button text="Apply" :disabled="!selected" @click="confirm" />
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { TFile } from 'obsidian'
import Modal from './obsidian/Modal.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import { GlobalStore } from '@/stores/GlobalStore'

interface PromptItem {
  path: string
  name: string
  description: string
}

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', file: TFile): void
}>()

const { app } = GlobalStore.getInstance()
const search = ref('')
const selected = ref<PromptItem | null>(null)

const prompts = computed(() => {
  const results: PromptItem[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file)
    if (cache?.frontmatter?.type === 'abele-prompt') {
      results.push({
        path: file.path,
        name: file.basename,
        description: cache.frontmatter.description || '',
      })
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name))
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return prompts.value
  return prompts.value.filter(
    (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  )
})

const confirm = () => {
  if (!selected.value) return
  const file = app.vault.getAbstractFileByPath(selected.value.path)
  if (file instanceof TFile) {
    emit('select', file)
  }
}
</script>

<style lang="scss">
.abele-prompt-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  max-width: 100%;
}

.abele-prompt-picker__list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-prompt-picker__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--size-4-2) var(--size-4-3);
  cursor: pointer;
  border-bottom: 1px solid var(--background-modifier-border);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--background-modifier-hover);
  }

  &_selected {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
}

.abele-prompt-picker__item-name {
  font-weight: var(--font-medium);
}

.abele-prompt-picker__item-desc {
  font-size: var(--font-smaller);
  opacity: 0.7;
}

.abele-prompt-picker__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}

.abele-prompt-picker__buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
