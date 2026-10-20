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
    @keydown.capture="onSlashKey"
  >
    <!-- «/» at the start of a message: the chat's commands, skills and prompts. -->
    <ChatSlashSuggest
      v-if="slashQuery !== null && !slashDismissed"
      ref="slash"
      :query="slashQuery"
      :text-only="textOnly"
      :extra="slashExtra"
      @choose="onSlash"
    />
    <!-- One frame, as Obsidian's own field: what goes with the message on top, the words, and
         the row of glyphs at its foot, so the field and its buttons read as one thing. -->
    <div class="abele-chat-input__box">
      <!-- A plain text box cannot draw a reply's chip: its places stand in the text as «[↩1]»,
           and here is what each number is. -->
      <div v-if="fallback && marked.size" class="abele-chat-input__replies">
        <span v-for="[n, to] in marked" :key="n" class="abele-chat-input__reply">
          <span class="abele-chat-input__reply-number">{{ replyMarker(n) }}</span>
          <ChatReplyCard :to="to" removable @open="emit('show-reply', to)" @remove="unmark(n)" />
        </span>
      </div>
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
            :tooltip="t('streamB.remove.9fc927', { v0: String(attachmentName(a.path)) })"
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
      />
      <textarea
        v-else
        ref="inputEl"
        :value="text"
        class="abele-chat-input__field abele-chat-input__textarea"
        :placeholder="t('streamB.message.fc7150')"
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

      <!-- `data-keeps-focus` on the buttons that act on what is typed: on a phone the field
           keeps its focus through the tap, so the keyboard stays up and the composer does not
           move out from under the finger before the click lands (see fieldFocus.ts). -->
      <div class="abele-chat-input__toolbar" @mousedown.prevent>
        <!-- What goes along with the message: files, and what the agent may reach. -->
        <div class="abele-chat-input__toolbar-left">
          <slot name="attach" />
          <Icon
            v-if="!textOnly && !isBusy && !importing"
            icon="paperclip"
            :tooltip="t('streamB.attachAFile.21298c')"
            @click="showAttachMenu"
          />
          <!-- What the agent may reach, as a glyph with a count: the whole vault, or so many
               places of its own; the full list is in the tooltip and in the access settings. -->
          <Icon
            v-if="scopeLabel"
            :icon="scopeIcon ?? 'vault'"
            :text-right="scopeCode || undefined"
            :tooltip="scopeLabel"
            class="abele-chat-input__scope"
            @click="emit('openScope')"
          />
          <!-- How a node session runs: its mode, model and context, from the chat. -->
          <slot name="settings" />
        </div>
        <!-- How it is sent: the room, the voice, and sending last. -->
        <div class="abele-chat-input__toolbar-right">
          <span v-if="tokenDisplay" class="abele-chat-input__tokens">{{ tokenDisplay }}</span>
          <!-- Opens the field out over the whole chat for writing at length, and back. It
               keeps the field's focus like Send does, so a phone's keyboard stays up. -->
          <Icon
            :icon="expanded ? 'minimize-2' : 'maximize-2'"
            class="abele-chat-input__expand"
            :tooltip="expandLabel"
            :aria-label="expandLabel"
            data-keeps-focus
            @click="toggleExpanded"
          />
          <Icon
            v-if="!isBusy && !importing"
            icon="mic"
            :tooltip="
              voiceOpen ? t('streamB.closeVoiceInput.e88eea') : t('streamB.dictateAMessage.1393f9')
            "
            :class="{ 'abele-chat-input__mic_open': voiceOpen }"
            @click="voiceOpen = !voiceOpen"
          />
          <template v-if="isStreaming">
            <Icon
              v-if="text.trim() || attachments.length"
              icon="send-horizontal"
              :tooltip="t('streamB.sendWhenTheAgentGetsThere.99298e')"
              class="abele-chat-input__send"
              data-keeps-focus
              @click="send"
            />
            <Icon
              icon="square"
              :tooltip="stopTip"
              class="abele-chat-input__stop"
              @click="emit('abort')"
            />
          </template>
          <Icon
            v-else-if="isBusy || importing"
            icon="loader"
            no-hover
            :tooltip="
              importing ? t('streamB.copyingTheFilesIntoTheVault.69a783') : t('streamB.busy.2b9cf7')
            "
            class="abele-chat-input__spinner"
          />
          <template v-else>
            <!-- Only over a comment, which is a place in a note as much as it is a chat: the
                 words are kept and nothing is asked of anybody. -->
            <Icon
              v-if="canNote"
              icon="sticky-note"
              :disabled="noteDisabled"
              :tooltip="noteTooltip"
              data-keeps-focus
              @click="keepNote"
            />
            <Icon
              v-if="canContinue && !text.trim() && !attachments.length"
              icon="play"
              :tooltip="t('streamB.continueWhereTheAgentStopped.ea04e7')"
              class="abele-chat-input__continue"
              @click="emit('continue')"
            />
            <Icon
              v-else
              icon="send-horizontal"
              :class="[
                'abele-chat-input__send',
                { 'abele-chat-input__disabled': !text.trim() && !attachments.length },
              ]"
              :tooltip="sendLabel ?? t('streamB.send.f6f468')"
              data-keeps-focus
              @click="send"
            />
          </template>
        </div>
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
import { t } from '@/i18n'
import { ref, computed, inject, nextTick, watch } from 'vue'
import { TFile, type Scope } from 'obsidian'
import { CHAT_KEY_SCOPE } from '@/ai/chatKeyScope'
import { stopTooltip } from '@/ai/chatTabKeyMap'
import Icon from './obsidian/Icon.vue'
import ChatSlashSuggest, { type SlashItem } from './ChatSlashSuggest.vue'
import VoiceRecorder from './VoiceRecorder.vue'
import ChatPicture from './ChatPicture.vue'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { useChatInputAttachments } from '@/composables/useChatInputAttachments'
import { useChatInputEditor } from '@/composables/useChatInputEditor'
import { getAttachmentIcon, fileName as attachmentName, ALLOWED_ACCEPT } from '@/ai/attachments'
import type { ChatDraft, ChatReplyTo } from '@/ai/types'
import {
  replyMarker,
  replyToken,
  replyTokens,
  samePlace,
  splitComposerText,
  splitMarkedText,
} from '@/ai/replyLinks'
import ChatReplyCard from './chat/ChatReplyCard.vue'
import { replyChips } from '@/editor/replyChips'
import { sameConversation, type ConversationOwner } from '@/ai/draftImports'

