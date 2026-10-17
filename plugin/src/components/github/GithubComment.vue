<template>
  <article
    ref="el"
    class="abele-github-comment"
    :class="{
      'abele-github-comment_target': !!comment.anchor && comment.anchor === target,
      'abele-github-comment_reply': reply,
      'abele-github-comment_event': !comment.body && !!comment.badge,
    }"
    :data-anchor="comment.anchor"
  >
    <div class="abele-github-comment__head">
      <GithubUser
        class="abele-github-comment__author"
        :login="comment.author"
        :avatar="comment.avatar"
      />
      <span class="abele-github-comment__date">{{ formatDate(comment.createdAt) }}</span>
      <span class="abele-github-comment__date abele-github-comment__date_short">{{
        shortDate(comment.createdAt)
      }}</span>
      <span v-if="comment.location" class="abele-github-comment__location">{{
        comment.location
      }}</span>
      <Badge v-if="comment.badge === 'Answer'" text="Answer" accent />
      <span v-else-if="comment.badge" class="abele-github-comment__state">
        <StatusDot :tone="reviewTone(comment.badge)" :label="comment.badge" />
        <span class="abele-github-comment__state-word">{{ comment.badge }}</span>
      </span>
      <GithubLinkActions
        v-if="linker && link"
        :linker="linker"
        :link="link"
        :what="what"
        :quote="quote"
      />
    </div>
    <GithubText
      v-if="comment.body"
      class="abele-github-comment__body"
      :text="comment.body"
      :repo="repo"
      as-document
    />
    <EmptyState v-else-if="!comment.badge" text="No text." />

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
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import Badge from '../obsidian/Badge.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import GithubText from './GithubText.vue'
import GithubLinkActions from './GithubLinkActions.vue'
import GithubUser from './GithubUser.vue'
import type { Comment } from '@/github/api'
import { formatDate, shortDate } from '@/github/format'
import { LINKER } from '@/github/linking'
import { GITHUB_REPO, NO_REPO } from '@/github/repoContext'
import { bodyLink, commentLink, type GithubLink } from '@/github/permalinks'
import { isNativeForge } from '@/forge/native'
import { commentSnippet, type SnippetBlock } from '@/github/snippetBlock'
import { registerProse, unregisterProse } from '@/github/proseSelection'
import { GITHUB_PEOPLE, personLabel } from '@/github/users'

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

/** A review's state as a colour: approved green, changes asked red, the rest quiet. */
function reviewTone(state: string): 'green' | 'red' | 'faint' {
  if (state === 'Approved') return 'green'
  if (state === 'Changes requested') return 'red'
  return 'faint'
}

const linker = inject(LINKER, null)
const people = inject(GITHUB_PEOPLE, null)
const repoRef = inject(GITHUB_REPO, null)
const repo = computed(() => repoRef?.value ?? NO_REPO)

/** A link to this comment, or to the item for its description; null when there is none to make. */
const link = computed((): (() => GithubLink) | null => {
  const item = linker?.item()
  if (!linker || !item) return null
  if (props.body) return () => bodyLink(item, linker.title())
  if (isNativeForge(item.provider) && props.comment.url)
    return () => ({
      label: `${linker.title()} · comment by ${props.comment.author}`,
      url: props.comment.url,
    })
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

// Words selected in it are asked about, linked and quoted as this comment's: see `proseSelection`.
const el = ref<HTMLElement>()
onMounted(() => {
  if (!el.value) return
  const own = el.value
  registerProse(own, {
    link: () => link.value?.() ?? null,
    get what() {
      return what.value
    },
    get author() {
      return props.comment.author
    },
    get by() {
      const host = people?.()?.endpoints.webHost
      return host ? personLabel(host, props.comment.author) : props.comment.author
    },
    get createdAt() {
      return props.comment.createdAt
    },
    get anchor() {
      return props.body ? undefined : props.comment.anchor
    },
    body: () => own.querySelector(':scope > .abele-github-comment__body'),
  })
})
onBeforeUnmount(() => {
  if (el.value) unregisterProse(el.value)
})
</script>

<style lang="scss">
// A review with no words — an approval — is one quiet line in the thread, not an empty card.
.abele-github-comment.abele-github-comment_event {
  border-color: transparent;
  background: none;
  padding-block: var(--size-2-2);
}

// An approval's actions stay at the end of its line, clear of the state word.
.abele-github-comment_event .abele-github-comment__head > .abele-github-link-actions {
  position: static;
  flex: none;
  margin-inline-start: auto;
  transform: none;
}

@container (max-width: 26em) {
  .abele-github-comment_event .abele-github-comment__state-word {
    display: none;
  }
}

// A comment's link, quote and ask wait under the pointer, as Obsidian's own row actions do;
// a phone has no pointer, so there they stay.
.abele-github-comment__head .abele-github-link-actions {
  opacity: 0;
  pointer-events: none;
}

.abele-github-comment__date_short,
.is-phone .abele-github-comment__date:not(.abele-github-comment__date_short) {
  display: none;
}

.abele-github-comment__state {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
}

// The review's state is its dot there; the word is in the dot's tooltip.
.is-phone .abele-github-comment__state-word {
  display: none;
}

// A narrow column takes the short date, as a phone does.
.abele-github-comment {
  container-type: inline-size;
}

@container (max-width: 26em) {
  .abele-github-comment__date:not(.abele-github-comment__date_short) {
    display: none;
  }

  .abele-github-comment__head .abele-github-comment__date_short {
    display: inline;
  }
}

// A phone keeps the head on one line: a short date, and the actions at its end.
.is-phone .abele-github-comment__head {
  .abele-github-comment__date_short {
    display: inline;
  }

  .abele-github-link-actions {
    position: static;
    flex: none;
    margin-inline-start: auto;
    transform: none;
  }
}

.abele-github-comment__head:hover .abele-github-link-actions,
.abele-github-comment__head:focus-within .abele-github-link-actions,
.is-phone .abele-github-comment__head .abele-github-link-actions {
  opacity: 1;
  pointer-events: auto;
}

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

  // The rule beside a reply stays grey; the reply linked to is told by a wash.
  &_reply#{&}_target {
    background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
    box-shadow: none;
  }

  // One line however narrow the column: the date and place give way, the actions keep their end.
  &__head {
    display: flex;
    align-items: center;
    gap: var(--size-4-1) var(--size-4-2);
    font-size: var(--font-ui-small);
    white-space: nowrap;

    > * {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    // They show under the pointer over the line's end, as the file explorer's own do, so the
    // words keep the whole line while they are not there.
    position: relative;

    > .abele-github-link-actions {
      position: absolute;
      inset-inline-end: 0;
      top: 50%;
      transform: translateY(-50%);
      overflow: visible;
      background-color: var(--background-primary);
    }
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
