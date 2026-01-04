<template>
  <div class="abele-notes-list">
    <div class="abele-notes-list__header">
      <div class="abele-notes-list__header-text">Backlinks</div>
    </div>
    <div class="abele-notes-list__notes">
      <ObsidianMarkdown :text="notesLinks" />
    </div>
    <div v-if="!notesLinks.length" class="abele-timeline__no-tasks">No notes to show.</div>
  </div>
</template>

<script setup lang="ts">
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { computed } from 'vue'
import { Note } from '@/entities/Note'

const props = defineProps<{
  notes: Note[]
}>()

const notesLinks = computed(() => {
  return props.notes.map((note) => `[[${note.filePath}|${note.name}]]`).join('\n\n')
})
</script>

<style lang="scss">
.abele-notes-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  font-weight: bold;
  margin-bottom: var(--p-spacing);
}

.abele-notes-list__notes {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  padding-left: calc(var(--icon-size) / 4);

  br {
    display: none;
  }
}

.abele-notes-list__no-notes {
  font-style: italic;
  color: var(--text-muted);
}
</style>
