<template>
  <div
    class="abele-chat-input"
    :class="{ 'abele-chat-input--dragover': isDragging }"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Pending attachments -->
    <div v-if="attachments.length" class="abele-chat-input__attachments">
      <div v-for="(a, i) in attachments" :key="a.path" class="abele-chat-input__attachment">
        <Icon :icon="getAttachmentIcon(a.path)" />
        <span class="abele-chat-input__attachment-name">{{ a.name }}</span>
        <Icon
          icon="x"
          class="abele-chat-input__attachment-remove"
          @click="attachments.splice(i, 1)"
        />
      </div>
    </div>

    <textarea
      ref="inputEl"
      :value="text"
      class="abele-chat-input__textarea"
      placeholder="Message..."
      rows="1"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @focus="emit('focus', true)"
      @blur="emit('focus', false)"
    />

    <VoiceRecorder
      v-if="voiceOpen"
      can-send
      auto-start
      :can-note="canNote && !noteBlocked"
      class="abele-chat-input__voice"
      @text="onVoiceText"
      @send="onVoiceSend"
      @note="onVoiceNote"
      @close="voiceOpen = false"
    />

    <div class="abele-chat-input__toolbar">
      <div class="abele-chat-input__toolbar-left">
        <span v-if="tokenDisplay" class="abele-chat-input__tokens">{{ tokenDisplay }}</span>
      </div>
      <div class="abele-chat-input__toolbar-right" @mousedown.prevent>
        <template v-if="isStreaming">
          <Icon
            v-if="text.trim() || attachments.length"
            icon="send-horizontal"
            with-bg
            tooltip="Send when the agent gets there"
            @click="send"
          />
          <Icon
            icon="square"
            with-bg
            tooltip="Stop"
            class="abele-chat-input__stop"
            @click="emit('abort')"
          />
        </template>
        <Icon v-else-if="isBusy" icon="loader" no-hover class="abele-chat-input__spinner" />
        <template v-else>
          <div v-if="scopeLabel" class="abele-chat-input__scope-badge" @click="emit('openScope')">
            {{ scopeLabel }}
          </div>
          <Icon icon="paperclip" with-bg @click="showAttachMenu" />
          <Icon
            icon="mic"
            with-bg
            :tooltip="voiceOpen ? 'Close voice input' : 'Dictate a message'"
            :class="{ 'abele-chat-input__mic_open': voiceOpen }"
            @click="voiceOpen = !voiceOpen"
          />
          <!-- Only over a comment, which is a place in a note as much as it is a chat: the
               words are kept and nothing is asked of anybody. -->
          <Icon
            v-if="canNote"
            icon="sticky-note"
            with-bg
            :disabled="noteDisabled"
            :tooltip="noteTooltip"
            @click="keepNote"
          />
          <Icon
            v-if="canContinue && !text.trim() && !attachments.length"
            icon="play"
            with-bg
            class="abele-chat-input__continue"
            @click="emit('continue')"
          />
          <Icon
            v-else
            icon="send-horizontal"
            with-bg
            :class="{ 'abele-chat-input__disabled': !text.trim() && !attachments.length }"
            @click="send"
          />
        </template>
      </div>
    </div>

    <!-- Hidden file input for system picker -->
    <input
      ref="fileInputEl"
      type="file"
      multiple
      :accept="ALLOWED_ACCEPT"
      style="display: none"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { Menu, TFile, Notice } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import VoiceRecorder from './VoiceRecorder.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { pickVaultFile } from '@/helpers/suggesters/VaultFilePicker'
import { importExternalFile, getAttachmentIcon, ALLOWED_ACCEPT } from '@/ai/attachments'
import type { ChatDraft } from '@/ai/types'

const props = defineProps<{
  isStreaming: boolean
  isBusy: boolean
  canContinue: boolean
  tokenDisplay: string
  scopeLabel: string
  /**
   * This conversation has a place in a note to keep words against — it is a comment.
   *
   * Half of what people write into one is not a question: a reminder, a second thought,
   * something to come back to. An ordinary chat has nowhere to put one, so the button and its
   * shortcut exist only here.
   */
  canNote?: boolean
  /**
   * The agent is holding a turn open — streaming, running a tool, waiting on an approval or on
   * an answer. A note put in now lands between a `tool_use` and its `tool_result`, and the next
   * question is refused by the model over it. `ChatSession.addUserNote` says no as well; this
   * is so the button says so first.
   */
  noteBlocked?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', message: string, attachments: string[]): void
  /** Keep these words in the conversation, and start nothing. */
  (e: 'note', text: string): void
  (e: 'command', command: string): void
  (e: 'abort'): void
  (e: 'continue'): void
  (e: 'focus', focused: boolean): void
  /** The scope badge: a way into the dialog that opens on what the badge is about. */
  (e: 'openScope'): void
  (e: 'attachFile', path: string): void
}>()

