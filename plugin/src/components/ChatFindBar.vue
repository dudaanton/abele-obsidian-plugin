<template>
  <div class="abele-chat-find" role="search">
    <Search
      ref="inputRef"
      class="abele-chat-find__input"
      :model-value="query"
      :placeholder="t('chat.find')"
      :label="t('chat.find')"
      suffix-class="abele-chat-find__count"
      :suffix="countText"
      :suffix-label="countLabel"
      @update:model-value="emit('update:query', $event)"
    />
    <div class="abele-chat-find__actions">
      <Icon
        icon="arrow-up"
        :tooltip="t('chat.previousMatch')"
        :disabled="!count"
        @click="emit('previous')"
      />
      <Icon
        icon="arrow-down"
        :tooltip="t('chat.nextMatch')"
        :disabled="!count"
        @click="emit('next')"
      />
      <Icon icon="x" :tooltip="t('chat.closeFind')" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Search from './obsidian/Search.vue'
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

const inputRef = ref<InstanceType<typeof Search>>()

const countText = computed(() =>
  props.query.trim() ? (props.count ? `${props.position}/${props.count}` : '0') : ''
)
const countLabel = computed(() =>
  props.query.trim()
    ? props.count
      ? t('chat.position', { position: props.position, count: props.count })
      : t('chat.noResults')
    : ''
)

const onKey = (e: KeyboardEvent) => {
  const field = inputRef.value?.inputRef as HTMLInputElement | undefined
  if (!field?.isConnected || e.target !== field || e.isComposing) return
  if (e.key !== 'Enter' && e.key !== 'Escape') return
  // Before Obsidian's document keymap: on mobile it takes plain Enter before the input hears it.
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.key === 'Enter') emit(e.shiftKey ? 'previous' : 'next')
  else emit('close')
}

/** Puts the cursor in the field with what is there selected, for another Cmd+F. */
const focus = () => {
  const el = inputRef.value?.inputRef as HTMLInputElement | undefined
  el?.focus()
  inputRef.value?.select()
}

let keyWindow: Window | null = null
onMounted(() => {
  keyWindow = (inputRef.value?.$el as HTMLElement | undefined)?.ownerDocument.defaultView ?? null
  keyWindow?.addEventListener('keydown', onKey, true)
  if (props.autofocus !== false) focus()
})
onUnmounted(() => keyWindow?.removeEventListener('keydown', onKey, true))
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

  &__input .abele-obsidian-search__suffix {
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
  background-color: var(--highlight-background, var(--text-highlight-bg));
}

::highlight(abele-chat-find-current) {
  background-color: color-mix(in srgb, var(--color-orange) 50%, transparent);
  color: var(--text-normal);
}
</style>
