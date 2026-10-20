<template>
  <!-- Where the chat went more than one way from here: this message is one of them. The arrows step
       to the neighbours; the count opens all of them, each by how it starts. -->
  <span
    class="abele-chat-branch"
    role="group"
    :aria-label="t('chat.branchPosition', { position: index + 1, count: choices.length })"
  >
    <Icon
      icon="chevron-left"
      size="xs"
      :label="t('chat.previousBranch')"
      :disabled="index <= 0"
      :disabled-reason="t('chat.firstBranch')"
      @click="emit('switch', choices[index - 1].id)"
    />
    <Button
      ref="count"
      plain
      icon="git-branch"
      class="abele-chat-branch__count"
      :text="`${index + 1}/${choices.length}`"
      :label="t('chat.branchPosition', { position: index + 1, count: choices.length })"
      :tooltip="t('chat.allBranches')"
      @click="showAll"
    />
    <Icon
      icon="chevron-right"
      size="xs"
      :label="t('chat.nextBranch')"
      :disabled="index >= choices.length - 1"
      :disabled-reason="t('chat.lastBranch')"
      @click="emit('switch', choices[index + 1].id)"
    />
  </span>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import type { BranchChoice } from '@/ai/chatBranches'
import Button from './obsidian/Button.vue'
import ChatBranchTitle from './chat/ChatBranchTitle.vue'
import { renderKit, unrenderKit } from './obsidian/mount'

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

/** Obsidian's own menu, a branch per item: how it starts, then its facts as codes, its words in labels. */
function showAll() {
  if (!count.value) return
  const menu = new Menu()
  const titles: HTMLElement[] = []
  menu.onHide(() => titles.forEach(unrenderKit))
  props.choices.forEach((choice, i) => {
    const title = createFragment()
    const holder = createSpan({ cls: 'abele-chat-branch__menu-title' })
    title.append(holder)
    renderKit(holder, ChatBranchTitle, {
      title: choice.title,
      questions: choice.questions,
      timestamp: choice.timestamp,
      tone: choice.tone,
    })
    titles.push(holder)
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
        .setTitle(t('chat.newBranch'))
        .setIcon('git-branch-plus')
        .onClick(() => emit('new'))
    )
  }
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
  margin-block: calc(-1 * var(--size-2-2));
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

// The menu's item: how the branch starts on the left, its facts at the end in quiet codes. The
// span the title is rendered into stands out of the way, so both are the title's own flex items.
.menu-item-title:has(> .abele-chat-branch__menu-title) {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-3);
  min-width: 0;
}

.abele-chat-branch__menu-title {
  display: contents;
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

.abele-chat-branch__glyph.abele-obsidian-icon {
  display: inline-flex;
  min-height: 0;
  color: inherit;
  --icon-size: var(--icon-xs);
}
</style>
