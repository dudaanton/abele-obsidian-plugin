<template>
  <div
    ref="chatContainer"
    class="abele-ai-chat"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onFileDrop"
  >
    <!-- Tabs -->
    <AiChatTabs
      :tabs="tabInfos"
      :can-create="chatService.canCreateTab"
      @select="chatService.switchTab($event)"
      @close="chatService.closeTab($event)"
      @create="chatService.createTab()"
    />

    <AiRunView v-if="activeRun" :run="activeRun" />

    <template v-else>
      <!-- Header -->
      <div class="abele-ai-chat__header">
        <AiAgentSelector />
        <div class="abele-ai-chat__header-actions">
          <Icon icon="refresh-cw" with-bg title="Reload from disk" @click="reloadChat" />
          <Icon icon="sliders-horizontal" with-bg @click="chatSettingsOpen = true" />
          <Icon icon="plus" with-bg @click="handleNewChat" />
          <Icon icon="history" with-bg @click="historyOpen = true" />
          <Icon icon="bug" with-bg @click="showDebug" />
        </div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="abele-ai-chat__messages" @scroll="onMessagesScroll">
        <div v-if="messages.length === 0" class="abele-ai-chat__empty">
          <Icon icon="tree-deciduous" no-hover class="abele-ai-chat__empty-icon" />
          <span class="abele-ai-chat__empty-text">What's on your mind?</span>
        </div>

        <div v-if="olderCount" class="abele-ai-chat__older">
          <Icon icon="chevron-up" no-hover />
          <span>{{ olderCount }} earlier messages</span>
        </div>

        <AiChatMessage
          v-for="msg in visibleMessages"
          :key="msg.id"
          :message="msg"
          :branch-info="branchInfoMap.get(msg.id)"
          :interceptor-streaming="msg.draft ? interceptorStreaming : false"
          :interceptor-streaming-content="msg.draft ? interceptorStreamingContent : ''"
          :interceptor-error="msg.draft ? interceptorError : null"
          @create-branch="onCreateBranch"
          @switch-branch="onSwitchBranch"
          @repeat-message="onRepeatMessage"
          @retry-message="onRetryMessage"
          @edit-message="onEditMessage"
          @confirm-draft="onConfirmDraft"
          @edit-draft="onEditDraft"
          @send-interceptor="onSendInterceptor"
          @toggle-interceptor="onToggleInterceptor"
          @retry-interceptor="onRetryInterceptor"
        />

        <!-- Streaming indicator -->
        <div v-if="isStreaming" class="abele-ai-chat__streaming">
          <div v-if="streamingThinking" class="abele-ai-chat__streaming-thinking">
            <details v-if="!hideReasoning" open>
              <summary>Thinking...</summary>
              <Markdown :text="streamingThinking" />
            </details>
            <div v-else class="abele-ai-chat__streaming-thinking-hidden">
              <Icon icon="lightbulb" no-hover class="abele-ai-chat__spinner" />
              <span>Thinking...</span>
            </div>
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

        <!-- Waiting to be sent: typed while the agent was working -->
        <div v-if="queuedMessages.length" class="abele-ai-chat__queued">
          <div v-for="q in queuedMessages" :key="q.id" class="abele-ai-chat__queued-item">
            <Icon icon="clock" no-hover class="abele-ai-chat__queued-icon" />
            <span class="abele-ai-chat__queued-text">{{ q.content }}</span>
            <Icon
              icon="x"
              tooltip="Remove from the queue"
              class="abele-ai-chat__queued-remove"
              @click="onRemoveQueued(q.id)"
            />
          </div>
        </div>

        <!-- Background task indicators -->
        <div v-if="isGeneratingTitle" class="abele-ai-chat__aux-status">
          <Icon icon="heading" />
          <span>Generating title...</span>
        </div>
        <div v-if="isCompacting" class="abele-ai-chat__aux-status">
          <Icon icon="minimize-2" />
          <span>Compacting conversation...</span>
        </div>

        <!-- Tool approval -->
        <AiToolApproval v-if="pendingApprovalMessage" :message="pendingApprovalMessage" />

        <!-- Questions tool -->
        <div v-if="currentQuestion" class="abele-ai-chat__questions">
          <div class="abele-ai-chat__questions-question">{{ currentQuestion.question }}</div>
          <div class="abele-ai-chat__questions-options">
            <button
              v-for="(opt, i) in currentQuestion.options"
              :key="i"
              class="abele-ai-chat__questions-option"
              @click="answerQuestion(opt)"
            >
              {{ opt }}
            </button>
          </div>
          <div class="abele-ai-chat__questions-footer">
            <span class="abele-ai-chat__questions-progress">
              {{ questionsProgress }}
            </span>
            <button class="abele-ai-chat__questions-abort" @click="abortQuestions">Abort</button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="abele-ai-chat__error">
          <div class="abele-ai-chat__error-line">
            <Icon icon="alert-triangle" />
            <span>{{ error }}</span>
          </div>
          <div class="abele-ai-chat__error-actions">
            <button @click="onRetryRequest">Retry</button>
            <button v-if="hasFallbackModel" @click="onRetryWithFallback">
              Retry on {{ fallbackModelName }}
            </button>
          </div>
        </div>
      </div>

      <!-- Input -->
      <AiChatInput
        ref="chatInput"
        :is-streaming="isStreaming || isExecutingTool"
        :is-busy="isBusy"
        :can-continue="showContinue"
        :token-display="tokenDisplay"
        :scope-label="scopeCompact"
        @send="onSend"
        @command="onCommand"
        @abort="onAbort"
        @continue="onContinue"
        @focus="onInputFocus"
        @open-scope="scopeOpen = true"
        @open-permissions="permissionsOpen = true"
        @open-skill-prompt="skillPromptOpen = true"
        @attach-file="onAttachFile"
      />
    </template>

    <!-- Modals -->
    <AiChatHistory v-if="historyOpen" @close="historyOpen = false" @select="onLoadChat" />
    <AiScopeManager v-if="scopeOpen" @close="scopeOpen = false" />
    <AiPermissions v-if="permissionsOpen" @close="permissionsOpen = false" />
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
    <AiChatSettings v-if="chatSettingsOpen" @close="chatSettingsOpen = false" />
    <AiSkillPromptPicker
      v-if="skillPromptOpen"
      @close="skillPromptOpen = false"
      @skill="onPickerSkill"
      @prompt="onPromptSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { Notice, Platform, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import AiChatMessage from './AiChatMessage.vue'
