<template>
  <!-- Where the chat goes more than one way: each way by how it starts, the one you are on ticked.
       A row jumps there (switching the chat to it); the arrow shows how that way went on. -->
  <TreeItem
    class="abele-chat-outline__fork"
    icon="split"
    :text="fork.parentId ? t('streamB.branches.2eee03') : t('streamB.starts.96dbed')"
    collapsible
    :collapsed="!outline.isOpen(`fork:${fork.id}`)"
    :data-fork-id="fork.id"
    @click="outline.flip(`fork:${fork.id}`)"
  >
    <template #end>
      <span class="abele-chat-outline__codes">
        <span>{{ fork.choices.length }}</span>
        <span class="abele-chat-outline__dot" />
      </span>
    </template>
    <TreeItem
      v-for="choice in fork.choices"
      :key="choice.message.id"
      class="abele-chat-outline__branch"
      :class="{ 'abele-chat-outline__branch_on': choice.selected }"
      :icon="choice.selected ? 'check' : 'git-branch'"
      :text="navigationTitle(choice.message)"
      :note="circular(choice) ? 'Leads back here' : undefined"
      :disabled="circular(choice)"
      :collapsible="!choice.selected && !circular(choice) && hasContents(choice.message.id)"
      :collapsed="!outline.isOpen(`continuation:${choice.message.id}`)"
      fold-apart
      :data-continuation="choice.message.id"
      @click="emit('jump', choice.message.id)"
      @toggle="outline.flip(`continuation:${choice.message.id}`)"
    >
      <template #end>
        <span class="abele-chat-outline__codes">
          <time class="abele-chat-outline__time">{{ timeOf(choice.message.timestamp) }}</time>
          <span class="abele-chat-outline__dot" />
        </span>
      </template>
      <!-- The way you are on is the list itself; only the others are drawn again here. -->
      <ChatOutlineTurns
        :messages="navigationSegment(tree, choice.message.id)"
        :comments="comments"
        :tree="tree"
        :current-ids="currentIds"
        :active-message-id="activeMessageId"
        :ancestors="ancestors"
        hide-first
        @jump="(id, part) => emit('jump', id, part)"
        @discussion="(id) => emit('discussion', id)"
      />
    </TreeItem>
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import TreeItem from '../obsidian/TreeItem.vue'
// The branches hold questions, which hold branches: the two lists draw each other.
import ChatOutlineTurns from './ChatOutlineTurns.vue'
import { useOutline } from './context'
import { timeOf } from './outline'
import { navigationTitle } from '@/ai/chatNavigation'
import {
  navigationSegment,
  type NavigationFork,
  type NavigationTree,
} from '@/ai/chatNavigationBranches'
import type { MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  fork: NavigationFork
  tree: NavigationTree
  currentIds: readonly string[]
  comments: readonly MessageComment[]
  activeMessageId?: string
  ancestors: string[]
}>()
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart): void
  (e: 'discussion', id: string): void
}>()

const outline = useOutline()
const hasContents = (id: string) =>
  (props.tree.children.get(id)?.length ?? 0) > 0 ||
  props.comments.some((comment) => comment.message === id)
const circular = (choice: NavigationFork['choices'][number]) =>
  !choice.selected && props.ancestors.includes(choice.message.id)
</script>

<style lang="scss">
.abele-chat-outline__fork > .tree-item-self {
  color: var(--text-muted);
}
.abele-chat-outline__branch > .tree-item-self .abele-tree-item__text {
  overflow: clip;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-chat-outline__branch_on > .tree-item-self .abele-tree-item__glyph {
  color: var(--text-accent);
  opacity: 1;
}
</style>
