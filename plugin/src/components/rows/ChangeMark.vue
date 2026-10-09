<template>
  <span class="abele-change" :class="`mod-${kind}`">
    <span class="abele-change__kind">{{ words[kind] }}</span>
    <span v-if="added || removed" class="abele-change__lines" :aria-label="linesLabel">
      <span v-if="added" class="abele-change__added">+{{ added }}</span>
      <span v-if="removed" class="abele-change__removed">−{{ removed }}</span>
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
.abele-change {
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-change.mod-modified .abele-change__kind {
  color: var(--text-accent-hover);
}
.abele-change.mod-added .abele-change__kind {
  color: var(--text-success);
}
.abele-change.mod-deleted .abele-change__kind {
  color: var(--text-error);
}
.abele-change.mod-renamed .abele-change__kind {
  color: var(--text-muted);
}
.abele-change__lines {
  display: inline-flex;
  gap: var(--size-2-2);
}
.abele-change__added {
  color: var(--text-success);
}
.abele-change__removed {
  color: var(--text-error);
}
</style>
