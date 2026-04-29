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
      :can-create="agentService.canCreateTab"
      @select="agentService.switchTab($event)"
      @close="agentService.closeTab($event)"
      @create="agentService.createTab()"
    />

    <!-- Header -->
    <div class="abele-ai-chat__header">
      <AiModelSelector />
      <div class="abele-ai-chat__header-actions">
        <Icon
          icon="scroll-text"
          with-bg
          :class="{ 'abele-ai-chat__header-active': hasCustomPrompt }"
          @click="promptSettingsOpen = true"
        />
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

      <AiChatMessage
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :branch-info="branchInfoMap.get(msg.id)"
        @create-branch="onCreateBranch"
        @switch-branch="onSwitchBranch"
        @repeat-message="onRepeatMessage"
      />

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

      <!-- Error -->
      <div v-if="error" class="abele-ai-chat__error">
        <Icon icon="alert-triangle" />
        <span>{{ error }}</span>
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
      @attach-file="onAttachFile"
    />

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
    <AiSystemPromptSettings v-if="promptSettingsOpen" @close="promptSettingsOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { Notice, Platform, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import AiChatMessage from './AiChatMessage.vue'
import AiChatInput from './AiChatInput.vue'
import AiChatTabs from './AiChatTabs.vue'
import AiToolApproval from './AiToolApproval.vue'
import AiModelSelector from './AiModelSelector.vue'
import AiChatHistory from './AiChatHistory.vue'
import AiScopeManager from './AiScopeManager.vue'
import AiPermissions from './AiPermissions.vue'
import AiPromptPicker from './AiPromptPicker.vue'
import AiSystemPromptSettings from './AiSystemPromptSettings.vue'
import TemplateVariablesModal from './TemplateVariablesModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseTemplateVariables, applyTemplateVariables } from '@/templates/TemplateParser'
import type { TemplateVariable } from '@/templates/TemplateParser'
import { importExternalFile } from '@/ai/attachments'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { getChildren } from '@/ai/chatTree'

const agentService = AgentService.getInstance()
agentService.ensureInitialized()
const session = computed(() => agentService.activeSession.value)

// Reactive state from active session
const messages = computed(() => session.value?.messages.value ?? [])
const allMessages = computed(() => session.value?.allMessages.value ?? [])
const isStreaming = computed(() => session.value?.isStreaming.value ?? false)
const isGeneratingTitle = computed(() => session.value?.isGeneratingTitle.value ?? false)
const isCompacting = computed(() => session.value?.isCompacting.value ?? false)
const isExecutingTool = computed(() => session.value?.isExecutingTool.value ?? false)
const streamingContent = computed(() => session.value?.streamingContent.value ?? '')
const streamingThinking = computed(() => session.value?.streamingThinking.value ?? '')
const pendingToolCalls = computed(() => session.value?.pendingToolCalls.value ?? [])
const error = computed(() => session.value?.error.value ?? null)

// Tab bar info
const tabInfos = computed(() =>
  agentService.tabOrder.value.map((id) => {
    const s = agentService.getSession(id)
    return {
      id,
      label: s?.chatTitle.value || 'New chat',
      isStreaming: s?.isStreaming.value ?? false,
      isActive: id === agentService.activeTabId.value,
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

const contextWindow = computed(() => {
  const config = AbeleConfig.getInstance().ai
  const provider =
    config.providers.find((p) => p.id === config.activeProviderId) ||
    config.providers.find((p) => p.models.length > 0)
  const model = provider?.models.find((m) => m.id === config.activeModelId) || provider?.models[0]
  return model?.contextWindow || 0
})

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
const promptSettingsOpen = ref(false)

const hasCustomPrompt = computed(
  () =>
    !!session.value?.customSystemPrompt.value || !!session.value?.customSystemPromptNotePath.value
)
const variablesModalOpen = ref(false)
const pendingPromptContent = ref('')
const pendingPromptAllVars = ref<TemplateVariable[]>([])
const pendingPromptUserVars = ref<TemplateVariable[]>([])

const AUTO_SCROLL_THRESHOLD_PX = 60
let shouldAutoScroll = true
let scrollSetByCode = false

const onMessagesScroll = () => {
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

const scrollOnUserSend = () => {
  shouldAutoScroll = true
  doScroll()
}

watch([messages, streamingContent, streamingThinking], doScroll)

// Reset scroll when switching tabs
watch(
  () => agentService.activeTabId.value,
  () => {
    shouldAutoScroll = true
    nextTick(doScroll)
    chatInput.value?.setText('')
  }
)

// Consume pending input from external sources (e.g. editor context menu)
watch(
  () => agentService.pendingInput.value,
  (text) => {
    if (text) {
      chatInput.value?.setText(text)
      agentService.pendingInput.value = null
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
      mutObserver = new MutationObserver(() => doScroll())
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

const onSend = async (content: string, attachments: string[] = []) => {
  const s = session.value
  if (!s) return

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

  scrollOnUserSend()
  await session.value?.injectSkill(skillName, args || undefined)
}

const onPromptSelected = async (file: TFile) => {
  promptPickerOpen.value = false
  const { app } = GlobalStore.getInstance()
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
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
}

const onDragLeave = () => {
  dragLeaveTimer = setTimeout(() => {
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
  if (isExecutingTool.value) {
    s.abortToolExecution()
  } else {
    s.abort()
  }
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
  const existing = agentService.getSessionByFile(file.path)
  if (existing) {
    agentService.switchTab(existing.id)
    return
  }
  // Load into the current tab
  await session.value?.load(file)
  agentService.saveTabs()
}

const showDebug = () => {
  const data = JSON.stringify(session.value?.getDebugData() ?? {}, null, 2)
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
