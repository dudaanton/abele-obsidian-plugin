<template>
  <div
    ref="chatContainer"
    class="abele-ai-chat"
    :class="{ 'abele-ai-chat--composing': composing, 'abele-keyboard-open': keyboardOpen }"
    @dragover.prevent
    @drop.prevent="onFileDrop"
  >
    <!-- Tabs -->
    <AiChatTabs
      :tabs="tabInfos"
      :can-create="chatService.canCreateTab"
      @select="chatService.switchTab($event)"
      @close="chatService.closeTab($event)"
      @create="onNewTab"
    />

    <ChatAnchorHistory
      v-if="anchorHistory"
      :anchor="anchorHistory.anchor"
      :resolution="anchorHistory.resolution"
      @close="anchorHistory = null"
    />
    <AiRunView v-if="activeRun" :run="activeRun" />
    <NodeChatView v-else-if="nodeSession" :key="nodeSession.id" :presenter="nodeSession" @new-chat="onNewTab" />

    <EmptyState
      v-else-if="session?.preparingClone?.value"
      text="Creating chat copy…"
      role="status"
    />

    <template v-else>
      <!-- Header -->
      <div class="abele-ai-chat__header">
        <AiAgentSelector />
        <div class="abele-ai-chat__header-actions">
          <AgentsButton />
          <!-- Only over a comment: the way back to the passage it was written against. It
               points back the way it came rather than being a panel glyph, because what it
               does is scroll a note, not move a pane. -->
          <Icon
            v-if="commentSession"
            icon="corner-up-left"
            with-bg
            tooltip="Back to the passage this is about"
            @click="backToNote"
          />
          <!-- Only for a comment still being a comment: the promotion into an ordinary chat,
               with the default agent, a place in the history and no anchor to answer to. Not a
               panel glyph: on a phone the comment is already in the sidebar, and a panel icon
               there read as "open in the sidebar" and made no sense (2026-09-05). -->
          <Icon
            v-if="commentSession"
            icon="messages-square"
            with-bg
            :disabled="blocked"
            :tooltip="blocked ? blockedTooltip : 'Turn this comment into an ordinary chat'"
            @click="openAsChat"
          />
          <!-- Find words in this conversation; Cmd/Ctrl+F does the same from inside the chat. -->
          <Icon
            icon="search"
            with-bg
            class="abele-ai-chat__find"
            tooltip="Find in this chat"
            @click="find.open()"
          />
          <Icon
            icon="list-tree"
            with-bg
            class="abele-ai-chat__navigation"
            tooltip="Navigation"
            @click="openNavigation()"
          />
          <!-- One button for everything this chat is set up with: scope, skills, prompts,
               tool permissions, its own settings, and the two things that are neither —
               reading the file again and copying what the chat is made of. -->
          <Icon
            icon="sliders-horizontal"
            with-bg
            tooltip="Scope, skills, prompts, permissions and settings"
            @click="openSetup()"
          />
          <Icon
            v-if="!commentSession"
            class="abele-ai-chat__artifacts"
            icon="boxes"
            with-bg
            tooltip="Artifacts — notes, images and scripts"
            @click="artifactsSession = session"
          />
          <Icon icon="plus" with-bg tooltip="Start a new chat" @click="onNewChatMenu" />
          <Icon
            icon="history"
            with-bg
            tooltip="Open a chat you have had"
            @click="historyOpen = true"
          />
        </div>
      </div>

      <ChatFindBar
        v-if="find.isOpen.value"
        v-show="!composing"
        :query="find.query.value"
        :count="find.count.value"
        :position="find.position.value"
        :focus-request="find.focusRequest.value"
        :autofocus="find.takesFocus.value"
        @update:query="find.setQuery"
        @next="find.next"
        @previous="find.previous"
        @close="find.close"
      />

      <!-- "Ask here" over words selected on a touch screen, once the finger has let them go. -->
      <ChatSelectionBar
        v-if="messagesContainer && canComment && !composing"
        :key="session?.id"
        :scroller="messagesContainer"
        :capture-link="captureLink"
        :capture-script="captureScript"
        :script-menu="selectionScripts"
        @ask="onAskHere"
        @highlight="onHighlight"
      />

      <!-- Over a comment on a message: the way down to it, every level a way back. -->
      <AiCommentTrail v-if="session" v-show="!composing" :session="session" />

      <!-- Messages -->
      <!-- Hidden, not taken away, while the composer is opened out over it: the conversation
           keeps streaming into it and is where it was when the composer closes. -->
      <div
        v-show="!composing"
        ref="messagesContainer"
        class="abele-ai-chat__messages"
        @scroll="onMessagesScroll"
        @wheel.passive="readerTakesOver"
        @touchstart.passive="fingerOn"
        @touchend.passive="fingerOff"
        @touchcancel.passive="fingerOff"
        @mousedown="readerTakesOver"
        @keydown="readerTakesOver"
      >
        <div v-if="messages.length === 0" class="abele-ai-chat__empty">
          <Icon icon="tree-deciduous" no-hover class="abele-ai-chat__empty-icon" />
          <span class="abele-ai-chat__empty-text">What's on your mind?</span>
        </div>

        <!-- The conversation's beginnings, when there is more than one. A repeat of the first
             message starts a second one, and with no parent to hang the usual switcher on the
             first looked deleted rather than put aside (2026-09-05, on both phone and desktop). -->
        <div v-if="rootBranches" class="abele-ai-chat__roots abele-chat-msg__branch-nav">
          <Icon
            icon="chevron-left"
            :class="{ 'abele-chat-msg__branch-disabled': rootBranches.index <= 0 }"
            @click="switchRoot(-1)"
          />
          <span class="abele-chat-msg__branch-label"
            >{{ rootBranches.index + 1 }}/{{ rootBranches.ids.length }}</span
          >
          <Icon
            icon="chevron-right"
            :class="{
              'abele-chat-msg__branch-disabled': rootBranches.index >= rootBranches.ids.length - 1,
            }"
            @click="switchRoot(1)"
          />
        </div>

        <div v-if="olderCount" class="abele-ai-chat__older">
          <Icon icon="chevron-up" no-hover />
          <span>{{ olderCount }} earlier messages</span>
        </div>

        <AiChatMessage
          v-for="msg in visibleMessages"
          :key="msg.id"
          :ref="(c) => keepMessageRef(msg.id, c)"
          :data-message-id="msg.id"
          :message="msg"
          :branch-info="branchInfoMap.get(msg.id)"
          :interceptor-streaming="
            msg.draft ? interceptorStreaming || interceptorWorking : replyReviews[msg.id]?.streaming
          "
          :interceptor-streaming-content="
            msg.draft ? interceptorStreamingContent : replyReviews[msg.id]?.streamingContent
          "
          :interceptor-error="msg.draft ? interceptorError : replyReviews[msg.id]?.error"
          :comments="commentsOn.get(msg.id)"
          :can-comment="canComment"
          :capture-link="captureLink"
          :capture-script="captureScript"
          :script-menu="selectionScripts"
          :can-rewind="canRewind && msg.role === 'user' && !msg.draft"
          :changed-files="changedTurns.has(msg.id)"
          :can-clone="!!session"
          @clone-chat="onCloneChat"
          @create-branch="onCreateBranch"
          @switch-branch="onSwitchBranch"
          @repeat-message="onRepeatMessage"
          @retry-message="onRetryMessage"
          @insert-into-note="onInsertIntoNote"
          @ask-here="onAskHere"
          @highlight="onHighlight"
          @remove-highlight="onRemoveHighlight"
          @recolor-highlight="onRecolorHighlight"
          @review-revision="onReviewRevision"
          @undo-revision="onUndoRevision"
          @edit-message="onEditMessage"
          @rewind="onRewind"
          @confirm-draft="onConfirmDraft"
          @edit-draft="onEditDraft"
          @send-interceptor="onSendInterceptor"
          @toggle-interceptor="onToggleInterceptor"
          @retry-interceptor="onRetryInterceptor"
        />

        <NodeDelegations v-if="session?.delegationParentId" :parent-id="session.delegationParentId" />

        <!-- Streaming indicator -->
        <div v-if="isStreaming" class="abele-ai-chat__streaming">
          <div v-if="streamingThinking" class="abele-ai-chat__streaming-thinking">
            <details v-if="!hideReasoning" open>
              <summary>Thinking...</summary>
              <Markdown :text="streamingThinking" streaming />
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
                <Markdown :text="streamingContent" streaming />
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
            <span class="abele-ai-chat__queued-text">
              {{ q.content }}
              <span v-if="q.attachments?.length">
                {{ q.attachments.map((path) => path.split('/').pop()).join(', ') }}
              </span>
            </span>
            <Icon
              icon="pencil"
              tooltip="Edit queued message"
              class="abele-ai-chat__queued-edit"
              @click="onEditQueued(q.id)"
            />
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
        <div
          v-if="currentQuestion"
          class="abele-ai-chat__questions"
          :data-attention-id="session?.attention?.value.question?.id"
        >
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

        <div v-if="reconnecting" class="setting-item-description" role="status" aria-live="polite">
          {{ reconnecting === 'waiting' ? 'Waiting to reconnect when the app returns…' : 'Reconnecting…' }}
        </div>
        <LocalAttentionPanel v-if="session" :session="session" />

        <!-- Error -->
        <div v-if="error" class="abele-ai-chat__error">
          <div class="abele-ai-chat__error-line">
            <Icon icon="alert-triangle" />
            <span>{{ error }}</span>
          </div>
          <div v-if="retrying" class="abele-ai-chat__error-line">
            <span>
              Trying again in {{ retrying.secondsLeft }}s ({{ retrying.attempt }} of
              {{ retrying.of }})
            </span>
          </div>
          <div class="abele-ai-chat__error-actions">
            <button @click="onRetryRequest">{{ retrying ? 'Retry now' : 'Retry' }}</button>
            <button v-if="retrying" @click="session?.cancelAutoRetry()">Stop trying</button>
            <button v-if="hasFallbackModel" @click="onRetryWithFallback">
              Retry on {{ fallbackModelName }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="navigationBadge" class="abele-ai-chat__continuation setting-item-description">
        <button type="button" @click="openNavigation(navigationBadge.fork.id)">
          Continuation {{ navigationBadge.index + 1 }} of {{ navigationBadge.fork.choices.length }} · Show fork
        </button>
      </div>
      <div v-if="pendingNavigation" class="abele-ai-chat__navigation-pending setting-item-description" aria-live="polite">
        {{ pendingNavigation.label }}
        <button type="button" @click="cancelPendingNavigation">Cancel branch switch</button>
      </div>
      <!-- Input -->
      <AiChatInput
        ref="chatInput"
        v-model:expanded="composing"
        :is-streaming="isStreaming || isExecutingTool || interceptorWorking || interceptorStreaming"
        :is-busy="isBusy"
        :attachment-owner="attachmentOwner"
        :conversation-draft="session?.draft.value"
        :owns-conversation="importBridge.owns"
        :is-current-conversation="isCurrentImportConversation"
        :attachment-ready="importBridge.ready"
        :can-continue="showContinue"
        :token-display="tokenDisplay"
        :scope-label="scopeCompact"
        :can-note="commentSession"
        :note-blocked="midTurn"
        @send="onSend"
        @note="onNote"
        @command="onCommand"
        @abort="onAbort"
        @continue="onContinue"
        @focus="onInputFocus"
        @open-scope="openSetup('scope')"
      />
    </template>

    <!-- Modals -->
    <ChatArtifacts
      v-if="artifactsSession"
      :session="artifactsSession"
      @close="artifactsSession = null"
      @reveal="revealArtifactMessage"
    />
    <AiReplyRevisionDialog
      v-if="replyReview"
      :proposal="replyReview.proposal"
      :decide="replyReview.decide"
      @close="replyReview = null"
    />
    <AiChatHistory v-if="historyOpen" @close="historyOpen = false" @select="onLoadChat" />
    <ChatNavigation
      v-if="navigationOpen && session"
      :messages="messages"
      :all-messages="allMessages"
      :comments="session.messageComments.value"
      :state="navigationState"
      :active-message-id="navigationActiveMessage"
      :can-go-back="navigationReturns.length > 0"
      :pending="pendingNavigation?.label"
      :focus-fork="navigationFocusFork"
      @cancel-pending="cancelPendingNavigation"
      @close="navigationOpen = false"
      @jump="navigationJump"
      @start="navigationJump(messages.find(m => !m.draft)?.id ?? '')"
      @latest="navigationLatest"
      @back="navigationBack"
      @discussion="navigationDiscussion"
    />
    <AiRewindDialog
      v-if="rewinding && session"
      :rewind="session.rewind"
      :mode="rewinding.mode"
      :message-id="rewinding.messageId"
      :since="rewinding.since"
      @conversation="onEditMessage"
      @close="rewinding = null"
    />
    <AiChatSetup
      v-if="setupOpen"
      :open="setupTab"
      @close="setupOpen = false"
      @skill="onPickerSkill"
      @prompt="onPromptSelected"
      @reload="reloadChat"
      @debug="showDebug"
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
import { ref, shallowRef, watch, watchEffect, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { Notice, Platform, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import AgentsButton from './AgentsButton.vue'
import LocalAttentionPanel from './LocalAttentionPanel.vue'
import Markdown from './obsidian/Markdown.vue'
import AiChatMessage from './AiChatMessage.vue'
import ChatSelectionBar from './ChatSelectionBar.vue'
import ChatAnchorHistory from './ChatAnchorHistory.vue'
import type { ChatAnchor, ChatAnchorResolution } from '@/selection/types'
import AiReplyRevisionDialog from './AiReplyRevisionDialog.vue'
import type { ReplyProposal } from '@/ai/replyAnnotations'
import type { HighlightColor } from '@/reader/highlights'
import ChatFindBar from './ChatFindBar.vue'
import { useChatFind } from '@/composables/useChatFind'
import { useFindKey } from '@/composables/useFindKey'
import type { FindPart } from '@/ai/chatFind'
import { useTailPagedList } from '@/composables/useTailPagedList'
import { useChatKeyboardGap } from '@/composables/useChatKeyboardGap'
import AiChatInput from './AiChatInput.vue'
import AiChatTabs from './AiChatTabs.vue'
import AiRunView from './AiRunView.vue'
import EmptyState from './obsidian/EmptyState.vue'
import NodeChatView from './NodeChatView.vue'
import NodeDelegations from './NodeDelegations.vue'
import { newChatMenu } from '@/node/openSession'
import AiToolApproval from './AiToolApproval.vue'
import AiAgentSelector from './AiAgentSelector.vue'
import AiChatHistory from './AiChatHistory.vue'
import ChatNavigation from './ChatNavigation.vue'
import { navigationPath, type NavigationState } from '@/ai/chatNavigation'
import { buildNavigationTree, navigationFork, selectedNavigationFork } from '@/ai/chatNavigationBranches'
import AiRewindDialog from './AiRewindDialog.vue'
import AiChatSetup from './AiChatSetup.vue'
import AiCommentTrail from './AiCommentTrail.vue'
import { CommentService } from '@/ai/CommentService'
import TemplateVariablesModal from './TemplateVariablesModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatService, type PendingInput } from '@/ai/ChatService'
import { fileMentions } from '@/ai/fileMentions'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseTemplateVariables, applyTemplateVariables } from '@/templates/TemplateParser'
import { allowTemplateExecution } from '@/templates/TemplateTrust'
import type { TemplateVariable } from '@/templates/TemplateParser'
import type { MessageComment } from '@/ai/types'
import { sameConversation, type ConversationOwner } from '@/ai/draftImports'
import { revealAnchor, captureSelectionLink } from '@/ai/openChat'
import { ScriptService } from '@/scripting/ScriptService'
import { selectionMenu } from '@/scripting/selectionMenuScripts'
import { captureChatScriptTarget, chatScriptAction } from '@/scripting/runFromChat'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { getChildren } from '@/ai/chatTree'
import { isChatLog } from '@/ai/chatText'
import { insertMessageCard } from '@/ai/messageCards'
import ChatArtifacts from './ChatArtifacts.vue'
import type { ChatSession } from '@/ai/ChatSession'

const chatService = ChatService.getInstance()
chatService.ensureInitialized()
const session = computed(() => chatService.activeSession.value)
const nodeSession = computed(() => chatService.activeTabId.value ? chatService.getNodeSession(chatService.activeTabId.value) : null)
const attachmentOwner = computed<ConversationOwner | undefined>(() => {
  const id = chatService.activeTabId.value
  return id ? { sessionId: id, version: session.value?.conversationVersion?.value ?? 0 } : undefined
})

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
const replyReviews = computed(() => session.value?.interceptor.replyReviews.value ?? {})
/** A script deciding about a message: the composer offers stop, which keeps the message back. */
const interceptorWorking = computed(() => session.value?.interceptor.working?.value ?? false)
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

    const s = chatService.getPresentation(id)
    const label = s?.label.value || 'New chat'
    return {
      id,
      label,
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

/**
 * The beginnings of this conversation, when there are several: every message without a
 * parent, and which of them the visible path starts from. The switcher under a message
 * covers that message's children; a root has no message above it to carry one.
 */
const rootBranches = computed(() => {
  const roots = allMessages.value.filter((m) => !m.parentId)
  const first = messages.value[0]
  if (roots.length < 2 || !first) return null
  return { ids: roots.map((m) => m.id), index: roots.findIndex((m) => m.id === first.id) }
})

const switchRoot = (step: number) => {
  const roots = rootBranches.value
  if (!roots) return
  const id = roots.ids[roots.index + step]
  if (id) onSwitchBranch(id)
}

const onCloneChat = (messageId: string) => {
  const owner = session.value
  if (owner) void chatService.cloneChatFromMessage(owner.id, messageId)
}

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

const onInsertIntoNote = (messageId: string) => {
  const s = session.value
  if (s) void insertMessageCard(s, messageId)
}

/** The chat's comments, by the answer each is on. */
const commentsOn = computed(() => {
  const byMessage = new Map<string, MessageComment[]>()
  for (const comment of session.value?.messageComments.value ?? []) {
    const list = byMessage.get(comment.message) ?? []
    list.push(comment)
    byMessage.set(comment.message, list)
  }
  return byMessage
})

/**
 * Where "Ask here" is offered on a message: any conversation with a file to keep its comments
 * in — a chat, and a comment too. Asked inside a comment, the new one takes the comment tab
 * and the one it came from steps back behind it, still alive; the trail over the messages is
 * the way back up, to any depth.
 */
const canComment = computed(
  () =>
    (session.value?.kind === 'chat' || session.value?.kind === 'comment') &&
    !!session.value?.currentChatFile.value
)

const onAskHere = (messageId: string, quote?: string, start?: number) => {
  const s = session.value
  if (s) void CommentService.getInstance().createOnMessage(s, messageId, quote, start)
}

const replyReview = shallowRef<{
  proposal: ReplyProposal
  decide: (accept: boolean) => Promise<void>
} | null>(null)
const reportReplyError = (error: unknown) =>
  new Notice(error instanceof Error ? error.message : String(error))
const captureLink = (id: string, quote: string, start: number, text: string) => {
  const s = session.value
  if (!s) return undefined
  const prepare = captureSelectionLink(s, id, quote, start, text)
  return () => { void prepare().then((link) => navigator.clipboard.writeText(link)).catch(reportReplyError) }
}
// Read at menu capture: changing the scripts folder can replace the service singleton.
const selectionScripts = () => {
  const config = AbeleConfig.getInstance()
  return selectionMenu(
    ScriptService.getInstance().getAll(),
    config.ai.chatSelectionScripts ?? [],
    'chat'
  )
}
const captureScript = (id: string, quote: string, start: number, text: string) => {
  if (!AbeleConfig.getInstance().ai.scriptsEnabled) return undefined
  const owner = session.value
  if (!owner) return undefined
  const target = captureChatScriptTarget(owner, id, quote, start, text)
  return target ? chatScriptAction(GlobalStore.getInstance().app, target) : undefined
}
const anchorHistory = shallowRef<{ anchor: ChatAnchor; resolution: ChatAnchorResolution } | null>(null)
let anchorReturnGeneration = 0

const onHighlight = (id: string, quote: string, start: number, color: HighlightColor) => {
  void session.value?.highlightReply(id, quote, start, color).catch(reportReplyError)
}
const onRecolorHighlight = (id: string, highlight: string, color: HighlightColor) => {
  void session.value?.recolorReplyHighlight(id, highlight, color).catch(reportReplyError)
}
const onRemoveHighlight = (id: string, highlight: string) => {
  void session.value?.removeReplyHighlight(id, highlight).catch(reportReplyError)
}
const onUndoRevision = (id: string) => {
  void session.value?.undoReplyRevision(id).catch(reportReplyError)
}
const onReviewRevision = (id: string) => {
  const owner = session.value
  const proposal = owner?.allMessages.value.find((message) => message.id === id)?.replyProposal
  if (!owner || !proposal || (proposal.status !== 'pending' && proposal.application !== 'pending')) return
  replyReview.value = { proposal, decide: (accept) => owner.decideReplyProposal(id, accept) }
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

/**
 * Rewind: in a chat or a comment, which keep a log of what their agent changed. A delegated
 * run's changes are in the log of the chat that delegated it.
 */
const canRewind = computed(
  () => session.value?.kind === 'chat' || session.value?.kind === 'comment'
)

/** User messages whose turns changed files that can still be put back. */
const changedTurns = computed<Set<string>>(() => {
  const s = session.value
  // A stand-in session — a test's — may have no log at all.
  const entries = canRewind.value ? s?.rewind?.entries.value : undefined
  return new Set((entries ?? []).map((e) => e.turn))
})

const rewinding = ref<{ messageId: string; mode: 'since' | 'turn'; since: number } | null>(null)

const onRewind = (messageId: string, mode: 'since' | 'turn') => {
  const msg = session.value?.allMessages.value.find((m) => m.id === messageId)
  if (!msg) return
  rewinding.value = { messageId, mode, since: msg.timestamp }
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
  s.draft.value.editingDraftId = messageId
  s.draft.value.text = msg.content
}

const onSendInterceptor = async (messageId: string, content: string) => {
  await session.value?.sendInterceptorMessage(messageId, content)
}

const onRetryInterceptor = async (messageId: string) => {
  await session.value?.retryInterceptor(messageId)
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

// The command that searches every chat: whichever chat is on screen takes it and opens its
// history on the search, and says so by setting the request back.
watch(
  () => [chatService.historyRequest.value, chatContainer.value] as const,
  ([asked, el]) => {
    if (!asked || !el) return
    chatService.historyRequest.value = false
    historyOpen.value = true
  },
  { immediate: true, flush: 'post' }
)

/**
 * A comment being read in this tab.
 *
 * The file, the kind and the agent are `CommentService`'s; what the tab lends it is this view.
 * Everything an ordinary chat can do it can do — «оставить все те же действия» — and it has
 * one thing of its own: half of what people write into a comment is a note rather than a
 * question, and a model run over that is a wait and a cost for an answer nobody wanted.
 */
const commentSession = computed(() => session.value?.kind === 'comment')

/**
 * A turn the conversation may not be moved out from under — see `ChatSession.isMidTurn` — and
 * a move already under way. Promotion rebinds the agent and rewrites what the file says this
 * is, neither of which may happen between a `tool_use` and its result.
 */
const midTurn = computed(() => !!session.value?.isMidTurn)
const moving = computed(() => !!session.value?.moving.value)
const blocked = computed(() => midTurn.value || moving.value)
const blockedTooltip = computed(() =>
  moving.value
    ? 'This comment is being moved'
    : 'The agent is still working — finish or dismiss the pending step first'
)

/**
 * Back to the passage: the note is opened and scrolled to the marker.
 *
 * The tab stays. Nothing is handed back and nothing is closed — this is navigation, and the
 * conversation is where the person was just reading it.
 */
async function backToNote(): Promise<void> {
  const current = session.value
  const id = current?.commentId
  const anchor = current?.anchor.value
  if (!id || !anchor?.note) return

  // A comment on a message goes back to that message, in its chat or in the comment above it;
  // a discussion in a book, to its words there.
  await revealAnchor(id, anchor)
}

/**
 * The promotion: a comment becomes an ordinary chat in the tab it is already in.
 *
 * What happens on screen is the header losing these two actions; what happens underneath is
 * the default agent, an entry in the history and the anchor kept, so the marker still leads
 * here. Refused mid-turn, and while the same move is already running.
 */
async function openAsChat(): Promise<void> {
  const id = session.value?.commentId
  if (!id) return

  if (moving.value) {
    new Notice('Already moving this comment')
    return
  }
  const moved = await CommentService.getInstance().expand(id)
  if (moved === 'busy') new Notice('Finish or dismiss the pending step first')
}

/**
 * Kept, not asked: the words join the conversation and no agent is started.
 *
 * The session refuses one in the middle of a turn — the composer's button is already dark
 * there, so this is the race between the two, and a refusal that said nothing would look
 * exactly like a note that was saved.
 */
async function onNote(text: string): Promise<void> {
  const kept = await session.value?.addUserNote(text)
  if (kept === false) new Notice('Finish or dismiss the pending step first')
}

/**
 * The one dialog everything about a chat lives in, and which tab it opens on.
 *
 * A way in that used to be its own dialog still lands on the thing it was about: the scope
 * badge in the composer opens the scope, `/prompt` the prompts.
 */
const setupOpen = ref(false)
const setupTab = ref('scope')

const openSetup = (tab = 'scope') => {
  setupTab.value = tab
  setupOpen.value = true
}

const artifactsSession = shallowRef<ChatSession | null>(null)
watch(session, () => {
  artifactsSession.value = null
})
const revealArtifactMessage = async (messageId: string) => {
  const owner = artifactsSession.value
  artifactsSession.value = null
  if (owner && session.value === owner) {
    composing.value = false
    // Opening or revealing a file can replace the chat drawer on a phone. Put the
    // conversation back on screen before measuring and scrolling its source message.
    await chatService.revealSidebar({ focus: false })
    if (session.value === owner) await revealMessage(messageId)
  }
}
const variablesModalOpen = ref(false)
const pendingPromptContent = ref('')
let pendingPromptAllowsMethods = false
const pendingPromptAllVars = ref<TemplateVariable[]>([])
const pendingPromptUserVars = ref<TemplateVariable[]>([])

const AUTO_SCROLL_THRESHOLD_PX = 60
/** How close to the top counts as asking for the messages above. */
const LOAD_OLDER_THRESHOLD_PX = 200
let shouldAutoScroll = true

/**
 * Where the code last left the scroll, for telling its own scrolling from the reader's.
 *
 * A position rather than a flag saying the next scroll event is the code's. That flag was
 * wrong whenever a scroll produced no event to spend it on — scrolling to the bottom of a
 * chat already at its bottom changes nothing, and nothing is what the browser reports — and
 * the reader's next scroll was then read as the code's and ignored, which is how a chat being
 * streamed into pulled them back down the moment they scrolled up to read something.
 */
let codeScrollTop: number | null = null

/** How far above the end of the conversation the reader is; kept across a change of box. */
let bottomGap = 0

/** Scrolls the container, remembering where the browser actually settled. */
const scrollContainerTo = (el: HTMLElement, top: number) => {
  el.scrollTop = top
  codeScrollTop = el.scrollTop
  bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
}

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
  showFrom: showMessagesFrom,
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
  scrollContainerTo(container, container.scrollTop + drift)
}

/**
 * The reader taking over, told from their input rather than from a scroll event.
 *
 * A scroll event says where the container is, not who put it there, and while the anchor is
 * held that is not enough: the reader scrolls, the hold puts the container back in the same
 * frame, and the browser reports the two as one event reading exactly the held position —
 * indistinguishable from the hold correcting itself. So the hold held on, and the chat
 * refused to scroll back for as long as it lasted. A wheel, a finger, a key or the scrollbar
 * being taken hold of says what the scroll event cannot.
 */
const readerTakesOver = (event?: Event) => {
  anchor = null
  // Heading up, said before the frame reports any scroll: a piece of the reply landing in
  // between used to take a reader still near the end back to it, flick after flick.
  // By type rather than by class: a chat in a popped-out window gets that window's events.
  const up =
    event?.type === 'wheel'
      ? (event as WheelEvent).deltaY < 0
      : event?.type === 'keydown' && SCROLL_UP_KEYS.has((event as KeyboardEvent).key)
  if (up) shouldAutoScroll = false
}

const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

/**
 * A finger on the screen. Nothing is scrolled under it, whichever way it is about to move:
 * following the end resumes once it lets go at the end, as the scroll events then say.
 */
let fingerDown = false
const fingerOn = (event: Event) => {
  fingerDown = true
  readerTakesOver(event)
}
const fingerOff = () => {
  fingerDown = false
  // Where the finger left it, read now: the scroll it made may not have been reported yet, and
  // the next piece of the reply would otherwise take a reader who went up for one still following.
  const el = messagesContainer.value
  if (!el) return
  bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
  shouldAutoScroll = bottomGap < AUTO_SCROLL_THRESHOLD_PX
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
  void nextTick(() => holdAnchorAWhile(el))
}

/**
 * The next frame, or a moment later when no frame comes. A window behind others draws none, and
 * whatever waited for one there — a reveal, a hold — waited until Obsidian was brought forward.
 */
const nextFrame = (win: Window, run: () => void) => {
  if (closed) return
  let done = false
  const once = () => {
    if (done) return
    done = true
    pendingFrames.delete(cancel)
    run()
  }
  const frame = win.requestAnimationFrame(once)
  const timer = win.setTimeout(once, 50)
  const cancel = () => {
    done = true
    win.cancelAnimationFrame(frame)
    win.clearTimeout(timer)
  }
  pendingFrames.add(cancel)
}

/**
 * Frames still asked for, so a chat that closes stops asking. A hold runs on for a moment and
 * would otherwise go on moving a container that is no longer on the page.
 */
const pendingFrames = new Set<() => void>()
let closed = false
onUnmounted(() => {
  closed = true
  anchor = null
  for (const cancel of pendingFrames) cancel()
  pendingFrames.clear()
})

/** Keeps the anchor where it is for as long as the messages around it take to render. */
const holdAnchorAWhile = (el: HTMLElement) => {
  // The chat can be in a popped-out window, whose frames and clock are not the main one's.
  const win = el.win
  const until = win.performance.now() + ANCHOR_HOLD_MS
  const hold = () => {
    if (!anchor) return
    holdAnchor()
    if (win.performance.now() < until) nextFrame(win, hold)
    else anchor = null
  }
  nextFrame(win, hold)
}

/**
 * The reader's place while the conversation changes under it — a reply ending and becoming a
 * message, a tool call arriving, a message taking the place of another — for a reader who is
 * not following the end.
 *
 * Kept as the block at the top of the box, a paragraph or a chart of a message, and where it
 * sits in the conversation. Whatever moves that block up or down is layout, and is taken back
 * out of the scroll; the reader scrolling moves the box, not the block, so it is never fought.
 * That is what the browser's own scroll anchoring does too, and the two cannot both correct the
 * same change: the browser's is off for as long as this one holds.
 *
 * A reply that ended used to take the reader to the end of the chat. The message replacing it
 * started empty, the scroll range collapsed under the reader, the browser clamped them to the
 * new end, and a chat at its end follows it. The message now takes over what the reply drew
 * (`markdownParts.ts`), and this covers what still differs between the two: the reasoning
 * folded away, the message's own chrome.
 */
const STEADY_MS = 1500
let steady: { el: HTMLElement; at: number; until: number } | null = null

/** Where an element sits in the conversation, whatever the scroll. */
const placeOf = (el: HTMLElement, container: HTMLElement) =>
  offsetOf(el, container) + container.scrollTop

/** The block at the top of the box: the first of a message's rendered blocks still in view. */
const blockAtTop = (container: HTMLElement): HTMLElement | null => {
  const top = container.getBoundingClientRect().top
  const inView = (el: Element) => el.getBoundingClientRect().bottom > top + 1
  const item = Array.from(container.children).find(inView)
  if (!item?.instanceOf(HTMLElement)) return null
  const blocks = item.querySelectorAll<HTMLElement>('.abele-markdown > *')
  return Array.from(blocks).find((b) => b.getClientRects().length && inView(b)) ?? item
}

const endSteady = (container?: HTMLElement | null) => {
  steady = null
  container?.classList.remove('abele-ai-chat__messages_steady')
}

/** Takes back out of the scroll whatever moved the block since it was last looked at. */
const holdSteady = () => {
  const container = messagesContainer.value
  if (!container || !steady) return
  const { el } = steady
  if (
    !el.isConnected ||
    !el.getClientRects().length ||
    container.win.performance.now() > steady.until
  ) {
    endSteady(container)
    return
  }
  const at = placeOf(el, container)
  const moved = at - steady.at
  // Another hold is putting the reader back already — a page revealed above them.
  if (!anchor && Math.abs(moved) >= 1) scrollContainerTo(container, container.scrollTop + moved)
  steady.at = at
}

/**
 * The scroll range kept at least as long as it was before the page changed, until what changed
 * has drawn again.
 *
 * A reply that ends moves its text into the message that replaces it, and for a moment the
 * message is on the page with nothing drawn in it. WebKit, which a phone runs, clamps the scroll
 * position the moment anything reads the layout, and in that moment the conversation ends where
 * the reply began: a reader halfway down the reply was put there, on a short chat at its very
 * top, and nothing put them back. A desktop's browser clamps with the frame, when the text is
 * back, so it was seen on a phone only. A floor under the content, as tall as the content was,
 * leaves the browser nothing to clamp.
 */
const FLOOR_CLASS = 'abele-ai-chat__messages_floor'
const FLOOR_VAR = '--abele-chat-floor'
let floorUntil = 0

const releaseFloor = (container: HTMLElement) => {
  container.classList.remove(FLOOR_CLASS)
  container.style.removeProperty(FLOOR_VAR)
}

/** Where the content itself ends, below the top of the conversation, floor or no floor. */
const contentEnd = (container: HTMLElement) => {
  const last = container.lastElementChild
  if (!last?.instanceOf(HTMLElement)) return 0
  const pad = parseFloat(container.win.getComputedStyle(container).paddingBottom) || 0
  return placeOf(last, container) + last.getBoundingClientRect().height + pad
}

const holdFloor = (container: HTMLElement) => {
  const win = container.win
  const fresh = !container.classList.contains(FLOOR_CLASS)
  const floor = Math.max(
    container.scrollHeight,
    parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0
  )
  container.style.setProperty(FLOOR_VAR, `${floor}px`)
  container.classList.add(FLOOR_CLASS)
  floorUntil = win.performance.now() + STEADY_MS
  if (!fresh) return
  const check = () => {
    if (!container.classList.contains(FLOOR_CLASS)) return
    const want = parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0
    if (closed || win.performance.now() > floorUntil || contentEnd(container) >= want - 1)
      releaseFloor(container)
    else nextFrame(win, check)
  }
  nextFrame(win, check)
}

/** Starts holding the reader's place, from before the change about to happen to the page. */
const steadyReader = () => {
  const container = messagesContainer.value
  if (!container || shouldAutoScroll || closed) return
  holdFloor(container)
  const el = blockAtTop(container)
  if (!el) return
  const win = container.win
  const fresh = !steady
  steady = { el, at: placeOf(el, container), until: win.performance.now() + STEADY_MS }
  container.classList.add('abele-ai-chat__messages_steady')
  if (!fresh) return
  const hold = () => {
    if (!steady) return
    holdSteady()
    if (steady) nextFrame(win, hold)
  }
  nextFrame(win, hold)
}

// Before the page changes: a message added, removed or replaced, a reply starting or ending.
watch(
  [() => messages.value.map((m) => m.id).join(), () => !!streamingContent.value, isStreaming],
  steadyReader,
  { flush: 'pre' }
)

/**
 * Where the reader was in each tab they have left, so going back puts them there again.
 *
 * Every tab is read in the same container, and switching used to send each one to its end —
 * reading back through one conversation, looking at another and coming back lost the place.
 * Kept as the message at the top of the box and its distance from the top, plus how far back
 * the window had been opened, rather than as a pixel offset: the messages mount afresh on the
 * way back and render their markdown late, and a pixel offset would land on whatever was there
 * before they had grown. A reader who was at the end has no entry: they go back to the end,
 * including whatever arrived while they were away, as a messenger does. Memory only — a
 * restart opens every chat at its end, as before.
 */
interface ReadingPlace {
  messageId: string
  offset: number
  hidden: number
}
const places = new Map<string, ReadingPlace>()

/** Notes where the reader is in the tab being left. The DOM still shows that tab. */
const rememberPlace = (tabId: string) => {
  places.delete(tabId)
  const el = messagesContainer.value
  // A tab a delegated run holds has no conversation on screen, and so no place in it.
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX) return
  const top = el.getBoundingClientRect().top
  const first = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(
    (m) => m.getBoundingClientRect().bottom > top
  )
  const messageId = first?.dataset.messageId
  if (!first || !messageId) return
  places.set(tabId, { messageId, offset: offsetOf(first, el), hidden: olderCount.value })
}

/**
 * Takes the reader back to a remembered place, once the tab's messages are on the page.
 *
 * A message that is no longer there — a branch switched, the history compacted — leaves
 * nothing to go back to, and the chat opens at its end as any other would.
 */
const returnTo = async (place: ReadingPlace) => {
  const index = messages.value.findIndex((m) => m.id === place.messageId)
  if (index >= 0) {
    showMessagesFrom(Math.min(place.hidden, index))
    await nextTick()
    const el = messagesContainer.value
    const target = el?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(place.messageId)}"]`
    )
    if (el && target) {
      anchor = { el: target, offset: place.offset }
      holdAnchor()
      // Measured here too: a place already in position is not scrolled to, and a keyboard
      // opening next would otherwise keep the distance to the end of the tab just left.
      bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
      holdAnchorAWhile(el)
      return
    }
  }
  scrollOnUserSend()
}

const onMessagesScroll = () => {
  const el = messagesContainer.value
  if (!el) return
  // The box has changed height and its observer has not run yet: this is the browser clamping
  // the position to the new box, not the reader, and the observer is about to put the reader
  // back where they were. The browser reports the clamp before it reports the resize.
  if (boxHeight === null) boxHeight = el.clientHeight
  if (el.clientHeight !== boxHeight) return
  // The container is exactly where it was put, so nobody has moved it since.
  if (codeScrollTop !== null && Math.abs(el.scrollTop - codeScrollTop) < 1) return
  codeScrollTop = null
  // The reader has taken over; whatever was being held is where they left it.
  anchor = null
  bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
  shouldAutoScroll = bottomGap < AUTO_SCROLL_THRESHOLD_PX
  if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder()
}

const doScroll = () => {
  if (!shouldAutoScroll || fingerDown) return
  nextTick(() => {
    const el = messagesContainer.value
    // Asked again: the reader may have scrolled away in the tick between.
    if (!el || !shouldAutoScroll || fingerDown) return
    scrollContainerTo(el, el.scrollHeight)
  })
}

const scrollOnUserSend = () => {
  shouldAutoScroll = true
  doScroll()
}

watch([messages, streamingContent, streamingThinking], () => {
  // Markdown may still be waiting for its display slot. Keep the resize anchor current
  // even when the conversation grows without a completed Markdown mutation in this tick.
  keepGapCurrent()
  doScroll()
})

/**
 * The composer opened out over the whole chat, for writing at length (`AiChatInput`). The
 * conversation is hidden under it, and put back where the reader left it when it closes — or
 * at its end, if that is where they were.
 */
const composing = ref(false)
let gapBeforeComposing = 0

watch(composing, (open) => {
  const el = messagesContainer.value
  if (open) {
    gapBeforeComposing = bottomGap
    return
  }
  void nextTick(() => {
    if (!el || !messagesContainer.value) return
    boxHeight = el.clientHeight
    if (shouldAutoScroll) scrollContainerTo(el, el.scrollHeight)
    else scrollContainerTo(el, el.scrollHeight - el.clientHeight - gapBeforeComposing)
  })
})

// Something the agent cannot go on without is shown in the conversation; it is not left
// waiting under the composer. What was written stays in the field.
watch(
  () => !!pendingApprovalMessage.value || !!currentQuestion.value,
  (waiting) => {
    if (waiting) composing.value = false
  }
)

/** How far below the top of the box a message brought into view sits: clear of the edge. */
const REVEAL_OFFSET_PX = 16
const REVEAL_CONTEXT = 3

/**
 * Brings one message into view — a card for it in a note was pressed.
 *
 * A message on another branch has its branch switched to first, the way the branch arrows
 * would. It is then held in place while the messages around it render, as a remembered place
 * is, and flashed so the eye finds it.
 */
let revealing = 0
const revealMessage = async (
  messageId: string,
  passage?: { quote: string; start?: number },
  exact?: Extract<ChatAnchorResolution, { status: 'current' }>,
  flashWholeMessage = true,
  currentBranchOnly = false
) => {
  const generation = ++revealing
  const s = session.value
  if (!s) return
  if (!s.messages.value.some((m) => m.id === messageId)) {
    if (currentBranchOnly) {
      new Notice('That message is no longer in the current branch')
      return
    }
    if (!s.allMessages.value.some((m) => m.id === messageId)) {
      new Notice('That message is no longer in this chat')
      return
    }
    s.switchBranch(messageId)
  }
  // Once whatever the tab switch did to the scroll has run.
  await nextTick()
  const box = messagesContainer.value
  if (box) await new Promise<void>((resolve) => nextFrame(box.win, resolve))

  if (session.value !== s || generation !== revealing) return
  const index = messages.value.findIndex((m) => m.id === messageId)
  if (index < 0) return
  // A few before it too, so it does not sit flush against the top with nothing to scroll to.
  showMessagesFrom(Math.max(0, index - REVEAL_CONTEXT))
  await nextTick()
  const el = messagesContainer.value
  const target = el?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
  if (!el || !target || session.value !== s || generation !== revealing) return
  let selected: HTMLElement | null | undefined
  if (passage || exact) {
    const until = Date.now() + 3000
    do {
      selected = exact
        ? messageRefs.get(messageId)?.revealSelection(exact.revision, exact.placement.range)
        : messageRefs.get(messageId)?.revealPassage(passage!.quote, passage!.start)
      if (selected !== undefined) break
      await new Promise<void>(resolve => el.win.setTimeout(resolve, 30))
      if (session.value !== s || generation !== revealing || !target.isConnected) return
    } while (Date.now() < until)
  }
  shouldAutoScroll = false
  anchor = { el: selected ?? target, offset: REVEAL_OFFSET_PX }
  holdAnchor()
  bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
  holdAnchorAWhile(el)
  if (!selected && !exact && flashWholeMessage) {
    target.classList.remove('abele-footnote-flash')
    void target.offsetWidth
    target.classList.add('abele-footnote-flash')
    window.setTimeout(() => target.classList.remove('abele-footnote-flash'), 2500)
  }
  return !!selected
}

// ── Find in this chat ──

/** The mounted messages, for unfolding the part of one a match is in. */
const messageRefs = new Map<string, InstanceType<typeof AiChatMessage>>()
const keepMessageRef = (id: string, component: unknown) => {
  if (component) messageRefs.set(id, component as InstanceType<typeof AiChatMessage>)
  else messageRefs.delete(id)
}

const find = useChatFind({
  messages: () => messages.value,
  container: () => messagesContainer.value,
  hidden: () => olderCount.value,
  mountFrom: (index) => showMessagesFrom(index),
  revealPart: (messageId: string, part: FindPart) => messageRefs.get(messageId)?.revealPart(part),
  holdInView: (el, offset) => {
    const box = messagesContainer.value
    if (!box) return
    // A reader taken to a match is reading back, not following the end.
    shouldAutoScroll = false
    anchor = { el, offset }
    holdAnchor()
    bottomGap = box.scrollHeight - box.scrollTop - box.clientHeight
    holdAnchorAWhile(box)
  },
})

// ── Navigation: memory only, never a branch selection or a send ──
const navigationOpen = ref(false)
const navigationActiveMessage = ref<string>()
const navigationState = shallowRef<NavigationState>({ expanded: [], scrollTop: 0 })
const navigationMemory = new WeakMap<ChatSession, { version: number; state: NavigationState; indicator?: NavigationIndicator | null }>()
const navigationFocusFork = ref<string>()
interface NavigationIndicator { owner: ChatSession; version: number; parentId?: string }
const navigationIndicator = shallowRef<NavigationIndicator | null>(null)
const indicatorFor = (owner: ChatSession) => {
  const indicator = navigationIndicator.value?.owner === owner ? navigationIndicator.value : navigationMemory.get(owner)?.indicator
  return indicator?.version === owner.conversationVersion.value ? indicator : null
}
const rememberNavigationIndicator = (owner: ChatSession, indicator: NavigationIndicator | null) => {
  const memory = navigationMemory.get(owner) ?? { version: owner.conversationVersion.value, state: { expanded: [], scrollTop: 0 } }
  memory.indicator = indicator
  navigationMemory.set(owner, memory)
  navigationIndicator.value = indicator
}
const navigationBadge = computed(() => {
  const owner = session.value
  const indicator = owner ? indicatorFor(owner) : null
  if (!indicator || !owner) return null
  const fork = navigationFork(buildNavigationTree(owner.allMessages.value), indicator.parentId, owner.messages.value.map(m => m.id))
  const index = fork?.choices.findIndex(choice => choice.selected) ?? -1
  return fork && index >= 0 ? { fork, index } : null
})
let navigationIntent = 0
interface PendingNavigation {
  owner: ChatSession
  source: ChatSession | null
  version: number
  selection: number
  intent: number
  label: string
  run: () => Promise<void>
}
const pendingNavigation = shallowRef<PendingNavigation | null>(null)
const branchBlocked = (owner: ChatSession) => owner.branchSwitchBlocked ??
  (owner.isMidTurn || owner.isExecutingTool.value || !!owner.retrying?.value || owner.interceptor.streaming.value || owner.moving.value)
const pendingIsCurrent = (pending: PendingNavigation) => !closed && !pending.owner.isDestroyed &&
  pending.source === session.value && pending.version === pending.owner.conversationVersion.value &&
  pending.selection === chatService.tabSelectionVersion && pending.intent === navigationIntent
const cancelPendingNavigation = () => { navigationIntent++; pendingNavigation.value = null }
const deferNavigation = (owner: ChatSession, run: () => Promise<void>) => {
  pendingNavigation.value = { owner, source: session.value, version: owner.conversationVersion.value,
    selection: chatService.tabSelectionVersion, intent: navigationIntent,
    label: 'Switch to the selected continuation when the agent finishes', run }
}
watch([pendingNavigation, session, () => pendingNavigation.value?.owner.messages.value,
  () => pendingNavigation.value ? branchBlocked(pendingNavigation.value.owner) : false], () => {
  const pending = pendingNavigation.value
  if (!pending) return
  if (!pendingIsCurrent(pending)) { pendingNavigation.value = null; return }
  if (branchBlocked(pending.owner)) return
  pendingNavigation.value = null
  void pending.run().catch(reportReplyError)
}, { flush: 'post' })
interface NavigationPlace {
  owner: ChatSession
  version: number
  leafId: string | null
  branchVersion: number
  grows: boolean
  indicator: NavigationIndicator | null
  place: ReadingPlace | null
}
const navigationReturns = shallowRef<NavigationPlace[]>([])
watchEffect(() => {
  for (const place of navigationReturns.value) {
    const owner = place.owner
    if (!place.grows || owner.isDestroyed || owner.conversationVersion.value !== place.version ||
        (owner.branchSelectionVersion ?? 0) !== place.branchVersion) continue
    if (place.leafId && owner.messages.value.some(message => message.id === place.leafId))
      place.leafId = owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? place.leafId
  }
}, { flush: 'sync' })
let navigationOpenedAt: NavigationPlace | null = null
const pruneNavigationReturns = () => {
  navigationReturns.value = navigationReturns.value.filter(
    (place) => !place.owner.isDestroyed && place.owner.conversationVersion.value === place.version
  )
}

const openNavigation = (forkId?: string) => {
  const owner = session.value
  if (!owner) return
  pruneNavigationReturns()
  const version = owner.conversationVersion.value
  let memory = navigationMemory.get(owner)
  if (!memory || memory.version !== version) {
    memory = { version, state: { expanded: [], scrollTop: 0 } }
    navigationMemory.set(owner, memory)
  }
  navigationFocusFork.value = forkId
  if (forkId && !memory.state.expanded.includes(`fork:${forkId}`)) memory.state.expanded.push(`fork:${forkId}`)
  navigationState.value = memory.state
  const el = messagesContainer.value
  const top = el?.getBoundingClientRect().top ?? 0
  const first = [...(el?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find(
    (m) => m.getBoundingClientRect().bottom > top
  )
  navigationActiveMessage.value = first?.dataset.messageId
  const atEnd = !el || el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX
  navigationOpenedAt = {
    owner,
    version,
    leafId: owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? null,
    branchVersion: owner.branchSelectionVersion ?? 0,
    grows: !owner.allMessages.value.some(message => message.parentId === (owner.branchLeafId ?? owner.messages.value.at(-1)?.id)),
    indicator: indicatorFor(owner),
    place:
      !atEnd && first?.dataset.messageId && el
        ? { messageId: first.dataset.messageId, offset: offsetOf(first, el), hidden: olderCount.value }
        : null,
  }
  navigationOpen.value = true
}
const saveNavigationReturn = () => {
  pruneNavigationReturns()
  const place = navigationOpenedAt
  if (
    !place ||
    place.owner !== session.value ||
    place.version !== place.owner.conversationVersion.value
  ) return
  const previous = navigationReturns.value.at(-1)
  if (previous?.owner !== place.owner || previous.version !== place.version)
    navigationReturns.value = [...navigationReturns.value, place]
}
const applyNavigationJump = async (owner: ChatSession, id: string, part?: FindPart, query?: string) => {
  const intent = navigationIntent
  const version = owner.conversationVersion.value
  if (session.value !== owner || !owner.allMessages.value.some(m => m.id === id && !m.draft)) return
  if (!owner.messages.value.some(m => m.id === id)) {
    if (branchBlocked(owner)) { deferNavigation(owner, () => applyNavigationJump(owner, id, part, query)); return }
    if (!owner.switchBranch(id)) { new Notice('That continuation is unavailable'); return }
    const chosen = selectedNavigationFork(buildNavigationTree(owner.allMessages.value), navigationPath(owner.allMessages.value, id))
    rememberNavigationIndicator(owner, chosen ? { owner, version, parentId: chosen.fork.parentId } : null)
  }
  shouldAutoScroll = false
  composing.value = false
  await revealMessage(id, undefined, undefined, true, true)
  if (session.value !== owner || owner.conversationVersion.value !== version || intent !== navigationIntent || !owner.messages.value.some(m => m.id === id)) return
  const revealPart = part ?? (owner.messages.value.find(m => m.id === id)?.role === 'tool-call' ? 'params' : undefined)
  if (revealPart) messageRefs.get(id)?.revealPart(revealPart)
  if (query) find.openAt(query, id, false, part)
}
const navigationJump = async (id: string, part?: FindPart, query?: string) => {
  const owner = session.value
  if (!owner || !id || !owner.allMessages.value.some(m => m.id === id && !m.draft)) return
  cancelPendingNavigation()
  saveNavigationReturn()
  navigationOpen.value = false
  await applyNavigationJump(owner, id, part, query)
}
const navigationLatest = () => {
  cancelPendingNavigation()
  saveNavigationReturn()
  navigationOpen.value = false
  anchor = null
  endSteady(messagesContainer.value)
  scrollOnUserSend()
}
const navigationDiscussion = async (id: string, messageId?: string, part?: FindPart, query?: string) => {
  const owner = session.value
  if (!owner) return
  cancelPendingNavigation()
  const intent = navigationIntent
  const version = owner.conversationVersion.value
  const selection = chatService.tabSelectionVersion
  const isCurrent = () =>
    !closed &&
    !owner.isDestroyed &&
    navigationIntent === intent &&
    owner.conversationVersion.value === version &&
    chatService.tabSelectionVersion === selection
  saveNavigationReturn()
  navigationOpen.value = false
  const comments = CommentService.getInstance()
  // Read first so a delayed file cannot take over a different chat. Opening uses the marker's
  // existing path, including replacing the one contextual tab for a nested discussion.
  const loaded = await comments.load(id)
  if (!isCurrent() || session.value !== owner) return
  const opened = loaded && (await comments.showInSidebar(id, isCurrent))
  if (!opened && isCurrent()) new Notice('Discussion could not be opened — it may be unavailable')
  if (opened && messageId && session.value === loaded && intent === navigationIntent)
    await applyNavigationJump(loaded, messageId, part, query)
}
const navigationPlaceExists = (saved: NavigationPlace) => {
  const owner = saved.owner
  const messageId = saved.place?.messageId
  return !owner.isDestroyed && owner.conversationVersion.value === saved.version &&
    (!saved.leafId || owner.allMessages.value.some(message => message.id === saved.leafId)) &&
    (!messageId || owner.allMessages.value.some(message => message.id === messageId))
}
const expireNavigationPlace = (saved: NavigationPlace) => {
  new Notice('The saved place is no longer in this conversation')
  navigationReturns.value = navigationReturns.value.filter((place) => place !== saved)
}
const restoreNavigationPlace = async (saved: NavigationPlace) => {
  const owner = saved.owner
  const currentLeaf = () => owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? null
  const needsBranch = () => saved.leafId !== currentLeaf()
  const intent = navigationIntent
  if (!navigationPlaceExists(saved)) { expireNavigationPlace(saved); return }
  if (needsBranch() && branchBlocked(owner)) { deferNavigation(owner, () => restoreNavigationPlace(saved)); return }
  const source = session.value
  const sourceVersion = source?.conversationVersion.value
  const selection = chatService.tabSelectionVersion
  const isCurrent = () => !closed && intent === navigationIntent &&
    owner.conversationVersion.value === saved.version && source?.conversationVersion.value === sourceVersion &&
    chatService.tabSelectionVersion === selection
  let returnPointExpired = false
  // The contextual tab is adopted before its phone drawer finishes revealing. Retire an
  // arrived return step at selection, so a second Back advances rather than repeating it.
  const stopSelected = watch(session, current => {
    if (current !== owner || intent !== navigationIntent || needsBranch()) return
    if (!navigationPlaceExists(saved)) {
      returnPointExpired = true
      expireNavigationPlace(saved)
    } else navigationReturns.value = navigationReturns.value.filter(place => place !== saved)
  }, { flush: 'sync' })
  try {
    if (owner.kind === 'comment' && owner.commentId) {
      if (source !== owner && !(await CommentService.getInstance().showInSidebar(owner.commentId, isCurrent))) return
    } else chatService.switchTab(owner.id)
  } finally {
    stopSelected()
  }
  if (returnPointExpired) return
  const selected = chatService.tabSelectionVersion
  await nextTick()
  if (session.value !== owner || intent !== navigationIntent || selected !== chatService.tabSelectionVersion || owner.conversationVersion.value !== saved.version) return
  // Opening a discussion can reconcile a changed file without replacing its lifetime.
  if (!navigationPlaceExists(saved)) {
    expireNavigationPlace(saved)
    return
  }
  if (needsBranch()) {
    if (branchBlocked(owner)) {
      deferNavigation(owner, () => restoreNavigationPlace(saved))
      return
    }
    if (!saved.leafId || !owner.switchBranch(saved.leafId, false)) {
      new Notice('The saved continuation is unavailable')
      return
    }
  }
  if (
    saved.place &&
    !owner.messages.value.some((message) => message.id === saved.place!.messageId)
  ) {
    expireNavigationPlace(saved)
    return
  }
  navigationReturns.value = navigationReturns.value.filter((place) => place !== saved)
  rememberNavigationIndicator(owner, saved.indicator)
  anchor = null
  endSteady(messagesContainer.value)
  shouldAutoScroll = saved.place === null
  if (saved.place) await returnTo(saved.place)
  else scrollOnUserSend()
}
const navigationBack = async () => {
  cancelPendingNavigation()
  pruneNavigationReturns()
  const saved = navigationReturns.value.at(-1)
  if (!saved) return
  navigationOpen.value = false
  await restoreNavigationPlace(saved)
}
watch(
  () => attachmentOwner.value,
  () => {
    navigationOpen.value = false
    pruneNavigationReturns()
  }
)

// The command that finds in the chat in front, taken by whichever chat is on screen.
watch(
  () => [chatService.findRequest.value, messagesContainer.value] as const,
  ([asked, el]) => {
    if (!asked || !el) return
    chatService.findRequest.value = false
    composing.value = false
    find.open()
  },
  { immediate: true, flush: 'post' }
)

useFindKey(chatContainer, () => {
  // A tab held by a delegated run has no conversation to search.
  if (!activeRun.value) find.open()
})

// Another chat loaded into this tab: the words were looked for in the one it replaced.
watch(
  () => session.value?.currentChatFile.value?.path,
  (path, before) => {
    if (before && path !== before) find.close()
  }
)

// A result of the search across chats: the chat it is in is opening in this tab, and the find
// bar opens on the words once its messages are here, at the message the result was.
watch(
  () =>
    [
      chatService.pendingFind.value,
      session.value?.currentChatFile.value?.path,
      messages.value.length,
      messagesContainer.value,
    ] as const,
  ([pending, path, count, el]) => {
    if (!pending || !el || !count || pending.path !== path) return
    chatService.pendingFind.value = null
    composing.value = false
    // On a phone the keyboard would cover the message just landed on.
    find.openAt(pending.query, pending.messageId, !Platform.isMobile)
  },
  { immediate: true, flush: 'post' }
)

watch(
  () => [chatService.pendingAnchorReturn.value, session.value, messagesContainer.value] as const,
  async ([pending, s, el]) => {
    if (!pending || !s || !el || pending.sessionId !== s.id) return
    const generation = ++anchorReturnGeneration
    chatService.pendingAnchorReturn.value = null
    composing.value = false
    await nextTick()
    if (session.value !== s || generation !== anchorReturnGeneration) return
    stopFocusing()
    const focused = el.ownerDocument.activeElement
    if (focused?.instanceOf(HTMLElement) && chatContainer.value?.contains(focused)) focused.blur()
    const { target } = pending
    if (target.resolution.status === 'current') {
      const selected = await revealMessage(target.messageId, undefined, target.resolution)
      if (session.value === s && generation === anchorReturnGeneration && !selected)
        anchorHistory.value = { anchor: target.anchor, resolution: { status: 'unresolved', snapshot: target.anchor.snapshot } }
    } else {
      await revealMessage(target.messageId, undefined, undefined, false)
      if (session.value === s && generation === anchorReturnGeneration) anchorHistory.value = target
    }
  },
  { immediate: true, flush: 'post' }
)
watch(session, () => { anchorHistory.value = null; anchorReturnGeneration++ })

watch(
  () => [chatService.pendingAttentionReveal?.value, session.value, messagesContainer.value] as const,
  async ([request, s, el]) => {
    if (!request || !s || !el || request.sessionId !== s.id) return
    chatService.pendingAttentionReveal.value = null
    composing.value = false
    await nextTick()
    if (session.value !== s || messagesContainer.value !== el) return
    const target = [...el.querySelectorAll<HTMLElement>('[data-attention-id]')].find(e => e.dataset.attentionId === request.id)
      ?? el.querySelector<HTMLElement>(request.kind === 'approval' ? '.abele-tool-approval' : '.abele-ai-chat__questions')
    target?.scrollIntoView({ block: 'center' })
    // Only an explicit Reply to this exact question takes the keyboard. A stale list
    // entry must not focus the composer for another question that arrived meanwhile.
    if (request.focusComposer && request.kind === 'question' && target?.dataset.attentionId === request.id) {
      await nextTick()
      if (session.value === s && messagesContainer.value === el) focusComposer()
    }
  },
  { flush: 'post', immediate: true }
)

watch(
  () => [chatService.pendingReveal.value, session.value, messagesContainer.value] as const,
  ([messageId, s, el]) => {
    if (!messageId || !s || !el) return
    const passage = chatService.pendingPassage.value
    if (passage && passage.message === messageId && passage.path !== s.currentChatFile.value?.path) return
    chatService.pendingReveal.value = null
    chatService.pendingPassage.value = null
    composing.value = false
    void revealMessage(messageId, passage?.message === messageId ? passage : undefined)
  },
  { immediate: true, flush: 'post' }
)

// Switching tabs: the one being left keeps its place, the one being opened goes back to its own
watch(
  () => [chatService.activeTabId.value, attachmentOwner.value?.version ?? 0] as const,
  ([tabId, version], [previousTabId]) => {
    // The DOM still shows the tab being left, so this is the moment to read its place.
    if (previousTabId) rememberPlace(previousTabId)
    anchor = null
    // The words were looked for in the conversation being left.
    find.close()
    resetWindow()
    const place = tabId ? places.get(tabId) : undefined
    // Not following the end while the messages mount, or they would be scrolled past the place.
    shouldAutoScroll = !place
    // A tick later, once the window has settled on the new tab's messages and they are mounted.
    if (place) void nextTick(() => returnTo(place))
    else void nextTick(doScroll)

    for (const id of places.keys()) {
      if (!chatService.tabOrder.value.includes(id)) places.delete(id)
    }

    // Drafts are session-owned. The editor only rebinds to the session; there is no view-local
    // snapshot to restore or replace, even if a run or a closed panel destroyed the editor.
    void nextTick(() => {
      if (chatService.activeTabId.value !== tabId || attachmentOwner.value?.version !== version) return
      consumePendingInput()
    })
  }
)

/** The vault files a pending input attaches, those still there. */
function filesOf(paths: string[] | undefined): TFile[] {
  const { app } = GlobalStore.getInstance()
  return (paths ?? [])
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile)
}

/** Inserted links and files alone join the draft; new-chat text still replaces it. */
function pendingDraft(pending: PendingInput, saved?: ChatDraft, incoming = filesOf(pending.attachments)): ChatDraft {
  const join = pending.append || (!pending.text && !!pending.attachments?.length)
  const before = saved?.text ?? ''
  const attachments = [...(saved?.attachments ?? [])]
  const index = attachments.findIndex((f) => f.path === pending.replaceAttachment)
  if (pending.replaceAttachment && index >= 0) attachments.splice(index, 1)
  return {
    ...saved,
    text: join
      ? `${before}${before && pending.text && !before.endsWith('\n') ? '\n' : ''}${pending.text}`
      : pending.text,
    attachments: [...attachments, ...incoming],
  }
}

/** The text waiting to go into this tab's input, if any. */
function pendingFor(tabId: string | null | undefined): PendingInput | null {
  const pending = chatService.pendingInput.value
  if (!pending || !tabId) return null
  if (pending.tabId && pending.tabId !== tabId) return null
  if (pending.conversationVersion !== undefined && pending.conversationVersion !== attachmentOwner.value?.version) {
    if (chatService.pendingInput.value === pending) chatService.pendingInput.value = null
    new Notice('The conversation changed. Attach the saved picture to the intended chat.')
    return null
  }
  return pending
}

/** Marks it taken, and puts the cursor after it when that was asked for. */
function takePending(pending: PendingInput) {
  if (chatService.pendingInput.value === pending) chatService.pendingInput.value = null
  if (pending.focus) void nextTick(focusComposer)
}

// Text from outside — a context menu, "Chat about this" — for the tab in front. One arriving
// with a tab switch is put in by the switch above, so this waits a tick and takes only what
// is still left, rather than racing it.
function consumePendingInput() {
  void nextTick(() => {
    const pending = pendingFor(chatService.activeTabId.value)
    if (!pending || !chatInput.value || !chatInput.value.isDraftFor(attachmentOwner.value)) return
    chatInput.value.putDraft(pendingDraft(pending, chatInput.value.takeDraft(), []))
    for (const file of filesOf(pending.attachments)) chatInput.value.addAttachment(file)
    takePending(pending)
  })
}

watch(() => chatService.pendingInput.value, consumePendingInput)
// A pending clone hides the composer without changing tab or conversation lifetime.
// Retry delivery when its editor mounts; consumePendingInput retains the ownership checks.
watch(
  () => chatInput.value,
  (input) => {
    if (input) consumePendingInput()
  },
  { flush: 'post' }
)

// On a phone the chat shrinks to sit above the keyboard; see `useChatKeyboardGap`.
const { measure: measureBottomGap } = useChatKeyboardGap(chatContainer)

onMounted(() => {
  // The sidebar may have been opened for this very text.
  consumePendingInput()
})

/**
 * Following the conversation as it grows, and the box it is read in as that changes.
 *
 * Attached to the container element, not once on mount: the container is unmounted while a
 * delegated run holds the tab and mounted afresh when the chat is back, and an observer left
 * on the first element watched nothing at all — a chat that had been away on a run's tab no
 * longer followed its own replies once their markdown rendered.
 */
let mutObserver: MutationObserver | null = null
let sizeObserver: ResizeObserver | null = null
/**
 * The container's height as last reported, for telling a change of box from a scroll. Null
 * until the observer has reported once: the first scroll to arrive before then measures it.
 */
let boxHeight: number | null = null

/**
 * Keeps the reader's place when the box around the conversation changes height.
 *
 * A phone's keyboard takes the lower half of the screen and the chat shrinks to sit above it,
 * and nothing scrolls on its own when a box shrinks: what was at the bottom — the message
 * being answered — went under the keyboard, and the reader found themselves at a line read a
 * minute before (2026-09-05, from the phone). At the end of the conversation they stay at the
 * end; anywhere above it they keep their distance from it, which is what the messages above
 * a composer do in every chat app, and the same in reverse when the keyboard goes.
 */
const onBoxResized = () => {
  const el = messagesContainer.value
  // Hidden under the opened composer: a box of nothing is not a change the reader made.
  if (!el || composing.value) return
  if (el.clientHeight !== boxHeight) {
    boxHeight = el.clientHeight
    if (!shouldAutoScroll) scrollContainerTo(el, el.scrollHeight - el.clientHeight - bottomGap)
  }
  // A narrower box wraps the text longer; a reader at the end stays at the end.
  doScroll()
}

/**
 * The distance to the end, measured again when the conversation grows or shrinks under a reader
 * who is not following it. A reply streaming in below adds to that distance without a scroll to
 * say so, and the box changing height afterwards — a row appearing under the chat on a phone —
 * put the reader back at the distance from before the reply grew: a jump down by all that had
 * streamed in since they scrolled. Not while the box itself has changed and its observer has not
 * run yet: the distance from before the change is the one it is to keep.
 */
const keepGapCurrent = () => {
  const el = messagesContainer.value
  if (!el || shouldAutoScroll || fingerDown) return
  if (boxHeight !== null && el.clientHeight !== boxHeight) return
  bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
}

const observe = (el: HTMLElement) => {
  mutObserver = new MutationObserver(() => {
    // Hidden under the opened composer; it is put right when the composer closes.
    if (composing.value) return
    // A message that has just rendered its markdown changes the subtree and the layout
    // with it — which is exactly when the anchor needs putting back.
    holdAnchor()
    holdSteady()
    keepGapCurrent()
    doScroll()
  })
  mutObserver.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  })
  boxHeight = null
  sizeObserver = new ResizeObserver(onBoxResized)
  sizeObserver.observe(el)
}

