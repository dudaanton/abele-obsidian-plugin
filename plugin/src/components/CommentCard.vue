<template>
  <Card
    class="abele-comment-card"
    title="Comment"
    :subtitle="entry.notePath"
    :description="entry.ids.join(', ')"
  />
</template>

<script setup lang="ts">
/**
 * Phase 2 places the card and proves it is reachable; phase 4 puts the thread and the input
 * inside it. Until then it says only which comments sit at this marker, which is exactly what
 * the editor extension knows without `CommentService`.
 */
import { CommentEntry } from '@/entities/Comment'
import Card from './obsidian/Card.vue'

defineProps<{
  entry: CommentEntry
}>()
</script>
