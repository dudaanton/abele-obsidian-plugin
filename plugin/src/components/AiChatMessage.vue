<template>
  <div
    v-if="!hiddenSessionMark(message.sessionMark)"
    class="abele-chat-msg"
    :class="[
      `abele-chat-msg_${message.role}`,
      {
        'abele-chat-msg--draft': message.draft,
        'abele-chat-msg_line': ownLine(message) || !!message.sessionMark || !!message.sessionPlan,
        'abele-chat-msg_checking': !!message.answerCheck,
      },
    ]"
    @click.capture="onMessageClick"
  >
    <!-- A tool call keeps its glyph in line, by the kind of work, and opens its details by it. A
         question or an answer has no glyph column: who speaks is plain from the bubble, and its
         actions are in the line under it. -->
    <button
      v-if="
        message.role !== 'user' &&
        message.role !== 'assistant' &&
        !ownLine(message) &&
        !message.sessionMark &&
        !message.sessionPlan
      "
      type="button"
      class="clickable-icon abele-chat-msg__icon"
      :aria-label="t('streamB.messageActionsAndDetails.74eaef')"
      :aria-expanded="expanded"
      @pointerdown="comments.captureFresh"
      @click="expanded = !expanded"
    >
      <Icon v-if="message.role === 'tool-call'" :icon="KIND_ICON[toolKind(message.toolName)]" />
      <Icon v-else-if="message.role === 'tool-result'" icon="check" />
      <Icon v-else icon="info" />
    </button>

    <div class="abele-chat-msg__body">
      <!-- Actions and debug info — toggled by the icon, so they open beside it at the top of the
           message rather than under a long answer. The buttons come first: the params and the
           result below them can be tall. -->
      <AiChatMessageDetails
        v-if="expanded && message.role !== 'tool-call'"
        :message="message"
        :actions="message.role !== 'user' && message.role !== 'assistant'"
        :read-only-history="readOnlyHistory"
        :can-comment="canComment"
        :capture-selection="comments.capture"
        :ask-here="comments.askHere"
        @copy="copyMessage"
        @actions="showActions"
        @edit-message="emit('edit-message', $event)"
        @retry-message="emit('retry-message', $event)"
        @insert-into-note="emit('insert-into-note', $event)"
        @remove-highlight="(id, highlight) => emit('remove-highlight', id, highlight)"
      />

      <!-- Thinking (collapsible) -->
      <ChatThinking
        v-if="message.thinking"
        ref="thinking"
        class="abele-chat-msg__thinking"
        :text="message.thinking"
        :streaming="thinkingStreaming"
        :resource-opener="resourceOpener"
      />

      <!-- Another session on the node wrote this: who, quietly over its words, opening its chat. -->
      <a
        v-if="message.fromSession"
        href="#"
        class="abele-chat-msg__from"
        :aria-label="
          t('streamB.open.863533', {
            v0: String(message.fromSession.title || t('streamB.theSessionThatWroteThis.e9de2c')),
          })
        "
        @click.prevent="openSourceChat(message.fromSession.id)"
        ><Icon icon="bot" size="xs" :interactive="false" />{{
          message.fromSession.path
            ? t('chat.letterFrom', { title: message.fromSession.title })
            : [
                message.fromSession.agent,
                message.fromSession.title || t('streamB.anotherSession.cc0abe'),
              ]
                .filter(Boolean)
                .join(' · ')
        }}</a
      >

      <!-- Tool call — compact one-liner + inline diff -->
      <template v-if="message.role === 'tool-call'">
        <span
          v-if="!ownLine(message)"
          class="abele-chat-msg__tool-line"
          :class="{ 'abele-chat-msg__tool-line_files': toolFilePath && !compactToolDetails }"
          data-find-part="tool"
          @contextmenu.prevent="showActions"
        >
          <span v-if="!toolFilePath || !compactToolDetails" class="abele-chat-msg__tool-name">{{
            readableToolName(message.toolName)
          }}</span>
          <ChatToolFiles
            v-if="toolFilePath"
            :message="message"
            :inline="compactToolDetails"
            :resource-opener="resourceOpener"
          />
          <span v-else-if="toolSummary" class="abele-chat-msg__tool-summary">{{
            toolSummary
          }}</span>
          <span
            v-if="
              message.toolName === 'delegate' &&
              !message.subAgentRun &&
              message.toolResult?.startsWith('Processing:')
            "
            class="abele-chat-msg__tool-progress"
          >
            {{ message.toolResult }}
          </span>
          <Icon
            v-if="
              message.toolStatus === 'approved' &&
              message.toolResult === undefined &&
              !message.toolExecution
            "
            icon="loader"
            no-hover
            class="abele-chat-msg__tool-spinner"
          />
          <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-err-badge">{{
            message.toolExecution === 'interrupted'
              ? t('streamB.interrupted.d512d9')
              : message.toolExecution === 'not-run'
                ? t('streamB.notRun.b4a984')
                : t('streamB.failed.5d28a9')
          }}</span>
          <ChatBranchSwitch
            v-if="branches"
            class="abele-chat-msg__branches abele-chat-msg__tool-branches"
            :choices="branches.choices"
            :index="branches.index"
            @switch="(id) => emit('switch-branch', id)"
          />
          <slot name="tool-place" />
          <Icon
            v-if="canForkCall"
            class="abele-chat-msg__tool-branch"
            icon="git-branch-plus"
            size="xs"
            :tooltip="t('streamB.branchFromHereGoOnFromThis.39238c')"
            :disabled="branchBlocked"
            :disabled-reason="t('streamB.waitForTheActiveTurnToFinish.82aa36')"
            @click.stop="branchFromHere"
          />
        </span>
        <div v-if="$slots['tool-note']" class="abele-chat-msg__tool-output">
          <slot name="tool-note" />
        </div>
        <span
          v-if="ownLine(message) && expanded"
          class="abele-chat-msg__tool-line"
          data-find-part="tool"
        >
          <code>{{ message.toolName }}</code
          ><span>{{ toolSummary }}</span>
        </span>
        <!-- A node call refused for want of access: the reason by name and the way through. -->
        <NodeAccessRefusal
          v-if="message.nodeAccessRefusal"
          :refusal="message.nodeAccessRefusal"
          :given="nodeAccessGiven"
          :approves="nodeAccessApproves"
          @act="(r: Refusal, named?: NodeScopeEntry[]) => emit('node-access', r, named)"
        />
        <AiChatMessageDetails
          v-if="expanded"
          :message="message"
          actions
          :read-only-history="readOnlyHistory"
          :can-comment="canComment"
          :capture-selection="comments.capture"
          :ask-here="comments.askHere"
          @copy="copyMessage"
          @actions="showActions"
          @edit-message="emit('edit-message', $event)"
          @retry-message="emit('retry-message', $event)"
          @insert-into-note="emit('insert-into-note', $event)"
          @remove-highlight="(id, highlight) => emit('remove-highlight', id, highlight)"
        />
        <!-- A delegated run: the whole sub-conversation, right where it was dispatched. -->
        <AiSubAgentRun v-if="message.subAgentRun" :run="message.subAgentRun" />
        <ChatLetterRun v-if="message.chatLetter" :message="message" />
        <TreeItem
          v-if="message.replyProposal"
          class="abele-chat-run abele-chat-msg__proposal"
          icon="git-compare"
          :text="proposalText(message.replyProposal)"
          :disabled="!proposalOpen(message.replyProposal)"
          @click="emit('review-revision', message.id)"
        >
          <template v-if="proposalOpen(message.replyProposal)" #end>
            <StatusDot tone="orange" :label="t('streamB.waitingForYourDecision.027404')" />
          </template>
        </TreeItem>

        <ChatToolImage :message="message" :resource-opener="resourceOpener" />
        <AbeleMap
          v-if="message.toolStatus === 'approved' && mapConfig"
          :config="mapConfig"
          class="abele-chat-msg__map"
        />
        <pre
          v-if="message.toolDiff && !message.toolDiff.old && (!compactToolDetails || expanded)"
          class="abele-chat-msg__new-file"
          data-find-part="newfile"
        ><code><SyntaxText :text="message.toolDiff.new" :path="diffPath" /></code></pre>
        <Diff
          v-else-if="message.toolDiff && (!compactToolDetails || expanded)"
          :text-left="message.toolDiff.old"
          :text-right="message.toolDiff.new"
          :path="diffPath"
          class="abele-chat-msg__diff"
        />
      </template>

      <!-- Tool result — only show errors -->
      <template v-else-if="message.role === 'tool-result'">
        <span
          v-if="message.toolStatus === 'rejected'"
          class="abele-chat-msg__tool-error"
          data-find-part="content"
        >
          <NodeErrorText
            v-if="
              message.toolName?.startsWith('node_') || message.toolName === 'list_node_worktrees'
            "
            :error="message.content"
          />
          <template v-else>{{ message.content }}</template>
        </span>
      </template>

      <!-- System messages: compact summary (long) or short label (model change, skill, etc.) -->
      <template v-else-if="message.role === 'system'">
        <!-- A node session's own line: compacted, compacting, woken by what it left running. -->
        <SessionMarkLine
          v-if="message.sessionMark"
          :mark="message.sessionMark"
          :summary="
            message.sessionMark.kind === 'notice' ? undefined : message.content || undefined
          "
        />
        <!-- The plan an agent keeps, where it first wrote it, as it stands now. -->
        <SessionPlan v-else-if="message.sessionPlan" :entries="message.sessionPlan" />
        <template v-else-if="message.content.length > 100">
          <span class="abele-chat-msg__compact-label">{{
            t('streamB.conversationCompacted.d6d381')
          }}</span>
          <div v-if="expanded" class="abele-chat-msg__compact-summary">
            <Markdown
              :text="message.content"
              :resource-opener="resourceOpener"
              data-find-part="summary"
            />
          </div>
        </template>
        <span v-else class="abele-chat-msg__compact-label"
          >── <span data-find-part="content">{{ message.content }}</span> ──</span
        >
      </template>

      <!-- User / Assistant — markdown; a question's places of the agent's words stand in it as
           chips, where the person put them. -->
      <Markdown
        v-else-if="
          (message.role === 'assistant' || message.role === 'user') &&
          (message.content || question.order.length)
        "
        :ref="comments.content"
        :text="question.text"
        :resource-opener="resourceOpener"
        :data-ask-message="canComment ? message.id : undefined"
        :data-copy-selection="canComment && !message.draft && !readOnlyHistory ? 'true' : undefined"
        :data-highlight-reply="
          canComment && message.role === 'assistant' && !message.draft ? 'true' : undefined
        "
        data-find-part="content"
        @rendered="onReplyRendered"
        @contextmenu="onContentMenu"
      />
      <Markdown
        v-else-if="message.content"
        :text="message.content"
        :resource-opener="resourceOpener"
        data-find-part="content"
      />
      <slot name="metadata" />
      <a
        v-if="message.sentTo"
        href="#"
        class="abele-chat-msg__from abele-chat-msg__sent-to"
        :aria-label="t('chat.letterOpen', { title: message.sentTo.title })"
        @click.prevent="openLocalChat(message.sentTo)"
      >
        <Icon icon="corner-up-right" size="xs" :interactive="false" />{{
          t('chat.letterSent', { title: message.sentTo.title })
        }}
      </a>

      <AiReplyOriginalDialog
        v-if="originalOpen"
        :message="message"
        @undo="emit('undo-revision', message.id)"
        @close="originalOpen = false"
      />

      <!-- Attachments -->
      <div v-if="message.attachments?.length" class="abele-chat-msg__attachments">
        <template v-for="path in message.attachments" :key="path">
          <ChatPicture v-if="isImagePath(path)" :path="path" />
          <span
            v-else
            class="abele-chat-msg__attachment-chip"
            @click="openAttachment(path)"
            @contextmenu.prevent="onAttachmentContextMenu($event, path)"
          >
            <Icon :icon="getAttachmentIcon(path)" />
            {{ attachmentName(path) }}
          </span>
        </template>
      </div>
    </div>

    <GalleryViewer
      v-if="contentPicture"
      :images="[contentPicture]"
      :start-index="0"
      :gallery-file-path="contentPicture.path"
      :chat-id="ChatService.getInstance().activeTabId.value ?? ''"
      @close="contentPicture = null"
    />

    <ChatMessageBar
      v-if="
        (message.role === 'user' || (message.role === 'assistant' && message.content.trim())) &&
        !message.draft
      "
      :message="message"
      :read-only="readOnlyHistory || !!message.answerCheck"
      :extra-actions="!!extendActions"
      :can-comment="canComment && !message.answerCheck"
      :can-reply="answerable && !message.answerCheck"
      :expanded="expanded"
      :capture-selection="comments.capture"
      :ask-here="comments.askHere"
      @copy="copyMessage"
      @reply="comments.replyHere"
      @actions="showActions"
      @edit-message="emit('edit-message', $event)"
      @retry-message="emit('retry-message', $event)"
      @insert-into-note="emit('insert-into-note', $event)"
      @details="expanded = !expanded"
    >
      <!-- The interceptor is reading the finished answer and may put its own text in its place:
           the turning glyph of work under way, beside the time; who reads it, in its tooltip. -->
      <Icon
        v-if="message.answerCheck"
        class="abele-chat-msg__checking abele-chat-msg__tool-spinner"
        icon="loader"
        size="xs"
        :tooltip="
          message.answerCheck.of
            ? t('streamB.isCheckingThisAnswerOf.2fe197', {
                v0: String(message.answerCheck.by),
                v1: String(message.answerCheck.at),
                v2: String(message.answerCheck.of),
              })
            : t('streamB.isCheckingThisAnswer.19e9e4', { v0: String(message.answerCheck.by) })
        "
      />
      <!-- With several in a row, which one is reading: a quiet count beside the turning glyph. -->
      <span v-if="message.answerCheck?.of" class="abele-chat-msg__check-count"
        >{{ message.answerCheck.at }}/{{ message.answerCheck.of }}</span
      >
      <!-- Changed after it was written: a pencil beside the time; pressed, the reply before.
           Replaced by an interceptor, it is its own glyph among the actions, there under the
           pointer only: the pencil is Edit. -->
      <Icon
        v-if="lastRevision"
        :class="replaced ? 'abele-chat-msg__replaced' : 'abele-chat-msg__edited'"
        :icon="replaced ? 'replace' : 'pencil-line'"
        size="xs"
        :label="editedLabel"
        @click="originalOpen = true"
      />
      <ChatBranchSwitch
        v-if="branches"
        class="abele-chat-msg__branches"
        :choices="branches.choices"
        :index="branches.index"
        :can-add="!!message.parentId && !readOnlyHistory"
        @switch="(id) => emit('switch-branch', id)"
        @new="message.parentId && emit('create-branch', message.parentId)"
      />
    </ChatMessageBar>
    <ChatBranchSwitch
      v-else-if="branches && message.role !== 'tool-call'"
      class="abele-chat-msg__branches"
      :choices="branches.choices"
      :index="branches.index"
      @switch="(id) => emit('switch-branch', id)"
    />

    <!-- Draft actions -->
    <div
      v-if="message.draft && !interceptorStreaming && !readOnlyHistory"
      class="abele-chat-msg__draft-actions"
    >
      <button
        class="abele-chat-msg__draft-btn abele-chat-msg__draft-btn--send"
        @click="emit('confirm-draft', message.id)"
      >
        <!-- After a failed check, sending goes on without the interceptors still to come. -->
        {{ interceptorError ? t('streamB.sendAsIs.f10c92') : t('streamB.send.f6f468') }}
      </button>
      <button class="abele-chat-msg__draft-btn" @click="emit('edit-draft', message.id)">
        {{ t('streamB.edit.464c4f') }}
      </button>
    </div>

    <!-- Interceptor sub-chat -->
    <AiChatMessageInterceptor
      v-model:text="interceptorText"
      :message="message"
      :interceptor-streaming="interceptorStreaming"
      :interceptor-streaming-content="interceptorStreamingContent"
      :interceptor-error="interceptorError"
      @toggle="emit('toggle-interceptor', $event)"
      @retry="emit('retry-interceptor', $event)"
      @reply="sendInterceptorReply"
    />
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { readableToolName } from '@/ai/toolLine'
import { t } from '@/i18n'
import SyntaxText from './SyntaxText.vue'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { flashMessagePassage, flashExactSelection, messageRenderedText } from '@/ai/messageComments'
import type { ChatRevision, RenderedRange } from '@/selection/types'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import { Menu, Notice, Platform } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import TreeItem from './obsidian/TreeItem.vue'
import StatusDot from './obsidian/StatusDot.vue'
import AiReplyOriginalDialog from './AiReplyOriginalDialog.vue'
import NodeAccessRefusal from './chat/NodeAccessRefusal.vue'
import type { NodeAccessRefusal as Refusal } from '@/ai/tools/node/accessRefusal'
import type { NodeScopeEntry } from '@/ai/nodeScope'
import ChatToolImage from './chat/ChatToolImage.vue'
import ChatToolFiles from './chat/ChatToolFiles.vue'
import AiChatMessageDetails from './AiChatMessageDetails.vue'
import AiChatMessageInterceptor from './AiChatMessageInterceptor.vue'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import ChatPicture from './ChatPicture.vue'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import Markdown from './obsidian/Markdown.vue'
import { chatMarkdown } from '@/ai/chatMarkdown'
import ChatThinking from './ChatThinking.vue'
import { KIND_ICON, ownLine, toolKind } from '@/ai/toolRuns'
import type { ReplyProposal } from '@/ai/replyAnnotations'
import AbeleMap from './AbeleMap.vue'
import Diff from './Diff.vue'
import AiSubAgentRun from './AiSubAgentRun.vue'
import ChatLetterRun from './chatTree/ChatLetterRun.vue'
import { openLetterChat } from '@/ai/chatMessaging'
import type { LetterChat } from '@/chats/chatLetters'
import SessionMarkLine from './nodeSession/SessionMarkLine.vue'
import { hiddenSessionMark } from './nodeSession/types'
import SessionPlan from './nodeSession/SessionPlan.vue'
import GalleryViewer from './GalleryViewer.vue'
import { getAttachmentIcon, fileName as attachmentName } from '@/ai/attachments'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage, ChatReplyTo, MessageComment } from '@/ai/types'
import { wholeQuote } from '@/ai/replyLinks'
import { paintReplyChips, questionMarkdown } from './chat/replyChipPaint'
import type { BranchSwitch } from '@/ai/chatBranches'
import ChatBranchSwitch from './ChatBranchSwitch.vue'
import ChatMessageBar from './ChatMessageBar.vue'
import { useMessageComments } from '@/composables/useMessageComments'
import { useChatMessageMedia } from '@/composables/useChatMessageMedia'
import type { FindPart } from '@/ai/chatFind'
import type { SelectionMenuItem } from '@/scripting/selectionMenuScripts'

