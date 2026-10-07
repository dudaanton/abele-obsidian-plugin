<template>
  <div class="abele-chat-navigation__discussion">
    <div v-if="trail.length > 2" class="setting-item-description">{{ trail.join(' › ') }}</div>
    <button type="button" data-nav-item :disabled="!loaded" @click="emit('discussion', comment.id)">
      <span v-if="comment.quote">“{{ navigationExcerpt(comment.quote) }}” · </span>
      {{ title }}
    </button>
    <details v-if="children.length" :open="expanded" @toggle="toggle">
      <summary data-nav-item>Nested discussions · {{ children.length }}</summary>
      <template v-if="expanded">
        <ChatNavigationDiscussion
          v-for="child in children"
          :key="child.id"
          :comment="child"
          :state="state"
          :ancestors="[...ancestors, comment.id]"
          :trail="[...trail, title]"
          @discussion="emit('discussion', $event)"
        />
      </template>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import type { MessageComment } from '@/ai/types'
import { navigationExcerpt, navigationTitle, type NavigationState } from '@/ai/chatNavigation'

const props = withDefaults(
  defineProps<{
    comment: MessageComment
    state: NavigationState
    ancestors?: string[]
    trail?: string[]
  }>(),
  { ancestors: () => [], trail: () => [] }
)
const emit = defineEmits<{ (e: 'discussion', id: string): void }>()
const loaded = shallowRef<Pick<ChatSession, 'messages' | 'messageComments' | 'isDestroyed'> | null>(
  null
)
const pending = ref(true)
const key = `discussion:${props.comment.id}`
const expanded = ref(props.state.expanded.includes(key))
let closed = false
onBeforeUnmount(() => {
  closed = true
})
onMounted(async () => {
  try {
    if (props.ancestors.includes(props.comment.id)) return
    const session = await CommentService.getInstance().navigationPreview(props.comment.id)
    if (!closed) loaded.value = session
  } catch {
    // A malformed or unreadable file is still an anchor worth showing.
    loaded.value = null
  } finally {
    pending.value = false
  }
})
const title = computed(() => {
  if (props.ancestors.includes(props.comment.id)) return 'Circular discussion link'
  if (pending.value) return 'Reading discussion…'
  if (!loaded.value || loaded.value.isDestroyed)
    return 'Discussion unavailable — deleted or not yet synced'
  const first = loaded.value.messages.value.find((m) => m.role === 'user' && !m.draft)
  return first ? navigationTitle(first) : 'Empty discussion'
})
const children = computed(() =>
  loaded.value?.isDestroyed ? [] : (loaded.value?.messageComments.value ?? [])
)
const toggle = (event: Event) => {
  expanded.value = (event.target as HTMLDetailsElement).open
  props.state.expanded = props.state.expanded.filter((k) => k !== key)
  if (expanded.value) props.state.expanded.push(key)
}
</script>
