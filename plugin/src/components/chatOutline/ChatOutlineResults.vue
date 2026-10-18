<template>
  <!-- As Obsidian's search lists them: a heading for where the matches are, with how many, and
       the matches under it with the words marked. -->
  <TreeItem
    v-for="group in groups"
    :key="group.key"
    class="search-result abele-chat-outline__group"
    :icon="group.icon"
    :text="group.title"
    :note="group.note"
    collapsible
    :collapsed="folded.has(group.key)"
    fold-apart
    @click="group.open()"
    @toggle="flip(group.key)"
  >
    <template #end>
      <span class="abele-chat-outline__codes"
        ><span>{{ group.hits.length }}</span
        ><span class="abele-chat-outline__dot"
      /></span>
    </template>
    <div class="search-result-file-matches">
      <div
        v-for="hit in group.hits"
        :key="`${hit.messageId}:${hit.part}`"
        class="search-result-file-match tappable abele-chat-outline__match"
        role="button"
        tabindex="0"
        @click="hit.open()"
        @keydown.enter.prevent="hit.open()"
      >
        {{ hit.snippet.before
        }}<span class="search-result-file-matched-text">{{ hit.snippet.match }}</span
        >{{ hit.snippet.after }}
      </div>
    </div>
  </TreeItem>
  <TreeItem
    v-for="entry in unavailable"
    :key="entry.discussionId"
    class="abele-chat-outline__group"
    icon="messages-square"
    :text="entry.label"
    note="Gone, unreadable or not synced yet"
    disabled
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// What a search of the chat found, grouped by the question each match is under (or by the
// discussion it is in), so a hit reads with the place it belongs to.
import { computed, reactive } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { buildChatNavigation, navigationTitle, type NavigationHit } from '@/ai/chatNavigation'
import type {
  DiscussionNavigationHit,
  UnavailableDiscussion,
} from '@/ai/chatNavigationDiscussionSearch'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  query: string
  hits: NavigationHit[]
  discussionHits: DiscussionNavigationHit[]
  unavailable: UnavailableDiscussion[]
  /** The messages searched: the branch you are on, or every branch. */
  messages: readonly ChatMessage[]
  comments: readonly MessageComment[]
  /** Which branch a message is on, when every branch was searched. */
  labels?: Map<string, string>
}>()
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart, query?: string): void
  (e: 'discussion', id: string, messageId?: string, part?: FindPart, query?: string): void
}>()

interface Group {
  key: string
  icon: string
  title: string
  note?: string
  open: () => void
  hits: (NavigationHit & { open: () => void })[]
}

const folded = reactive(new Set<string>())
const flip = (key: string) => (folded.has(key) ? folded.delete(key) : folded.add(key))

// The question a message answers: the last one sent before it on its own way through the chat.
const owners = computed(() => {
  const byId = new Map(props.messages.map((m) => [m.id, m]))
  const owner = new Map<string, ChatMessage>()
  for (const turn of buildChatNavigation(props.messages, props.comments))
    for (const m of [turn.message, ...turn.answers, ...turn.tools]) owner.set(m.id, turn.message)
  return (id: string) => owner.get(id) ?? byId.get(id)
})

const groups = computed<Group[]>(() => {
  const out = new Map<string, Group>()
  for (const hit of props.hits) {
    const question = owners.value(hit.messageId)
    const ownerId = question?.id ?? hit.messageId
    const branch = props.labels?.get(hit.messageId)
    const key = branch ? `${ownerId}:${branch}` : ownerId
    if (!out.has(key))
      out.set(key, {
        key,
        icon: 'message-circle',
        title: question ? navigationTitle(question) : t('streamB.message.2f7766'),
        note: branch,
        open: () => emit('jump', ownerId),
        hits: [],
      })
    out
      .get(key)
      .hits.push({ ...hit, open: () => emit('jump', hit.messageId, hit.part, props.query) })
  }
  for (const hit of props.discussionHits) {
    const key = `discussion:${hit.discussionId}`
    if (!out.has(key))
      out.set(key, {
        key,
        icon: 'messages-square',
        title: hit.label,
        note: props.labels ? hit.continuation : undefined,
        open: () => emit('discussion', hit.discussionId),
        hits: [],
      })
    out.get(key).hits.push({
      ...hit,
      open: () => emit('discussion', hit.discussionId, hit.messageId, hit.part, props.query),
    })
  }
  return [...out.values()]
})
</script>

<style lang="scss">
.abele-chat-outline__group > .tree-item-self .abele-tree-item__text {
  overflow: clip;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-chat-outline__group > .tree-item-self .abele-tree-item__inner {
  min-width: 0;
}
.abele-chat-outline__match {
  overflow-wrap: anywhere;
}
</style>
