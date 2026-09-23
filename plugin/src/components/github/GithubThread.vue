<template>
  <div class="abele-github-thread">
    <GithubComment :comment="opening" :target="anchor" />
    <GithubComment v-for="c in comments" :key="c.id" :comment="c" :target="anchor" />
    <div v-if="!comments.length" class="abele-github-thread__note">No comments yet.</div>
    <div v-if="missing > 0" class="abele-github-thread__note">
      {{ missing }} more {{ missing === 1 ? 'comment is' : 'comments are' }} on GitHub.
    </div>
    <div v-else-if="incomplete" class="abele-github-thread__note">
      Only the first {{ comments.length }} comments are shown; the rest are on GitHub.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import GithubComment from './GithubComment.vue'
import type { Comment } from '@/github/api'

const props = withDefaults(
  defineProps<{
    author: string
    createdAt: string
    body: string
    comments: Comment[]
    anchor?: string
    /** Comments that exist but were not fetched. */
    missing?: number
    /** Some comments were not fetched, and how many is not known. */
    incomplete?: boolean
  }>(),
  { anchor: undefined, missing: 0 }
)

const opening = computed<Comment>(() => ({
  id: 'opening',
  author: props.author,
  createdAt: props.createdAt,
  body: props.body,
}))
</script>

<style lang="scss">
.abele-github-thread {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  &__note {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
</style>
