<template>
  <template v-for="child in children" :key="child.kind === 'answer' ? child.message.id : child.id">
    <TreeItem
      v-if="child.kind === 'answer'"
      class="abele-chat-outline__answer"
      icon="message-square-text"
      :text="navigationTitle(child.message)"
      :active="child.message.id === activeMessageId"
      @click="emit('jump', child.message.id)"
    />
    <!-- Tool calls in a row are one line, named by the tools they used; opened, each call. -->
    <TreeItem
      v-else
      class="abele-chat-outline__work"
      icon="wrench"
      :text="toolNames(child.tools)"
      collapsible
      :collapsed="!outline.isOpen(`${child.id}:work`)"
      @click="outline.flip(`${child.id}:work`)"
    >
      <template #end>
        <span class="abele-chat-outline__codes">
          <span>{{ child.tools.length }}</span>
          <span
            :ref="(el) => tip(el, toneOf(child.tools) ? toneLabel[toneOf(child.tools)!] : '')"
            class="abele-chat-outline__dot"
            :class="toneOf(child.tools) && `abele-chat-outline__dot_${toneOf(child.tools)}`"
          />
        </span>
      </template>
      <TreeItem
        v-for="tool in child.tools"
        :key="tool.id"
        class="abele-chat-outline__tool"
        :class="toolTone(tool) && `abele-chat-outline__tool_${toolTone(tool)}`"
        :icon="toolIcon(tool)"
        :text="navigationTitle(tool)"
        :active="tool.id === activeMessageId"
        @click="emit('jump', tool.id, 'params')"
      >
        <template #end>
          <span class="abele-chat-outline__codes">
            <span
              :ref="(el) => tip(el, toolTone(tool) ? toneLabel[toolTone(tool)!] : '')"
              class="abele-chat-outline__dot"
              :class="toolTone(tool) && `abele-chat-outline__dot_${toolTone(tool)}`"
            />
          </span>
        </template>
      </TreeItem>
    </TreeItem>
  </template>
  <ChatOutlineFork
    v-for="fork in forks"
    :key="fork.id"
    :fork="fork"
    :tree="tree"
    :current-ids="currentIds"
    :comments="comments"
    :active-message-id="activeMessageId"
    :ancestors="ancestors"
    @jump="(id, part) => emit('jump', id, part)"
    @discussion="(id) => emit('discussion', id)"
  />
  <ChatOutlineDiscussion
    v-for="comment in turn.discussions"
    :key="comment.id"
    :comment="comment"
    @discussion="(id) => emit('discussion', id)"
  />
</template>

<script setup lang="ts">
// What followed one question: its answers and the agent's work in order, then where the chat
// branches off it and the discussions held on it.
import { computed } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import ChatOutlineFork from './ChatOutlineFork.vue'
import ChatOutlineDiscussion from './ChatOutlineDiscussion.vue'
import { useOutline } from './context'
import { toneLabel, toneOf, toolIcon, toolNames, toolTone, turnChildren } from './outline'
import { navigationTitle, type NavigationTurn } from '@/ai/chatNavigation'
import type { NavigationFork, NavigationTree } from '@/ai/chatNavigationBranches'
import type { MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  turn: NavigationTurn
  forks: NavigationFork[]
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
const children = computed(() => turnChildren(props.turn))
const tip = (el: unknown, text: string) => {
  if (el instanceof HTMLElement) setTooltip(el, text)
}
</script>

<style lang="scss">
// An answer or a call reads in one line under its question; the chat has the rest.
.abele-chat-outline__answer,
.abele-chat-outline__tool,
.abele-chat-outline__work {
  > .tree-item-self .abele-tree-item__text {
    overflow: clip;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.abele-chat-outline__answer > .tree-item-self,
.abele-chat-outline__work > .tree-item-self {
  color: var(--text-muted);
}
.abele-chat-outline__tool_waiting > .tree-item-self .abele-tree-item__glyph {
  color: var(--color-orange);
  opacity: 1;
}
.abele-chat-outline__tool_failed > .tree-item-self .abele-tree-item__glyph {
  color: var(--color-red);
  opacity: 1;
}
</style>