import { useTailPagedList } from '@/composables/useTailPagedList'
import AiChatInput from './AiChatInput.vue'
import AiChatTabs from './AiChatTabs.vue'
import AiRunView from './AiRunView.vue'
import AiToolApproval from './AiToolApproval.vue'
import AiAgentSelector from './AiAgentSelector.vue'
import AiChatHistory from './AiChatHistory.vue'
import AiScopeManager from './AiScopeManager.vue'
import AiPermissions from './AiPermissions.vue'
import AiPromptPicker from './AiPromptPicker.vue'
import AiChatSettings from './AiChatSettings.vue'
import AiSkillPromptPicker from './AiSkillPromptPicker.vue'
import TemplateVariablesModal from './TemplateVariablesModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseTemplateVariables, applyTemplateVariables } from '@/templates/TemplateParser'
import type { TemplateVariable } from '@/templates/TemplateParser'
import { importExternalFile } from '@/ai/attachments'
import type { ChatDraft } from '@/ai/types'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { getChildren } from '@/ai/chatTree'

const chatService = ChatService.getInstance()
chatService.ensureInitialized()
const session = computed(() => chatService.activeSession.value)

// Reactive state from active session
const messages = computed(() => session.value?.messages.value ?? [])
const allMessages = computed(() => session.value?.allMessages.value ?? [])
const isStreaming = computed(() => session.value?.isStreaming.value ?? false)
const isGeneratingTitle = computed(() => session.value?.isGeneratingTitle.value ?? false)
const isCompacting = computed(() => session.value?.isCompacting.value ?? false)
const isExecutingTool = computed(() => session.value?.isExecutingTool.value ?? false)
const streamingContent = computed(() => session.value?.streamingContent.value ?? '')
const streamingThinking = computed(() => session.value?.streamingThinking.value ?? '')
const hideReasoning = computed(() => session.value?.hideReasoning.value ?? false)

