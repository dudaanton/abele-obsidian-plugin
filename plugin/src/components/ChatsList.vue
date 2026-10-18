<template>
  <div class="abele-chats-list" data-abele-anchor="section:chats">
    <ListSectionHeader
      class-prefix="abele-chats-list"
      :text="t('streamB.chats.ef5b40')"
      :count="chats.length"
      :fold="fold"
    />
    <div v-if="!fold.collapsed.value" class="abele-chats-list__chats">
      <Card
        v-for="chat in visible"
        :key="chat.path"
        :ref="(card) => describe(card, chat)"
        :data-abele-anchor="'chat:' + chat.path"
        :title="chat.title"
        :description="chat.recap || undefined"
        :meta="metaOf(chat)"
        clamp-description
        clickable
        @click="chat.open()"
      >
        <!-- Visible rather than behind a right-click, which a phone does not have. Detaching
             takes the card away and nothing else: the chat itself is untouched. -->
        <template #actions>
          <Icon
            class="abele-chats-list__detach"
            icon="unlink"
            :tooltip="t('streamB.detachThisChatFromThe.861a43', { v0: String(subject) })"
            @click="detach(chat)"
          />
        </template>
      </Card>
      <div v-if="hasMore" ref="sentinel" class="abele-chats-list__sentinel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed } from 'vue'
import type { ChatLink } from '@/entities/ChatLink'
import Card from './obsidian/Card.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import { setTooltip } from 'obsidian'
import { useFooterFold } from '@/composables/useFooterFold'
import Icon from './obsidian/Icon.vue'
import { detachNote } from '@/ai/chatNoteLinks'
import { usePagedList } from '@/composables/usePagedList'
import { useFooterPages } from '@/composables/useFooterView'
import { compactDate } from '@/helpers/datesHelper'

const props = withDefaults(
  defineProps<{
    chats: ChatLink[]
    /** What the list sits under, for the detach button's tooltip: a note or a script. */
    subject?: string
  }>(),
  { subject: 'note' }
)

const fold = useFooterFold('chats')

/** Already ordered by `useChatLinks`; kept as a getter so paging follows a refiltered list. */
const sorted = computed(() => props.chats)

const metaOf = (chat: ChatLink): string[] => (chat.touchedAt ? [compactDate(chat.touchedAt)] : [])

/** Who the chat is with is a fact for the pointer, not a coloured label on every card. */
const describe = (card: unknown, chat: ChatLink) => {
  const el = (card as { $el?: unknown } | null)?.$el
  if (el instanceof HTMLElement && chat.agentName)
    setTooltip(el, t('streamB.agent.c60697', { v0: String(chat.agentName) }))
}

const detach = (chat: ChatLink) => {
  void detachNote(chat.path, chat.notePath).catch((e: unknown) => {
    console.error('[Abele] Could not detach the chat:', e)
  })
}

const { visible, hasMore, sentinel } = usePagedList(
  () => sorted.value,
  undefined,
  useFooterPages('chats')
)
</script>

<style lang="scss">
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
