<template>
  <ChatOutlineFork
    v-for="fork in orphanForks"
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
  <template v-for="(turn, i) in turns" :key="turn.message.id">
    <div v-if="dayStarts(i)" class="abele-chat-outline__day">
      {{ dayLabel(turn.message.timestamp) }}
    </div>
    <!-- A question as the outline shows a heading: the row jumps to it, the arrow folds what
         followed it. Its codes say what is under it without opening it. -->
    <TreeItem
      v-if="!(hideFirst && i === 0)"
      class="abele-chat-outline__turn"
      :text="navigationTitle(turn.message)"
      :active="isCurrent(turn)"
      :collapsible="hasBody(turn, i)"
      :collapsed="!outline.isOpen(`${turn.message.id}:turn`)"
      fold-apart
      :data-question="turn.message.id"
      @click="emit('jump', turn.message.id)"
      @toggle="outline.flip(`${turn.message.id}:turn`)"
    >
      <template #end>
        <span class="abele-chat-outline__codes">
          <!-- Each kind of code keeps its place in every row of the list, empty where a question
               has none, so the numbers stand in columns. -->
          <span
            v-if="kinds.fork"
            :ref="(el) => tip(el, forkCount(i) ? `${forkCount(i)} branches go on from here` : '')"
            class="abele-chat-outline__code"
            ><template v-if="forkCount(i)"
              ><Icon icon="split" size="xs" :interactive="false" /><span
                class="abele-chat-outline__num"
                >{{ forkCount(i) }}</span
              ></template
            ></span
          >
          <span
            v-if="kinds.discussions"
            :ref="
              (el) =>
                tip(
                  el,
                  turn.discussions.length ? plural(turn.discussions.length, 'discussion') : ''
                )
            "
            class="abele-chat-outline__code"
            ><template v-if="turn.discussions.length"
              ><Icon icon="messages-square" size="xs" :interactive="false" /><span
                class="abele-chat-outline__num"
                >{{ turn.discussions.length }}</span
              ></template
            ></span
          >
          <span
            v-if="kinds.work"
            :ref="(el) => tip(el, turn.tools.length ? plural(turn.tools.length, 'tool call') : '')"
            class="abele-chat-outline__code abele-chat-outline__code_work"
            ><template v-if="turn.tools.length"
              ><Icon icon="wrench" size="xs" :interactive="false" />{{
                turn.tools.length
              }}</template
            ></span
          >
          <time class="abele-chat-outline__time">{{ timeOf(turn.message.timestamp) }}</time>
          <span
            :ref="(el) => tip(el, toneOf(turn.tools) ? toneLabel[toneOf(turn.tools)!] : '')"
            class="abele-chat-outline__dot"
            :class="toneOf(turn.tools) && `abele-chat-outline__dot_${toneOf(turn.tools)}`"
          />
        </span>
      </template>
      <ChatOutlineTurnBody
        :turn="turn"
        :forks="forks(i)"
        :tree="tree"
        :current-ids="currentIds"
        :comments="comments"
        :active-message-id="activeMessageId"
        :ancestors="[...ancestors, ...messages.map((m) => m.id)]"
        @jump="(id, part) => emit('jump', id, part)"
        @discussion="(id) => emit('discussion', id)"
      />
    </TreeItem>
    <!-- A branch's first question is the branch's own row above; what followed it comes here. -->
    <ChatOutlineTurnBody
      v-else
      :turn="turn"
      :forks="forks(i)"
      :tree="tree"
      :current-ids="currentIds"
      :comments="comments"
      :active-message-id="activeMessageId"
      :ancestors="[...ancestors, ...messages.map((m) => m.id)]"
      @jump="(id, part) => emit('jump', id, part)"
      @discussion="(id) => emit('discussion', id)"
    />
  </template>
</template>

<script setup lang="ts">
// The questions of one stretch of a chat, by day, each with what followed it folded under it.
// Used for the conversation as it is now and again, inside a branch row, for another branch.
import { computed } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import ChatOutlineTurnBody from './ChatOutlineTurnBody.vue'
import ChatOutlineFork from './ChatOutlineFork.vue'
import { useOutline } from './context'
import { dayKey, dayLabel, timeOf, toneLabel, toneOf } from './outline'
import { plural } from '../nodeWork/codes'
import { buildChatNavigation, navigationTitle, type NavigationTurn } from '@/ai/chatNavigation'
import { navigationFork, type NavigationTree } from '@/ai/chatNavigationBranches'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = withDefaults(
  defineProps<{
    messages: readonly ChatMessage[]
    comments: readonly MessageComment[]
    tree: NavigationTree
    currentIds: readonly string[]
    activeMessageId?: string
    /** The stretch starts with a branch's first message, which its row already shows. */
    hideFirst?: boolean
    ancestors?: string[]
  }>(),
  { activeMessageId: undefined, hideFirst: false, ancestors: () => [] }
)
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart): void
  (e: 'discussion', id: string): void
}>()