const unobserve = () => {
  mutObserver?.disconnect()
  mutObserver = null
  sizeObserver?.disconnect()
  sizeObserver = null
}

watch(
  messagesContainer,
  (el) => {
    unobserve()
    if (el) observe(el)
  },
  { immediate: true, flush: 'post' }
)
onUnmounted(unobserve)

/**
 * Puts the cursor in the composer, after whatever is already typed there, and goes on trying
 * for a moment when it does not take.
 *
 * A focus given to a field not on screen yet is dropped without a word, and a new chat is
 * asked for at exactly that moment: the panel's leaf is still being made, a phone's drawer is
 * still sliding in, the tab just added has not rendered. One try on a timer lost that race as
 * often as it won it. Once the cursor is in, nothing more is tried, so a click somewhere else
 * afterwards is left alone.
 */
const FOCUS_TRIES_FOR_MS = 1000
const FOCUS_RETRY_MS = 50
let focusTimer: number | null = null
/**
 * The window the chat is drawn in, whose clock the retries run on: a chat in a popout window
 * waits on that window, and the timers go with it when it closes.
 */
let focusWindow: Window | null = null

function stopFocusing() {
  if (focusTimer !== null) focusWindow?.clearTimeout(focusTimer)
  focusTimer = null
}

function focusComposer() {
  stopFocusing()
  if (chatService.openingSelection.value || chatService.pendingAnchorReturn.value) return
  focusWindow = chatContainer.value?.ownerDocument.defaultView ?? window
  const win = focusWindow
  const until = Date.now() + FOCUS_TRIES_FOR_MS
  const attempt = () => {
    focusTimer = null
    if (chatService.openingSelection.value || chatService.pendingAnchorReturn.value) return
    const input = chatInput.value
    input?.focus({ atEnd: true })
    if (input?.hasFocus()) return
    if (Date.now() < until) focusTimer = win.setTimeout(attempt, FOCUS_RETRY_MS)
  }
  attempt()
}