// Interceptor
const interceptorStreaming = computed(() => session.value?.interceptor.streaming.value ?? false)
const interceptorStreamingContent = computed(
  () => session.value?.interceptor.streamingContent.value ?? ''
)
const interceptorError = computed(() => session.value?.interceptor.error.value ?? null)
const draftMessage = computed(() => session.value?.getDraftMessage() ?? null)

// Questions tool
const pendingQuestions = computed(() => session.value?.pendingQuestions.value ?? null)
const currentQuestion = computed(() => {
  const pq = pendingQuestions.value
  if (!pq) return null
  return pq.questions[pq.currentIndex]
})
const questionsProgress = computed(() => {
  const pq = pendingQuestions.value
  if (!pq) return ''
  return `${pq.currentIndex + 1} / ${pq.questions.length}`
})
const answerQuestion = (answer: string) => {
  session.value?.answerCurrentQuestion(answer)
}
const abortQuestions = () => {
  session.value?.abortQuestions()
}
const pendingToolCalls = computed(() => session.value?.pendingToolCalls.value ?? [])
const error = computed(() => session.value?.error.value ?? null)

/** The run shown in the active tab, if this tab is a run rather than a chat. */
const activeRun = computed(() => chatService.activeRun)

// Tab bar info
const tabInfos = computed(() =>
  chatService.tabOrder.value.map((id) => {
    const run = chatService.getRun(id)
    if (run) {
      return {
        id,
        label: `${run.agentName} run`,
        isStreaming: false,
        isActive: id === chatService.activeTabId.value,
      }
    }

    const s = chatService.getSession(id)
    return {
      id,
      label: s?.chatTitle.value || 'New chat',
      isStreaming: s?.isStreaming.value ?? false,
      isActive: id === chatService.activeTabId.value,
    }
  })
)

export interface BranchInfo {
  childIds: string[]
  activeChildIndex: number // -1 = new branch (not yet sent)
  total: number // childIds.length + 1 if currently on a new unsent branch
}

const branchInfoMap = computed(() => {
  const map = new Map<string, BranchInfo>()
  const all = allMessages.value
  const visible = messages.value
  if (all.length === 0 || visible.length === 0) return map

  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i]
    const children = getChildren(all, msg.id)
    if (children.length <= 1 && i < visible.length - 1) continue
    if (children.length === 0 && i < visible.length - 1) continue

    if (children.length > 1) {
      const nextVisible = visible[i + 1]
      const activeIdx = nextVisible ? children.findIndex((c) => c.id === nextVisible.id) : -1
      map.set(msg.id, {
        childIds: children.map((c) => c.id),
        activeChildIndex: activeIdx,
        total: activeIdx === -1 ? children.length + 1 : children.length,
      })
    } else if (i === visible.length - 1 && children.length > 0) {
      map.set(msg.id, {
        childIds: children.map((c) => c.id),
        activeChildIndex: -1,
        total: children.length + 1,
      })
    }
  }

  return map
})

const onCreateBranch = (messageId: string) => {
  shouldAutoScroll = false
  session.value?.createBranch(messageId)
}

const onSwitchBranch = (childId: string) => {
  shouldAutoScroll = false
  session.value?.switchBranch(childId)
}

const onRepeatMessage = (messageId: string) => {
  shouldAutoScroll = true
  session.value?.repeatMessage(messageId)
}

