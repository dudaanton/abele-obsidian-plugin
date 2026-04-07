<template>
  <div class="abele-ai-chat">
    <!-- Header -->
    <div class="abele-ai-chat__header">
      <AiModelSelector />
      <div class="abele-ai-chat__header-actions">
        <span v-if="tokenDisplay" class="abele-ai-chat__tokens">{{ tokenDisplay }}</span>
        <div v-if="scopeCompact" class="abele-ai-chat__scope-badge" @click="scopeOpen = true">
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

      <AiChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

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

      <!-- Compacting indicator -->
      <div v-if="isCompacting" class="abele-ai-chat__compacting">
        <Icon icon="minimize-2" />
        <span>Compacting conversation...</span>
      </div>

      <!-- Tool approval -->
      <AiToolApproval v-if="pendingApprovalMessage" :message="pendingApprovalMessage" />

      <!-- Error -->
      <div v-if="error" class="abele-ai-chat__error">
        <Icon icon="alert-triangle" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Input -->
    <AiChatInput
      ref="chatInput"
      :is-streaming="isStreaming"
      :can-continue="showContinue"
      @send="onSend"
      @command="onCommand"
      @abort="agent.abort()"
      @continue="onContinue"
    />

    <!-- Modals -->
    <AiChatHistory v-if="historyOpen" @close="historyOpen = false" @select="onLoadChat" />
    <AiScopeManager v-if="scopeOpen" @close="scopeOpen = false" />
    <AiPromptPicker
      v-if="promptPickerOpen"
      @close="promptPickerOpen = false"
      @select="onPromptSelected"
    />
    <TemplateVariablesModal
      v-if="variablesModalOpen"
      :variables="pendingPromptUserVars"
      @close="variablesModalOpen = false"
      @confirm="onPromptVariablesConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { Notice, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import AiChatMessage from './AiChatMessage.vue'
import AiChatInput from './AiChatInput.vue'
import AiToolApproval from './AiToolApproval.vue'
import AiModelSelector from './AiModelSelector.vue'
import AiChatHistory from './AiChatHistory.vue'
import AiScopeManager from './AiScopeManager.vue'
import AiPromptPicker from './AiPromptPicker.vue'
import TemplateVariablesModal from './TemplateVariablesModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseTemplateVariables, applyTemplateVariables } from '@/templates/TemplateParser'
import type { TemplateVariable } from '@/templates/TemplateParser'
import { ScopeResolver } from '@/ai/ScopeResolver'

const agent = AgentService.getInstance()
const scope = ScopeResolver.getInstance()

const {
  messages,
  isStreaming,
  isCompacting,
  streamingContent,
  streamingThinking,
  pendingToolCalls,
  error,
} = agent

const pendingApprovalMessage = computed(() => {
  if (pendingToolCalls.value.length === 0) return null
  const tc = pendingToolCalls.value[0]
  return messages.value.find((m) => m.toolCallId === tc.id && m.toolStatus === 'pending') || null
})

const showContinue = computed(() => {
  if (isStreaming.value) return false
  if (pendingToolCalls.value.length > 0) return false
  if (messages.value.length === 0) return false
  return true
})

const contextWindow = computed(() => {
  const config = AbeleConfig.getInstance().ai
  const provider =
    config.providers.find((p) => p.id === config.activeProviderId) ||
    config.providers.find((p) => p.models.length > 0)
  const model = provider?.models.find((m) => m.id === config.activeModelId) || provider?.models[0]
  return model?.contextWindow || 0
})

const contextTokens = computed(() => {
  // Find last assistant with usage, but only after the last compact divider
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.role === 'system') break
    if (m.role === 'assistant' && m.usage) {
      return m.usage.total
    }
  }
  return 0
})

const tokenDisplay = computed(() => {
  const t = contextTokens.value
  if (t === 0) return ''
  const ctx = contextWindow.value
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return ctx ? `${fmt(t)}/${fmt(ctx)}` : fmt(t)
})
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
const chatInput = ref<InstanceType<typeof AiChatInput> | null>(null)
const historyOpen = ref(false)
const scopeOpen = ref(false)
const promptPickerOpen = ref(false)
const variablesModalOpen = ref(false)
const pendingPromptContent = ref('')
const pendingPromptAllVars = ref<TemplateVariable[]>([])
const pendingPromptUserVars = ref<TemplateVariable[]>([])

const AUTO_SCROLL_THRESHOLD_PX = 60
let shouldAutoScroll = true
let scrollSetByCode = false

const onMessagesScroll = () => {
  // Ignore scroll events triggered by our own scrollTop assignment
  if (scrollSetByCode) {
    scrollSetByCode = false
    return
  }
  const el = messagesContainer.value
  if (!el) return
  shouldAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX
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
  const fileRefs = content.match(/@([\w/.@\s-]+\.\w+)/g)
  if (fileRefs) {
    for (const r of fileRefs) {
      scope.addFile(r.slice(1))
    }
  }
  scrollOnUserSend()
  await agent.sendMessage(content)
}

const onCommand = (command: string) => {
  switch (command) {
    case '/compact':
      agent.compact().catch(() => {
        return
      })
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
    case '/prompt':
      promptPickerOpen.value = true
      break
  }
}

const onPromptSelected = async (file: TFile) => {
  promptPickerOpen.value = false
  const { app } = GlobalStore.getInstance()
  const content = await app.vault.read(file)
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\n?/, '')
  const { variables, userVariables } = parseTemplateVariables(body)

  if (userVariables.length > 0) {
    pendingPromptContent.value = body
    pendingPromptAllVars.value = variables
    pendingPromptUserVars.value = userVariables
    variablesModalOpen.value = true
  } else {
    const resolved = await applyTemplateVariables(body, variables, new Map())
    chatInput.value?.setText(resolved.trim())
  }
}

const onPromptVariablesConfirm = async (values: Map<string, string>) => {
  variablesModalOpen.value = false
  const resolved = await applyTemplateVariables(
    pendingPromptContent.value,
    pendingPromptAllVars.value,
    values
  )
  chatInput.value?.setText(resolved.trim())
}

const onContinue = async () => {
  scrollOnUserSend()
  await agent.sendMessage('Continue')
}

const handleNewChat = async () => {
  await agent.newChat()
}

const onLoadChat = async (file: TFile) => {
  await agent.loadChat(file)
}

const showDebug = () => {
  const data = JSON.stringify(agent.getDebugData(), null, 2)
  console.log('[Abele AI Debug]', data)
  navigator.clipboard.writeText(data).then(
    () => new Notice('Debug JSON copied to clipboard'),
    () => new Notice('Failed to copy to clipboard')
  )
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
  gap: var(--size-4-1);
}

.abele-ai-chat__tokens {
  font-size: var(--font-smaller);
  color: var(--text-faint);
  white-space: nowrap;
}

.abele-ai-chat__scope-badge {
  font-size: var(--font-smaller);
  color: var(--text-muted);
  background-color: var(--background-secondary);
  padding: var(--size-2-1) var(--size-2-3);
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

.abele-ai-chat__compacting {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-small);
  font-style: italic;
}

.abele-ai-chat__typing {
  display: flex;
  gap: var(--size-4-1);
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
