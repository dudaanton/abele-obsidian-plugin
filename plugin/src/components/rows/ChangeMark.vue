<template>
  <span class="abele-change-mark" :class="`abele-change-mark_${kind}`">
    <span class="abele-change-mark__kind">{{ words[kind] }}</span>
    <span v-if="added || removed" class="abele-change-mark__lines" :aria-label="linesLabel">
      <span v-if="added" class="abele-change-mark__added">+{{ added }}</span>
      <span v-if="removed" class="abele-change-mark__removed">−{{ removed }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
// What happened to a file, in words first and colour second. The colours are the ones Obsidian
// Sync's own version history gives changed, new and deleted files.
import { computed } from 'vue'

const props = defineProps<{
  kind: 'modified' | 'added' | 'deleted' | 'renamed'
  added?: number
  removed?: number
}>()
const words = { modified: 'Изменён', added: 'Новый', deleted: 'Удалён', renamed: 'Переименован' }
const linesLabel = computed(
  () => `Строк добавлено: ${props.added ?? 0}, удалено: ${props.removed ?? 0}`
)
</script>

<style>
.abele-change-mark {
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-change-mark_modified .abele-change-mark__kind {
  color: var(--text-accent-hover);
}
.abele-change-mark_added .abele-change-mark__kind {
  color: var(--text-success);
}
.abele-change-mark_deleted .abele-change-mark__kind {
  color: var(--text-error);
}
.abele-change-mark_renamed .abele-change-mark__kind {
  color: var(--text-muted);
}
.abele-change-mark__lines {
  display: inline-flex;
  gap: var(--size-2-2);
}
.abele-change-mark__added {
  color: var(--text-success);
}
.abele-change-mark__removed {
  color: var(--text-error);
}
</style>
