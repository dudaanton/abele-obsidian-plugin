<template>
  <details :data-fork-id="fork.id" :open="expanded.includes(key)" @toggle="toggle($event, key)">
    <summary data-nav-item>
      {{ fork.parentId ? 'Continuations' : 'Conversation starts' }} · {{ fork.choices.length }}
    </summary>
    <template v-if="expanded.includes(key)">
      <div
        v-for="choice in fork.choices"
        :key="choice.message.id"
        :data-continuation="choice.message.id"
      >
        <button
          type="button"
          data-nav-item
          class="abele-chat-navigation__row"
          @click="emit('jump', choice.message.id)"
        >
          <span
            >{{ navigationTitle(choice.message)
            }}<template v-if="choice.selected"> · Selected</template></span
          >
          <time>{{ dayjs(choice.message.timestamp).format('HH:mm') }}</time>
        </button>
        <div
          v-if="ancestors.includes(choice.message.id) && !choice.selected"
          class="setting-item-description"
        >
          Circular continuation link
        </div>
        <!-- The selected path is already listed below the fork; do not duplicate it here. -->
        <details
          v-else-if="!choice.selected && hasContents(choice.message.id)"
          :open="expanded.includes(`continuation:${choice.message.id}`)"
          @toggle="toggle($event, `continuation:${choice.message.id}`)"
        >
          <summary data-nav-item>Show continuation</summary>
          <ChatNavigationRows
            v-if="expanded.includes(`continuation:${choice.message.id}`)"
            :messages="navigationSegment(tree, choice.message.id)"
            :comments="comments"
            :tree="tree"
            :current-ids="currentIds"
            :state="state"
            :ancestors="ancestors"
            hide-first
            @jump="(id, part) => emit('jump', id, part)"
            @discussion="emit('discussion', $event)"
          />
        </details>
      </div>
    </template>
  </details>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import dayjs from 'dayjs'
import ChatNavigationRows from './ChatNavigationRows.vue'
import { navigationTitle, type NavigationState } from '@/ai/chatNavigation'
import {
  navigationSegment,
  type NavigationFork,
  type NavigationTree,
} from '@/ai/chatNavigationBranches'
import type { MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'
const props = withDefaults(
  defineProps<{
    fork: NavigationFork
    tree: NavigationTree
    currentIds: readonly string[]
    comments: readonly MessageComment[]
    state: NavigationState
    ancestors?: string[]
  }>(),
  { ancestors: () => [] }
)
const emit = defineEmits<{
  (e: 'jump', id: string, part?: FindPart): void
  (e: 'discussion', id: string): void
}>()
const key = `fork:${props.fork.id}`
const expanded = ref([...props.state.expanded])
const hasContents = (id: string) =>
  (props.tree.children.get(id)?.length ?? 0) > 0 ||
  props.comments.some((comment) => comment.message === id)
const toggle = (event: Event, item: string) => {
  // Native toggle bubbles from nested details in some hosts; only its own element owns it.
  if (event.target !== event.currentTarget) return
  expanded.value = expanded.value.filter((k) => k !== item)
  props.state.expanded = props.state.expanded.filter((k) => k !== item)
  if ((event.target as HTMLDetailsElement).open) {
    expanded.value.push(item)
    props.state.expanded.push(item)
  }
}
</script>
