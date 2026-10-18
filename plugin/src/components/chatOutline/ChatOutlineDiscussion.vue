<template>
  <!-- A discussion by its first question, the passage it is about after it; opened, the
       discussions held inside it, read only when opened. -->
  <TreeItem
    class="abele-chat-outline__discussion"
    :class="{ 'abele-chat-outline__discussion_gone': gone }"
    icon="messages-square"
    :text="title"
    :note="comment.quote ? `“${navigationExcerpt(comment.quote)}”` : undefined"
    :disabled="gone || pending"
    :collapsible="children.length > 0"
    :collapsed="!outline.isOpen(key)"
    fold-apart
    @click="emit('discussion', comment.id)"
    @toggle="outline.flip(key)"
  >
    <template v-if="children.length" #end>
      <span class="abele-chat-outline__codes"
        ><span>{{ children.length }}</span
        ><span class="abele-chat-outline__dot"
      /></span>
    </template>
    <template v-if="outline.isOpen(key)">
      <ChatOutlineDiscussion
        v-for="child in children"
        :key="child.id"
        :comment="child"
        :ancestors="[...ancestors, comment.id]"
        @discussion="(id) => emit('discussion', id)"
      />
    </template>
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { useOutline } from './context'
import { buildChatNavigation, navigationExcerpt, navigationTitle } from '@/ai/chatNavigation'
import type { NavigationDiscussionData } from '@/ai/chatNavigationDiscussionSearch'
import type { MessageComment } from '@/ai/types'

const props = withDefaults(
  defineProps<{
    comment: MessageComment
    ancestors?: string[]
  }>(),
  { ancestors: () => [] }
)
const emit = defineEmits<{ (e: 'discussion', id: string): void }>()

const outline = useOutline()
const key = `discussion:${props.comment.id}`
const loaded = shallowRef<NavigationDiscussionData | null>(null)
const pending = ref(true)
const circular = props.ancestors.includes(props.comment.id)
let closed = false
onBeforeUnmount(() => (closed = true))
onMounted(async () => {
  try {
    if (circular) return
    const data = await outline.preview(props.comment.id)
    if (!closed) loaded.value = data
  } catch {
    // An unreadable file is still a place worth showing.
    loaded.value = null
  } finally {
    pending.value = false
  }
})

const gone = computed(() => circular || (!pending.value && !loaded.value))
const title = computed(() => {
  if (circular) return t('streamB.leadsBackToADiscussionAbove.2b077a')
  if (pending.value) return t('streamB.reading.874bfa')
  if (!loaded.value) return t('streamB.goneUnreadableOrNotSyncedYet.67e298')
  const first = loaded.value.messages.find((m) => m.role === 'user' && !m.draft)
  return first ? navigationTitle(first) : t('streamB.emptyDiscussion.f14433')
})
const children = computed(() =>
  loaded.value
    ? buildChatNavigation(loaded.value.messages, loaded.value.comments).flatMap(
        (turn) => turn.discussions
      )
    : []
)
</script>

<style lang="scss">
.abele-chat-outline__discussion > .tree-item-self .abele-tree-item__inner {
  min-width: 0;
}
.abele-chat-outline__discussion > .tree-item-self .abele-tree-item__text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: clip;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-chat-outline__discussion > .tree-item-self .abele-tree-item__note {
  font-style: italic;
}
</style>