const onRetryMessage = (messageId: string) => {
  shouldAutoScroll = true
  session.value?.retryFromMessage(messageId)
}

const onEditMessage = (messageId: string) => {
  const s = session.value
  if (!s) return
  const msg = s.allMessages.value.find((m) => m.id === messageId)
  if (!msg || msg.role !== 'user') return

  // Branch from parent so user message and everything below disappears
  if (msg.parentId) {
    s.createBranch(msg.parentId)
  } else {
    s.createBranch(messageId)
  }
  chatInput.value?.setText(msg.content)
}

// ── Interceptor handlers ──

const onConfirmDraft = async (messageId: string) => {
  shouldAutoScroll = true
  await session.value?.confirmDraft(messageId)
}

const onEditDraft = (messageId: string) => {
  const s = session.value
  if (!s) return
  const msg = s.allMessages.value.find((m) => m.id === messageId)
  if (!msg || !msg.draft) return
  chatInput.value?.setText(msg.content)
  editingDraftId.value = messageId
}

const editingDraftId = ref<string | null>(null)

const onSendInterceptor = async (messageId: string, content: string) => {
  await session.value?.sendInterceptorMessage(messageId, content)
}

const onRetryInterceptor = async () => {
  await session.value?.retryInterceptor()
}

const onToggleInterceptor = (messageId: string) => {
  const s = session.value
  if (!s) return
  const msg = s.allMessages.value.find((m) => m.id === messageId)
  if (!msg) return
  msg.interceptorCollapsed = !msg.interceptorCollapsed
  s.updateVisibleMessages()
}

const isBusy = computed(() => {
  if (!AbeleConfig.getInstance().ai.sequentialAuxiliary) return false
  return isGeneratingTitle.value || isCompacting.value
})

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

const contextWindow = computed(() => session.value?.resolveModel()?.contextWindow || 0)

const contextTokens = computed(() => {
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
  const scope = session.value?.scopeResolver
  if (!scope) return ''
  const s = scope.summary.value
  if (!s || s === 'No files') return ''
  if (s === 'Full vault') return 'vault'
  return s
    .replace(/ files?/, 'f')
    .replace(/ folders?/, 'd')
    .replace(/ patterns?/, 'p')
    .replace(/,\s*/g, ' ')
})

const chatContainer = ref<HTMLElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const chatInput = ref<InstanceType<typeof AiChatInput> | null>(null)
const historyOpen = ref(false)
const scopeOpen = ref(false)
const permissionsOpen = ref(false)
const promptPickerOpen = ref(false)
const chatSettingsOpen = ref(false)
const skillPromptOpen = ref(false)
const variablesModalOpen = ref(false)
const pendingPromptContent = ref('')
const pendingPromptAllVars = ref<TemplateVariable[]>([])
const pendingPromptUserVars = ref<TemplateVariable[]>([])

const AUTO_SCROLL_THRESHOLD_PX = 60
/** How close to the top counts as asking for the messages above. */
const LOAD_OLDER_THRESHOLD_PX = 200
let shouldAutoScroll = true
let scrollSetByCode = false

/**
 * Only the end of the conversation is mounted; scrolling back reveals the rest.
 *
 * Every message mounts a component, and an assistant message mounts a markdown renderer with
 * it, so a long conversation paid for all of it before showing anything.
 */
const {
  visible: visibleMessages,
  hasMore: hasOlder,
  hidden: olderCount,
  showMore: showOlder,
  reset: resetWindow,
} = useTailPagedList(() => messages.value)

/**
 * What the reader was looking at while older messages are being revealed above it.
 *
 * A message rather than a height. Reading the growth of `scrollHeight` once, on the tick
 * after the page is revealed, corrects for nothing: a message renders its markdown
 * asynchronously — `MarkdownRenderer.render` is awaited, and a re-render is queued behind a
 * timeout — so at that point the messages just mounted are still nearly empty, and their real
 * height arrives afterwards and shoves the view down. Holding one element still is immune to
 * that, however late and however often the heights change.
 */
