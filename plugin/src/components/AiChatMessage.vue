<template>
  <div
    class="abele-chat-msg"
    :class="[`abele-chat-msg_${message.role}`, { 'abele-chat-msg--draft': message.draft }]"
    @click.capture="onMessageClick"
  >
    <!-- Icon — clickable to expand details -->
    <button
      type="button"
      class="clickable-icon abele-chat-msg__icon"
      aria-label="Message actions and details"
      :aria-expanded="expanded"
      @pointerdown="comments.captureFresh"
      @click="expanded = !expanded"
    >
      <Icon v-if="message.role === 'user'" icon="user" />
      <Icon v-else-if="message.role === 'assistant'" icon="bot" />
      <Icon v-else-if="message.role === 'tool-call'" icon="terminal" />
      <Icon v-else-if="message.role === 'tool-result'" icon="check" />
      <Icon v-else icon="info" />
    </button>

    <div class="abele-chat-msg__body">
      <!-- Actions and debug info — toggled by the icon, so they open beside it at the top of the
           message rather than under a long answer. The buttons come first: the params and the
           result below them can be tall. -->
      <AiChatMessageDetails
        v-if="expanded"
        :message="message"
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
      <details v-if="message.thinking" class="abele-chat-msg__thinking">
        <summary>Thinking</summary>
        <Markdown :text="message.thinking" :resource-opener="resourceOpener" data-find-part="thinking" />
      </details>

      <!-- Tool call — compact one-liner + inline diff -->
      <template v-if="message.role === 'tool-call'">
        <span class="abele-chat-msg__tool-line" data-find-part="tool">
          <code>{{ message.toolName }}</code>
          <span
            class="abele-chat-msg__tool-summary"
            :class="{ 'abele-chat-msg__tool-link': toolFilePath }"
            @click="openToolFile"
            >{{ toolSummary }}</span
          >
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
              message.toolStatus === 'approved' && !message.toolResult && !message.toolExecution
            "
            icon="loader"
            no-hover
            class="abele-chat-msg__tool-spinner"
          />
          <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-err-badge">{{
            message.toolExecution === 'interrupted'
              ? 'interrupted'
              : message.toolExecution === 'not-run'
                ? 'not run'
                : 'failed'
          }}</span>
          <slot name="tool-note" />
        </span>
        <!-- A delegated run: the whole sub-conversation, right where it was dispatched. -->
        <AiSubAgentRun v-if="message.subAgentRun" :run="message.subAgentRun" />
        <div v-if="message.replyProposal" class="abele-chat-msg__revision">
          <Button
            v-if="message.replyProposal.status === 'pending' || message.replyProposal.application === 'pending'"
            :text="message.replyProposal.application === 'pending' ? 'Finish accepted revision' : 'Review reply revision'"
            icon="git-compare"
            tooltip="Compare the selected passage before accepting or rejecting the replacement"
            @click="emit('review-revision', message.id)"
          />
          <span v-else>Reply revision {{ message.replyProposal.status }}</span>
        </div>

        <div
          v-if="message.toolStatus === 'approved' && imageUrl"
          class="abele-chat-msg__image-wrap"
        >
          <img
            :src="imageUrl"
            class="abele-chat-msg__image-preview"
            @click="openImagePreview"
            @contextmenu.prevent="onImageContextMenu"
          />
          <span v-if="imagePath" class="abele-chat-msg__image-link" @click="openImagePreview">{{
            imagePath
          }}</span>
          <GalleryViewer
            v-if="viewerOpen"
            :images="viewerImages"
            :start-index="0"
            :gallery-file-path="imagePath || ''"
            :chat-id="ChatService.getInstance().activeTabId.value ?? ''"
            @close="viewerOpen = false"
          />
        </div>
        <AbeleMap
          v-if="message.toolStatus === 'approved' && mapConfig"
          :config="mapConfig"
          class="abele-chat-msg__map"
        />
        <pre
          v-if="message.toolDiff && !message.toolDiff.old && (!compactToolDetails || expanded)"
          class="abele-chat-msg__new-file"
          data-find-part="newfile"
        ><code>{{ message.toolDiff.new }}</code></pre>
        <Diff
          v-else-if="message.toolDiff && (!compactToolDetails || expanded)"
          :text-left="message.toolDiff.old"
          :text-right="message.toolDiff.new"
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
          {{ message.content }}
        </span>
      </template>

      <!-- System messages: compact summary (long) or short label (model change, skill, etc.) -->
      <template v-else-if="message.role === 'system'">
        <template v-if="message.content.length > 100">
          <span class="abele-chat-msg__compact-label">── Conversation compacted ──</span>
          <div v-if="expanded" class="abele-chat-msg__compact-summary">
            <Markdown :text="message.content" :resource-opener="resourceOpener" data-find-part="summary" />
          </div>
        </template>
        <span v-else class="abele-chat-msg__compact-label"
          >── <span data-find-part="content">{{ message.content }}</span> ──</span
        >
      </template>

      <!-- User / Assistant — markdown -->
      <Markdown
        v-else-if="(message.role === 'assistant' || message.role === 'user') && message.content"
        :ref="comments.content"
        :text="message.content"
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
      <Markdown v-else-if="message.content" :text="message.content" :resource-opener="resourceOpener" data-find-part="content" />
      <slot name="metadata" />

      <div v-if="lastRevision" class="abele-chat-msg__revision">
        <span
          >Edited by {{ lastRevision.author }} · {{ formatTime(lastRevision.at)
          }}{{ lastRevision.undoneAt ? ' · undone' : '' }}</span
        >
        <Button text="View original" tooltip="Read the original reply or undo the last revision" @click="originalOpen = true" />
      </div>
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

    <!-- Timestamp — always visible, right-aligned -->
    <span
      v-if="message.role === 'user' || message.role === 'assistant'"
      class="abele-chat-msg__time"
    >
      {{ shortTime(message.timestamp) }}
    </span>

    <!-- Branch navigation — below message, full width -->
    <div v-if="branchInfo && branchInfo.total > 1" class="abele-chat-msg__branch-nav">
      <Icon
        icon="chevron-left"
        :class="{ 'abele-chat-msg__branch-disabled': displayIndex <= 0 }"
        @click.stop="switchPrev"
      />
      <span class="abele-chat-msg__branch-label"
        >{{ displayIndex + 1 }}/{{ branchInfo.total }}</span
      >
      <Icon
        icon="chevron-right"
        :class="{ 'abele-chat-msg__branch-disabled': displayIndex >= branchInfo.total - 1 }"
        @click.stop="switchNext"
      />
      <Icon icon="plus" class="abele-chat-msg__branch-add" @click.stop="branchFromHere" />
    </div>

    <!-- Draft actions -->
    <div v-if="message.draft && !interceptorStreaming && !readOnlyHistory" class="abele-chat-msg__draft-actions">
      <button
        class="abele-chat-msg__draft-btn abele-chat-msg__draft-btn--send"
        @click="emit('confirm-draft', message.id)"
      >
        Send
      </button>
      <button class="abele-chat-msg__draft-btn" @click="emit('edit-draft', message.id)">
        Edit
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
import { ref, computed, watch } from 'vue'
import { flashMessagePassage, flashExactSelection } from '@/ai/messageComments'
import type { ChatRevision, RenderedRange } from '@/selection/types'
import dayjs from 'dayjs'
import { Menu, Notice, Platform } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import AiReplyOriginalDialog from './AiReplyOriginalDialog.vue'
import AiChatMessageDetails from './AiChatMessageDetails.vue'
import AiChatMessageInterceptor from './AiChatMessageInterceptor.vue'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import ChatPicture from './ChatPicture.vue'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import Markdown from './obsidian/Markdown.vue'
import AbeleMap from './AbeleMap.vue'
import Diff from './Diff.vue'
import AiSubAgentRun from './AiSubAgentRun.vue'
import GalleryViewer from './GalleryViewer.vue'
import { getAttachmentIcon, fileName as attachmentName } from '@/ai/attachments'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { BranchInfo } from './AiChat.vue'
import { useMessageComments } from '@/composables/useMessageComments'
import { useChatMessageMedia } from '@/composables/useChatMessageMedia'
import type { FindPart } from '@/ai/chatFind'
import type { SelectionMenuItem } from '@/scripting/selectionMenuScripts'