const props = defineProps<{
  message: ChatMessage
  readOnlyHistory?: boolean
  /** Provider-native actions compose the ordinary message menu without enabling vault edits. */
  extendActions?: (menu: Menu) => void
  /** Local chats only; node/provider-native sessions cannot be cloned into a vault chat. */
  canClone?: boolean
  /** Its thought is still being written: open until the agent moves on, folded after. */
  thinkingStreaming?: boolean
  /** The session refuses all branch changes while its current turn is unsettled. */
  branchBlocked?: boolean
  /** Node histories keep successful tool previews behind the existing detail toggle. */
  compactToolDetails?: boolean
  resourceOpener?: (path: string) => void
  branches?: BranchSwitch
  interceptorStreaming?: boolean
  interceptorStreamingContent?: string
  interceptorError?: string | null
  /** Comments asked on this answer, from the chat's metadata. */
  comments?: MessageComment[]
  /** Whether "Ask here" is offered: an ordinary chat that has a file to keep comments in. */
  canComment?: boolean
  /** Whether the message being written can reply to this one, when it is the agent's. */
  canReply?: boolean
  /** Messages this question replies to that are not in the branch on screen. */
  replyGone?: string[]
  /** The chat has since been given the access a refused node call wanted. */
  nodeAccessGiven?: boolean
  /** What approving a refused node call here would confirm, by entry. */
  nodeAccessApproves?: NodeScopeEntry[]
  /** Whether "Rewind" is offered on a user message: a chat that keeps a rewind log. */
  canRewind?: boolean
  /** This user message's turn changed files that can still be put back. */
  changedFiles?: boolean
  captureLink?: (id: string, quote: string, start: number, text: string) => (() => void) | undefined
  captureScript?: (
    id: string,
    quote: string,
    start: number,
    text: string
  ) => ((name?: string) => void) | undefined
  scripts?: SelectionMenuItem[]
  scriptMenu?: () => SelectionMenuItem[]
}>()