/** The slash commands the chat answers itself; anything else is looked up as a skill. */
const COMMANDS = ['/compact', '/new', '/load', '/scope', '/prompt']

const TEXTAREA_MIN_HEIGHT = 34
/**
 * Six lines or so before it starts scrolling. Three was what it used to be, which is not
 * enough to see a paragraph you are still writing. The stylesheet caps it at the same number.
 */
const TEXTAREA_MAX_HEIGHT = 140

const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = ref<TFile[]>([])

const autoResize = () => {
  const el = inputEl.value
  if (!el) return
  el.style.height = `${TEXTAREA_MIN_HEIGHT}px`
  const newHeight = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
  el.style.height = `${newHeight}px`
  el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

const onInput = (e: Event) => {
  text.value = (e.target as HTMLTextAreaElement).value
  nextTick(autoResize)
}

const send = () => {
  // Streaming is deliberately not a guard: the session queues that message and gives it to
  // the loop at its next iteration. An auxiliary task the user chose to run on its own still
  // holds the input, because that is what running it sequentially means.
  if (props.isBusy) return

  const msg = text.value.trim()
  if (!msg && !attachments.value.length) return

  if (msg.startsWith('/')) {
    const cmd = msg.split(' ')[0].toLowerCase()
    if (COMMANDS.includes(cmd)) {
      emit('command', cmd)
    } else {
      emit('command', msg)
    }
    text.value = ''
    nextTick(autoResize)
    return
  }

  const paths = attachments.value.map((f) => f.path)
  emit('send', msg, paths)
  text.value = ''
  attachments.value = []
  nextTick(autoResize)
}

const noteDisabled = computed(() => !!props.noteBlocked || text.value.trim().length === 0)

const noteTooltip = computed(() =>
  props.noteBlocked
    ? 'Finish or dismiss the pending step before keeping a note'
    : 'Save as note, without asking the agent (Alt+Enter)'
)

/** Kept, not sent: the words go into the conversation and no agent is started. */
const keepNote = () => {
  if (noteDisabled.value) return

  emit('note', text.value.trim())
  text.value = ''
  nextTick(autoResize)
}

/**
 * Voice sits under the field rather than replacing it: what was dictated is added to whatever
 * was already typed, and any attachments go along with it, because a recording is one more
 * thing said in the message rather than a message of its own.
 */
const voiceOpen = ref(false)

const withDictated = (dictated: string) => {
  const existing = text.value.trim()
  return existing ? `${existing} ${dictated}` : dictated
}

const onVoiceText = (dictated: string) => {
  text.value = withDictated(dictated)
  nextTick(() => {
    autoResize()
    inputEl.value?.focus()
  })
}

const onVoiceSend = (dictated: string) => {
  text.value = withDictated(dictated)
  nextTick(send)
}

const onVoiceNote = (dictated: string) => {
  text.value = withDictated(dictated)
  keepNote()
}

const showAttachMenu = (event: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item.setTitle('From vault').setIcon('vault').onClick(pickFromVault)
  })
  menu.addItem((item) => {
    item.setTitle('From disk').setIcon('hard-drive').onClick(pickFromDisk)
  })
  menu.showAtMouseEvent(event)
}

const pickFromVault = async () => {
  const { app } = GlobalStore.getInstance()
  const file = await pickVaultFile(app)
  if (file && !attachments.value.some((a) => a.path === file.path)) {
    attachments.value = [...attachments.value, file]
    emit('attachFile', file.path)
  }
}

const pickFromDisk = () => {
  fileInputEl.value?.click()
}

