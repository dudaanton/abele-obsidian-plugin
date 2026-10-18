<template>
  <div class="abele-github-thread">
    <GithubComment :comment="opening" :target="anchor" body />
    <GithubComment v-for="c in comments" :key="c.id" :comment="c" :target="anchor" />
    <GithubNotice v-if="problem" :text="problem" :busy="retrying" @retry="emit('retry')" />
    <div v-else-if="!comments.length" class="abele-github-thread__note">
      {{ t('streamB.noCommentsYet.b7cba9') }}
    </div>
    <div v-if="missing > 0" class="abele-github-thread__note">
      {{ t('streamBCount.missingComments', { count: missing }) }}
    </div>
    <div v-else-if="incomplete && !problem" class="abele-github-thread__note">
      {{ t('streamBMeta.7be439b701', { p0: String(comments.length) }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed } from 'vue'
import GithubComment from './GithubComment.vue'
import GithubNotice from './GithubNotice.vue'
import type { Comment } from '@/github/api'

const props = withDefaults(
  defineProps<{
    author: string
    avatar?: string
    createdAt: string
    body: string
    comments: Comment[]
    anchor?: string
    /** Comments that exist but were not fetched. */
    missing?: number
    /** Some comments were not fetched, and how many is not known. */
    incomplete?: boolean
    /** Why some or all of the comments could not be read. */
    problem?: string
    /** They are being asked for again. */
    retrying?: boolean
  }>(),
  { anchor: undefined, avatar: undefined, missing: 0, problem: undefined }
)

const emit = defineEmits<{
  (e: 'retry'): void
}>()

const opening = computed<Comment>(() => ({
  id: 'opening',
  author: props.author,
  avatar: props.avatar,
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
