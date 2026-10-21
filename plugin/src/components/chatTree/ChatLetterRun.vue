<template>
  <TreeItem
    ref="line"
    class="abele-chat-run abele-chat-letter"
    :class="[`abele-chat-run_${state}`, { 'abele-chat-letter_running': state === 'running' }]"
    :icon="state === 'running' ? 'loader' : 'message-square-share'"
    :text="t('chat.letterAsked', { title })"
    :style="{ '--abele-letter-indent': indent }"
    :where="letter.to.folder"
    :collapsible="letter.reply !== undefined"
    :collapsed="!open"
    @click="open = !open"
  >
    <template v-if="state !== 'done'" #end>
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
  <CallNote
    v-if="letter.refusal"
    class="abele-chat-msg__letter-refusal"
    :text="letter.refusal"
    :style="{ '--abele-letter-indent': indent }"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, onUpdated, watch } from 'vue'
import { setTooltip } from 'obsidian'
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
const line = ref<InstanceType<typeof TreeItem>>()
const indent = ref('0px')
const letter = computed(() => props.message.chatLetter)
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
// Follow the host's actual tree padding, including theme changes and right-to-left layouts.
const align = () => {
  const root = line.value?.$el as HTMLElement | undefined
  const text = root?.querySelector<HTMLElement>('.abele-tree-item__text')
  if (!root || !text) return
  const rowBox = root.getBoundingClientRect(),
    textBox = text.getBoundingClientRect()
  const offset =
    getComputedStyle(root).direction === 'rtl'
      ? rowBox.right - textBox.right
      : textBox.left - rowBox.left
  indent.value = `${Math.max(0, offset)}px`
}
const tooltip = () => {
  if (line.value?.$el)
    setTooltip(line.value.$el as HTMLElement, unknown.value ? letter.value.to.id : '')
}
let observer: ResizeObserver | undefined
onMounted(() => {
  align()
  tooltip()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(align)
    observer.observe(line.value!.$el as HTMLElement)
  }
})
onUpdated(align)
watch(() => [unknown.value, letter.value.to.id], tooltip)
onUnmounted(() => observer?.disconnect())
</script>

<style lang="scss">
.abele-chat-msg__body:has(> .abele-chat-letter) {
  grid-column: 1 / -1;
}
.abele-chat-letter.abele-chat-run > .abele-tree-item__self {
  width: 100%;
}
.abele-chat-letter.abele-chat-run > .abele-tree-item__self > .abele-tree-item__inner {
  flex: 1 1 auto;
}
body.is-phone
  .abele-chat-letter:not(.abele-chat-run_done)
  > .abele-tree-item__self
  > .tree-item-flair-outer {
  min-inline-size: calc(var(--size-4-2) + var(--touch-size-m) + 2 * var(--size-2-2));
}
.abele-chat-letter > .tree-item-children {
  margin-inline-start: 0;
  padding-inline-start: 0;
  border-inline-start: 0;
}
.abele-chat-letter__reply,
.abele-chat-letter + .abele-call-note {
  padding-inline-start: var(--abele-letter-indent);
  font-size: var(--font-ui-small);
}
.abele-chat-letter__reply {
  color: var(--text-normal);
}
</style>