onMounted(() => void nextTick(focusComposer))
onUnmounted(stopFocusing)

// A new chat or a new comment, and somebody about to type into it. After the tab has rendered.
watch(
  () => chatService.focusRequest.value,
  () => void nextTick(focusComposer)
)

const onSend = async (content: string, attachments: string[] = []) => {
  const s = session.value
  if (!s) return

  // Update draft content if editing
  if (s.draft.value.editingDraftId) {
    s.updateDraftContent(s.draft.value.editingDraftId, content)
    delete s.draft.value.editingDraftId
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

  for (const path of fileMentions(content)) s.scopeResolver.addFile(path)
  scrollOnUserSend()
  await s.sendMessage(content, attachments)
}

/**
 * The composer has the focus, and on a phone the keyboard with it. In the class binding, not
 * put on the element by hand: the binding rewrites the class list whenever another of its
 * classes changes, and opening the composer out took the keyboard layout away with it.
 */
const keyboardOpen = ref(false)

const onInputFocus = (focused: boolean) => {
  if (focused) measureBottomGap()
  keyboardOpen.value = focused
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
      openSetup('scope')
      break
    case '/prompt':
      openSetup('prompts')
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
  setupOpen.value = false
  const { app } = GlobalStore.getInstance()

  const cache = app.metadataCache.getFileCache(file)
  applyAiModelProperty(cache?.frontmatter?.['ai-model'] as string | undefined)

  const content = await app.vault.read(file)
  const body = content.replace(/^---[\s\S]*?---\n?/, '')
  const { variables, userVariables } = parseTemplateVariables(body)
  pendingPromptAllowsMethods = await allowTemplateExecution(
    file.path,
    file.basename,
    content,
    variables.some((v) => v.type === 'plugin')
  )

  if (userVariables.length > 0) {
    pendingPromptContent.value = body
    pendingPromptAllVars.value = variables
    pendingPromptUserVars.value = userVariables
    variablesModalOpen.value = true
  } else {
    const resolved = await applyTemplateVariables(
      body,
      variables,
      new Map(),
      pendingPromptAllowsMethods
    )
    chatInput.value?.setText(resolved.trim())
  }
}

const onPromptVariablesConfirm = async (values: Map<string, string>) => {
  variablesModalOpen.value = false
  const resolved = await applyTemplateVariables(
    pendingPromptContent.value,
    pendingPromptAllVars.value,
    values,
    pendingPromptAllowsMethods
  )
  chatInput.value?.setText(resolved.trim())
}

// Capture the live conversation itself when an import starts. Moving a comment out of the
// sidebar releases its tab, not its session; a tab-registry lookup would lose that owner.
const importBridge = computed(() => {
  const origin = session.value
  const expected = attachmentOwner.value
  const owns = (owner?: ConversationOwner): boolean => !!origin && !origin.isDestroyed &&
    sameConversation(owner, expected) && (origin.conversationVersion?.value ?? 0) === expected?.version
  const ready = (path: string, owner?: ConversationOwner): void => {
    // Chat logs are supplied as conversation text, never granted as files in scope.
    if (owns(owner) && !isChatLog(path)) origin!.scopeResolver.addFile(path)
  }
  return { owns, ready }
})

function isCurrentImportConversation(owner?: ConversationOwner): boolean {
  return sameConversation(owner, attachmentOwner.value) && importBridge.value.owns(owner)
}

// ── Drag & drop on the whole chat area ──

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
  await chatInput.value?.importFiles(fileList)
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

const onEditQueued = (id: string) => {
  const s = session.value
  const input = chatInput.value
  const queued = s?.queuedMessages.value.find((q) => q.id === id)
  if (!s || !input || !queued) return
  const draft = input.takeDraft()
  input.putDraft({
    text: [queued.content, draft.text].filter(Boolean).join('\n'),
    attachments: [
      ...draft.attachments,
      ...filesOf(queued.attachments).filter(
        (file) => !draft.attachments.some((a) => a.path === file.path)
      ),
    ],
  })
  s.removeQueuedMessage(id)
  void nextTick(focusComposer)
}

const hasFallbackModel = computed(() => session.value?.hasFallbackModel ?? false)

/** The countdown to an automatic retry, when one is running. */
const retrying = computed(() => session.value?.retrying.value ?? null)
const reconnecting = computed(() => session.value?.reconnecting?.value ?? null)
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

const newMenuPosition = () => {
  const rect = chatContainer.value?.getBoundingClientRect()
  return { x: rect?.left ?? 0, y: (rect?.top ?? 0) + 40 }
}
const onNewTab = () => newChatMenu(() => { chatService.newTab() }, newMenuPosition())
const onNewChatMenu = () => newChatMenu(() => { void handleNewChat() }, newMenuPosition())

const handleNewChat = async () => {
  const id = session.value?.id
  if (id) await chatService.startNewChat(id)
}

/**
 * A chat picked in the history. Picked by a match in its messages, it opens on that message with
 * the find bar on the words, so the rest of them are a press of Enter away.
 */
const onLoadChat = async (file: TFile, found?: { query: string; messageId: string }) => {
  const id = session.value?.id
  if (found) chatService.pendingFind.value = { path: file.path, ...found }
  if (id) await chatService.openChatInTab(id, file)
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
      height: calc(100% - max(0px, var(--keyboard-height, 0px) - var(--abele-bottom-gap, 0px)));
    }
  }

  // The composer is Obsidian's note editor, so Obsidian's toolbar comes up over the keyboard
  // for it, as for a note. It stands on the keyboard and covered the composer's own row of
  // buttons, Send among them; the chat ends above it instead.
  body.is-mobile.mod-toolbar-open &.abele-keyboard-open {
    height: calc(
      100% - max(
          0px,
          var(--keyboard-height, 0px) +
            var(--mobile-toolbar-height, 0px) - var(--abele-bottom-gap, 0px)
        )
    );
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
    min-width: 2em;
    flex-shrink: 0;
  }
}

/** Between beginnings: the same strip a message carries under it, at the top of the list. */
.abele-ai-chat__roots {
  margin-bottom: var(--size-4-2);
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

/* While the chat holds the reader's place itself, the browser does not hold it a second time. */
.abele-ai-chat__messages_steady {
  overflow-anchor: none;
}

/* The scroll range kept from shrinking while a change draws again: see `holdFloor`. Absolutely
   placed, it takes no room among the messages and only reaches down as far as they did. */
.abele-ai-chat__messages_floor {
  position: relative;
}

.abele-ai-chat__messages_floor::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: var(--abele-chat-floor, 0);
  pointer-events: none;
  visibility: hidden;
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
