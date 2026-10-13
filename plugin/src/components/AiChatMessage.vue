<template>
  <div
    class="abele-chat-msg"
    :class="[
      `abele-chat-msg_${message.role}`,
      { 'abele-chat-msg--draft': message.draft, 'abele-chat-msg_line': ownLine(message) },
    ]"
    @click.capture="onMessageClick"
  >
    <!-- A tool call keeps its glyph in line, by the kind of work, and opens its details by it. A
         question or an answer has no glyph column: who speaks is plain from the bubble, and its
         actions are in the line under it. -->
    <button
      v-if="message.role !== 'user' && message.role !== 'assistant' && !ownLine(message)"
      type="button"
      class="clickable-icon abele-chat-msg__icon"
      aria-label="Message actions and details"
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
        :live="liveTurn"
        :resource-opener="resourceOpener"
      />

      <!-- Tool call — compact one-liner + inline diff -->
      <template v-if="message.role === 'tool-call'">
        <span
          v-if="!ownLine(message)"
          class="abele-chat-msg__tool-line"
          data-find-part="tool"
          @contextmenu.prevent="showActions"
        >
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
          <ChatBranchSwitch
            v-if="branches"
            class="abele-chat-msg__branches abele-chat-msg__tool-branches"
            :choices="branches.choices"
            :index="branches.index"
            @switch="(id) => emit('switch-branch', id)"
          />
          <Icon
            v-if="canForkCall"
            class="abele-chat-msg__tool-branch"
            icon="git-branch-plus"
            size="xs"
            tooltip="Branch from here: go on from this call in a new branch"
            :disabled="branchBlocked"
            disabled-reason="Wait for the active turn to finish"
            @click.stop="branchFromHere"
          />
        </span>
        <span
          v-if="ownLine(message) && expanded"
          class="abele-chat-msg__tool-line"
          data-find-part="tool"
        >
          <code>{{ message.toolName }}</code
          ><span>{{ toolSummary }}</span>
        </span>
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
        <TreeItem
          v-if="message.replyProposal"
          class="abele-chat-run abele-chat-msg__proposal"
          icon="git-compare"
          :text="proposalText(message.replyProposal)"
          :disabled="!proposalOpen(message.replyProposal)"
          @click="emit('review-revision', message.id)"
        >
          <template v-if="proposalOpen(message.replyProposal)" #end>
            <StatusDot tone="orange" label="Waiting for your decision" />
          </template>
        </TreeItem>

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
          {{ message.content }}
        </span>
      </template>

      <!-- System messages: compact summary (long) or short label (model change, skill, etc.) -->
      <template v-else-if="message.role === 'system'">
        <template v-if="message.content.length > 100">
          <span class="abele-chat-msg__compact-label">── Conversation compacted ──</span>
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
      <Markdown
        v-else-if="message.content"
        :text="message.content"
        :resource-opener="resourceOpener"
        data-find-part="content"
      />
      <slot name="metadata" />

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
      :read-only="readOnlyHistory"
      :can-comment="canComment"
      :expanded="expanded"
      :capture-selection="comments.capture"
      :ask-here="comments.askHere"
      @copy="copyMessage"
      @actions="showActions"
      @edit-message="emit('edit-message', $event)"
      @retry-message="emit('retry-message', $event)"
      @insert-into-note="emit('insert-into-note', $event)"
      @details="expanded = !expanded"
    >
      <Icon
        v-if="lastRevision"
        class="abele-chat-msg__edited"
        icon="pencil-line"
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
import { formatTimestamp } from '@/helpers/displayFormat'
import { Menu, Notice, Platform } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import TreeItem from './obsidian/TreeItem.vue'
import StatusDot from './obsidian/StatusDot.vue'
import AiReplyOriginalDialog from './AiReplyOriginalDialog.vue'
import AiChatMessageDetails from './AiChatMessageDetails.vue'
import AiChatMessageInterceptor from './AiChatMessageInterceptor.vue'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import ChatPicture from './ChatPicture.vue'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import Markdown from './obsidian/Markdown.vue'
import ChatThinking from './ChatThinking.vue'
import { KIND_ICON, ownLine, toolKind } from '@/ai/toolRuns'
import type { ReplyProposal } from '@/ai/replyAnnotations'
import AbeleMap from './AbeleMap.vue'
import Diff from './Diff.vue'
import AiSubAgentRun from './AiSubAgentRun.vue'
import GalleryViewer from './GalleryViewer.vue'
import { getAttachmentIcon, fileName as attachmentName } from '@/ai/attachments'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage, MessageComment } from '@/ai/types'
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
  /** Local chats only; node/provider-native sessions cannot be cloned into a vault chat. */
  canClone?: boolean
  /** Part of the turn the agent is still working on: its thinking stays open. */
  liveTurn?: boolean
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
    add('Copy', 'copy', 'direct', () => void copyMessage())
    if (!props.readOnlyHistory) {
      if (props.message.role === 'user')
        add('Edit', 'pencil', 'direct', () => emit('edit-message', props.message.id))
      else add('Retry', 'rotate-cw', 'direct', () => emit('retry-message', props.message.id))
      add('Insert into note', 'file-input', 'direct', () =>
        emit('insert-into-note', props.message.id)
      )
      if (props.canComment) add('Ask here', 'message-square', 'direct', () => comments.askHere())
    }
  }
  if (props.readOnlyHistory) return menu.showAtMouseEvent(event)
  if (props.message.role === 'user')
    add('Repeat', 'repeat', 'message', () => emit('repeat-message', props.message.id))
  if (props.message.role !== 'tool-call' || canForkCall.value)
    menu.addItem((item) =>
      item
        .setTitle('Branch from here')
        .setIcon('git-branch')
        .setSection('conversation')
        .setDisabled(!!props.branchBlocked)
        .onClick(() => branchFromHere())
    )
  if (props.canClone && !props.message.draft)
    add('New chat from here', 'copy-plus', 'conversation', () =>
      emit('clone-chat', props.message.id)
    )
  if (props.message.role === 'user' && props.canRewind) {
    add('Rewind', 'history', 'changes', () => emit('rewind', props.message.id, 'since'))
    if (props.changedFiles)
      add('Undo changes', 'undo-2', 'changes', () => emit('rewind', props.message.id, 'turn'))
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
  openToolFile,
  imagePath,
  imageUrl,
  viewerOpen,
  viewerImages,
  contentPicture,
  previewContentImage,
  openImagePreview,
  onAttachmentContextMenu,
  onImageContextMenu,
  openAttachment,
} = useChatMessageMedia(props)

const originalOpen = ref(false)
const lastRevision = computed(() => props.message.revisions?.at(-1))
// The file an edit or a write changed — the plugin's own tools say `path`, Claude Code's
// `file_path` — so its comparison is coloured as that file's code.
const diffPath = computed(() => {
  const params = props.message.toolParams
  const path = params?.path ?? params?.file_path
  return typeof path === 'string' ? path : undefined
})
const editedLabel = computed(() => {
  const revision = lastRevision.value
  if (!revision) return ''
  const state = revision.undoneAt ? 'Change undone' : `Edited by ${revision.author}`
  return `${state} · ${formatTimestamp(revision.at, { diagnostic: true }).exact} · the reply before`
})
const proposalOpen = (proposal: ReplyProposal) =>
  proposal.status === 'pending' || proposal.application === 'pending'
const proposalText = (proposal: ReplyProposal) => {
  if (proposal.application === 'pending') return 'Accepted change, not applied yet'
  if (proposal.status === 'pending') return 'Proposed change to a reply'
  return proposal.status === 'accepted' ? 'Change accepted' : 'Change rejected'
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
  replyRendered.value = true
}
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
