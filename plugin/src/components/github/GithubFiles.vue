<template>
  <div class="abele-github-files">
    <div class="abele-github-files__summary">
      {{ t('streamBCount.changedFiles', { count: files.length }) }}
      <template v-if="!countsPending">
        <span class="abele-github-file__add">+{{ additions }}</span>
        <span class="abele-github-file__del">−{{ deletions }}</span>
      </template>
    </div>
    <div v-if="anchor && !anchored" class="abele-github-files__missing">
      {{ t('streamB.theFileThisLinkPointsAtIs.734bff') }}
    </div>
    <GithubDiffFile
      v-for="file in files"
      :key="file.path"
      :file="file"
      :initially-open="files.length <= OPEN_UP_TO || holdsComment(file)"
      :anchor="file.hash === anchor?.hash ? anchor : undefined"
      :comment-anchor="commentAnchor"
      :refs="refs"
      :analysis-ref="analysisRef"
      @loaded="patchEpoch++"
      @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
    />
    <EmptyState v-if="!files.length" :text="t('streamB.noFilesChanged.68c489')" />
    <div v-if="!complete" class="abele-github-files__missing">
      {{ t('streamBMeta.060854f39b', { p0: String(files.length) }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubDiffFile from './GithubDiffFile.vue'
import type { DiffFile } from '@/repository/model'
import type { DiffFileAnchor } from '@/github/urls'
import type { PaneType } from 'obsidian'

/** A short change opens whole; a long one lists its files and draws each diff on demand. */
const OPEN_UP_TO = 5

const props = withDefaults(
  defineProps<{
    files: DiffFile[]
    anchor?: DiffFileAnchor
    /** A review comment the link pointed at: its file opens, and the comment is marked. */
    commentAnchor?: string
    complete?: boolean
    /** The commits the change is between, for opening a file whole. */
    refs?: { head?: string; base?: string }
    analysisRef?: string
  }>(),
  {
    anchor: undefined,
    commentAnchor: undefined,
    complete: true,
    refs: undefined,
    analysisRef: undefined,
  }
)

const emit = defineEmits<{
  open: [url: string, pane: PaneType | false]
}>()

const holdsComment = (file: DiffFile) =>
  !!props.commentAnchor && file.reviewComments.some((c) => c.anchor === props.commentAnchor)

const patchEpoch = ref(0)
/** A total over files whose counts are not all known yet would understate the change. */
const countsPending = computed(() => {
  void patchEpoch.value
  return props.files.some((f) => f.countsPending)
})
const additions = computed(() => {
  void patchEpoch.value
  return props.files.reduce((n, f) => n + f.additions, 0)
})
const deletions = computed(() => {
  void patchEpoch.value
  return props.files.reduce((n, f) => n + f.deletions, 0)
})
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
