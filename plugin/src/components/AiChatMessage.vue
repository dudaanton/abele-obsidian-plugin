<template>
  <div class="abele-chat-msg" :class="`abele-chat-msg_${message.role}`">
    <!-- Icon — clickable to expand details -->
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

      <!-- Tool call — compact one-liner + inline diff -->
      <template v-if="message.role === 'tool-call'">
        <span class="abele-chat-msg__tool-line">
          <code>{{ message.toolName }}</code>
          <span class="abele-chat-msg__tool-summary">{{ toolSummary }}</span>
          <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-err-badge"
            >failed</span
          >
        </span>
        <pre
          v-if="message.toolDiff && !message.toolDiff.old"
          class="abele-chat-msg__new-file"
        ><code>{{ message.toolDiff.new }}</code></pre>
        <Diff
          v-else-if="message.toolDiff"
          :text-left="message.toolDiff.old"
          :text-right="message.toolDiff.new"
          class="abele-chat-msg__diff"
        />
      </template>

      <!-- Tool result — only show errors -->
      <template v-else-if="message.role === 'tool-result'">
        <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-error">
          {{ message.content }}
        </span>
      </template>

      <!-- System / compact divider -->
      <template v-else-if="message.role === 'system'">
        <span class="abele-chat-msg__compact-label">── Conversation compacted ──</span>
        <div v-if="expanded" class="abele-chat-msg__compact-summary">
          <Markdown :text="message.content" />
        </div>
      </template>

      <!-- User / Assistant — markdown -->
      <Markdown v-else-if="message.content" :text="message.content" />

      <!-- Expanded debug info — toggled by icon click -->
      <div v-if="expanded" class="abele-chat-msg__details">
        <div class="abele-chat-msg__detail-time">{{ formatTime(message.timestamp) }}</div>
        <div v-if="message.usage" class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__detail-label">Tokens</span>
          <span
            >in: {{ message.usage.input }} / out: {{ message.usage.output }} / total:
            {{ message.usage.total }}</span
          >
        </div>
        <div v-if="message.toolParams" class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__detail-label">Params</span>
          <pre>{{ JSON.stringify(message.toolParams, null, 2) }}</pre>
        </div>
        <div v-if="message.toolResult" class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__detail-label">Result</span>
          <pre>{{ truncate(message.toolResult, TOOL_RESULT_MAX_LENGTH) }}</pre>
        </div>
      </div>
    </div>

    <!-- Timestamp — always visible, right-aligned -->
    <span
      v-if="message.role === 'user' || message.role === 'assistant'"
      class="abele-chat-msg__time"
    >
      {{ shortTime(message.timestamp) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import Diff from './Diff.vue'
import type { ChatMessage } from '@/ai/types'

const props = defineProps<{
  message: ChatMessage
}>()

const expanded = ref(false)

const toolSummary = computed(() => {
  const p = props.message.toolParams
  if (!p) return ''
  if (p.path) return String(p.path)
  if (p.from && p.to) return `${p.from} → ${p.to}`
  if (p.query) return String(p.query)
  if (p.name) return String(p.name)
  return ''
})

const TOOL_RESULT_MAX_LENGTH = 1000

const formatTime = (ts: number) => dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
const shortTime = (ts: number) => dayjs(ts).format('HH:mm')
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)
</script>

<style lang="scss">
.abele-chat-msg {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2) 0;
  line-height: 1.5;

  &_user .abele-chat-msg__body {
    background-color: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: var(--size-4-1) var(--size-4-3);
  }

  &_tool-call,
  &_tool-result {
    padding: 2px 0;
  }

  &_system {
    color: var(--text-faint);

    .abele-chat-msg__compact-label {
      text-align: center;
      display: block;
    }
  }

  &_tool-result:not(:has(.abele-chat-msg__tool-error)) {
    display: none;
  }
}

.abele-chat-msg__icon {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--text-faint);
  cursor: pointer;

  &:hover {
    color: var(--text-muted);
  }
}

// Per-type icon vertical offset
.abele-chat-msg_user > .abele-chat-msg__icon {
  margin-top: 7px;
}
.abele-chat-msg_assistant > .abele-chat-msg__icon {
  margin-top: 4px;
}

.abele-chat-msg__time {
  flex-shrink: 0;
  font-size: var(--font-smaller);
  color: var(--text-faint);
  margin-top: 3px;
  white-space: nowrap;
}

.abele-chat-msg_user > .abele-chat-msg__time {
  margin-top: 7px;
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

  :not(pre) > code {
    padding: 1px 4px;
    background-color: var(--background-secondary);
    border-radius: var(--radius-s);
    font-size: 0.9em;
  }
}

.abele-chat-msg__thinking {
  margin-top: 0;
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

.abele-chat-msg__compact-label {
  color: var(--text-faint);
  font-size: var(--font-small);
}

.abele-chat-msg__compact-summary {
  font-size: var(--font-small);
  color: var(--text-muted);
  border-top: 1px solid var(--background-modifier-border);
  padding-top: var(--size-4-1);
  margin-top: var(--size-4-1);
}

.abele-chat-msg__tool-line {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  font-size: var(--font-small);
  color: var(--text-muted);
  padding-top: 5px;

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

.abele-chat-msg__tool-err-badge {
  color: var(--text-error);
  font-size: var(--font-smaller);
}

.abele-chat-msg__tool-error {
  font-size: var(--font-small);
  color: var(--text-error);
}

.abele-chat-msg__new-file {
  margin-top: var(--size-4-1);
  border-radius: var(--radius-s);
  max-height: 300px;
  overflow-y: auto;
  background-color: var(--background-secondary);

  code {
    display: block;
    padding: var(--size-4-2) var(--size-4-3);
    font-size: var(--font-small);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.abele-chat-msg__diff {
  margin-top: var(--size-4-1);
  border-radius: var(--radius-s);
  overflow: hidden;
  font-size: var(--font-small);
  max-height: 300px;
  overflow-y: auto;
}

.abele-chat-msg__details {
  margin-top: var(--size-4-1);
  font-size: var(--font-smaller);
  color: var(--text-muted);
  border-top: 1px solid var(--background-modifier-border);
  padding-top: var(--size-4-1);

  pre {
    background-color: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: var(--size-4-1) var(--size-4-2);
    max-height: 200px;
    overflow: auto;
    margin: 2px 0 var(--size-4-1);
    font-size: var(--font-smaller);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.abele-chat-msg__detail-row {
  margin-bottom: var(--size-4-1);
}

.abele-chat-msg__detail-label {
  font-weight: bold;
  margin-right: var(--size-4-1);
}

.abele-chat-msg__detail-time {
  color: var(--text-faint);
}
</style>
