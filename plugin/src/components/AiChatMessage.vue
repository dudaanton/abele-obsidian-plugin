<template>
  <div
    class="abele-chat-msg"
    :class="[`abele-chat-msg_${message.role}`, { 'abele-chat-msg--draft': message.draft }]"
  >
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
            v-if="message.toolStatus === 'approved' && !message.toolResult"
            icon="loader"
            no-hover
            class="abele-chat-msg__tool-spinner"
          />
          <span v-if="message.toolStatus === 'rejected'" class="abele-chat-msg__tool-err-badge"
            >failed</span
          >
        </span>
        <!-- A delegated run: the whole sub-conversation, right where it was dispatched. -->
        <AiSubAgentRun v-if="message.subAgentRun" :run="message.subAgentRun" />

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
            @close="viewerOpen = false"
          />
        </div>
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

      <!-- System messages: compact summary (long) or short label (model change, skill, etc.) -->
      <template v-else-if="message.role === 'system'">
        <template v-if="message.content.length > 100">
          <span class="abele-chat-msg__compact-label">── Conversation compacted ──</span>
          <div v-if="expanded" class="abele-chat-msg__compact-summary">
            <Markdown :text="message.content" />
          </div>
        </template>
        <span v-else class="abele-chat-msg__compact-label">── {{ message.content }} ──</span>
      </template>

      <!-- User / Assistant — markdown -->
      <Markdown v-else-if="message.content" :text="message.content" />

      <!-- Attachments -->
      <div v-if="message.attachments?.length" class="abele-chat-msg__attachments">
        <span
          v-for="path in message.attachments"
          :key="path"
          class="abele-chat-msg__attachment-chip"
          @click="openAttachment(path)"
        >
          <Icon :icon="getAttachmentIcon(path)" />
          {{ attachmentName(path) }}
        </span>
      </div>

      <!-- Expanded debug info — toggled by icon click -->
      <div v-if="expanded" class="abele-chat-msg__details">
        <div class="abele-chat-msg__detail-time">{{ formatTime(message.timestamp) }}</div>
        <div v-if="message.usage" class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__detail-label">Tokens</span>
          <span
            >in: {{ message.usage.input }} / out: {{ message.usage.output }} / total:
            {{ message.usage.total
            }}<template v-if="message.usage.speed"> · {{ message.usage.speed }} t/s</template></span
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
        <div class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__branch-action" @click="emit('create-branch', message.id)"
            >Branch from here</span
          >
        </div>
        <div v-if="message.role === 'user'" class="abele-chat-msg__detail-row">
          <span class="abele-chat-msg__branch-action" @click="emit('repeat-message', message.id)"
            >Repeat</span
          >
          <span class="abele-chat-msg__branch-action" @click="emit('edit-message', message.id)"
            >Edit</span
          >
        </div>
        <div
          v-if="message.role === 'assistant' || message.role === 'tool-call'"
          class="abele-chat-msg__detail-row"
        >
          <span class="abele-chat-msg__branch-action" @click="emit('retry-message', message.id)"
            >Retry</span
          >
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
    <div v-if="message.draft" class="abele-chat-msg__draft-actions">
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
    <div
      v-if="message.interceptorChat?.length || interceptorStreaming || interceptorError"
      class="abele-chat-msg__interceptor"
    >
      <div
        v-if="!message.draft && message.interceptorCollapsed !== false"
        class="abele-chat-msg__interceptor-collapsed"
        @click="emit('toggle-interceptor', message.id)"
      >
        <Icon icon="message-square" />
        <span
          >{{ message.interceptorName || 'Interceptor' }} ({{
            message.interceptorChat?.length || 0
          }})</span
        >
      </div>
      <template v-else>
        <div
          v-if="!message.draft"
          class="abele-chat-msg__interceptor-header"
          @click="emit('toggle-interceptor', message.id)"
        >
          <Icon icon="chevron-down" />
          <span>{{ message.interceptorName || 'Interceptor' }}</span>
        </div>
        <div class="abele-chat-msg__interceptor-messages">
          <div
            v-for="icMsg in message.interceptorChat"
            :key="icMsg.id"
            class="abele-chat-msg__interceptor-msg"
            :class="`abele-chat-msg__interceptor-msg--${icMsg.role}`"
          >
            <Markdown v-if="icMsg.role === 'assistant'" :text="icMsg.content" />
            <span v-else>{{ icMsg.content }}</span>
          </div>
          <div
            v-if="interceptorStreaming"
            class="abele-chat-msg__interceptor-msg abele-chat-msg__interceptor-msg--assistant"
          >
            <Markdown v-if="interceptorStreamingContent" :text="interceptorStreamingContent" />
            <span v-else class="abele-chat-msg__interceptor-typing">
              <span class="abele-ai-chat__typing-dot" />
              <span class="abele-ai-chat__typing-dot" />
              <span class="abele-ai-chat__typing-dot" />
            </span>
          </div>
        </div>
        <div v-if="interceptorError" class="abele-chat-msg__interceptor-error">
          <span>{{ interceptorError }}</span>
          <button class="abele-chat-msg__draft-btn" @click="emit('retry-interceptor')">
            Retry
          </button>
        </div>
        <div
          v-if="message.draft && !interceptorStreaming && !interceptorError"
          class="abele-chat-msg__interceptor-input"
        >
          <textarea
            ref="interceptorInputEl"
            :value="interceptorText"
            class="abele-chat-msg__interceptor-textarea"
            placeholder="Reply..."
            rows="1"
            @input="interceptorText = ($event.target as HTMLTextAreaElement).value"
            @keydown.shift.enter.prevent="sendInterceptorReply"
          />
          <Icon icon="send-horizontal" with-bg @click="sendInterceptorReply" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { Menu, Notice, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import Diff from './Diff.vue'
import AiSubAgentRun from './AiSubAgentRun.vue'
import GalleryViewer from './GalleryViewer.vue'
import type { ViewerImage } from './GalleryViewer.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { getAttachmentIcon, fileName as attachmentName } from '@/ai/attachments'
import type { ChatMessage } from '@/ai/types'
import type { BranchInfo } from './AiChat.vue'

const props = defineProps<{
  message: ChatMessage
  branchInfo?: BranchInfo
  interceptorStreaming?: boolean
  interceptorStreamingContent?: string
  interceptorError?: string | null
}>()

const emit = defineEmits<{
  (e: 'create-branch', messageId: string): void
  (e: 'switch-branch', messageId: string): void
  (e: 'repeat-message', messageId: string): void
  (e: 'retry-message', messageId: string): void
  (e: 'edit-message', messageId: string): void
  (e: 'confirm-draft', messageId: string): void
  (e: 'edit-draft', messageId: string): void
  (e: 'send-interceptor', messageId: string, content: string): void
  (e: 'toggle-interceptor', messageId: string): void
  (e: 'retry-interceptor'): void
}>()

const interceptorText = ref('')
const interceptorInputEl = ref<HTMLTextAreaElement | null>(null)

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

const FILE_TOOLS = [
  'read',
  'edit',
  'write',
  'create',
  'rm',
  'mv',
  'cp',
  'read_image',
  'apply_template',
]

/** Extract path from tool result text like "Created: path" or "Saved: path" */
function extractResultPath(result?: string): string {
  if (!result) return ''
  const match = result.match(/^(?:Created|Saved|Edited):\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

const toolSummary = computed(() => {
  const name = props.message.toolName
  const p = props.message.toolParams
  // For apply_template, show created file path once available
  if (name === 'apply_template') {
    return extractResultPath(props.message.toolResult) || String(p?.path || '')
  }
  if (!p) return ''
  if (p.path) return String(p.path)
  if (p.from && p.to) return `${p.from} → ${p.to}`
  if (p.url) return String(p.url)
  if (p.query) return String(p.query)
  if (p.name) return String(p.name)
  return ''
})

/** Path to open when clicking the tool summary (result path for mv/cp, otherwise path param) */
const toolFilePath = computed(() => {
  const name = props.message.toolName
  if (!name || !FILE_TOOLS.includes(name)) return ''
  const p = props.message.toolParams
  if (!p) return ''
  if (name === 'mv' || name === 'cp') return String(p.to || '')
  if (name === 'apply_template') return extractResultPath(props.message.toolResult)
  return String(p.path || '')
})

const openToolFile = () => {
  if (!toolFilePath.value) return
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(toolFilePath.value)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  }
}

const IMAGE_TOOLS = ['read_image', 'generate_image', 'edit_image']

const imagePath = computed(() => {
  const name = props.message.toolName
  if (!name || !IMAGE_TOOLS.includes(name)) return ''
  if (name === 'read_image') return (props.message.toolParams?.path as string) || ''
  const result = props.message.toolResult
  if (!result) return ''
  const match = result.match(/(?:Image saved|Edited image saved): (.+)/)
  return match ? match[1].trim() : ''
})

const viewerOpen = ref(false)

const viewerImages = computed<ViewerImage[]>(() => {
  if (!imageUrl.value || !imagePath.value) return []
  return [
    {
      url: imageUrl.value,
      alt: imagePath.value.split('/').pop() || '',
      type: 'local' as const,
      path: imagePath.value,
    },
  ]
})

const openImagePreview = () => {
  if (viewerImages.value.length) {
    viewerOpen.value = true
  }
}

const onImageContextMenu = (e: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item
      .setTitle('Preview')
      .setIcon('eye')
      .onClick(() => openImagePreview())
  })
  menu.addItem((item) => {
    item
      .setTitle('Open file')
      .setIcon('file')
      .onClick(() => {
        if (!imagePath.value) return
        const { app } = GlobalStore.getInstance()
        const file = app.vault.getAbstractFileByPath(imagePath.value)
        if (file instanceof TFile) app.workspace.getLeaf(false).openFile(file)
      })
  })
  menu.addItem((item) => {
    item
      .setTitle('Copy path')
      .setIcon('link')
      .onClick(() => {
        if (imagePath.value) {
          navigator.clipboard.writeText(imagePath.value)
          new Notice('Path copied')
        }
      })
  })
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}

