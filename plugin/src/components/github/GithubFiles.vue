<template>
  <div class="abele-github-files">
    <div class="abele-github-files__summary">
      {{ files.length }} {{ files.length === 1 ? 'file' : 'files' }} changed
      <span class="abele-github-file__add">+{{ additions }}</span>
      <span class="abele-github-file__del">−{{ deletions }}</span>
    </div>
    <div v-if="anchor && !anchored" class="abele-github-files__missing">
      The file this link points at is not among the changed files.
    </div>
    <GithubDiffFile
      v-for="file in files"
      :key="file.path"
      :file="file"
      :initially-open="files.length <= OPEN_UP_TO || holdsComment(file)"
      :anchor="file.hash === anchor?.hash ? anchor : undefined"
      :comment-anchor="commentAnchor"
    />
    <EmptyState v-if="!files.length" text="No files changed." />
    <div v-if="!complete" class="abele-github-files__missing">
      GitHub lists only the first {{ files.length }} files here; the rest are on GitHub.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubDiffFile from './GithubDiffFile.vue'
import type { DiffFile } from '@/github/api'
import type { DiffFileAnchor } from '@/github/urls'

/** A short change opens whole; a long one lists its files and draws each diff on demand. */
const OPEN_UP_TO = 5

const props = withDefaults(
  defineProps<{
    files: DiffFile[]
    anchor?: DiffFileAnchor
    /** A review comment the link pointed at: its file opens, and the comment is marked. */
    commentAnchor?: string
    complete?: boolean
  }>(),
  { anchor: undefined, commentAnchor: undefined, complete: true }
)

const holdsComment = (file: DiffFile) =>
  !!props.commentAnchor && file.reviewComments.some((c) => c.anchor === props.commentAnchor)

const additions = computed(() => props.files.reduce((n, f) => n + f.additions, 0))
const deletions = computed(() => props.files.reduce((n, f) => n + f.deletions, 0))
const anchored = computed(() => props.files.some((f) => f.hash === props.anchor?.hash))
</script>

<style lang="scss">
.abele-github-files {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);

  &__summary {
    display: flex;
    gap: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__missing {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
</style>
