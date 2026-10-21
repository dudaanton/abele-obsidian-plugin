<template>
  <TreeItem
    class="abele-chat-run abele-chat-letter"
    :class="[`abele-chat-run_${state}`, { 'abele-chat-letter_running': state === 'running' }]"
    :icon="state === 'running' ? 'loader' : 'message-square-share'"
    :text="t('chat.letterAsked', { title })"
    :title="unknown ? letter.to.id : undefined"
    :where="letter.to.folder"
    :collapsible="letter.reply !== undefined"
    :collapsed="!open"
    @click="open = !open"
  >
    <template #end>
      <StatusDot :tone="tone" :label="stateLabel" />
    </template>
    <template v-if="canOpen" #actions>
      <Icon
        icon="external-link"
        size="xs"
        :tooltip="t('chat.letterOpen', { title })"
        @click.stop="openLetterChat(letter.to)"
      />
    </template>
    <div v-if="letter.reply !== undefined" class="abele-chat-letter__reply">
      <Markdown :text="letter.reply" />
    </div>
  </TreeItem>
  <CallNote v-if="letter.refusal" class="abele-chat-msg__letter-refusal" :text="letter.refusal" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import { openLetterChat, canOpenLetterChat } from '@/ai/chatMessaging'
import { callState } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import Markdown from '../obsidian/Markdown.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import CallNote from '../obsidian/CallNote.vue'

const props = defineProps<{ message: ChatMessage }>()
const open = ref(false)
const letter = computed(() => props.message.chatLetter!)
const canOpen = computed(() => canOpenLetterChat(letter.value.to))
const unknown = computed(
  () => letter.value.to.unknown || (!canOpen.value && letter.value.to.title === letter.value.to.id)
)
const title = computed(() => (unknown.value ? t('chat.letterUnknown') : letter.value.to.title))
const state = computed(() =>
  letter.value.refusal
    ? 'failed'
    : letter.value.reply !== undefined
      ? 'done'
      : callState(props.message)
)
const tone = computed(
  () =>
    (({ failed: 'red', waiting: 'orange', running: 'accent', done: 'faint' }) as const)[state.value]
)
const stateLabel = computed(() =>
  state.value === 'running'
    ? t('chat.letterWorking', { title: title.value })
    : state.value === 'waiting'
      ? t('chat.letterWaiting')
      : state.value === 'failed'
        ? t('chat.letterRefused')
        : title.value
)
</script>

<style lang="scss">
.abele-chat-letter > .tree-item-children {
  margin-inline-start: 0;
  padding-inline-start: 0;
  border-inline-start: 0;
}
.abele-chat-letter__reply,
.abele-chat-letter + .abele-call-note {
  padding-inline-start: calc(var(--icon-xs) + var(--size-4-1) + var(--size-4-2));
  font-size: var(--font-ui-small);
}
.abele-chat-letter__reply {
  color: var(--text-normal);
}
</style>
