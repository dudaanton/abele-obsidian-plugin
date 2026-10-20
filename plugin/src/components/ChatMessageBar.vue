<template>
  <!-- One quiet line under a question or an answer, on the side of whoever wrote it: what can be
       done with it and when it was written, together, coming up under the pointer on a computer;
       the branches that part from it stay. A phone, which cannot point, keeps the ⋯ that holds
       every action, and the time. -->
  <div class="abele-chat-msg__bar">
    <span class="abele-chat-msg__quick" role="group" :aria-label="t('chat.messageActions')">
      <template v-if="!mobile">
        <!-- Replying to the agent's words, as in a messenger: the words selected in this answer,
             or all of it, go into the message being written, where the cursor is. -->
        <Icon
          v-if="canReply"
          icon="reply"
          size="xs"
          :label="t('chat.replyThis')"
          @pointerdown="captureSelection"
          @click="emit('reply')"
        />
        <Icon icon="copy" size="xs" :label="t('chat.copyMessage')" @click="emit('copy')" />
        <template v-if="!readOnly">
          <Icon
            v-if="message.role === 'user'"
            icon="pencil"
            size="xs"
            :label="t('chat.edit')"
            @click="emit('edit-message', message.id)"
          />
          <Icon
            v-else
            icon="rotate-cw"
            size="xs"
            :label="t('chat.retry')"
            @click="emit('retry-message', message.id)"
          />
          <Icon
            icon="file-input"
            size="xs"
            :label="t('chat.insertNote')"
            @click="emit('insert-into-note', message.id)"
          />
          <Icon
            v-if="canComment"
            icon="message-square"
            size="xs"
            :label="t('chat.askHere')"
            @pointerdown="captureSelection"
            @click="askHere"
          />
        </template>
      </template>
      <Icon
        v-if="!readOnly || mobile || extraActions"
        icon="ellipsis"
        size="xs"
        :label="t('chat.moreActions')"
        aria-haspopup="menu"
        @click="(event: MouseEvent) => emit('actions', event)"
      />
    </span>
    <slot />
    <!-- When it was written; pressed, the message's details: tokens, highlights. -->
    <Button
      :text="shortTime"
      plain
      class="clickable-icon abele-chat-msg__icon abele-chat-msg__time"
      :label="t('chat.details')"
      :tooltip="timeTooltip"
      :aria-expanded="expanded"
      @click="emit('details')"
    >
      <time :datetime="formatted.datetime" :aria-label="formatted.exact">{{ shortTime }}</time>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed } from 'vue'
import { Platform } from 'obsidian'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import type { ChatMessage } from '@/ai/types'

const props = defineProps<{
  message: ChatMessage
  readOnly?: boolean
  extraActions?: boolean
  canComment?: boolean
  /** An answer of the agent the message being written can reply to. */
  canReply?: boolean
  expanded?: boolean
  captureSelection: () => void
  askHere: () => void
}>()
const emit = defineEmits<{
  (event: 'copy'): void
  (event: 'reply'): void
  (event: 'actions', mouse: MouseEvent): void
  (event: 'edit-message', id: string): void
  (event: 'retry-message', id: string): void
  (event: 'insert-into-note', id: string): void
  (event: 'details'): void
}>()

const mobile = Platform.isMobile
const formatted = computed(() => formatTimestamp(props.message.timestamp, { diagnostic: true }))
const shortTime = computed(() =>
  formatted.value.datetime ? formatted.value.clock : t('chat.timeUnknown')
)

/** The whole date, and what the answer cost, in the time's tooltip. */
const timeTooltip = computed(() => {
  const usage = props.message.usage
  const date = formatted.value.exact
  return usage ? t('chat.timeTokens', { date, count: usage.total }) : date
})
</script>

<style lang="scss">
.abele-chat-msg__bar {
  display: flex;
  flex-basis: 100%;
  align-items: center;
  gap: var(--size-2-1);
  min-height: calc(var(--icon-xs) + 2 * var(--size-2-2));
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-chat-msg__quick {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
}
// The time right after the actions, as one group, an interceptor's replacement between them.
// What sits apart from it — the branches, an edit's pencil — is on the message's own edge, so it
// does not float apart from it while the group is hidden: an answer's on the left, a question's
// on the right.
.abele-chat-msg__bar > .abele-chat-msg__time {
  order: 1;
}
.abele-chat-msg__bar
  > :not(.abele-chat-msg__quick, .abele-chat-msg__time, .abele-chat-msg__replaced) {
  order: -1;
}
.abele-chat-msg_user > .abele-chat-msg__bar {
  justify-content: flex-end;

  > :not(.abele-chat-msg__quick, .abele-chat-msg__time, .abele-chat-msg__replaced) {
    order: 2;
  }
}
.abele-chat-msg__bar .abele-chat-msg__time {
  height: auto;
  padding: var(--size-2-1) var(--size-2-2);
  color: var(--text-muted);
  font-size: inherit;
  font-variant-numeric: tabular-nums;
}
// On a phone the line's buttons are a finger's size, and stand in the line, not across it.
body.is-mobile .abele-chat-msg__bar button.abele-chat-msg__icon {
  margin-block: 0;
}
// Under the pointer, or with the keyboard in it, a message shows what can be done with it, and
// what changed it — an edit's pencil, an interceptor's replacement; the glyph of one still being
// checked stays.
body:not(.is-mobile)
  .abele-chat-msg:not(:hover):not(:focus-within)
  > .abele-chat-msg__bar
  :is(
    .abele-chat-msg__quick,
    .abele-chat-msg__edited,
    .abele-chat-msg__replaced,
    .abele-chat-msg__time:not([aria-expanded='true'])
  ) {
  opacity: 0;
}
</style>
