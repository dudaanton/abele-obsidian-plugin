<template>
  <ObsidianModal title="Navigation" size="tall" @close="emit('close')">
    <div ref="root" class="abele-chat-navigation" tabindex="-1" @keydown="onKey">
      <Search v-model="query" placeholder="Find in the current branch…" />
      <div class="abele-chat-navigation__actions">
        <button type="button" :disabled="!sent.length" @click="emit('start')">To start</button>
        <button type="button" :disabled="!sent.length" @click="emit('latest')">To latest</button>
        <button type="button" :disabled="!canGoBack" @click="emit('back')">Back to place</button>
      </div>
      <div ref="list" class="abele-chat-navigation__list" @scroll="rememberScroll">
        <template v-if="query.trim()">
          <div v-if="!hits.length" class="setting-item-description">
            No matches in the current branch
          </div>
          <button
            v-for="hit in hits"
            :key="`${hit.messageId}:${hit.part}`"
            type="button"
            data-nav-item
            class="abele-chat-navigation__row"
            @click="emit('jump', hit.messageId, hit.part, query)"
          >
            <span
              >{{ hit.snippet.before
              }}<span class="search-result-file-matched-text">{{ hit.snippet.match }}</span
              >{{ hit.snippet.after }}</span
            >
            <time>{{ timeOf(hit.timestamp) }}</time>
          </button>
        </template>
        <template v-else>
          <div v-if="!turns.length" class="setting-item-description">No sent messages</div>
          <template v-for="(turn, i) in turns" :key="turn.message.id">
            <DateDivider
              v-if="dayOf(turn.message.timestamp) !== dayOf(turns[i - 1]?.message.timestamp)"
              :date="dayOf(turn.message.timestamp)"
            />
            <div :data-current="isCurrent(turn)" :class="{ 'is-selected': isCurrent(turn) }">
              <button
                type="button"
                data-nav-item
                :data-question="turn.message.id"
                class="abele-chat-navigation__row"
                @click="emit('jump', turn.message.id)"
              >
                <span>{{ navigationTitle(turn.message) }}</span>
                <time>{{ timeOf(turn.message.timestamp) }}</time>
              </button>
              <details
                v-if="turn.answers.length"
                :open="isExpanded(turn.message.id, 'answers')"
                @toggle="toggle($event, turn.message.id, 'answers')"
              >
                <summary data-nav-item>Answers · {{ turn.answers.length }}</summary>
                <template v-if="isExpanded(turn.message.id, 'answers')">
                  <button
                    v-for="answer in turn.answers"
                    :key="answer.id"
                    type="button"
                    data-nav-item
                    class="abele-chat-navigation__row"
                    @click="emit('jump', answer.id)"
                  >
                    <span>{{ navigationTitle(answer) }}</span>
                    <time>{{ timeOf(answer.timestamp) }}</time>
                  </button>
                </template>
              </details>
              <details
                v-if="turn.tools.length"
                :open="isExpanded(turn.message.id, 'tools')"
                @toggle="toggle($event, turn.message.id, 'tools')"
              >
                <summary data-nav-item>
                  Agent work · {{ turn.tools.length }} tool calls{{
                    turn.attention ? ' · Needs attention' : ''
                  }}
                </summary>
                <template v-if="isExpanded(turn.message.id, 'tools')">
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
                    >
                    <time>{{ timeOf(tool.timestamp) }}</time>
                  </button>
                </template>
              </details>
              <div v-if="turn.discussions.length" class="abele-chat-navigation__discussions">
                <div class="setting-item-description">
                  Discussions · {{ turn.discussions.length }}
                </div>
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
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import Search from './obsidian/Search.vue'
import DateDivider from './obsidian/DateDivider.vue'
import ChatNavigationDiscussion from './ChatNavigationDiscussion.vue'
import {
  buildChatNavigation,
  navigationTitle,
  searchChatNavigation,
  type NavigationState,
  type NavigationTurn,
} from '@/ai/chatNavigation'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  messages: readonly ChatMessage[]
  comments: readonly MessageComment[]
  state: NavigationState
  activeMessageId?: string
  canGoBack?: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'start'): void
  (e: 'latest'): void
  (e: 'back'): void
  (e: 'jump', id: string, part?: FindPart, query?: string): void
  (e: 'discussion', id: string): void
}>()
const root = ref<HTMLElement>()
const list = ref<HTMLElement>()
const query = ref('')
const sent = computed(() => props.messages.filter((m) => !m.draft))
const turns = computed(() => buildChatNavigation(props.messages, props.comments))
const hits = computed(() => searchChatNavigation(props.messages, query.value))
const expanded = ref([...props.state.expanded])
const isExpanded = (id: string, kind: string) => expanded.value.includes(`${id}:${kind}`)
const toggle = (event: Event, id: string, kind: string) => {
  const key = `${id}:${kind}`
  expanded.value = expanded.value.filter((k) => k !== key)
  props.state.expanded = props.state.expanded.filter((k) => k !== key)
  if ((event.target as HTMLDetailsElement).open) {
    expanded.value.push(key)
    props.state.expanded.push(key)
  }
}
const rememberScroll = () => {
  if (list.value) props.state.scrollTop = list.value.scrollTop
}
const dayOf = (at?: number) => (at === undefined ? '' : dayjs(at).format('YYYY-MM-DD'))
const timeOf = (at: number) => dayjs(at).format('HH:mm')
const isCurrent = (turn: NavigationTurn) =>
  [turn.message, ...turn.answers, ...turn.tools].some((m) => m.id === props.activeMessageId)

