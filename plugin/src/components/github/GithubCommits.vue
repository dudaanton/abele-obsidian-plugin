<template>
  <!-- One row per commit, the same on GitHub and on a node: message, who and when, its short SHA. -->
  <div class="abele-github-commits">
    <RepositoryRow
      v-for="commit in commits"
      :key="commit.sha"
      :title="splitMessage(commit.message).title"
      :status="commit.sha.slice(0, 7)"
      icon="git-commit-horizontal"
      kind="commit"
      @pick="emit('open', commit.sha)"
    >
      <!-- The person is shown as everywhere else in a GitHub tab: by name or login, swapped by a click. -->
      <template #meta>
        <GithubUser v-if="commit.login" :login="commit.login" :avatar="commit.avatar" />
        <template v-else>{{ commit.author }}</template>
        · {{ formatDate(commit.date) }}
      </template>
    </RepositoryRow>
  </div>
</template>

<script setup lang="ts">
import RepositoryRow from '../repository/RepositoryRow.vue'
import GithubUser from './GithubUser.vue'
import type { CommitSummary } from '@/repository/model'
import { formatDate, splitMessage } from '@/github/format'

/** A list of commits — a pull request's, a comparison's — each opening the commit. */
defineProps<{ commits: CommitSummary[] }>()

const emit = defineEmits<{ open: [sha: string] }>()
</script>

<style lang="scss">
.abele-github-commits {
  display: flex;
  flex-direction: column;
}
</style>
