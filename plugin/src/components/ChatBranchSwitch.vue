<template>
  <!-- Where the chat went more than one way from here: this message is one of them. The arrows step
       to the neighbours; the count opens all of them, each by how it starts. -->
  <span
    class="abele-chat-branch"
    role="group"
    :aria-label="`Branch ${index + 1} of ${choices.length}`"
  >
    <Icon
      icon="chevron-left"
      size="xs"
      label="Previous branch"
      :disabled="index <= 0"
      disabled-reason="This is the first branch"
      @click="emit('switch', choices[index - 1].id)"
    />
    <Button
      ref="count"
      plain
      icon="git-branch"
      class="abele-chat-branch__count"
      :text="`${index + 1}/${choices.length}`"
      :label="`Branch ${index + 1} of ${choices.length}`"
      tooltip="Show all branches from here"
      @click="showAll"
    />
    <Icon
      icon="chevron-right"
      size="xs"
      label="Next branch"
      :disabled="index >= choices.length - 1"
      disabled-reason="This is the last branch"
      @click="emit('switch', choices[index + 1].id)"
    />
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Menu, setIcon } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import type { BranchChoice } from '@/ai/chatBranches'
import Button from './obsidian/Button.vue'
import { formatTimestamp } from '@/helpers/displayFormat'

const props = defineProps<{
  choices: BranchChoice[]
  index: number
  /** The branches part from an earlier message, so one more can be started from it. */
  canAdd?: boolean
}>()
const emit = defineEmits<{
  (e: 'switch', id: string): void
  /** Another way from the same place, beside the ones there: what is typed next starts it. */
  (e: 'new'): void
}>()

const count = ref<InstanceType<typeof Button>>()

const toneLabel = { waiting: 'Waiting for your approval', failed: 'Refused or failed' } as const

/** Obsidian's own menu, a branch per item: how it starts, then its facts as codes, its words in labels. */
function showAll() {
  const menu = new Menu()
  props.choices.forEach((choice, i) => {
    const title = createFragment()
    const words = title.createSpan({ cls: 'abele-chat-branch__title', text: choice.title })
    words.setAttr('title', choice.title)
    const facts = title.createSpan({ cls: 'abele-chat-branch__facts' })
    const questions = facts.createSpan({
      cls: 'abele-chat-branch__questions',
      attr: { 'aria-label': `${choice.questions} questions in it` },
    })
    setIcon(questions.createSpan({ cls: 'abele-chat-branch__glyph' }), 'message-circle-question')
    questions.createSpan({ text: String(choice.questions) })
    const time = formatTimestamp(choice.timestamp, { diagnostic: true })
    facts.createEl('time', {
      text: time.datetime ? time.exact.split(', ')[1].slice(0, 5) : time.label,
      attr: { ...(time.datetime ? { datetime: time.datetime } : {}), 'aria-label': time.exact },
    })
    if (choice.tone)
      facts.createSpan({
        cls: `abele-chat-branch__dot abele-chat-branch__dot_${choice.tone}`,
        attr: { 'aria-label': toneLabel[choice.tone], role: 'img' },
      })
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon('git-branch')
        .setChecked(i === props.index)
        .onClick(() => i !== props.index && emit('switch', choice.id))
    )
  })
  if (props.canAdd) {
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('New branch from here')
        .setIcon('git-branch-plus')
        .onClick(() => emit('new'))
    )
  }
  if (!count.value) return
  const button = count.value.$el as HTMLElement
  const box = button.getBoundingClientRect()
  menu.onHide(() => {
    if (button.isConnected) button.focus({ preventScroll: true })
  })
  menu.showAtPosition({ x: box.left, y: box.bottom })
}
</script>

<style lang="scss">
.abele-chat-branch {
  display: inline-flex;
  align-items: center;
  height: 1lh;
  color: var(--text-faint);
  font-size: var(--font-smaller);
  white-space: nowrap;
}

.abele-chat-branch__count {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  height: auto;
  padding: 0 var(--size-2-1);
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

// The menu's item: how the branch starts on the left, its facts at the end in quiet codes.
.menu-item-title:has(> .abele-chat-branch__title) {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-3);
  min-width: 0;
}

.abele-chat-branch__title {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 28em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-branch__facts {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  flex: none;
  color: var(--text-faint);
  font-size: var(--font-smaller);
  font-variant-numeric: tabular-nums;
}

.abele-chat-branch__questions {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
}

.abele-chat-branch__glyph {
  display: inline-flex;
  --icon-size: var(--icon-xs);
}

.abele-chat-branch__dot {
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;

  &_waiting {
    background-color: var(--color-orange);
  }

  &_failed {
    background-color: var(--color-red);
  }
}
</style>
