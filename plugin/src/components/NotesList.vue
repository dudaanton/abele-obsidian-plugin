<template>
  <div class="abele-notes-list">
    <div class="abele-notes-list__header">
      <div class="abele-notes-list__header-text">Backlinks</div>
      <button class="abele-notes-list__sort-btn clickable-icon" @click="toggleSort">
        {{ sortBy === 'created' ? 'created' : 'updated' }}
      </button>
    </div>
    <div class="abele-notes-list__notes">
      <Card
        v-for="note in visible"
        :key="note.filePath"
        class="abele-notes-list__item"
        :title="note.name"
        :description="note.description ?? undefined"
        :thumbnail="thumbnailOf(note)"
        :meta="metaOf(note)"
        clamp-description
        clickable
        @click="openNote(note)"
      />
      <div v-if="hasMore" ref="sentinel" class="abele-notes-list__sentinel" />
    </div>
    <div v-if="!props.notes.length" class="abele-notes-list__no-notes">No notes to show.</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Note } from '@/entities/Note'
import { openFile } from '@/helpers/vaultUtils'
import { compactDate } from '@/helpers/datesHelper'
import { resourceUrl } from '@/helpers/resourceUrl'
import Card from './obsidian/Card.vue'
import { usePagedList } from '@/composables/usePagedList'

/**
 * Larger than the other footer lists: a row here is a card of plain text — a title, a
 * clamped description, two dates and at most one lazily loaded picture — with no markdown
 * rendering, so it costs a fraction of a log or a task.
 */
const PAGE_SIZE = 50

const props = defineProps<{
  notes: Note[]
}>()

type SortBy = 'created' | 'updated'
const sortBy = ref<SortBy>('created')

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

const { visible, hasMore, sentinel, reset } = usePagedList(() => sortedNotes.value, PAGE_SIZE)

function toggleSort() {
  sortBy.value = sortBy.value === 'created' ? 'updated' : 'created'
  // A different sort is a different list; keeping the expanded window would strand the
  // reader in the middle of an order they never scrolled through.
  reset()
}

/**
 * The cover as a URL the card can load, looked up only for the cards on screen and resolved
 * from the note itself, the way its own link would be. One that names nothing in the vault
 * gets no picture rather than a broken one.
 */
function thumbnailOf(note: Note): string | undefined {
  return note.cover ? resourceUrl(note.cover, note.filePath) : undefined
}

/**
 * The created date, and the updated one when it is a different day — the day a note was
 * written is what orders the list, and an edit the same day says nothing new.
 */
function metaOf(note: Note): string[] {
  const meta: string[] = []
  if (note.createdAt) meta.push(compactDate(note.createdAt))
  if (note.updatedAt && !note.updatedAt.isSame(note.createdAt, 'day')) {
    meta.push(`updated ${compactDate(note.updatedAt)}`)
  }
  return meta
}

function openNote(note: Note) {
  void openFile(note.filePath)
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

.abele-notes-list__sentinel {
  height: 1px;
}

/**
 * Flush with the note, like the chat cards: a card has a border of its own. Half the chats'
 * gap, because a backlink list runs long and every row of it is a card.
 */
.abele-notes-list__notes {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
}

/** Tighter than the kit's card: this list is scanned rather than read, and runs long. */
.abele-notes-list__item.abele-card {
  padding-block: var(--size-4-2);
}

.abele-notes-list__no-notes {
  font-style: italic;
  color: var(--text-muted);
}
</style>