const onFileSelected = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const fileList = input.files ? Array.from(input.files) : []
  input.value = ''
  if (!fileList.length) return

  for (const file of fileList) {
    try {
      const vaultFile = await importExternalFile(file)
      if (!attachments.value.some((a) => a.path === vaultFile.path)) {
        attachments.value = [...attachments.value, vaultFile]
        emit('attachFile', vaultFile.path)
      }
    } catch (err: unknown) {
      new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

const onPaste = async (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  const files: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }

  if (!files.length) return
  e.preventDefault()

  for (const file of files) {
    try {
      const vaultFile = await importExternalFile(file)
      if (!attachments.value.some((a) => a.path === vaultFile.path)) {
        attachments.value = [...attachments.value, vaultFile]
        emit('attachFile', vaultFile.path)
      }
    } catch (err: unknown) {
      new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

// ── Drag & drop ──

const isDragging = ref(false)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

const onDragOver = () => {
  if (dragLeaveTimer) {
    window.clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  isDragging.value = true
}

const onDragLeave = () => {
  // Small delay to prevent flicker when moving between child elements
  dragLeaveTimer = window.setTimeout(() => {
    isDragging.value = false
  }, 50)
}

const onDrop = async (e: DragEvent) => {
  isDragging.value = false
  const dt = e.dataTransfer
  if (!dt) return

  console.debug('[Abele drop]', {
    types: [...dt.types],
    text: dt.getData('text/plain'),
    html: dt.getData('text/html'),
    files: dt.files?.length,
  })

  // 1. Obsidian internal drag — files from file explorer
  // Obsidian puts the path in text/plain and may also provide Files
  const textData = dt.getData('text/plain')?.trim()
  if (textData) {
    const { app } = GlobalStore.getInstance()
    // Could be a single path or a wikilink-style drag
    const path = textData.replace(/^\[\[|\]\]$/g, '')
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      if (!attachments.value.some((a) => a.path === file.path)) {
        attachments.value = [...attachments.value, file]
        emit('attachFile', file.path)
      }
      return
    }
  }

  // 2. External files from OS
  const fileList = dt.files ? Array.from(dt.files) : []
  for (const file of fileList) {
    try {
      const vaultFile = await importExternalFile(file)
      if (!attachments.value.some((a) => a.path === vaultFile.path)) {
        attachments.value = [...attachments.value, vaultFile]
        emit('attachFile', vaultFile.path)
      }
    } catch (err: unknown) {
      new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

const setText = (value: string) => {
  text.value = value
  nextTick(autoResize)
}

/** Hand the unsent input to whoever is keeping it while another tab is open. */
const takeDraft = (): ChatDraft => ({ text: text.value, attachments: attachments.value })

const putDraft = (draft: ChatDraft) => {
  text.value = draft.text
  attachments.value = draft.attachments
  nextTick(autoResize)
}

const addAttachment = (file: TFile) => {
  if (!attachments.value.some((a) => a.path === file.path)) {
    attachments.value = [...attachments.value, file]
    emit('attachFile', file.path)
  }
}

function focus() {
  inputEl.value?.focus()
}

defineExpose({ setText, addAttachment, focus, takeDraft, putDraft })

const onKeydown = (e: KeyboardEvent) => {
  // Alt+Enter is Enter without the model, and only where there is a note to keep.
  if (e.key === 'Enter' && e.altKey && props.canNote) {
    e.preventDefault()
    keepNote()
    return
  }
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    send()
  }
}

// Cmd/Ctrl+Enter: Obsidian intercepts this at document level,
// so we catch it on the capture phase before Obsidian does
const onCaptureKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === inputEl.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    send()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onCaptureKeydown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onCaptureKeydown, true)
})
</script>

<style lang="scss">
.abele-chat-input {
  border-top: 1px solid var(--background-modifier-border);
  padding: var(--size-4-2);
  flex-shrink: 0;
  transition: border-color 0.15s;

  &--dragover {
    border-color: var(--interactive-accent);
  }
}

.abele-chat-input__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin-bottom: var(--size-4-1);
}

.abele-chat-input__attachment {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-2-3);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  font-size: var(--font-smaller);
  color: var(--text-muted);
  max-width: 200px;

  .abele-obsidian-icon {
    flex-shrink: 0;
  }
}

.abele-chat-input__attachment-remove {
  margin-left: auto;
}

.abele-chat-input__attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-input__textarea {
  width: 100%;
  resize: none;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-2-3) var(--size-4-2);
  font-family: inherit;
  font-size: inherit;
  line-height: 1.5;
  background-color: var(--background-primary);
  color: var(--text-normal);
  height: 34px;
  min-height: 34px;
  // Keep in step with `TEXTAREA_MAX_HEIGHT`: the script sizes the field as it is typed into,
  // and this stops it going further if anything else ever sets a height.
  max-height: 140px;
  overflow-y: hidden;
  box-sizing: border-box;

  &:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
}

/**
 * A phone, where this is the field a comment is typed into.
 *
 * The composer inherits its size from the pane, which on a phone can put it under 16 px — and
 * below 16 px iOS answers a focus by zooming the whole view into the field, so the note behind
 * jumps and has to be pinched back. `--font-ui-medium` is exactly that floor. Nothing else is
 * touched: the height is set by the script as the field is typed into.
 */
body.is-mobile .abele-chat-input__textarea {
  font-size: var(--font-ui-medium);
}

.abele-chat-input__voice {
  margin: var(--size-4-2) 0;
}

.abele-chat-input__mic_open {
  color: var(--interactive-accent);
}

.abele-chat-input__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--size-4-1);
}

.abele-chat-input__toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}

.abele-chat-input__toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);

  > .abele-obsidian-icon {
    flex-shrink: 0;
    height: 2em;
    width: 2em;
  }
}

.abele-chat-input__tokens {
  font-size: var(--font-smaller);
  color: var(--text-faint);
  white-space: nowrap;
}

.abele-chat-input__scope-badge {
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

.abele-chat-input__continue {
  opacity: 0.5;

  &:hover {
    opacity: 1;
  }
}

.abele-chat-input__spinner {
  animation: abele-spin 1s linear infinite;
  color: var(--text-muted);
}

@keyframes abele-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.abele-chat-input__disabled {
  opacity: 0.3;
  pointer-events: none;
}
</style>
