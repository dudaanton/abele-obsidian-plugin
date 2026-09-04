<template>
  <div ref="rootEl" class="abele-sp-picker">
    <Input v-model="search" placeholder="Search..." />

    <div class="abele-sp-picker__list">
      <template v-if="kind === 'skills'">
        <div
          v-for="skill in filteredSkills"
          :key="skill.path"
          class="abele-sp-picker__item"
          @click="selectSkill(skill)"
        >
          <span class="abele-sp-picker__item-name">/{{ skill.name }}</span>
          <span v-if="skill.description" class="abele-sp-picker__item-desc">{{
            skill.description
          }}</span>
        </div>
        <div v-if="filteredSkills.length === 0" class="abele-sp-picker__empty">No skills found</div>
      </template>
      <template v-else>
        <div
          v-for="prompt in filteredPrompts"
          :key="prompt.path"
          class="abele-sp-picker__item"
          @click="selectPrompt(prompt)"
        >
          <span class="abele-sp-picker__item-name">{{ prompt.name }}</span>
          <span v-if="prompt.description" class="abele-sp-picker__item-desc">{{
            prompt.description
          }}</span>
        </div>
        <div v-if="filteredPrompts.length === 0" class="abele-sp-picker__empty">
          No prompts found
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { TFile } from 'obsidian'
import Input from './obsidian/Input.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { discoverSkills, type SkillInfo } from '@/ai/tools/SkillTool'

interface PromptItem {
  path: string
  name: string
  description: string
}

defineProps<{
  /**
   * Which of the two lists this is. It used to be a strip of two buttons inside the picker;
   * the dialog above it has a strip of its own now, and one screen with two of them is one
   * strip too many.
   */
  kind: 'skills' | 'prompts'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'skill', name: string): void
  (e: 'prompt', file: TFile): void
}>()

const { app } = GlobalStore.getInstance()

const search = ref('')

/**
 * Inside this picker rather than through the global `document`: opened from the settings
 * window, the global lookup finds a field on the main one. Cleared on the way out, or a
 * picker dismissed within the hundred milliseconds reaches for a document that has gone.
 */
const rootEl = useTemplateRef<HTMLElement>('rootEl')
let focusTimer = 0

onMounted(() => {
  focusTimer = window.setTimeout(() => {
    rootEl.value?.querySelector<HTMLInputElement>('input')?.focus()
  }, 100)
})

onBeforeUnmount(() => window.clearTimeout(focusTimer))

const skills = computed(() => discoverSkills())

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

const filteredSkills = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return skills.value
  return skills.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  )
})

const filteredPrompts = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return prompts.value
  return prompts.value.filter(
    (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  )
})

const selectSkill = (skill: SkillInfo) => {
  emit('skill', skill.name)
  emit('close')
}

const selectPrompt = (prompt: PromptItem) => {
  const file = app.vault.getAbstractFileByPath(prompt.path)
  if (file instanceof TFile) {
    emit('prompt', file)
    emit('close')
  }
}
</script>

<style lang="scss">
.abele-sp-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-sp-picker__list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-sp-picker__item {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  padding: var(--size-4-2) var(--size-4-3);
  cursor: pointer;
  border-bottom: 1px solid var(--background-modifier-border);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--background-modifier-hover);
  }
}

.abele-sp-picker__item-name {
  font-weight: var(--font-medium);
}

.abele-sp-picker__item-desc {
  font-size: var(--font-smaller);
  color: var(--text-muted);
}

.abele-sp-picker__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}
</style>
