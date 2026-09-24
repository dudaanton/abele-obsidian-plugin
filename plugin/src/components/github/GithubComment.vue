<template>
  <article
    class="abele-github-comment"
    :class="{
      'abele-github-comment_target': !!comment.anchor && comment.anchor === target,
      'abele-github-comment_reply': reply,
    }"
    :data-anchor="comment.anchor"
  >
    <div class="abele-github-comment__head">
      <span class="abele-github-comment__author">{{ comment.author }}</span>
      <span class="abele-github-comment__date">{{ formatDate(comment.createdAt) }}</span>
      <span v-if="comment.location" class="abele-github-comment__location">{{
        comment.location
      }}</span>
      <Badge v-if="comment.badge" :text="comment.badge" :accent="comment.badge === 'Answer'" />
      <GithubLinkActions
        v-if="linker && link"
        :linker="linker"
        :link="link"
        :what="what"
        :quote="quote"
      />
    </div>
    <Markdown
      v-if="comment.body"
      class="abele-github-comment__body"
      :text="comment.body"
      as-document
    />
    <div v-else class="abele-github-comment__empty">No text.</div>

    <div v-if="comment.replies?.length" class="abele-github-comment__replies">
      <GithubComment v-for="r in comment.replies" :key="r.id" :comment="r" :target="target" reply />
      <div v-if="comment.moreReplies" class="abele-github-comment__more">
        {{ comment.moreReplies }} more {{ comment.moreReplies === 1 ? 'reply' : 'replies' }} on
        GitHub.
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import Badge from '../obsidian/Badge.vue'
import Markdown from '../obsidian/Markdown.vue'
import GithubLinkActions from './GithubLinkActions.vue'
import type { Comment } from '@/github/api'
import { formatDate } from '@/github/format'
import { LINKER } from '@/github/linking'
import { bodyLink, commentLink, type GithubLink } from '@/github/permalinks'
import { commentSnippet, type SnippetBlock } from '@/github/snippetBlock'

const props = withDefaults(
  defineProps<{
    comment: Comment
    /** The anchor the link pointed at; that comment is marked. */
    target?: string
    reply?: boolean
    /** The item's own description, whose link is the item's. */
    body?: boolean
  }>(),
  { target: undefined }
)

const linker = inject(LINKER, null)

/** A link to this comment, or to the item for its description; null when there is none to make. */
const link = computed((): (() => GithubLink) | null => {
  const item = linker?.item()
  if (!linker || !item) return null
  if (props.body) return () => bodyLink(item, linker.title())
  const anchor = props.comment.anchor
  if (!anchor) return null
  return () => commentLink(item, { anchor, author: props.comment.author }, props.reply)
})

/** The comment quoted whole, with who wrote it and when. */
const quote = computed((): (() => SnippetBlock) | undefined => {
  const make = link.value
  if (!make) return undefined
  return () => commentSnippet(make(), props.comment)
})

const what = computed(() => {
  const anchor = props.comment.anchor ?? ''
  if (props.body) {
    const kind = linker?.item()?.kind
    return kind === 'pull' ? 'pull request' : (kind ?? 'item')
  }
  if (anchor.startsWith('pullrequestreview-')) return 'review'
  if (anchor.startsWith('discussion_r')) return 'review comment'
  return props.reply ? 'reply' : 'comment'
})
</script>

<style lang="scss">
.abele-github-comment {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  padding: var(--size-4-2) var(--size-4-3);
  background: var(--background-primary);

  &_target {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  &_reply {
    border: none;
    border-left: var(--size-2-1) solid var(--background-modifier-border);
    border-radius: 0;
    padding: var(--size-4-1) 0 var(--size-4-1) var(--size-4-3);
  }

  &_reply#{&}_target {
    border-left-color: var(--interactive-accent);
    box-shadow: none;
  }

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-1) var(--size-4-2);
    font-size: var(--font-ui-small);
  }

  &__author {
    font-weight: var(--font-semibold);
  }

  &__date,
  &__location {
    color: var(--text-muted);
  }

  &__body {
    overflow-wrap: anywhere;

    // Reading-view spacing is for a page; inside a card the first and last block sit flush.
    > :first-child,
    > :first-child > :first-child {
      margin-top: var(--size-4-1);
    }

    > :last-child,
    > :last-child > :last-child {
      margin-bottom: 0;
    }
  }

  &__empty,
  &__more {
    color: var(--text-faint);
    font-size: var(--font-ui-small);
    margin-top: var(--size-4-1);
  }

  &__replies {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
    margin-top: var(--size-4-2);
  }
}
</style>
