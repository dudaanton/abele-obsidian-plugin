<template>
  <!-- The other ways the chat went from this question's place, each a row by how it starts:
       the row switches the chat to it and jumps there; the arrow shows its questions, with
       their own branches in the same way. The way you are on is the list itself. -->
  <TreeItem
    v-for="choice in others"
    :key="choice.id"
    class="abele-chat-outline__branch"
    icon="git-branch"
    :text="choice.title"
    :collapsible="contents(choice.id).length > 1"
    :collapsed="!outline.isOpen(`branch:${choice.id}`)"
    fold-apart
    :data-branch="choice.id"
    @click="emit('jump', choice.id)"
    @toggle="outline.flip(`branch:${choice.id}`)"
  >
    <template #end>
      <span class="abele-chat-outline__codes">
        <span
          :ref="(el) => tip(el, plural(choice.questions, 'question'))"
          class="abele-chat-outline__code"
          ><Icon icon="message-circle-question" size="xs" :interactive="false" /><span
            class="abele-chat-outline__num"
            >{{ choice.questions }}</span
          ></span
        >
        <time class="abele-chat-outline__time">{{ timeOf(choice.timestamp) }}</time>
        <span
          :ref="(el) => tip(el, choice.tone ? toneLabel[choice.tone] : '')"
          class="abele-chat-outline__dot"
          :class="choice.tone && `abele-chat-outline__dot_${choice.tone}`"
        />
      </span>
    </template>
    <ChatOutlineTurns
      v-if="outline.isOpen(`branch:${choice.id}`)"
      :messages="contents(choice.id)"
      :comments="comments"
      :tree="tree"
      :current-ids="currentIds"
      :active-message-id="activeMessageId"
      hide-first
      @jump="(id, part) => emit('jump', id, part)"
      @discussion="(id) => emit('discussion', id)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
// Branches hold questions, which hold branches: the two lists draw each other.
import ChatOutlineTurns from './ChatOutlineTurns.vue'
import { useOutline } from './context'
import { timeOf, toneLabel } from './outline'
import { plural } from '../nodeWork/codes'
import { branchChoice, branchPath } from '@/ai/chatBranches'
import type { NavigationFork, NavigationTree } from '@/ai/chatNavigationBranches'
import type { MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  fork: NavigationFork
  /** The question this list hangs under: one of the ways, drawn already. */
  here: string
  tree: NavigationTree
  currentIds: readonly string[]
  comments: readonly MessageComment[]
  activeMessageId?: string
}>()
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart): void
  (e: 'discussion', id: string): void
}>()

const outline = useOutline()
const all = computed(() => [...props.tree.byId.values()])
const others = computed(() =>
  props.fork.choices
    .filter((choice) => choice.message.id !== props.here)
    .map((choice) => branchChoice(all.value, choice.message))
)
const contents = (id: string) => branchPath(all.value, id)
const tip = (el: unknown, text: string) => {
  if (el instanceof HTMLElement) setTooltip(el, text)
}
</script>

<style lang="scss">
// Another way reads as one line: how it starts; the rest is in it.
.abele-chat-outline__branch > .tree-item-self .abele-tree-item__text {
  overflow: clip;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-chat-outline__branch > .tree-item-self {
  color: var(--text-muted);
}
</style>