const imageUrl = computed(() => {
  const name = props.message.toolName
  if (!name || !IMAGE_TOOLS.includes(name)) return ''

  // read_image: path is in toolParams
  if (name === 'read_image') {
    const path = props.message.toolParams?.path as string
    if (!path) return ''
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return ''
    return app.vault.getResourcePath(file)
  }

  // generate_image / edit_image: extract saved path from toolResult
  const result = props.message.toolResult
  if (!result) return ''
  const match = result.match(/(?:Image saved|Edited image saved): (.+)/)
  if (!match) return ''
  const path = match[1].trim()
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return ''
  return app.vault.getResourcePath(file)
})

const openAttachment = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  }
}

const TOOL_RESULT_MAX_LENGTH = 1000

const formatTime = (ts: number) => dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
const shortTime = (ts: number) => dayjs(ts).format('HH:mm')
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)
</script>

<style lang="scss">
.abele-chat-msg {
  display: flex;
  flex-wrap: wrap;
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
    padding: var(--size-2-1) 0;
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

/**
 * The icon and the timestamp sit beside the message's first line, so both are given a box
 * exactly one line tall and their content centred in it. `1lh` is that line — the element's
 * own font size times its line height — which is why this holds when the font changes:
 * a phone's larger text moves the icon with it. It replaced four hand-picked pixel offsets
 * that were tuned against one desktop font size and left the icons sitting ~4px low
 * everywhere else.
 */
.abele-chat-msg__icon,
.abele-chat-msg__time {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 1lh;
}

.abele-chat-msg__icon {
  color: var(--text-faint);
  cursor: pointer;

  &:hover {
    color: var(--text-muted);
  }
}

// The tool rows set a smaller font on their line, so their icon matches it to stay on it.
.abele-chat-msg_tool-call > .abele-chat-msg__icon,
.abele-chat-msg_tool-result > .abele-chat-msg__icon {
  font-size: var(--font-small);
}

// A user message is a bubble, and its text starts below the bubble's own padding.
.abele-chat-msg_user > .abele-chat-msg__icon,
.abele-chat-msg_user > .abele-chat-msg__time {
  margin-top: var(--size-4-1);
}

.abele-chat-msg__time {
  font-size: var(--font-smaller);
  color: var(--text-faint);
  white-space: nowrap;
}

.abele-chat-msg__body {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
  word-break: break-word;
  overflow-x: hidden;

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

  table {
    border-collapse: collapse;
    width: 100%;

    th,
    td {
      border: 1px solid var(--background-modifier-border);
      padding: var(--size-4-1) var(--size-4-2);
      text-align: left;
    }

    th {
      background-color: var(--background-secondary);
    }
  }
}

.abele-chat-msg__thinking {
  margin-top: 0;
  margin-bottom: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-1) var(--size-4-2);
  font-size: var(--font-small);
  overflow: hidden;
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

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--font-small);

    th,
    td {
      border: 1px solid var(--background-modifier-border);
      padding: var(--size-4-1) var(--size-4-2);
      text-align: left;
    }

    th {
      background-color: var(--background-secondary);
    }
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
  overflow: hidden;

  code {
    color: var(--text-accent);
    font-size: var(--font-smaller);
    flex-shrink: 0;
    white-space: nowrap;
  }
}

