<template>
  <div class="abele-chat-msg" :class="`abele-chat-msg_${message.role}`">
    <!-- Icon — clickable to expand raw details -->
    <div class="abele-chat-msg__icon" @click="expanded = !expanded">
      <Icon v-if="message.role === 'user'" icon="user" />
      <Icon v-else-if="message.role === 'assistant'" icon="bot" />
      <Icon v-else-if="message.role === 'tool-call'" icon="terminal" />
      <Icon v-else-if="message.role === 'tool-result'" icon="check" />
      <Icon v-else icon="info" />
    </div>

    <div class="abele-chat-msg__body">
      <!-- Thinking (collapsible) -->
      <details v-if="message.thinking" class="abele-chat-msg__thinking">
        <summary>Thinking</summary>
        <Markdown :text="message.thinking" />
      </details>

      <!-- Tool call — compact one-liner -->
      <template v-if="message.role === 'tool-call'">
        <span class="abele-chat-msg__tool-line">
          <code>{{ message.toolName }}</code>
          <span class="abele-chat-msg__tool-summary">{{ toolSummary }}</span>
        </span>
      </template>

      <!-- Tool result — only show errors, hide success -->
      <template v-else-if="message.role === 'tool-result'">
        <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-error">
          {{ message.content }}
        </span>
        <!-- Success: show nothing (implied by no error) -->
      </template>

      <!-- User / Assistant — markdown -->
      <Markdown v-else-if="message.content" :text="message.content" />

      <!-- Expanded raw details -->
      <pre v-if="expanded" class="abele-chat-msg__raw">{{ rawDetails }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import type { ChatMessage } from '@/ai/types'

const props = defineProps<{
  message: ChatMessage
}>()

const expanded = ref(false)

const toolSummary = computed(() => {
  const p = props.message.toolParams
  if (!p) return ''
  // Build a compact summary from params
  if (p.path) return String(p.path)
  if (p.from && p.to) return `${p.from} → ${p.to}`
  if (p.query) return String(p.query)
  if (p.name) return String(p.name)
  return ''
})

const rawDetails = computed(() => {
  const m = props.message
  const obj: Record<string, unknown> = { role: m.role, content: m.content }
  if (m.toolName) obj.tool = m.toolName
  if (m.toolParams) obj.params = m.toolParams
  if (m.toolStatus) obj.status = m.toolStatus
  if (m.thinking) obj.thinking = m.thinking
  return JSON.stringify(obj, null, 2)
})
</script>

<style lang="scss">
.abele-chat-msg {
  display: flex;
  gap: var(--size-4-2);
  padding: var(--size-4-2) 0;

  &_user {
    .abele-chat-msg__body {
      background-color: var(--background-secondary);
      border-radius: var(--radius-s);
      padding: var(--size-4-2) var(--size-4-3);
    }
  }

  &_assistant {
    .abele-chat-msg__body {
      padding: var(--size-4-1) 0;
    }
  }

  &_tool-call,
  &_tool-result {
    padding: 2px 0;
  }

  &_system {
    opacity: 0.7;
    font-style: italic;
  }

  // Hide empty tool results (success)
  &_tool-result:not(:has(.abele-chat-msg__tool-error)) {
    display: none;
  }
}

.abele-chat-msg__icon {
  flex-shrink: 0;
  width: 18px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4px;
  color: var(--text-faint);
  cursor: pointer;

  .abele-obsidian-icon {
    padding: 0;
    height: auto;

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &:hover {
    color: var(--text-muted);
  }
}

.abele-chat-msg__body {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;

  p:first-child {
    margin-top: 0;
  }
  p:last-child {
    margin-bottom: 0;
  }
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin-top: var(--size-4-2);
  }
  h1:first-child,
  h2:first-child,
  h3:first-child {
    margin-top: 0;
  }

  pre {
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
    margin: var(--size-4-2) 0;

    code {
      display: block;
      padding: var(--size-4-2) var(--size-4-3);
      background-color: var(--background-secondary);
      border-radius: var(--radius-s);
      font-size: var(--font-small);
      line-height: 1.5;
    }
  }

  // Inline code
  :not(pre) > code {
    padding: 1px 4px;
    background-color: var(--background-secondary);
    border-radius: var(--radius-s);
    font-size: 0.9em;
  }
}

.abele-chat-msg__thinking {
  margin-bottom: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-1) var(--size-4-2);
  font-size: var(--font-small);

  summary {
    cursor: pointer;
    color: var(--text-muted);
    font-style: italic;
  }
}

.abele-chat-msg__tool-line {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  font-size: var(--font-small);
  color: var(--text-muted);

  code {
    color: var(--text-accent);
    font-size: var(--font-smaller);
  }
}

.abele-chat-msg__tool-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-msg__tool-error {
  font-size: var(--font-small);
  color: var(--text-error);
}

.abele-chat-msg__raw {
  font-size: var(--font-smaller);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  margin-top: var(--size-4-1);
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
