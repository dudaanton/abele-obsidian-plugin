<template>
  <div class="abele-github-compare">
    <GithubNotice v-if="data.note" :text="data.note" :retry="false" />
    <EmptyState
      v-if="data.status === 'identical'"
      text="These two are the same: there is nothing to compare."
    />
    <template v-else>
      <Tabs
        :model-value="tab"
        :tabs="tabs"
        level="secondary"
        class="abele-github__tabs"
        @update:model-value="(id: string) => emit('tab', id as CompareSection)"
      />
      <template v-if="tab === 'files'">
        <GithubFiles
          v-if="data.files.length || data.filesComplete"
          :files="data.files"
          :complete="data.filesComplete"
          :anchor="anchor"
          :refs="{ head: data.headSha, base: data.mergeBaseSha }"
          @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
        />
      </template>
      <template v-else>
        <EmptyState
          v-if="!data.commits.length"
          :text="`${data.head} has no commits that ${data.base} has not.`"
        />
        <GithubCommits v-else :commits="data.commits" @open="openCommit" />
        <div v-if="!data.commitsComplete" class="abele-github-compare__more">
          {{ data.commits.length }} of {{ data.totalCommits }} commits are listed here; the rest are
          on GitHub.
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PaneType } from 'obsidian'
import EmptyState from '../obsidian/EmptyState.vue'
import Tabs from '../obsidian/Tabs.vue'
import GithubFiles from './GithubFiles.vue'
import GithubCommits from './GithubCommits.vue'
import GithubNotice from './GithubNotice.vue'
import type { CompareData } from '@/github/compare'
import type { DiffFileAnchor } from '@/github/urls'
import { repoWeb } from '@/github/origin'

export type CompareSection = 'files' | 'commits'

/** A comparison's body under its header: what it could not show, then its files or commits. */
const props = defineProps<{
  data: CompareData
  repo: { host: string; owner: string; repo: string }
  tab: CompareSection
  anchor?: DiffFileAnchor
}>()

const emit = defineEmits<{
  tab: [tab: CompareSection]
  open: [url: string, pane: PaneType | false]
}>()

const tabs = computed(() => [
  {
    id: 'files',
    label: `Files (${props.data.files.length}${props.data.filesComplete ? '' : '+'})`,
    icon: 'file-diff',
  },
  {
    id: 'commits',
    label: `Commits (${props.data.totalCommits})`,
    icon: 'git-commit-horizontal',
  },
])

const openCommit = (sha: string) => emit('open', `${repoWeb(props.repo)}/commit/${sha}`, false)
</script>

<style lang="scss">
.abele-github-compare {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  &__more {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
</style>
