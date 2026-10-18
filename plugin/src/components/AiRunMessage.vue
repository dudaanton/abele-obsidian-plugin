<template>
  <div class="abele-run-msg" :class="`abele-run-msg_${message.role}`">
    <div v-if="message.role !== 'tool-call'" class="abele-run-msg__icon">
      <Icon :icon="icon" no-hover />
    </div>

    <div class="abele-run-msg__body">
      <template v-if="message.role === 'tool-call'">
        <!-- A call as the chat shows one: a quiet line with what it was given, opening to what
             came back. -->
        <TreeItem
          v-if="!message.subAgentRun"
          class="abele-chat-run abele-run-msg__tool"
          :icon="KIND_ICON[toolKind(message.toolName)]"
          :text="message.toolName ?? t('streamB.tool.7c9bbe')"
          :note="params"
          :collapsible="!!message.toolResult"
          :collapsed="!resultOpen"
          :plain="!message.toolResult"
          @click="resultOpen = !resultOpen"
        >
          <pre class="abele-run-msg__result">{{ message.toolResult }}</pre>
        </TreeItem>

        <!-- A run that delegated further opens the same way its own branch did. -->
        <AiSubAgentRun
          v-else-if="depth < MAX_NESTING"
          :run="message.subAgentRun"
          :depth="depth + 1"
        />
        <p v-else class="abele-run-msg__note">
          {{ t('streamBMeta.ea7b694e1c', { p0: String(message.subAgentRun.agentName) }) }}
        </p>
      </template>

      <Markdown v-else-if="message.content" :text="message.content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Icon from './obsidian/Icon.vue'
import TreeItem from './obsidian/TreeItem.vue'
import { KIND_ICON, toolKind } from '@/ai/toolRuns'
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
const resultOpen = ref(false)

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

.abele-run-msg__tool .abele-tree-item__inner {
  min-width: 0;
}
.abele-run-msg__tool .abele-tree-item__text {
  flex: none;
  white-space: nowrap;
}
.abele-run-msg__tool .abele-tree-item__note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-run-msg__result {
  margin: var(--size-2-1) 0;
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