const props = defineProps<{
  isStreaming: boolean
  isBusy: boolean
  /** Node sessions accept text only and do not resolve vault skills or attachments. */
  textOnly?: boolean
  /** A node session's own commands and skills, offered after «/» instead of the chat's. */
  slashExtra?: SlashItem[]
  /** Captured conversation lifetime, not merely the tab that displays it. */
  attachmentOwner?: ConversationOwner
  /** A session-owned object: neither mounting nor replacing an editor changes its lifetime. */
  conversationDraft?: ChatDraft
  /** Admission-aware owners clear their draft only after a turn is durably admitted. */
  sendClearing?: 'composer' | 'owner'
  sendLabel?: string
  ownsConversation?: (owner?: ConversationOwner) => boolean
  isCurrentConversation?: (owner?: ConversationOwner) => boolean
  /** An adapter that outlives composer remounts; async completions cannot emit from a dead editor. */
  attachmentReady?: (path: string, owner?: ConversationOwner) => void
  canContinue: boolean
  tokenDisplay: string
  /** What the agent may reach, said in full: the access button's tooltip; empty hides it. */
  scopeLabel: string
  /** The access button's glyph: `vault` for all of it, `folder-lock` for places of its own. */
  scopeIcon?: string
  /** How many places of its own the agent may reach, beside the glyph. */
  scopeCode?: string
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
  /** With `replyTo` when the words reply to places of the agent's, each where it stands. */
  (e: 'send', message: string, attachments: string[], replyTo?: ChatReplyTo[]): void
  /** A reply's chip was pressed: the chat goes to the words it replies to. */
  (e: 'show-reply', to: ChatReplyTo): void
  /** Keep these words in the conversation, and start nothing. */
  (e: 'note', text: string, replyTo?: ChatReplyTo[]): void
  (e: 'command', command: string): void
  /** A prompt was picked from the «/» list: the chat fills its variables and applies it. */
  (e: 'prompt', file: TFile): void
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
const text = computed({
  get: () => draft.value.text,
  set: (value) => {
    draft.value.text = value
  },
})
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = computed({
  get: () => draft.value.attachments,
  set: (files: TFile[]) => {
    draft.value.attachments = files
  },
})

/**
 * Open out over the whole chat, for a message that takes more than a few lines to write. The
 * field is the same element either way — only the room around it changes — so the draft, the
 * cursor, the undo history and the attachments are all simply still there.
 */
const expanded = defineModel<boolean>('expanded', { default: false })
const {
  inputEl,
  editorHost,
  fallback,
  write,
  autoResize,
  onInput,
  syncText,
  focus,
  placeLine,
  hasFocus,
  hasSelection,
  onKeydown,
  onEditorDrop,
} = useChatInputEditor({
  props,
  text,
  expanded,
  send: () => send(),
  keepNote: () => keepNote(),
  emitFocus: (focused) => emit('focus', focused),
  extensions: [replyChips((to) => emit('show-reply', to))],
  // Only inside a chat pane, whose tabs the keys work: a comment or a node's own view has none.
  parentScope: inject<Scope | undefined>(CHAT_KEY_SCOPE, undefined),
})
const stopTip = stopTooltip()
const expandLabel = computed(() =>
  expanded.value
    ? t('streamB.collapseTheMessageField.0637b4')
    : t('streamB.expandTheMessageField.0b9d03')
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
  if (props.isBusy || importing.value || !(props.isCurrentConversation?.(draftOwner) ?? true))
    return

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
  // The places replied to go beside the words, each where it stood; a message that replies to
  // nothing goes as it always did.
  const { text: words, replyTo } = splitPlaces(msg)
  if (replyTo.length) emit('send', words, paths, replyTo)
  else emit('send', words, paths)
  if (props.sendClearing === 'owner') return
  write('')
  attachments.value = []
  // What was written is sent; what comes next is the answer, and it needs the room.
  setExpanded(false)
  nextTick(autoResize)
}

/** The word after «/» while the message is only that word; null otherwise. */
const slashQuery = computed(() => /^\/(\S*)$/.exec(text.value)?.[1] ?? null)
/** Esc closed the list for this word; typing on opens it again. */
const slashDismissed = ref(false)
watch(slashQuery, () => {
  slashDismissed.value = false
})
const slash = ref<InstanceType<typeof ChatSlashSuggest> | null>(null)
const onSlashKey = (e: KeyboardEvent) => {
  if (slashQuery.value === null || slashDismissed.value || !slash.value?.open) return
  if (e.key === 'Escape') {
    slashDismissed.value = true
    e.preventDefault()
    e.stopPropagation()
    return
  }
  slash.value.key(e)
}
const onSlash = (item: SlashItem) => {
  if (item.kind === 'skill' || item.kind === 'agent') {
    // A skill or an agent's command can take words after it: it stays in the field until the
    // message is sent, and goes as that message.
    write(`/${item.name} `)
    void nextTick(() => focus())
    return
  }
  write('')
  if (item.kind === 'command') emit('command', `/${item.name}`)
  else if (item.file) emit('prompt', item.file)
}

const noteDisabled = computed(() => !!props.noteBlocked || text.value.trim().length === 0)

const noteTooltip = computed(() =>
  props.noteBlocked
    ? t('streamB.finishOrDismissThePendingStepBefore.928303')
    : t('streamB.saveAsNoteWithoutAskingTheAgent.a9a082')
)

/** Kept, not sent: the words go into the conversation and no agent is started. */
const keepNote = () => {
  if (noteDisabled.value) return

  const { text: words, replyTo } = splitPlaces(text.value.trim())
  if (replyTo.length) emit('note', words, replyTo)
  else emit('note', words)
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
  showAttachMenu,
  onFileSelected,
  onPaste,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  addAttachment,
  importFiles,
} = useChatInputAttachments({
  props,
  draft,
  owner: () => draftOwner,
  fileInputEl,
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
watch(
  () => [props.conversationDraft, props.attachmentOwner] as const,
  ([owned, owner]) => {
    if (!owned && !boundToSession) return
    if (owned) boundToSession = true
    draftOwner = owner
    draft.value = owned ?? { text: '', attachments: [] }
    write(draft.value.text)
    nextTick(autoResize)
  },
  { flush: 'post' }
)

// Text can arrive while no composer exists. When one is mounted, it mirrors the session,
// without echoing edits the embedded editor already made or moving their cursor.
watch(text, syncText)

const isDraftFor = (owner?: ConversationOwner) => sameConversation(draftOwner, owner)

/**
 * A place of the agent's words replied to: a card on a line of its own where the cursor is, the
 * person's own words before and after it. Several can be put in one message; the same place
 * twice is one.
 */
const quote = (to: ChatReplyTo) => {
  if (fallback.value) {
    const kept = [...marked.value].find(([, place]) => samePlace(place, to))
    if (kept && text.value.includes(replyMarker(kept[0]))) return focus()
    const n = kept?.[0] ?? Math.max(0, ...marked.value.keys()) + 1
    marked.value.set(n, to)
    return placeLine(replyMarker(n))
  }
  if (replyTokens(text.value).some((translationItem) => samePlace(translationItem.reply, to)))
    return focus()
  placeLine(replyToken(to))
}

/** In a plain text box, the places by the number their marker carries. */
const marked = ref(new Map<number, ChatReplyTo>())
const unmark = (n: number) => {
  marked.value.delete(n)
  write(text.value.split(replyMarker(n)).join(''))
}
// Sent or cleared: the numbers start again.
watch(text, (value) => {
  if (!value.trim()) marked.value.clear()
})
/** What is sent: the words, and the places where they stood in them. */
const splitPlaces = (value: string) =>
  fallback.value ? splitMarkedText(value, marked.value) : splitComposerText(value)

defineExpose({
  hasSelection,
  quote,
  setText,
  addAttachment,
  importFiles,
  focus,
  hasFocus,
  takeDraft,
  putDraft,
  isDraftFor,
})
</script>

<style lang="scss" src="./chat/input.scss"></style>