onMounted(async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = props.state.scrollTop
  // A dialog is not a request to type. Focusing its non-input root avoids opening a phone keyboard.
  root.value?.focus({ preventScroll: true })
})
const onKey = (event: KeyboardEvent) => {
  const el = root.value
  if (!el) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  const target = event.target as HTMLElement
  if (event.key === 'Enter' && target.matches('[data-nav-item]')) {
    event.preventDefault()
    target.click()
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (!target.matches('summary')) return
    event.preventDefault()
    const details = target.parentElement as HTMLDetailsElement
    details.open = event.key === 'ArrowRight'
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...el.querySelectorAll<HTMLElement>('[data-nav-item]:not(:disabled)')].filter(
    (item) => {
      for (
        let parent = item.parentElement;
        parent && parent !== el;
        parent = parent.parentElement
      ) {
        if (
          parent.tagName === 'DETAILS' &&
          !(parent as HTMLDetailsElement).open &&
          parent.firstElementChild !== item
        )
          return false
      }
      return true
    }
  )
  if (!items.length) return
  event.preventDefault()
  const at = items.indexOf(target)
  const next =
    at < 0
      ? event.key === 'ArrowDown'
        ? 0
        : items.length - 1
      : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
  items[next].focus()
}
</script>

<style lang="scss">
.abele-chat-navigation {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  gap: var(--size-4-2);
}
.abele-chat-navigation__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}
.abele-chat-navigation__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-2);
  margin: calc(-1 * var(--size-4-2));
}
.abele-chat-navigation__row {
  display: flex;
  width: 100%;
  height: auto;
  min-width: 0;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--size-4-2);
  white-space: normal;
  text-align: start;
  margin-block: var(--size-4-1);
}
.abele-chat-navigation__row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-chat-navigation time {
  flex-shrink: 0;
  color: var(--text-muted);
}
.abele-chat-navigation summary {
  padding: var(--size-4-1);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.abele-chat-navigation__list .is-selected {
  background: var(--background-modifier-hover);
}
.abele-chat-navigation__discussions {
  padding: var(--size-4-2);
}
.abele-chat-navigation__discussion > button {
  height: auto;
  white-space: normal;
  text-align: start;
  width: 100%;
  overflow-wrap: anywhere;
  margin-block: var(--size-4-1);
}
</style>