let anchor: { el: HTMLElement; offset: number } | null = null

/** How far the anchor sits below the top of the scroll container. Negative when above it. */
const offsetOf = (el: HTMLElement, container: HTMLElement) =>
  el.getBoundingClientRect().top - container.getBoundingClientRect().top

/** Takes the topmost rendered message as the anchor: the page is revealed above it. */
const captureAnchor = () => {
  const container = messagesContainer.value
  const first = container?.querySelector<HTMLElement>('.abele-chat-msg')
  anchor = container && first ? { el: first, offset: offsetOf(first, container) } : null
}

/** Puts the anchor back where it was, whatever has grown around it since. */
const holdAnchor = () => {
  const container = messagesContainer.value
  if (!container || !anchor) return
  if (!anchor.el.isConnected) {
    anchor = null
    return
  }

  const drift = offsetOf(anchor.el, container) - anchor.offset
  if (Math.abs(drift) < 1) return
  scrollSetByCode = true
  container.scrollTop += drift
}

/**
 * Reveals the previous page, keeping the reader where they are.
 *
 * The anchor is held for a moment rather than once, because that is how long the revealed
 * messages take to render themselves. Held with the frames rather than with a timer: a frame
 * is when layout has settled, and there is nothing to correct between them.
 */
const ANCHOR_HOLD_MS = 1500

const loadOlder = () => {
  const el = messagesContainer.value
  if (!el || !hasOlder.value) return

  captureAnchor()
  showOlder()

  // The chat can be in a popped-out window, whose frames and clock are not the main one's.
  const win = el.win
  const until = win.performance.now() + ANCHOR_HOLD_MS
  const hold = () => {
    if (!anchor) return
    holdAnchor()
    if (win.performance.now() < until) win.requestAnimationFrame(hold)
    else anchor = null
  }
  void nextTick(() => win.requestAnimationFrame(hold))
}

const onMessagesScroll = () => {
  if (scrollSetByCode) {
    scrollSetByCode = false
    return
  }
  const el = messagesContainer.value
  if (!el) return
  // The reader has taken over; whatever was being held is where they left it.
  anchor = null
  shouldAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX
  if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder()
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

const scrollOnUserSend = () => {
  shouldAutoScroll = true
  doScroll()
}

watch([messages, streamingContent, streamingThinking], doScroll)

/**
 * What was typed in each tab and not sent.
 *
 * The input is one component shared by every tab, so leaving it alone would show the message
 * being composed in one conversation while another is open. It used to be emptied instead,
 * which threw the message away for anyone who switched tabs to check something.
 */
const drafts = new Map<string, ChatDraft>()
const NO_DRAFT: ChatDraft = { text: '', attachments: [] }

// Reset scroll when switching tabs
watch(
  () => chatService.activeTabId.value,
  (tabId, previousTabId) => {
    shouldAutoScroll = true
    // Another conversation entirely: it starts at its end, like this one did.
    resetWindow()
    void nextTick(doScroll)

    // The input still holds the tab being left — the DOM has not been updated yet.
    if (previousTabId) drafts.set(previousTabId, chatInput.value?.takeDraft() ?? NO_DRAFT)
    for (const id of drafts.keys()) {
      if (!chatService.tabOrder.value.includes(id)) drafts.delete(id)
    }

    // On a tab held by a delegated run the input is not mounted at all, so the one being
    // returned to is put back a tick later, once there is an input to put it in.
    const draft = tabId ? drafts.get(tabId) : undefined
    void nextTick(() => chatInput.value?.putDraft(draft ?? NO_DRAFT))
  }
)

// Consume pending input from external sources (e.g. editor context menu)
watch(
  () => chatService.pendingInput.value,
  (text) => {
    if (text) {
      chatInput.value?.setText(text)
      chatService.pendingInput.value = null
    }
  }
)

onMounted(() => {
  if (Platform.isMobile && chatContainer.value) {
    nextTick(() => {
      const el = chatContainer.value!
      const safeArea =
        parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom')
        ) || 0
      const fullGap = window.innerHeight - el.getBoundingClientRect().bottom
      const uiGap = Math.max(0, fullGap - safeArea)
      el.style.setProperty('--abele-bottom-gap', `${uiGap}px`)
    })
  }
})