const props = defineProps<{
  message: ChatMessage
  readOnlyHistory?: boolean
  /** Local chats only; node/provider-native sessions cannot be cloned into a vault chat. */
  canClone?: boolean
  /** Node histories keep successful tool previews behind the existing detail toggle. */
  compactToolDetails?: boolean
  resourceOpener?: (path: string) => void
  branchInfo?: BranchInfo
  interceptorStreaming?: boolean
  interceptorStreamingContent?: string
  interceptorError?: string | null
  /** Comments asked on this answer, from the chat's metadata. */
  comments?: MessageComment[]
  /** Whether "Ask here" is offered: an ordinary chat that has a file to keep comments in. */
  canComment?: boolean
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
  /** Take back file changes: everything from this message on, or this turn's alone. */
  (e: 'rewind', messageId: string, mode: 'since' | 'turn'): void
  (e: 'highlight', messageId: string, quote: string, start: number, color: HighlightColor): void
  (e: 'remove-highlight', messageId: string, highlightId: string): void
  (e: 'recolor-highlight', messageId: string, highlightId: string, color: HighlightColor): void
  (e: 'review-revision', messageId: string): void
  (e: 'undo-revision', messageId: string): void
}>()

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
  () => props.scriptMenu?.() ?? props.scripts ?? []
)

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.message.content || props.message.toolResult || '')
    new Notice('Message copied')
  } catch {
    new Notice('Could not copy the message')
  }
}