const outline = useOutline()
const turns = computed(() => buildChatNavigation(props.messages, props.comments))
const dayStarts = (i: number) =>
  !(props.hideFirst && i === 0) &&
  dayKey(turns.value[i].message.timestamp) !==
    (i ? dayKey(turns.value[i - 1].message.timestamp) : '')
const isCurrent = (turn: NavigationTurn) =>
  [turn.message, ...turn.answers, ...turn.tools].some((m) => m.id === props.activeMessageId)

const positions = computed(() => new Map(props.messages.map((m, i) => [m.id, i])))
const forksIn = (messages: readonly ChatMessage[]) =>
  messages
    .map((message) => navigationFork(props.tree, message.id, props.currentIds))
    .filter((fork) => !!fork)
// Every fork from the question to the next one: a hidden successful result can own one too.
const forks = (i: number) => {
  const start = i === 0 ? 0 : (positions.value.get(turns.value[i].message.id) ?? 0)
  const next = turns.value[i + 1]
  const end = next ? positions.value.get(next.message.id) : props.messages.length
  return forksIn(props.messages.slice(start, end))
}
const forkCount = (i: number) => forks(i).reduce((n, f) => n + f.choices.length, 0)
const orphanForks = computed(() => (turns.value.length ? [] : forksIn(props.messages)))
// Which codes any question of this list has: those get a column, the others none.
const kinds = computed(() => ({
  fork: turns.value.some((_, i) => forkCount(i) > 0),
  discussions: turns.value.some((t) => t.discussions.length > 0),
  work: turns.value.some((t) => t.tools.length > 0),
}))
const hasBody = (turn: NavigationTurn, i: number) =>
  !!(turn.answers.length || turn.tools.length || turn.discussions.length || forks(i).length)

const tip = (el: unknown, text: string) => {
  if (el instanceof HTMLElement) setTooltip(el, text)
}
</script>

<style lang="scss">
// A day over its questions, as small as the outline's own muted labels, set in to the text.
.abele-chat-outline__day {
  padding: var(--size-4-3) var(--size-4-2) var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
}
.abele-chat-outline__day:first-child {
  padding-block-start: var(--size-4-1);
}
// A question has no glyph, as a heading in the outline has none: its text starts at the row's edge.
.abele-chat-outline__turn > .tree-item-self .abele-tree-item__glyph {
  display: none;
}
// A question reads in two lines at most; the rest is in the chat.
.abele-chat-outline__turn > .tree-item-self .abele-tree-item__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.abele-chat-outline__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-chat-outline__code {
  display: inline-flex;
  justify-content: flex-start;
  min-width: calc(var(--icon-xs) + var(--size-2-1) + 2ch);
  align-items: center;
  gap: var(--size-2-1);

  .abele-obsidian-icon {
    padding: 0;
  }
}
// The dot always holds its place, so the times of every row stand in one column.
.abele-chat-outline__dot {
  width: var(--size-2-3);
  height: var(--size-2-3);
  border-radius: 50%;
}
.abele-chat-outline__dot_waiting {
  background-color: var(--color-orange);
}
.abele-chat-outline__dot_failed {
  background-color: var(--color-red);
}
.abele-chat-outline__time {
  min-width: 5ch;
  color: var(--text-muted);
  text-align: end;
}
</style>
<style lang="scss">
// Narrow, as in a side panel, the question keeps the room: its codes stay on its first line but
// shrink to what tells most, a branch and a discussion by their glyph alone, the time and the dot.
// The numbers and the agent's work are one click away, under the arrow.
.abele-chat-outline {
  container-type: inline-size;
}
@container (max-width: 480px) {
  .abele-chat-outline__turn > .tree-item-self .abele-chat-outline__num,
  .abele-chat-outline__turn > .tree-item-self .abele-chat-outline__code_work {
    display: none;
  }
  .abele-chat-outline__turn > .tree-item-self .abele-chat-outline__code {
    min-width: var(--icon-xs);
  }
  .abele-chat-outline__turn > .tree-item-self .abele-chat-outline__codes {
    gap: var(--size-4-1);
  }
}
</style>