.abele-chat-msg__tool-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-msg__tool-link {
  color: var(--text-accent);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.abele-chat-msg__tool-spinner {
  animation: abele-spin 1s linear infinite;
  color: var(--text-faint);
  flex-shrink: 0;
  overflow: hidden;
}

.abele-chat-msg__tool-progress {
  font-size: var(--font-smaller);
  color: var(--text-muted);
  font-style: italic;
}

/**
 * The badge keeps its word. It is a flex item next to a file path that can be arbitrarily
 * long, and the body around it sets `word-break: break-word` — so left to shrink it collapsed
 * to a single character's width and broke "failed" across three lines. The path has an
 * ellipsis and can give up the room instead.
 */
.abele-chat-msg__tool-err-badge {
  flex: 0 0 auto;
  white-space: nowrap;
  word-break: normal;
  color: var(--text-error);
  font-size: var(--font-smaller);
}

.abele-chat-msg__tool-error {
  font-size: var(--font-small);
  color: var(--text-error);
}

.abele-chat-msg__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin-top: var(--size-4-1);
}

.abele-chat-msg__attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-2-3);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  font-size: var(--font-smaller);
  color: var(--text-accent);
  cursor: pointer;

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-chat-msg__image-wrap {
  margin-top: var(--size-4-1);
}