let mutObserver: MutationObserver | null = null
onMounted(() => {
  nextTick(() => {
    if (messagesContainer.value) {
      mutObserver = new MutationObserver(() => {
        // A message that has just rendered its markdown changes the subtree and the layout
        // with it — which is exactly when the anchor needs putting back.
        holdAnchor()
        doScroll()
      })
      mutObserver.observe(messagesContainer.value, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
      })
    }
  })
})
onUnmounted(() => mutObserver?.disconnect())

onMounted(() => {
  window.setTimeout(() => chatInput.value?.focus(), 150)
})

const onSend = async (content: string, attachments: string[] = []) => {
  const s = session.value
  if (!s) return

  // Update draft content if editing
  if (editingDraftId.value) {
    s.updateDraftContent(editingDraftId.value, content)
    editingDraftId.value = null
    return
  }

  // Answer pending question with typed text
  if (s.pendingQuestions.value) {
    s.answerCurrentQuestion(content)
    return
  }

  // Auto-reject pending tool call when user sends a message instead
  if (s.pendingToolCalls.value.length > 0) {
    s.rejectToolCall('User sent a new message')
  }

  const fileRefs = content.match(/@([\w/.@\s-]+\.\w+)/g)
  if (fileRefs) {
    for (const r of fileRefs) {
      s.scopeResolver.addFile(r.slice(1))
    }
  }
  scrollOnUserSend()
  await s.sendMessage(content, attachments)
}

const onInputFocus = (focused: boolean) => {
  chatContainer.value?.classList.toggle('abele-keyboard-open', focused)
}