const emit = defineEmits<{
  (e: 'create-branch', messageId: string): void
  (e: 'clone-chat', messageId: string): void
  (e: 'switch-branch', messageId: string): void
  (e: 'repeat-message', messageId: string): void
  (e: 'retry-message', messageId: string): void
  /** Put this message into the note being worked in, as a card that leads back here. */
  (e: 'insert-into-note', messageId: string): void
  (e: 'edit-message', messageId: string): void
  (e: 'confirm-draft', messageId: string): void
  (e: 'edit-draft', messageId: string): void
  (e: 'send-interceptor', messageId: string, content: string): void
  (e: 'toggle-interceptor', messageId: string): void
  (e: 'retry-interceptor', messageId: string): void
  /** A comment on this answer: on the selected words, or on all of it when there are none. */
  (e: 'ask-here', messageId: string, quote?: string, start?: number): void
  /** The message being written replies to this one: the words selected in it, or all of it. */
  (e: 'reply', to: ChatReplyTo): void
  /** Go to the words a place in this question replies to. */
  (e: 'show-reply', to: ChatReplyTo): void
  /** A refused node call's way through was pressed. */
  (e: 'node-access', refusal: Refusal, named?: NodeScopeEntry[]): void
  /** Take back file changes: everything from this message on, or this turn's alone. */
  (e: 'rewind', messageId: string, mode: 'since' | 'turn'): void
  /** Open another session on the node, one that wrote to this one, in its own chat. */
  (e: 'open-session', sessionId: string): void
  (e: 'highlight', messageId: string, quote: string, start: number, color: HighlightColor): void
  (e: 'remove-highlight', messageId: string, highlightId: string): void
  (e: 'recolor-highlight', messageId: string, highlightId: string, color: HighlightColor): void
  (e: 'review-revision', messageId: string): void
  (e: 'undo-revision', messageId: string): void
}>()

