<template>
  <div class="abele-github-commits">
    <Card
      v-for="c in commits"
      :key="c.sha"
      :title="splitMessage(c.message).title"
      icon="git-commit-horizontal"
      clickable
      @click="emit('open', c.sha)"
    >
      <template #subtitle>
        {{ c.sha.slice(0, 7) }} ·
        <GithubUser v-if="c.login" :login="c.login" :avatar="c.avatar" />
        <template v-else>{{ c.author }}</template>
        · {{ formatDate(c.date) }}
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import Card from '../obsidian/Card.vue'
import GithubUser from './GithubUser.vue'
import type { CommitSummary } from '@/github/api'
import { formatDate, splitMessage } from '@/github/format'

/** A list of commits — a pull request's, a comparison's — each opening the commit. */
defineProps<{ commits: CommitSummary[] }>()

const emit = defineEmits<{ open: [sha: string] }>()
</script>

<style lang="scss">
.abele-github-commits {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
</style>
