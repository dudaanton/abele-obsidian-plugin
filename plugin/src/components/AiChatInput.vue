<template>
  <div
    class="abele-chat-input"
    :class="{
      'abele-chat-input--dragover': isDragging,
      'abele-chat-input--expanded': expanded,
    }"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent.stop="onDrop"
  >
    <!-- Pending attachments -->
    <div v-if="attachments.length" class="abele-chat-input__attachments">
      <div v-for="(a, i) in attachments" :key="a.path" class="abele-chat-input__attachment">
        <ChatPicture v-if="isImagePath(a.path)" :path="a.path" pending />
        <template v-else>
          <Icon :icon="getAttachmentIcon(a.path)" />
          <span class="abele-chat-input__attachment-name">{{ attachmentName(a.path) }}</span>
        </template>
        <Icon
          icon="x"
          class="abele-chat-input__attachment-remove"
          @click="attachments.splice(i, 1)"
        />
      </div>
    </div>

    <!-- Obsidian's own note editor: live preview, the `[[` suggester, the formatting hotkeys,
         and on a phone Obsidian's toolbar above the keyboard. A plain text box only where
         that editor cannot be borrowed (see embeddedEditor.ts). -->
    <div
      v-if="!fallback"
      ref="editorHost"
      class="abele-chat-input__field abele-chat-input__editor"
      @paste.capture="onPaste"
      @drop.capture="onEditorDrop"
      @mousedown="onEmptyPress"
    />
    <textarea
      v-else
      ref="inputEl"
      :value="text"
      class="abele-chat-input__field abele-chat-input__textarea"
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
        <!-- Opens the field out over the whole chat for writing at length, and back. It keeps
             the field's focus like Send does, so a phone's keyboard stays up through it. -->
        <Icon
          :icon="expanded ? 'minimize-2' : 'maximize-2'"
          with-bg
          class="abele-chat-input__expand"
          :tooltip="expandLabel"
          :aria-label="expandLabel"
          data-keeps-focus
          @mousedown.prevent
          @click="toggleExpanded"
        />
        <span v-if="tokenDisplay" class="abele-chat-input__tokens">{{ tokenDisplay }}</span>
      </div>
      <!-- `data-keeps-focus` on the buttons that act on what is typed: on a phone the field
           keeps its focus through the tap, so the keyboard stays up and the composer does not
           move out from under the finger before the click lands (see fieldFocus.ts). -->
      <div class="abele-chat-input__toolbar-right" @mousedown.prevent>
        <template v-if="!isBusy && !importing">
          <Icon v-if="!textOnly" icon="paperclip" with-bg tooltip="Attach a file" @click="showAttachMenu" />
          <Icon
            icon="mic"
            with-bg
            :tooltip="voiceOpen ? 'Close voice input' : 'Dictate a message'"
            :class="{ 'abele-chat-input__mic_open': voiceOpen }"
            @click="voiceOpen = !voiceOpen"
          />
        </template>
        <template v-if="isStreaming">
          <Icon
            v-if="text.trim() || attachments.length"
            icon="send-horizontal"
            with-bg
            tooltip="Send when the agent gets there"
            data-keeps-focus
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
        <Icon v-else-if="isBusy || importing" icon="loader" no-hover class="abele-chat-input__spinner" />
        <template v-else>
          <div v-if="scopeLabel" class="abele-chat-input__scope-badge" @click="emit('openScope')">
            {{ scopeLabel }}
          </div>
          <!-- Only over a comment, which is a place in a note as much as it is a chat: the
               words are kept and nothing is asked of anybody. -->
          <Icon
            v-if="canNote"
            icon="sticky-note"
            with-bg
            :disabled="noteDisabled"
            :tooltip="noteTooltip"
            data-keeps-focus
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
            data-keeps-focus
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
import { ref, computed, nextTick, watch } from 'vue'
import { TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import VoiceRecorder from './VoiceRecorder.vue'
import ChatPicture from './ChatPicture.vue'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { useChatInputAttachments } from '@/composables/useChatInputAttachments'
import { useChatInputEditor } from '@/composables/useChatInputEditor'
import {
  getAttachmentIcon,
  fileName as attachmentName,
  ALLOWED_ACCEPT,
} from '@/ai/attachments'
import type { ChatDraft } from '@/ai/types'
import { sameConversation, type ConversationOwner } from '@/ai/draftImports'

const props = defineProps<{
  isStreaming: boolean
  isBusy: boolean
  /** Node sessions accept text only and do not resolve vault skills or attachments. */
  textOnly?: boolean
  /** Captured conversation lifetime, not merely the tab that displays it. */
  attachmentOwner?: ConversationOwner
  /** A session-owned object: neither mounting nor replacing an editor changes its lifetime. */
  conversationDraft?: ChatDraft
  ownsConversation?: (owner?: ConversationOwner) => boolean
  isCurrentConversation?: (owner?: ConversationOwner) => boolean
  /** An adapter that outlives composer remounts; async completions cannot emit from a dead editor. */
  attachmentReady?: (path: string, owner?: ConversationOwner) => void
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
  (e: 'attachFile', path: string, owner?: ConversationOwner): void
}>()

/** The slash commands the chat answers itself; anything else is looked up as a skill. */
const COMMANDS = ['/compact', '/new', '/load', '/scope', '/prompt']

const draft = ref<ChatDraft>(props.conversationDraft ?? { text: '', attachments: [] })
let draftOwner = props.attachmentOwner
let boundToSession = !!props.conversationDraft
const importing = computed(() => !!draft.value.imports?.pending.size)
const text = computed({ get: () => draft.value.text, set: (value) => { draft.value.text = value } })
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = computed({
  get: () => draft.value.attachments,
  set: (files: TFile[]) => { draft.value.attachments = files },
})

/**
 * Open out over the whole chat, for a message that takes more than a few lines to write. The
 * field is the same element either way — only the room around it changes — so the draft, the
 * cursor, the undo history and the attachments are all simply still there.
 */
const expanded = defineModel<boolean>('expanded', { default: false })
const {
  inputEl, editorHost, fallback, write, autoResize, onInput, syncText, focus,
  hasFocus, onKeydown, onEmptyPress, onEditorDrop,
} = useChatInputEditor({
  props, text, expanded, send: () => send(), keepNote: () => keepNote(),
  emitFocus: (focused) => emit('focus', focused),
})
const expandLabel = computed(() =>
  expanded.value ? 'Collapse the message field' : 'Expand the message field'
)

const setExpanded = (value: boolean) => {
  expanded.value = value
}

// However it changed — its button, a send, the chat taking the room back — the text box is
// sized for the room it now has.
watch(expanded, () => void nextTick(autoResize))

const toggleExpanded = () => {
  setExpanded(!expanded.value)
  // Straight back to writing; the button is only a change of room.
  void nextTick(() => focus())
}

const send = () => {
  // Streaming is deliberately not a guard: the session queues that message and gives it to
  // the loop at its next iteration. An auxiliary task the user chose to run on its own still
  // holds the input, because that is what running it sequentially means.
  if (props.isBusy || importing.value || !(props.isCurrentConversation?.(draftOwner) ?? true)) return

  const msg = text.value.trim()
  if (!msg && !attachments.value.length) return

  if (!props.textOnly && msg.startsWith('/')) {
    const name = msg.split(/\s+/, 1)[0]
    const cmd = name.toLowerCase()
    // A leading slash also appears in paths and prose. Consume only an actual command/skill.
    if (COMMANDS.includes(cmd) || discoverSkills().some((skill) => skill.name === name.slice(1))) {
      emit('command', COMMANDS.includes(cmd) ? cmd : msg)
      write('')
      setExpanded(false)
      nextTick(autoResize)
      return
    }
  }

  const paths = attachments.value.map((f) => f.path)
  emit('send', msg, paths)
  write('')
  attachments.value = []
  // What was written is sent; what comes next is the answer, and it needs the room.
  setExpanded(false)
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
  write('')
  setExpanded(false)
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
  write(withDictated(dictated))
  nextTick(() => {
    autoResize()
    focus({ atEnd: true })
  })
}

const onVoiceSend = (dictated: string) => {
  write(withDictated(dictated))
  nextTick(send)
}

const onVoiceNote = (dictated: string) => {
  write(withDictated(dictated))
  keepNote()
}

const {
  showAttachMenu, onFileSelected, onPaste, isDragging, onDragOver, onDragLeave,
  onDrop, addAttachment, importFiles,
} = useChatInputAttachments({
  props, draft, owner: () => draftOwner, fileInputEl,
  emitAttachFile: (path, owner) => emit('attachFile', path, owner),
})

const setText = (value: string) => {
  write(value)
  nextTick(autoResize)
}

/** Hand the unsent input to whoever is keeping it while another tab is open. */
const takeDraft = (): ChatDraft => draft.value

const putDraft = (incoming: ChatDraft) => {
  if (props.conversationDraft) {
    // Edit the one session-owned draft in place. Its import context and pending barrier are
    // not editor state, and must not be lost when incoming text replaces the contents.
    draftOwner = props.attachmentOwner
    draft.value = props.conversationDraft
    draft.value.attachments = incoming.attachments
    write(incoming.text)
    nextTick(autoResize)
    return
  }
  const owner = props.attachmentOwner
  const previous = draft.value.imports
  const same = sameConversation(draftOwner, owner)
  if (!same && draftOwner?.sessionId === owner?.sessionId) previous?.retire()
  // A content edit (drawing returned, queued message restored) retains the lifetime and
  // redirects every completion to the replacement. Switching conversations never transfers it.
  if (same && previous) incoming.imports = previous
  if (incoming.imports && !sameConversation(incoming.imports.owner, owner)) {
    incoming.imports.retire()
    incoming.imports = undefined
  }
  incoming.imports?.redirect(incoming)
  draftOwner = owner
  draft.value = incoming
  write(incoming.text)
  nextTick(autoResize)
}

// Binding a different session is not retirement: its imports continue in its own draft.
watch(() => [props.conversationDraft, props.attachmentOwner] as const, ([owned, owner]) => {
  if (!owned && !boundToSession) return
  if (owned) boundToSession = true
  draftOwner = owner
  draft.value = owned ?? { text: '', attachments: [] }
  write(draft.value.text)
  nextTick(autoResize)
}, { flush: 'post' })

// Text can arrive while no composer exists. When one is mounted, it mirrors the session,
// without echoing edits the embedded editor already made or moving their cursor.
watch(text, syncText)

const isDraftFor = (owner?: ConversationOwner) => sameConversation(draftOwner, owner)

defineExpose({ setText, addAttachment, importFiles, focus, hasFocus, takeDraft, putDraft, isDraftFor })

</script>

<style lang="scss" src="./chat/input.scss"></style>