function openLocalChat(chat: LetterChat) {
  void openLetterChat(chat)
}

function openSourceChat(id: string) {
  if (props.message.fromSession?.path || ChatService.getInstance().getSession(id)) {
    if (props.message.fromSession) openLocalChat(props.message.fromSession)
  } else emit('open-session', id)
}

const comments = useMessageComments(
  () => props.comments,
  (quote, start) => emit('ask-here', props.message.id, quote, start),
  () => props.message.highlights,
  props.message.role === 'assistant' && !props.message.draft
    ? (quote, start, color) => emit('highlight', props.message.id, quote, start, color)
    : undefined,
  (id) => emit('remove-highlight', props.message.id, id),
  (quote, start, text) =>
    !props.message.draft && !props.readOnlyHistory && replyRendered.value
      ? props.captureLink?.(props.message.id, quote, start, text)
      : undefined,
  (quote, start, text) =>
    !props.message.draft && !props.readOnlyHistory && replyRendered.value
      ? props.captureScript?.(props.message.id, quote, start, text)
      : undefined,
  () => props.scriptMenu?.() ?? props.scripts ?? [],
  {
    reply: (quote, start) => {
      if (!answerable.value) return
      const root = comments.content.value?.$el as HTMLElement | undefined
      emit('reply', {
        messageId: props.message.id,
        // Nothing selected: the whole answer, by its opening as it reads.
        ...(quote !== undefined && start !== undefined
          ? { quote, start }
          : { quote: wholeQuote(root ? messageRenderedText(root) : props.message.content) }),
      })
    },
    canReply: () => answerable.value,
    canAnnotate: () => !!props.canComment,
  }
)
/** An answer of the agent, sent, in a chat whose next message can reply to it. */
const answerable = computed(
  () => !!props.canReply && props.message.role === 'assistant' && !props.message.draft
)
/** What is rendered: a question's words with a spot for each of its places. */
const question = computed(() =>
  questionMarkdown(
    props.message.role === 'user' ? chatMarkdown(props.message.content) : props.message.content,
    props.message.role === 'user' ? props.message.replyTo : undefined
  )
)

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.message.content || props.message.toolResult || '')
    new Notice(t('streamB.messageCopied.ed1122'))
  } catch {
    new Notice(t('streamB.couldNotCopyTheMessage.edba99'))
  }
}

