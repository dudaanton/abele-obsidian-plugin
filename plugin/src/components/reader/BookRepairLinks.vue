<template>
  <ObsidianModal
    :title="
      items.length === 1 ? 'Repair highlight link?' : `Repair ${items.length} highlight links?`
    "
    size="tall"
    close-in-footer
    @close="emit('close')"
  >
    <p>
      These quoted words were found away from their saved links. Only the links will change, not the
      quotes or comments.
    </p>
    <p>
      Only mismatches found in chapters opened during this reading session are listed. Repeated
      words use the occurrence nearest the saved location when that location is available.
    </p>
    <div v-for="item in items" :key="item.cfi">
      <strong>{{ item.label || 'Untitled chapter' }}</strong>
      <p>“{{ item.text }}”</p>
      <p>{{ context(item) }}</p>
      <p v-if="!item.anchored">Saved location unavailable; this is a found occurrence.</p>
    </div>
    <template #footer>
      <Button text="Cancel" tooltip="Leave every link as it is" @click="emit('close')" />
      <Button
        :text="items.length === 1 ? 'Repair link' : `Repair ${items.length} links`"
        tooltip="Move these links to the words found"
        accent
        @click="repair"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import type { HighlightRepairCandidate } from '@/reader/highlightRepair'

/**
 * The highlights whose links would move, each with its chapter, its words and the text around
 * where they were found. Only the button repairs; every other way out leaves the links alone.
 */
defineProps<{ items: HighlightRepairCandidate[] }>()

const emit = defineEmits<{
  (e: 'answer', value: true): void
  (e: 'close'): void
}>()

const context = ({ context: { pre, match, post } }: HighlightRepairCandidate) =>
  `${pre.slice(-70)}${match}${post.slice(0, 70)}`

function repair(): void {
  emit('answer', true)
  emit('close')
}
</script>
