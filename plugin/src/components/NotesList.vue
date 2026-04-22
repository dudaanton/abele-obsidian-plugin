<template>
  <div class="abele-notes-list">
    <div class="abele-notes-list__header">
      <div class="abele-notes-list__header-text">Backlinks</div>
      <button class="abele-notes-list__sort-btn clickable-icon" @click="toggleSort">
        {{ sortBy === 'created' ? 'created' : 'updated' }}
      </button>
    </div>
    <div class="abele-notes-list__notes">
      <div v-for="note in sortedNotes" :key="note.filePath" class="abele-notes-list__item">
        <a class="internal-link" @click.prevent="openNote(note)">{{ note.name }}</a>
        <div class="abele-notes-list__meta">
          <span v-if="note.createdAt"
            >created {{ note.createdAt.format(DISPLAY_DATE_FORMAT) }}</span
          >
          <span v-if="note.updatedAt">
            · updated {{ note.updatedAt.format(DISPLAY_DATE_FORMAT) }}</span
          >
        </div>
      </div>
    </div>
    <div v-if="!props.notes.length" class="abele-notes-list__no-notes">No notes to show.</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Note } from '@/entities/Note'
import { openFile } from '@/helpers/vaultUtils'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'

const props = defineProps<{
  notes: Note[]
}>()

type SortBy = 'created' | 'updated'
const sortBy = ref<SortBy>('created')

function toggleSort() {
  sortBy.value = sortBy.value === 'created' ? 'updated' : 'created'
}

const sortedNotes = computed(() => {
  return [...props.notes].sort((a, b) => {
    if (sortBy.value === 'updated') {
      const aDate = a.updatedAt ?? a.createdAt
      const bDate = b.updatedAt ?? b.createdAt
      return (bDate?.unix() ?? 0) - (aDate?.unix() ?? 0)
    }
    return (b.createdAt?.unix() ?? 0) - (a.createdAt?.unix() ?? 0)
  })
})

function openNote(note: Note) {
  openFile(note.filePath)
}
</script>

<style lang="scss">
.abele-notes-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  font-weight: bold;
  margin-bottom: var(--p-spacing);
}

.abele-notes-list__sort-btn {
  font-size: var(--font-smallest);
  color: var(--text-muted);
  font-weight: normal;
  padding: 2px 6px;
  border-radius: var(--radius-s);
}

.abele-notes-list__notes {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  padding-left: 0;
}

.abele-notes-list__meta {
  font-size: var(--font-smallest);
  color: var(--text-faint);
}

.abele-notes-list__no-notes {
  font-style: italic;
  color: var(--text-muted);
}
</style>