const canForkCall = computed(
  () =>
    !props.readOnlyHistory &&
    !props.message.draft &&
    props.message.role === 'tool-call' &&
    props.message.toolStatus !== 'pending' &&
    props.message.toolResult !== undefined
)
function showActions(event: MouseEvent) {
  const menu = new Menu()
  const add = (title: string, icon: string, section: string, action: () => void) =>
    menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(action))
  // A phone shows only the ⋯ under a message, so everything is in its menu there.
  if (Platform.isMobile && (props.message.role === 'user' || props.message.role === 'assistant')) {
    if (answerable.value)
      add(t('streamB.reply.c253f4'), 'reply', 'direct', () => comments.replyHere())
    add(t('streamB.copy.e21f93'), 'copy', 'direct', () => void copyMessage())
    if (!props.readOnlyHistory) {
      if (props.message.role === 'user')
        add(t('streamB.edit.464c4f'), 'pencil', 'direct', () =>
          emit('edit-message', props.message.id)
        )
      else
        add(t('streamB.retry.942087'), 'rotate-cw', 'direct', () =>
          emit('retry-message', props.message.id)
        )
      add(t('streamB.insertIntoNote.be3d5a'), 'file-input', 'direct', () =>
        emit('insert-into-note', props.message.id)
      )
      if (props.canComment)
        add(t('streamB.askHere.7b4ec4'), 'message-square', 'direct', () => comments.askHere())
    }
  }
  props.extendActions?.(menu)
  if (props.readOnlyHistory) return menu.showAtMouseEvent(event)
  if (props.message.role === 'user')
    add(t('streamB.repeat.b6b7a0'), 'repeat', 'message', () =>
      emit('repeat-message', props.message.id)
    )
  if (props.message.role !== 'tool-call' || canForkCall.value)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.branchFromHere.35ed21'))
        .setIcon('git-branch')
        .setSection('conversation')
        .setDisabled(!!props.branchBlocked)
        .onClick(() => branchFromHere())
    )
  if (props.canClone && !props.message.draft)
    add(t('streamB.newChatFromHere.0e1fec'), 'copy-plus', 'conversation', () =>
      emit('clone-chat', props.message.id)
    )
  if (props.message.role === 'user' && props.canRewind) {
    add(t('streamB.rewind.26b658'), 'history', 'changes', () =>
      emit('rewind', props.message.id, 'since')
    )
    if (props.changedFiles)
      add(t('streamB.undoChanges.ba0624'), 'undo-2', 'changes', () =>
        emit('rewind', props.message.id, 'turn')
      )
  }
  if (event.type === 'contextmenu') {
    menu.showAtMouseEvent(event)
    return
  }
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  menu.onHide(() => button.focus({ preventScroll: true }))
  menu.showAtPosition({ x: rect.left, y: rect.bottom })
}

