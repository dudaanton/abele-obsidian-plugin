<template>
  <div class="abele-ai-chat">
    <!-- Header -->
    <div class="abele-ai-chat__header">
      <AiModelSelector />
      <div class="abele-ai-chat__header-actions">
        <div v-if="scopeSummary" class="abele-ai-chat__scope-badge" @click="scopeOpen = true">
          {{ scopeCompact }}
        </div>
        <Icon icon="folder-open" with-bg @click="scopeOpen = true" />
        <Icon icon="plus" with-bg @click="handleNewChat" />
        <Icon icon="history" with-bg @click="historyOpen = true" />
        <Icon icon="bug" with-bg @click="showDebug" />
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="abele-ai-chat__messages" @scroll="onMessagesScroll">
      <div v-if="messages.length === 0" class="abele-ai-chat__empty">
        Start a conversation with your AI assistant.
      </div>

      <AiChatMessage v-for="(msg, idx) in messages" :key="idx" :message="msg" />

      <!-- Streaming indicator -->
      <div v-if="isStreaming" class="abele-ai-chat__streaming">
        <div v-if="streamingThinking" class="abele-ai-chat__streaming-thinking">
          <details open>
            <summary>Thinking...</summary>
            <Markdown :text="streamingThinking" />
          </details>
        </div>
        <div v-if="streamingContent" class="abele-ai-chat__streaming-content">
          <div class="abele-chat-msg abele-chat-msg_assistant">
            <div class="abele-chat-msg__icon">
              <Icon icon="bot" />
            </div>
            <div class="abele-chat-msg__body">
              <Markdown :text="streamingContent" />
            </div>
          </div>
        </div>
        <div v-if="!streamingContent && !streamingThinking" class="abele-ai-chat__typing">
          <span class="abele-ai-chat__typing-dot" />
          <span class="abele-ai-chat__typing-dot" />
          <span class="abele-ai-chat__typing-dot" />
        </div>
      </div>

      <!-- Tool approval -->
      <AiToolApproval v-if="currentApproval" :request="currentApproval" />

      <!-- Error -->
      <div v-if="error" class="abele-ai-chat__error">
        <Icon icon="alert-triangle" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Input -->
    <AiChatInput
      :is-streaming="isStreaming"
      @send="onSend"
      @command="onCommand"
      @abort="agent.abort()"
    />

    <!-- Modals -->
    <AiChatHistory v-if="historyOpen" @close="historyOpen = false" @select="onLoadChat" />
    <AiScopeManager v-if="scopeOpen" @close="scopeOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import AiChatMessage from './AiChatMessage.vue'
import AiChatInput from './AiChatInput.vue'
import AiToolApproval from './AiToolApproval.vue'
import AiModelSelector from './AiModelSelector.vue'
import AiChatHistory from './AiChatHistory.vue'
import AiScopeManager from './AiScopeManager.vue'
import { AgentService } from '@/ai/AgentService'
import { ScopeResolver } from '@/ai/ScopeResolver'

const agent = AgentService.getInstance()
const scope = ScopeResolver.getInstance()

const { messages, isStreaming, streamingContent, streamingThinking, currentApproval, error } = agent

const scopeSummary = computed(() => scope.summary.value)
const scopeCompact = computed(() => {
  const s = scope.summary.value
  if (!s || s === 'No files') return ''
  if (s === 'Full vault') return 'vault'
  // Shorten: "2 files, 1 folder" → "2f 1d"
  return s
    .replace(/ files?/, 'f')
    .replace(/ folders?/, 'd')
    .replace(/ patterns?/, 'p')
    .replace(/,\s*/g, ' ')
})

const messagesContainer = ref<HTMLElement | null>(null)
const historyOpen = ref(false)
const scopeOpen = ref(false)

let shouldAutoScroll = true
// Track with a flag that only user scroll events can set to false
let scrollSetByCode = false

const onMessagesScroll = () => {
  // Ignore scroll events triggered by our own scrollTop assignment
  if (scrollSetByCode) {
    scrollSetByCode = false
    return
  }
  const el = messagesContainer.value
  if (!el) return
  shouldAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

const doScroll = () => {
  if (!shouldAutoScroll) return
  nextTick(() => {
    const el = messagesContainer.value
    if (!el) return
    scrollSetByCode = true
    el.scrollTop = el.scrollHeight
  })
}

// User sends a message — they want to see the response, scroll down
const scrollOnUserSend = () => {
  shouldAutoScroll = true
  doScroll()
}

// Any content change during streaming — scroll if user hasn't scrolled away
watch([messages, streamingContent, streamingThinking], doScroll)

// MutationObserver catches all DOM changes (thinking open/close, markdown render, new elements)
let mutObserver: MutationObserver | null = null
onMounted(() => {
  nextTick(() => {
    if (messagesContainer.value) {
      mutObserver = new MutationObserver(() => doScroll())
      mutObserver.observe(messagesContainer.value, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open'], // <details open> toggle
      })
    }
  })
})
onUnmounted(() => mutObserver?.disconnect())

const onSend = async (content: string) => {
  const fileRefs = content.match(/@([\w/.@-]+)/g)
  if (fileRefs) {
    for (const r of fileRefs) {
      scope.addFile(r.slice(1))
    }
  }
  scrollOnUserSend()
  await agent.sendMessage(content)
  // Auto-save after each exchange
  agent.saveCurrentChat()
}

const onCommand = (command: string) => {
  switch (command) {
    case '/compact':
      agent.compact()
      break
    case '/new':
      handleNewChat()
      break
    case '/load':
      historyOpen.value = true
      break
    case '/scope':
      scopeOpen.value = true
      break
  }
}

const handleNewChat = async () => {
  await agent.newChat()
}

const onLoadChat = async (file: TFile) => {
  await agent.loadChat(file)
}

const showDebug = () => {
  const data = JSON.stringify(messages.value, null, 2)
  console.log('[Abele AI Debug]', data)
  navigator.clipboard.writeText(data).then(() => {
    new (window as any).Notice('Chat JSON copied to clipboard')
  })
}
</script>

<style lang="scss">
.abele-ai-chat {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--status-bar-height, 22px);
  box-sizing: border-box;
  background-color: var(--background-primary);
}

.abele-ai-chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-4-1) var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
  gap: var(--size-4-1);
}

.abele-ai-chat__header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.abele-ai-chat__scope-badge {
  font-size: var(--font-smaller);
  color: var(--text-muted);
  background-color: var(--background-secondary);
  padding: 2px 6px;
  border-radius: var(--radius-s);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-ai-chat__messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-2) var(--size-4-3);
  user-select: text;
}

.abele-ai-chat__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-style: italic;
}

.abele-ai-chat__streaming-thinking {
  margin: var(--size-4-2) 0;
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

.abele-ai-chat__typing {
  display: flex;
  gap: 4px;
  padding: var(--size-4-2);
}

.abele-ai-chat__typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--text-muted);
  animation: abele-typing 1.4s infinite ease-in-out;

  &:nth-child(2) {
    animation-delay: 0.2s;
  }
  &:nth-child(3) {
    animation-delay: 0.4s;
  }
}

@keyframes abele-typing {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.abele-ai-chat__error {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  color: var(--text-muted);
  background-color: var(--background-secondary);
  border-left: 3px solid var(--text-error);
  border-radius: var(--radius-s);
  margin: var(--size-4-2) 0;
  font-size: var(--font-small);
  word-break: break-word;
}
</style>
