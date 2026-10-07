<template>
  <ChatNavigationFork
    v-for="fork in orphanForks"
    :key="fork.id"
    :fork="fork"
    :tree="tree"
    :current-ids="currentIds"
    :comments="comments"
    :state="state"
    :ancestors="ancestors"
    @jump="(id, part) => emit('jump', id, part)"
    @discussion="emit('discussion', $event)"
  />
  <template v-for="(turn, i) in turns" :key="turn.message.id">
    <DateDivider
      v-if="
        !(hideFirst && i === 0) &&
        dayOf(turn.message.timestamp) !== dayOf(turns[i - 1]?.message.timestamp)
      "
      :date="dayOf(turn.message.timestamp)"
    />
    <div :data-current="isCurrent(turn)" :class="{ 'is-selected': isCurrent(turn) }">
      <button
        v-if="!(hideFirst && i === 0)"
        type="button"
        data-nav-item
        :data-question="turn.message.id"
        class="abele-chat-navigation__row"
        @click="emit('jump', turn.message.id)"
      >
        <span>{{ navigationTitle(turn.message) }}</span
        ><time>{{ timeOf(turn.message.timestamp) }}</time>
      </button>
      <details
        v-if="turn.answers.length"
        :open="expanded.includes(`${turn.message.id}:answers`)"
        @toggle="toggle($event, `${turn.message.id}:answers`)"
      >
        <summary data-nav-item>Answers · {{ turn.answers.length }}</summary>
        <template v-if="expanded.includes(`${turn.message.id}:answers`)">
          <button
            v-for="answer in turn.answers"
            :key="answer.id"
            type="button"
            data-nav-item
            class="abele-chat-navigation__row"
            @click="emit('jump', answer.id)"
          >
            <span>{{ navigationTitle(answer) }}</span
            ><time>{{ timeOf(answer.timestamp) }}</time>
          </button>
        </template>
      </details>
      <details
        v-if="turn.tools.length"
        :open="expanded.includes(`${turn.message.id}:tools`)"
        @toggle="toggle($event, `${turn.message.id}:tools`)"
      >
        <summary data-nav-item>
          Agent work · {{ turn.tools.length }} tool calls{{
            turn.attention ? ' · Needs attention' : ''
          }}
        </summary>
        <template v-if="expanded.includes(`${turn.message.id}:tools`)">
          <button
            v-for="tool in turn.tools"
            :key="tool.id"
            type="button"
            data-nav-item
            class="abele-chat-navigation__row"
            @click="emit('jump', tool.id, 'params')"
          >
            <span
              >{{ navigationTitle(tool) }} · {{ tool.toolStatus || 'Working'
              }}<template v-if="tool.subAgentRun">
                · Assistant: {{ tool.subAgentRun.agentName }} ({{
                  tool.subAgentRun.status
                }})</template
              ></span
            ><time>{{ timeOf(tool.timestamp) }}</time>
          </button>
        </template>
      </details>
      <!-- Forks remain visible even while the work they are on is folded. -->
      <ChatNavigationFork
        v-for="fork in forks(i)"
        :key="fork.id"
        :fork="fork"
        :tree="tree"
        :current-ids="currentIds"
        :comments="comments"
        :state="state"
        :ancestors="[...ancestors, ...messages.map((m) => m.id)]"
        @jump="(id, part) => emit('jump', id, part)"
        @discussion="(id) => emit('discussion', id)"
      />
      <div v-if="turn.discussions.length" class="abele-chat-navigation__discussions">
        <div class="setting-item-description">Discussions · {{ turn.discussions.length }}</div>
        <ChatNavigationDiscussion
          v-for="comment in turn.discussions"
          :key="comment.id"
          :comment="comment"
          :state="state"
          @discussion="emit('discussion', $event)"
        />
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import DateDivider from './obsidian/DateDivider.vue'
import ChatNavigationDiscussion from './ChatNavigationDiscussion.vue'
import ChatNavigationFork from './ChatNavigationFork.vue'
import {
  buildChatNavigation,
  navigationTitle,
  type NavigationState,
  type NavigationTurn,
} from '@/ai/chatNavigation'
import { navigationFork, type NavigationTree } from '@/ai/chatNavigationBranches'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'
const props = withDefaults(
  defineProps<{
    messages: readonly ChatMessage[]
    comments: readonly MessageComment[]
    tree: NavigationTree
    currentIds: readonly string[]
    state: NavigationState
    activeMessageId?: string
    hideFirst?: boolean
    ancestors?: string[]
  }>(),
  { ancestors: () => [] }
)
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart): void
  (e: 'discussion', id: string): void
}>()
const turns = computed(() => buildChatNavigation(props.messages, props.comments))
const expanded = ref([...props.state.expanded])
const toggle = (event: Event, key: string) => {
  expanded.value = expanded.value.filter((k) => k !== key)
  props.state.expanded = props.state.expanded.filter((k) => k !== key)
  if ((event.target as HTMLDetailsElement).open) {
    expanded.value.push(key)
    props.state.expanded.push(key)
  }
}
const dayOf = (at?: number) => (at === undefined ? '' : dayjs(at).format('YYYY-MM-DD'))
const timeOf = (at: number) => dayjs(at).format('HH:mm')
const isCurrent = (turn: NavigationTurn) =>
  [turn.message, ...turn.answers, ...turn.tools].some((m) => m.id === props.activeMessageId)
const positions = computed(
  () => new Map(props.messages.map((message, index) => [message.id, index]))
)
const forksIn = (messages: readonly ChatMessage[]) =>
  messages
    .map((message) => navigationFork(props.tree, message.id, props.currentIds))
    .filter((fork) => !!fork)
const forks = (index: number) => {
  const start = index === 0 ? 0 : (positions.value.get(turns.value[index].message.id) ?? 0)
  const next = turns.value[index + 1]
  const end = next ? positions.value.get(next.message.id) : props.messages.length
  // A successful standalone result is hidden in the feed, but can still own a fork.
  return forksIn(props.messages.slice(start, end))
}
const orphanForks = computed(() => (turns.value.length ? [] : forksIn(props.messages)))
</script>