const {
  mapConfig,
  toolSummary,
  toolFilePath,
  contentPicture,
  previewContentImage,
  onAttachmentContextMenu,
  openAttachment,
} = useChatMessageMedia(props)

const originalOpen = ref(false)
const lastRevision = computed(() => props.message.revisions?.at(-1))
const replaced = computed(() => lastRevision.value?.by === 'interceptor')
// The file an edit or a write changed — the plugin's own tools say `path`, Claude Code's
// `file_path` — so its comparison is coloured as that file's code.
const diffPath = computed(() => {
  const params = props.message.toolParams
  const path = params?.path ?? params?.file_path ?? props.message.toolPath
  return typeof path === 'string' ? path : undefined
})
const editedLabel = computed(() => {
  const revision = lastRevision.value
  if (!revision) return ''
  const state = revision.undoneAt
    ? t('streamB.changeUndone.e18ed8')
    : revision.by === 'interceptor'
      ? t('streamB.replacedBy.2a28e0', { v0: String(revision.author) })
      : t('streamB.editedBy.f8de4d', { v0: String(revision.author) })
  return t('streamB.theReplyBefore.7ea725', {
    v0: String(state),
    v1: String(formatTimestamp(revision.at, { diagnostic: true }).exact),
  })
})
const proposalOpen = (proposal: ReplyProposal) =>
  proposal.status === 'pending' || proposal.application === 'pending'
