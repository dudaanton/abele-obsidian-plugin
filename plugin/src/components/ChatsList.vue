<template>
  <div class="abele-chats-list">
    <div class="abele-chats-list__header">
      <div class="abele-chats-list__header-text">Chats</div>
    </div>
    <div class="abele-chats-list__chats">
      <Card
        v-for="chat in visible"
        :key="chat.path"
        :title="chat.title"
        :description="chat.recap || undefined"
        :meta="metaOf(chat)"
        clamp-description
        clickable
        @click="chat.open()"
      >
        <template v-if="chat.agentName" #badges>
          <Badge :text="chat.agentName" />
        </template>
        <!-- Visible rather than behind a right-click, which a phone does not have. Detaching
             takes the card away and nothing else: the chat itself is untouched. -->
        <template #actions>
          <Icon
            class="abele-chats-list__detach"
            icon="unlink"
            :tooltip="`Detach this chat from the ${subject}`"
            @click="detach(chat)"
          />
        </template>
      </Card>
      <div v-if="hasMore" ref="sentinel" class="abele-chats-list__sentinel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatLink } from '@/entities/ChatLink'
import Card from './obsidian/Card.vue'
import Badge from './obsidian/Badge.vue'
import Icon from './obsidian/Icon.vue'
import { detachNote } from '@/ai/chatNoteLinks'
import { usePagedList } from '@/composables/usePagedList'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'

const props = withDefaults(
  defineProps<{
    chats: ChatLink[]
    /** What the list sits under, for the detach button's tooltip: a note or a script. */
    subject?: string
  }>(),
  { subject: 'note' }
)

/** Already ordered by `useChatLinks`; kept as a getter so paging follows a refiltered list. */
const sorted = computed(() => props.chats)

const metaOf = (chat: ChatLink): string[] =>
  chat.touchedAt ? [chat.touchedAt.format(DISPLAY_DATE_FORMAT)] : []

const detach = (chat: ChatLink) => {
  void detachNote(chat.path, chat.notePath).catch((e: unknown) => {
    console.error('[Abele] Could not detach the chat:', e)
  })
}

const { visible, hasMore, sentinel } = usePagedList(() => sorted.value)
</script>

<style lang="scss">
.abele-chats-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  font-weight: bold;
  margin-bottom: var(--p-spacing);
}

.abele-chats-list__sentinel {
  height: 1px;
}

/**
 * Flush with the note above it. The other footer lists are indented by a quarter of an icon
 * because their rows *start* with one — a checkbox, a log's glyph — and the text after it
 * needs the same margin the prose has. A chat card is a box with a border of its own, and a
 * box set in from the text it belongs to reads as a box that missed.
 */
.abele-chats-list__chats {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
}
</style>
