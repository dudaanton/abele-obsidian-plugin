<template>
  <!-- The agent's calls in a row, told in one line: what kind of work, in words, how many calls,
       and a dot when something in it waits for you, was refused or failed. The row opens the calls
       one by one, each with what it was given and what came back. -->
  <TreeItem
    class="abele-chat-run"
    :class="`abele-chat-run_${state}`"
    :icon="icon"
    :text="summary"
    collapsible
    :collapsed="!open"
    :data-message-id="id"
    :data-run-ids="calls.map((c) => c.id).join(' ')"
    @click="emit('update:open', !open)"
  >
    <template #end>
      <span class="abele-chat-run__codes">
        <span
          ref="dot"
          class="abele-chat-run__dot"
          :class="state !== 'done' && `abele-chat-run__dot_${state}`"
          :role="state !== 'done' ? 'img' : undefined"
          :aria-label="state !== 'done' ? STATE_LABEL[state] : undefined"
        />
      </span>
    </template>
    <div class="abele-chat-run__calls">
      <slot />
    </div>
  </TreeItem>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from './obsidian/TreeItem.vue'
import type { ChatMessage } from '@/ai/types'
import { KIND_ICON, runKind, runState, runSummary, type RunState } from '@/ai/toolRuns'

const props = defineProps<{ id: string; calls: ChatMessage[]; open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', open: boolean): void }>()

const STATE_LABEL: Record<RunState, string> = {
  running: 'The agent is working on it',
  waiting: 'Waiting for your approval',
  failed: 'Refused or failed',
  done: '',
}

const state = computed(() => runState(props.calls))
const icon = computed(() =>
  state.value === 'running' ? 'loader' : KIND_ICON[runKind(props.calls)]
)
const summary = computed(() => runSummary(props.calls))

const dot = ref<HTMLElement>()
watchEffect(() => dot.value && setTooltip(dot.value, STATE_LABEL[state.value]))
</script>

<style lang="scss">
// A run sits in the chat as a quiet line, level with the messages' text. The line is as wide
// as its words, so on a wide pane its state dot and its hover stay beside what they belong to;
// the counts are in the words already («Searched 3 · Read»).
.abele-chat-run > .tree-item-self {
  width: fit-content;
  max-width: 100%;
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .tree-item-flair-outer {
    margin-inline-start: var(--size-4-2);
  }
}
.abele-chat-run_running > .tree-item-self .abele-tree-item__glyph svg {
  animation: abele-chat-run-spin 1.2s linear infinite;
}
@keyframes abele-chat-run-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .abele-chat-run_running > .tree-item-self .abele-tree-item__glyph svg {
    animation: none;
  }
}
.abele-chat-run__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
// The dot keeps its place in every run, empty when all is well, so runs line up.
.abele-chat-run__dot {
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;

  &_running {
    background-color: var(--interactive-accent);
  }
  &_waiting {
    background-color: var(--color-orange);
  }
  &_failed {
    background-color: var(--color-red);
  }
}
/* A call nests as a tree's child does: its glyph under the run's words, the same size as the
   run's glyph and as close to its own words. The guide's offset and the run's toggle are
   Obsidian's; what is added is the run's glyph and the gap after it. */
.abele-chat-run__calls {
  padding-block: var(--size-2-1);
  padding-inline-start: calc(var(--icon-xs) + var(--size-4-1) + var(--size-4-2));

  > .abele-chat-msg_tool-call {
    column-gap: var(--size-4-1);
  }

  .abele-chat-msg__icon .abele-obsidian-icon {
    padding: 0;
    --icon-size: var(--icon-xs);
  }
}

/* A finger's box stays as tall, but no wider than the glyph, or it would push the words away. */
body.is-mobile .abele-chat-run__calls button.abele-chat-msg__icon {
  min-width: 0;
}
</style>