const proposalText = (proposal: ReplyProposal) => {
  if (proposal.application === 'pending') return t('streamB.acceptedChangeNotAppliedYet.5e02cb')
  if (proposal.status === 'pending') return t('streamB.proposedChangeToAReply.04e863')
  return proposal.status === 'accepted'
    ? t('streamB.changeAccepted.36085f')
    : t('streamB.changeRejected.867e26')
}

function onMessageClick(event: MouseEvent) {
  previewContentImage(event)
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-reply-highlight]')
  if (!props.canComment || !el || !el.ownerDocument.getSelection()?.isCollapsed) return
  const mark = props.message.highlights?.find((h) => h.id === el.dataset.replyHighlight)
  if (!mark) return
  event.preventDefault()
  event.stopPropagation()
  const menu = new Menu()
  for (const color of HIGHLIGHT_COLORS)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.makeIt.2a1398', { v0: String(color) }))
        .setIcon('highlighter')
        .setChecked(mark.color === color)
        .onClick(() => emit('recolor-highlight', props.message.id, mark.id, color))
    )
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.removeHighlight.aab650'))
      .setIcon('eraser')
      .onClick(() => emit('remove-highlight', props.message.id, mark.id))
  )
  menu.showAtMouseEvent(event)
}

// Only where a comment can be kept: elsewhere a right-click stays the browser's own. Not on a
// touch screen, where the long press that fires it is the one selecting the words: the menu
// jumped up before they were chosen. There `ChatSelectionBar` offers it once they are.
const onContentMenu = (event: MouseEvent) => {
  if ((props.canComment || answerable.value) && !Platform.isMobile) comments.onContentMenu(event)
}

