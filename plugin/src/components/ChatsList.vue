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
import { usePagedList } from '@/composables/usePagedList'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'

const props = defineProps<{
  chats: ChatLink[]
}>()

/** Already ordered by `useChatLinks`; kept as a getter so paging follows a refiltered list. */
const sorted = computed(() => props.chats)

const metaOf = (chat: ChatLink): string[] =>
  chat.touchedAt ? [chat.touchedAt.format(DISPLAY_DATE_FORMAT)] : []

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

.abele-chats-list__chats {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
  padding-left: calc(var(--icon-size) / 4);
}
</style>
