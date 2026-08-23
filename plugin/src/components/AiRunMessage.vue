<template>
  <div class="abele-run-msg" :class="`abele-run-msg_${message.role}`">
    <div class="abele-run-msg__icon">
      <Icon :icon="icon" no-hover />
    </div>

    <div class="abele-run-msg__body">
      <template v-if="message.role === 'tool-call'">
        <div class="abele-run-msg__tool">
          <span class="abele-run-msg__tool-name">{{ message.toolName }}</span>
          <span v-if="params" class="abele-run-msg__tool-params">{{ params }}</span>
        </div>

        <!-- A run that delegated further opens the same way its own branch did. -->
        <AiSubAgentRun
          v-if="message.subAgentRun && depth < MAX_NESTING"
          :run="message.subAgentRun"
          :depth="depth + 1"
        />
        <div v-else-if="message.subAgentRun" class="abele-run-msg__note">
          Nested {{ message.subAgentRun.agentName }} run — open it in its own tab to go deeper.
        </div>

        <details v-else-if="message.toolResult" class="abele-run-msg__result">
          <summary>Result</summary>
          <pre>{{ message.toolResult }}</pre>
        </details>
      </template>

      <Markdown v-else-if="message.content" :text="message.content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import AiSubAgentRun from './AiSubAgentRun.vue'
import type { ChatMessage } from '@/ai/types'

/**
 * How deep nesting renders inline before it becomes a link.
 *
 * Delegation can nest as far as the agents allow, and rendering every level inside one message
 * turns a sidebar into a wall of indentation. Past this the reader is sent to the run's own tab.
 */
const MAX_NESTING = 2

const props = withDefaults(defineProps<{ message: ChatMessage; depth?: number }>(), { depth: 0 })

const icon = computed(() => {
  switch (props.message.role) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'bot'
    case 'tool-call':
      return 'wrench'
    default:
      return 'info'
  }
})

/** A short, readable rendering of the tool arguments — the full call is in the run file. */
const params = computed(() => {
  const args = props.message.toolParams
  if (!args) return ''
  const text = Object.entries(args)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
})
</script>

<style lang="scss">
.abele-run-msg {
  display: flex;
  gap: var(--size-2-2);
  padding: var(--size-2-2) 0;
  min-width: 0;
}

.abele-run-msg__icon {
  flex: 0 0 auto;
  color: var(--text-faint);
}

.abele-run-msg__body {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--font-small);
}

.abele-run-msg_user .abele-run-msg__body {
  color: var(--text-muted);
}

.abele-run-msg__tool {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  align-items: baseline;
}

.abele-run-msg__tool-name {
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
}

.abele-run-msg__tool-params {
  color: var(--text-faint);
  font-size: var(--font-smallest);
  overflow-wrap: anywhere;
}

.abele-run-msg__result pre {
  max-height: 16em;
  overflow: auto;
  font-size: var(--font-smallest);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.abele-run-msg__note {
  color: var(--text-muted);
  font-size: var(--font-smallest);
}
</style>