const interceptorText = ref('')

const sendInterceptorReply = () => {
  const text = interceptorText.value.trim()
  if (!text) return
  emit('send-interceptor', props.message.id, text)
  interceptorText.value = ''
}

const branchFromHere = () => {
  emit('create-branch', props.message.id)
}

const expanded = ref(false)
const thinking = ref<InstanceType<typeof ChatThinking>>()

/**
 * Unfolds whatever keeps a part of this message out of sight, for a match found in it: the
 * details for a tool's parameters and result or a compaction's summary, the side conversation
 * for the interceptor's replies. Reasoning folds in a `<details>` of its own, which the finder
 * opens on the page.
 */
const revealPart = (part: FindPart) => {
  if (
    part === 'params' ||
    part === 'result' ||
    part === 'summary' ||
    (part === 'tool' && ownLine(props.message))
  )
    expanded.value = true
  if (part === 'thinking') thinking.value?.reveal()
  if (
    part === 'interceptor' &&
    !props.message.draft &&
    props.message.interceptorCollapsed !== false
  )
    emit('toggle-interceptor', props.message.id)
}

const replyRendered = ref(false)
watch(
  () => props.message.content,
  () => {
    replyRendered.value = false
  }
)
function onReplyRendered() {
  comments.paint()
  paintPlaces()
  replyRendered.value = true
}
/** The cards drawn in the words last time, taken down before they are drawn again. */
let unpaintPlaces: (() => void) | undefined
onBeforeUnmount(() => unpaintPlaces?.())
/** A question's places, each a card where it stands and the way back to its words. */
function paintPlaces() {
  const root = comments.content.value?.$el as HTMLElement | undefined
  unpaintPlaces?.()
  unpaintPlaces = undefined
  if (!root || !question.value.order.length) return
  unpaintPlaces = paintReplyChips(
    root,
    question.value.order,
    (to) => !!props.replyGone?.includes(to.messageId),
    (to) => emit('show-reply', to)
  )
}
watch(() => props.replyGone?.join('\n'), paintPlaces)
/** Undefined while rendering; null only when the rendered passage is genuinely missing. */
function revealPassage(quote: string, start?: number): HTMLElement | null | undefined {
  if (!replyRendered.value) return undefined
  const root = comments.content.value?.$el as HTMLElement | undefined
  return root ? flashMessagePassage(root, quote, start) : null
}

function revealSelection(
  revision: ChatRevision,
  range: RenderedRange
): HTMLElement | null | undefined {
  if (!replyRendered.value) return undefined
  const root = comments.content.value?.$el as HTMLElement | undefined
  return root &&
    props.message.content === revision.content &&
    props.message.selection?.revisionId === revision.reference.revisionId
    ? flashExactSelection(root, revision.projection, range)
    : null
}

defineExpose({ revealPart, revealPassage, revealSelection })
</script>

<style lang="scss" src="../styles/chatMessage/index.scss" />
