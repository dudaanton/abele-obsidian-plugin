<template>
  <div class="abele-chat-find" role="search">
    <Input
      ref="inputRef"
      class="abele-chat-find__input"
      :model-value="query"
      placeholder="Find in this chat"
      aria-label="Find in this chat"
      @update:model-value="emit('update:query', $event)"
      @keydown="onKey"
    />
    <span class="abele-chat-find__count" aria-live="polite">{{ countText }}</span>
    <div class="abele-chat-find__actions">
      <Icon
        icon="arrow-up"
        tooltip="Previous match (Shift+Enter)"
        :disabled="!count"
        @click="emit('previous')"
      />
      <Icon
        icon="arrow-down"
        tooltip="Next match (Enter)"
        :disabled="!count"
        @click="emit('next')"
      />
      <Icon icon="x" tooltip="Close the find bar (Esc)" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Input from './obsidian/Input.vue'
import Icon from './obsidian/Icon.vue'

/**
 * The find bar over a chat's messages: what is typed, where the one shown stands among the
 * matches, and the way to the next and the previous one. What is searched and how a match is
 * shown is `useChatFind`'s; this is only the bar. It looks the way the find bar over a GitHub tab
 * does, so the plugin has one find bar and not two.
 */
const props = withDefaults(
  defineProps<{
    query: string
    count: number
    /** 1-based; 0 when there is no match. */
    position: number
    /** Moves each time the bar should take the cursor again. */
    focusRequest?: number
    /** False to leave the cursor where it is as the bar appears. */
    autofocus?: boolean
  }>(),
  { focusRequest: 0, autofocus: true }
)

const emit = defineEmits<{
  (e: 'update:query', value: string): void
  (e: 'next'): void
  (e: 'previous'): void
  (e: 'close'): void
}>()

const inputRef = ref<InstanceType<typeof Input>>()

const countText = computed(() => {
  if (!props.query.trim()) return ''
  if (!props.count) return 'No results'
  return `${props.position} of ${props.count}`
})

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit(e.shiftKey ? 'previous' : 'next')
  } else if (e.key === 'Escape') {
    // Taken here, so Obsidian does not also act on it — close a panel, leave a modal.
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

/** Puts the cursor in the field with what is there selected, for another Cmd+F. */
const focus = () => {
  const el = inputRef.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}

onMounted(() => {
  if (props.autofocus !== false) focus()
})
watch(() => props.focusRequest, focus)

defineExpose({ focus })
</script>

<style lang="scss">
.abele-chat-find {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--size-4-2);
  margin: 0 var(--size-4-2) var(--size-4-2);
  padding: var(--size-4-2);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-s);

  &__input {
    flex: 1 1 auto;
  }

  &__count {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--size-2-1);
  }
}

// The matches, painted over the messages' own text by the CSS Custom Highlight API
// (`chatFindDom.ts`). The same colours as the find bar over a GitHub tab.
::highlight(abele-chat-find) {
  background-color: var(--text-highlight-bg);
}

::highlight(abele-chat-find-current) {
  background-color: color-mix(in srgb, var(--color-orange) 50%, transparent);
  color: var(--text-normal);
}
</style>