function showActions(event: MouseEvent) {
  const menu = new Menu()
  const add = (title: string, icon: string, section: string, action: () => void) =>
    menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(action))
  if (props.message.role === 'user')
    add('Repeat', 'repeat', 'message', () => emit('repeat-message', props.message.id))
  add('Branch from here', 'git-branch', 'conversation', () => branchFromHere())
  if (props.canClone && !props.message.draft)
    add('New chat from here', 'copy-plus', 'conversation', () =>
      emit('clone-chat', props.message.id)
    )
  if (props.message.role === 'user' && props.canRewind) {
    add('Rewind', 'history', 'changes', () => emit('rewind', props.message.id, 'since'))
    if (props.changedFiles)
      add('Undo changes', 'undo-2', 'changes', () => emit('rewind', props.message.id, 'turn'))
  }
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  menu.onHide(() => button.focus({ preventScroll: true }))
  menu.showAtPosition({ x: rect.left, y: rect.bottom })
}

const {
  mapConfig, toolSummary, toolFilePath, openToolFile,
  imagePath, imageUrl, viewerOpen, viewerImages, contentPicture,
  previewContentImage, openImagePreview, onAttachmentContextMenu,
  onImageContextMenu, openAttachment,
} = useChatMessageMedia(props)

const originalOpen = ref(false)
const lastRevision = computed(() => props.message.revisions?.at(-1))

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
        .setTitle(`Make it ${color}`)
        .setIcon('highlighter')
        .setChecked(mark.color === color)
        .onClick(() => emit('recolor-highlight', props.message.id, mark.id, color))
    )
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle('Remove highlight')
      .setIcon('eraser')
      .onClick(() => emit('remove-highlight', props.message.id, mark.id))
  )
  menu.showAtMouseEvent(event)
}

// Only where a comment can be kept: elsewhere a right-click stays the browser's own. Not on a
// touch screen, where the long press that fires it is the one selecting the words: the menu
// jumped up before they were chosen. There `ChatSelectionBar` offers it once they are.
const onContentMenu = (event: MouseEvent) => {
  if (props.canComment && !Platform.isMobile) comments.onContentMenu(event)
}

const interceptorText = ref('')

const sendInterceptorReply = () => {
  const text = interceptorText.value.trim()
  if (!text) return
  emit('send-interceptor', props.message.id, text)
  interceptorText.value = ''
}

// -1 = "new unsent branch" = last position (after all existing children)
const displayIndex = computed(() => {
  if (!props.branchInfo) return 0
  return props.branchInfo.activeChildIndex === -1
    ? props.branchInfo.total - 1
    : props.branchInfo.activeChildIndex
})

const switchPrev = () => {
  if (!props.branchInfo || displayIndex.value <= 0) return
  emit('switch-branch', props.branchInfo.childIds[displayIndex.value - 1])
}

const switchNext = () => {
  if (!props.branchInfo) return
  const idx = displayIndex.value
  if (idx >= props.branchInfo.total - 1) return
  // Going forward into "new branch" = create branch
  if (idx + 1 >= props.branchInfo.childIds.length) {
    emit('create-branch', props.message.id)
  } else {
    emit('switch-branch', props.branchInfo.childIds[idx + 1])
  }
}

const branchFromHere = () => {
  emit('create-branch', props.message.id)
}

const expanded = ref(false)

/**
 * Unfolds whatever keeps a part of this message out of sight, for a match found in it: the
 * details for a tool's parameters and result or a compaction's summary, the side conversation
 * for the interceptor's replies. Reasoning folds in a `<details>` of its own, which the finder
 * opens on the page.
 */
const revealPart = (part: FindPart) => {
  if (part === 'params' || part === 'result' || part === 'summary') expanded.value = true
  if (
    part === 'interceptor' &&
    !props.message.draft &&
    props.message.interceptorCollapsed !== false
  )
    emit('toggle-interceptor', props.message.id)
}

const replyRendered = ref(false)
watch(() => props.message.content, () => { replyRendered.value = false })
function onReplyRendered() {
  comments.paint()
  replyRendered.value = true
}
/** Undefined while rendering; null only when the rendered passage is genuinely missing. */
function revealPassage(quote: string, start?: number): HTMLElement | null | undefined {
  if (!replyRendered.value) return undefined
  const root = comments.content.value?.$el as HTMLElement | undefined
  return root ? flashMessagePassage(root, quote, start) : null
}

function revealSelection(revision: ChatRevision, range: RenderedRange): HTMLElement | null | undefined {
  if (!replyRendered.value) return undefined
  const root = comments.content.value?.$el as HTMLElement | undefined
  return root && props.message.content === revision.content &&
    props.message.selection?.revisionId === revision.reference.revisionId
    ? flashExactSelection(root, revision.projection, range) : null
}

defineExpose({ revealPart, revealPassage, revealSelection })

const formatTime = (ts: number) => dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
const shortTime = (ts: number) => dayjs(ts).format('HH:mm')
</script>

<style lang="scss" src="../styles/chatMessage/index.scss" />