const onCommand = async (command: string) => {
  const s = session.value
  if (!s) return
  switch (command) {
    case '/compact':
      s.compact().catch(() => {
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
    default:
      if (command.startsWith('/')) {
        await onSkillCommand(command)
      }
  }
}

const applyAiModelProperty = (modelKey: string | undefined) => {
  if (!modelKey) return
  const config = AbeleConfig.getInstance()
  let resolvedProviderId: string | undefined
  let resolvedModelId: string | undefined

  if (modelKey.includes('::')) {
    const [providerPart, modelPart] = modelKey.split('::')
    const provider = config.ai.providers.find(
      (p) => p.id === providerPart || p.name === providerPart
    )
    if (provider) {
      const model = provider.models.find((m) => m.id === modelPart || m.name === modelPart)
      if (model) {
        resolvedProviderId = provider.id
        resolvedModelId = model.id
      }
    }
  } else {
    for (const p of config.ai.providers) {
      const m = p.models.find((m) => m.id === modelKey || m.name === modelKey)
      if (m) {
        resolvedProviderId = p.id
        resolvedModelId = m.id
        break
      }
    }
  }

  if (resolvedProviderId && resolvedModelId) {
    chatService.switchModel(resolvedProviderId, resolvedModelId)
  } else {
    new Notice(`Model not found: ${modelKey}`)
  }
}

const getSkillModelKey = (skillName: string): string | undefined => {
  const { app } = GlobalStore.getInstance()
  const skills = discoverSkills()
  const skill = skills.find((s) => s.name === skillName)
  if (!skill) return undefined
  const file = app.vault.getAbstractFileByPath(skill.path)
  if (!(file instanceof TFile)) return undefined
  const cache = app.metadataCache.getFileCache(file)
  return cache?.frontmatter?.['ai-model'] as string | undefined
}

const onSkillCommand = async (command: string) => {
  const rest = command.slice(1)
  const spaceIdx = rest.indexOf(' ')
  const skillName = spaceIdx >= 0 ? rest.slice(0, spaceIdx).trim() : rest.trim()
  const args = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : ''

  const skills = discoverSkills()
  if (!skills.some((s) => s.name === skillName)) {
    new Notice(`Unknown command: /${skillName}`)
    return
  }

  applyAiModelProperty(getSkillModelKey(skillName))
  scrollOnUserSend()
  await session.value?.injectSkill(skillName, args || undefined)
}

const onPickerSkill = async (name: string) => {
  applyAiModelProperty(getSkillModelKey(name))
  scrollOnUserSend()
  await session.value?.injectSkill(name)
}

const onPromptSelected = async (file: TFile) => {
  promptPickerOpen.value = false
  const { app } = GlobalStore.getInstance()

  const cache = app.metadataCache.getFileCache(file)
  applyAiModelProperty(cache?.frontmatter?.['ai-model'] as string | undefined)

  const content = await app.vault.read(file)
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

const onAttachFile = (path: string) => {
  session.value?.scopeResolver.addFile(path)
}

// ── Drag & drop on the whole chat area ──

let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

const onDragOver = () => {
  if (dragLeaveTimer) {
    window.clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
}

const onDragLeave = () => {
  dragLeaveTimer = window.setTimeout(() => {
    dragLeaveTimer = null
  }, 50)
}

const onFileDrop = async (e: DragEvent) => {
  const dt = e.dataTransfer
  if (!dt) return

  console.debug('[Abele drop]', {
    types: [...dt.types],
    text: dt.getData('text/plain'),
    files: dt.files?.length,
  })

  const { app } = GlobalStore.getInstance()

  // 1. Obsidian internal drag — URIs like obsidian://open?vault=...&file=...
  const textData = dt.getData('text/plain')?.trim()
  if (textData) {
    const lines = textData
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    let handled = false
    for (const line of lines) {
      let path = line
      // Parse obsidian:// URI
      const fileParam = line.match(/[?&]file=([^&]+)/)
      if (fileParam) {
        path = decodeURIComponent(fileParam[1])
      }
      const file = app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) {
        chatInput.value?.addAttachment(file)
        handled = true
      }
    }
    if (handled) return
  }

  // 2. External files
  const fileList = dt.files ? Array.from(dt.files) : []
  for (const f of fileList) {
    try {
      const vaultFile = await importExternalFile(f)
      chatInput.value?.addAttachment(vaultFile)
    } catch (err: unknown) {
      new Notice(`Failed to import ${f.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

const onAbort = () => {
  const s = session.value
  if (!s) return

  // Stopping cancels what was queued behind the answer, so the text goes back where it was
  // typed rather than disappearing: after whatever is in the box now, in the order it was sent.
  const queued = s.takeQueuedMessages()
  if (queued.length) {
    const { app } = GlobalStore.getInstance()
    const draft = chatInput.value?.takeDraft() ?? { text: '', attachments: [] }
    const files = queued
      .flatMap((q) => q.attachments ?? [])
      .map((path) => app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile)
    chatInput.value?.putDraft({
      text: [...queued.map((q) => q.content), draft.text].filter(Boolean).join('\n'),
      attachments: [...draft.attachments, ...files.filter((f) => !draft.attachments.includes(f))],
    })
  }

  if (isExecutingTool.value) {
    s.abortToolExecution()
  } else {
    s.abort()
  }
}

/** Typed while the agent was working, waiting for the next iteration of its loop. */
const queuedMessages = computed(() => session.value?.queuedMessages.value ?? [])

const onRemoveQueued = (id: string) => session.value?.removeQueuedMessage(id)

const hasFallbackModel = computed(() => session.value?.hasFallbackModel ?? false)
const fallbackModelName = computed(
  () => session.value?.resolveModel({ fallback: true })?.name ?? ''
)

const onRetryRequest = async () => {
  await session.value?.retryRequest()
}

const onRetryWithFallback = async () => {
  const s = session.value
  if (!s || !s.useFallbackModel()) return
  await s.retryRequest()
}

const onContinue = async () => {
  scrollOnUserSend()
  await session.value?.sendMessage('Continue')
}

const handleNewChat = async () => {
  await session.value?.reset()
}

const onLoadChat = async (file: TFile) => {
  // If this chat is already open in another tab, switch to it
  const existing = chatService.getSessionByFile(file.path)
  if (existing) {
    chatService.switchTab(existing.id)
    return
  }
  // Load into the current tab
  await session.value?.load(file)
  chatService.saveTabs()
}

const reloadChat = async () => {
  const file = session.value?.currentChatFile.value
  if (!file) {
    new Notice('No chat file to reload')
    return
  }
  await session.value?.load(file)
  new Notice('Chat reloaded from disk')
}

const showDebug = () => {
  const data = JSON.stringify(session.value?.getDebugData() ?? {}, null, 2)
  console.debug('[Abele AI Debug]', data)
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
  container-type: inline-size;
  background-color: var(--background-primary);

  body.is-mobile & {
    padding-bottom: var(--size-4-4);
    // When keyboard is open, shrink by the keyboard portion not covered by bottom UI
    &.abele-keyboard-open {
      padding-bottom: 0;
      height: calc(
        100% - max(0px, var(--safe-area-inset-bottom, 0px) - var(--abele-bottom-gap, 0px))
      );
    }
  }
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

  > .abele-obsidian-icon {
    height: 2em;
    width: 2em;
  }
}

.abele-ai-chat__header-active {
  color: var(--interactive-accent) !important;
}

/** The marker above the oldest rendered message, saying what scrolling further would show. */
.abele-ai-chat__older {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-4-1);
  padding: var(--size-4-2) 0;
  color: var(--text-faint);
  font-size: var(--font-smaller);
}

.abele-ai-chat__messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--size-4-2) var(--size-4-3);
  user-select: text;
}

.abele-ai-chat__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--size-4-3);
}

.abele-ai-chat__empty-icon {
  color: var(--background-modifier-border);

  svg {
    width: 64px;
    height: 64px;
    stroke-width: 1;
  }
}

.abele-ai-chat__empty-text {
  display: block;
  margin-top: var(--size-4-4);
  color: var(--background-modifier-border);
  font-size: var(--font-small);
}

.abele-ai-chat__streaming-thinking {
  margin: var(--size-4-2) 0;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-1) var(--size-4-2);
  font-size: var(--font-small);
  overflow-wrap: break-word;
  word-break: break-word;

  summary {
    cursor: pointer;
    color: var(--text-muted);
    font-style: italic;
  }

  pre {
    position: relative;
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

    .copy-code-button {
      position: absolute;
      top: var(--size-4-1);
      right: var(--size-4-1);
      color: var(--text-muted);
      background: none;
      border: none;
      box-shadow: none;

      &:hover {
        color: var(--text-normal);
        background-color: var(--background-modifier-hover);
      }
    }
  }

  :not(pre) > code {
    padding: 1px var(--size-4-1);
    background-color: var(--code-background);
    border-radius: var(--radius-s);
    font-size: 0.9em;
  }
}

/**
 * Messages waiting their turn. They are not in the conversation yet — the agent has not been
 * shown them — so they read as pending rather than as sent: muted, dashed, and each with a
 * way out of the queue.
 */
.abele-ai-chat__queued {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  padding: var(--size-4-2) var(--size-4-3);
}

.abele-ai-chat__queued-item {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  border: 1px dashed var(--background-modifier-border);
  border-radius: var(--radius-m);
  color: var(--text-muted);
  font-size: var(--font-small);
}

.abele-ai-chat__queued-icon {
  flex-shrink: 0;
}

.abele-ai-chat__queued-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.abele-ai-chat__aux-status {
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
  flex-direction: column;
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

.abele-ai-chat__error-line {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
}

.abele-ai-chat__error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);

  button {
    font-size: var(--font-smallest);
    padding: var(--size-2-1) var(--size-4-2);
  }
}
</style>