.abele-chat-msg__image-preview {
  display: block;
  max-width: 300px;
  max-height: 300px;
  border-radius: var(--radius-s);
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
}

.abele-chat-msg__image-link {
  display: block;
  margin-top: var(--size-2-1);
  font-size: var(--font-smallest);
  color: var(--text-accent);
  cursor: pointer;
  word-break: break-all;

  &:hover {
    text-decoration: underline;
  }
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
    margin: var(--size-2-1) 0 var(--size-4-1);
    font-size: var(--font-smaller);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.abele-chat-msg__detail-row {
  display: flex;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-1);
}

.abele-chat-msg__detail-label {
  font-weight: bold;
  margin-right: var(--size-4-1);
  flex-shrink: 0;
  white-space: nowrap;
}

.abele-chat-msg__detail-time {
  color: var(--text-faint);
}

.abele-chat-msg__branch-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-2-1);
  flex-basis: 100%;
  color: var(--text-faint);
  font-size: var(--font-smaller);

  .clickable-icon {
    cursor: pointer;
    &:hover {
      color: var(--text-muted);
    }
  }
}

.abele-chat-msg__branch-label {
  white-space: nowrap;
  min-width: 20px;
  text-align: center;
}

.abele-chat-msg__branch-disabled {
  opacity: 0.3;
  pointer-events: none;
}

.abele-chat-msg__branch-add {
  margin-left: var(--size-2-1);
  cursor: pointer;
  color: var(--text-faint);

  &:hover {
    color: var(--text-muted);
  }
}

.abele-chat-msg__branch-action {
  color: var(--text-accent);
  cursor: pointer;
  font-size: var(--font-smaller);

  &:hover {
    text-decoration: underline;
  }
}

@container (max-width: 450px) {
  .abele-chat-msg__time {
    display: none;
  }
}

// ── Draft ──

.abele-chat-msg--draft {
  &.abele-chat-msg_user .abele-chat-msg__body {
    border: 1px dashed var(--interactive-accent);
    background-color: var(--background-primary-alt);
  }
}

.abele-chat-msg__draft-actions {
  display: flex;
  gap: var(--size-4-1);
  flex-basis: 100%;
  padding-left: calc(var(--icon-size) + var(--size-4-2));
}

.abele-chat-msg__draft-btn {
  font-size: var(--font-ui-smaller);
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-s);
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  &--send {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);

    &:hover {
      background: var(--interactive-accent-hover);
    }
  }
}

// ── Interceptor sub-chat ──

.abele-chat-msg__interceptor {
  flex-basis: 100%;
  margin-left: calc(var(--icon-size) + var(--size-4-2) + var(--size-4-3));
  border-left: 2px solid var(--background-modifier-border);
  padding-left: var(--size-4-2);
}

.abele-chat-msg__interceptor-collapsed {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  font-size: var(--font-smaller);
  color: var(--text-faint);
  cursor: pointer;

  &:hover {
    color: var(--text-muted);
  }
}

.abele-chat-msg__interceptor-header {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  font-size: var(--font-smaller);
  color: var(--text-faint);
  cursor: pointer;
  margin-bottom: var(--size-4-1);

  &:hover {
    color: var(--text-muted);
  }
}

.abele-chat-msg__interceptor-messages {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-chat-msg__interceptor-msg {
  font-size: var(--font-ui-small);
  line-height: 1.5;

  p:first-child {
    margin-top: 0;
  }
  p:last-child {
    margin-bottom: 0;
  }

  &--user {
    color: var(--text-muted);
    font-style: italic;
  }

  &--assistant {
    color: var(--text-normal);
  }
}

.abele-chat-msg__interceptor-typing {
  display: inline-flex;
  gap: 4px;
}

.abele-chat-msg__interceptor-error {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
  font-size: var(--font-ui-small);
  color: var(--text-error);
}

.abele-chat-msg__interceptor-input {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin-top: var(--size-4-1);
}

.abele-chat-msg__interceptor-textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-2-1) var(--size-4-1);
  font-family: inherit;
  font-size: var(--font-ui-small);
  line-height: 1.5;
  background-color: var(--background-primary);
  color: var(--text-normal);
  height: 28px;
  min-height: 28px;
  max-height: 60px;
  overflow-y: hidden;

  &:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
}
</style>
