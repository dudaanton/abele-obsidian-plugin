<template>
  <!-- A passage's comments as a card by the passage, as a document's comments stand by their
       words; on a phone, or with no place to stand by, Obsidian's sheet. -->
  <component
    :is="anchor ? AnchoredCard : ObsidianModal"
    v-bind="
      anchor
        ? { anchor, label: 'Comments on this passage' }
        : { title: 'Comments', phoneSheet: true }
    "
    :can-close="canClose"
    @close="emit('close')"
  >
    <div class="abele-text-comments" :class="{ 'abele-text-comments_card': anchor }">
      <!-- One line: how the passage is marked, then the thread's other actions. -->
      <div class="abele-text-comments__bar">
        <button
          type="button"
          class="clickable-icon abele-text-comments__mark"
          :aria-label="`Marked ${markName(appearance)}: change how the passage is marked`"
          :aria-expanded="choosing"
          :disabled="busy"
          @click="choosing = !choosing"
        >
          <span class="abele-text-comments__dot" :class="dotClass(appearance)" />
        </button>
        <span class="abele-text-comments__count">{{ countText }}</span>
        <Icon
          v-if="saved"
          icon="more-horizontal"
          tooltip="More: copy the passage, delete the thread"
          :disabled="busy"
          @click="more"
        />
      </div>
      <div
        v-if="choosing"
        class="abele-text-comments__marks"
        role="radiogroup"
        aria-label="How the passage is marked"
      >
        <button
          v-for="choice in COMMENT_APPEARANCES"
          :key="choice"
          type="button"
          role="radio"
          class="clickable-icon abele-text-comments__mark"
          :aria-checked="appearance === choice"
          :aria-label="markName(choice)"
          :disabled="busy"
          @click="mark(choice)"
        >
          <span class="abele-text-comments__dot" :class="dotClass(choice)" />
        </button>
      </div>
      <!-- The passage itself only where it cannot be seen: on a phone's sheet, or when the note
           no longer holds it. -->
      <Quote v-if="!anchor || unresolved" :text="quote" class="abele-text-comments__quote" />
      <div v-if="unresolved" class="abele-text-comments__status" role="status">
        <span>{{
          orphan
            ? 'The mark is gone from the note; the thread is kept'
            : 'The passage changed; the thread is kept'
        }}</span>
        <Button
          v-if="orphan"
          text="Put the mark back"
          tooltip="Mark the passage in the note again, so the thread opens from it"
          :disabled="busy"
          @click="republish"
        />
      </div>
      <div v-if="saved" ref="list" class="abele-text-comments__list">
        <article
          v-for="entry in saved.thread.entries"
          :key="entry.id"
          class="abele-text-comments__entry"
          :class="{ 'is-editing': editing === entry.id }"
          :data-entry-id="entry.id"
        >
          <!-- Changing a comment happens where it stands. -->
          <template v-if="editing === entry.id">
            <NoteEditorField
              ref="editEditor"
              v-model="editBody"
              escape-closes
              @escape="cancelEdit"
              @submit="saveEdit"
            />
            <div class="abele-text-comments__edit-actions">
              <Button
                text="Cancel"
                tooltip="Keep the comment as it was"
                :disabled="busy"
                @click="cancelEdit"
              />
              <Button
                text="Save"
                accent
                tooltip="Save the changed comment (⌘↵)"
                :loading="busy"
                :disabled="busy || !editBody.trim()"
                @click="saveEdit"
              />
            </div>
          </template>
          <template v-else>
            <Markdown :text="entry.body" :file-path="saved.thread.anchor.note" />
            <div class="abele-text-comments__meta">
              <span class="abele-text-comments__time"
                >{{ shortTime(entry.createdAt)
                }}<template v-if="entry.editedAt"> · edited</template></span
              >
              <Icon
                icon="pencil"
                tooltip="Edit this comment"
                :disabled="busy"
                @click="edit(entry.id)"
              />
              <Icon
                icon="trash-2"
                tooltip="Delete this comment"
                :disabled="busy"
                @click="remove(entry.id)"
              />
            </div>
          </template>
        </article>
      </div>
      <p v-if="error" class="abele-text-comments__error" role="alert">{{ error }}</p>
      <!-- Text typed while the comment it continues was saving goes into that comment. -->
      <div v-if="replaces" class="abele-text-comments__replaces">
        <span>Goes into your last comment</span>
        <Icon icon="x" tooltip="Make it a new comment instead" @click="replaces = null" />
      </div>
      <div class="abele-text-comments__reply">
        <NoteEditorField
          ref="editor"
          v-model="body"
          :placeholder="saved ? 'Reply…' : 'Write a comment…'"
          escape-closes
          @escape="close"
          @submit="send"
        />
        <Icon
          icon="arrow-up"
          class="abele-text-comments__send"
          :class="{ 'is-ready': sendable }"
          tooltip="Send (⌘↵)"
          :disabled="busy || !sendable"
          @click="send"
        />
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Menu } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import AnchoredCard, { type CardAnchor } from './obsidian/AnchoredCard.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import Quote from './obsidian/Quote.vue'
import NoteEditorField from './NoteEditorField.vue'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { COMMENT_APPEARANCES, type CommentAppearance } from '@/comments/model'
import type {
  CommentDraft,
  CommentSelection,
  TextCommentService,
  ThreadSnapshot,
} from '@/comments/service'

const confirm = (options: Parameters<typeof confirmAction>[1]) =>
  confirmAction(GlobalStore.getInstance().app, options)

const props = defineProps<{
  service: TextCommentService
  initial?: ThreadSnapshot
  selection?: CommentSelection
  unresolved?: boolean
  orphan?: boolean
  /** Where the passage is on the screen; without it the comments open as a sheet. */
  anchor?: CardAnchor
  /** Flush the originating view before marker publication/removal, never a stale editor buffer. */
  beforeWrite?: () => Promise<void>
  changed?: (saved: ThreadSnapshot | null) => void
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const saved = shallowRef(props.initial)
const orphan = ref(props.orphan ?? false)
const unresolved = ref(props.unresolved ?? false)
const appearance = ref<CommentAppearance>(props.initial?.thread.appearance ?? 'yellow')
const choosing = ref(false)
const body = ref('')
/** The entry the reply field's text goes into instead of a new one. */
const replaces = ref<string | null>(null)
const editing = ref<string | null>(null)
const editBody = ref('')
const editor = ref<{ focus(): void; $el: HTMLElement } | null>(null)
const editEditor = ref<{ focus(): void; $el: HTMLElement }[] | null>(null)
const busy = ref(false)
const error = ref('')
let draft: CommentDraft | undefined

const quote = computed(
  () =>
    saved.value?.thread.anchor.quote ??
    props.selection?.source.slice(props.selection.from, props.selection.to) ??
    ''
)
const sendable = computed(() => !!body.value.trim())
const countText = computed(() => {
  const n = saved.value?.thread.entries.length ?? 0
  return n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'New comment'
})

const markName = (choice: CommentAppearance) =>
  choice === 'underline' ? 'underlined' : choice === 'gray' ? 'grey' : choice
const dotClass = (choice: CommentAppearance) =>
  choice === 'underline' ? 'abele-text-comments__dot_underline' : `abele-highlight--${choice}`

/** A comment's time, short: the day and the minute, the year only when it is not this one. */
const shortTime = (value: string) => {
  const date = new Date(value)
  const thisYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Unsent words outlive the card: they wait in the field for its next opening. */
const draftKey = computed(() =>
  saved.value
    ? saved.value.thread.id
    : props.selection
      ? `${props.selection.note}:${props.selection.from}:${props.selection.to}`
      : ''
)
body.value = drafts.get(draftKey.value) ?? ''
watch(body, (text) => {
  if (!draftKey.value) return
  if (text.trim()) drafts.set(draftKey.value, text)
  else drafts.delete(draftKey.value)
})

const list = ref<HTMLElement | null>(null)
/** A thread reads to its latest comment, as a chat does: it opens there and follows replies,
 * also as comments finish drawing, until the reader scrolls up. */
let pinned = true
const pin = () => {
  if (pinned && list.value) list.value.scrollTop = list.value.scrollHeight
}
const toLatest = async () => {
  pinned = true
  await nextTick()
  pin()
}
const growth = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(pin)
watch(
  list,
  (el, old) => {
    if (old) growth?.unobserve(old.firstElementChild ?? old)
    if (!el) return
    el.addEventListener('scroll', () => {
      pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 4
    })
    for (const child of el.children) growth?.observe(child)
  },
  { flush: 'post' }
)
onMounted(() => {
  editor.value?.focus()
  void toLatest()
})
onBeforeUnmount(() => growth?.disconnect())

async function canClose(): Promise<boolean> {
  return !busy.value
}
async function close() {
  if (await canClose()) emit('close')
}

function more(event: MouseEvent) {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Copy the passage')
      .setIcon('copy')
      .onClick(() => void navigator.clipboard?.writeText(quote.value))
  )
  menu.addItem((item) =>
    item
      .setTitle('Delete the thread')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => void removeThread())
  )
  const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  if (box) menu.showAtPosition({ x: box.left, y: box.bottom })
  else menu.showAtMouseEvent(event)
}

async function mark(choice: CommentAppearance) {
  choosing.value = false
  if (choice === appearance.value) return
  const before = appearance.value
  appearance.value = choice
  // A new thread takes the mark with its first comment; a saved one changes at once.
  if (!saved.value) return
  await run(
    async () => {
      saved.value = await props.service.appearance(saved.value!, choice)
      props.changed?.(saved.value)
    },
    () => (appearance.value = before)
  )
}

async function run(work: () => Promise<void>, undo?: () => void) {
  busy.value = true
  error.value = ''
  try {
    await props.beforeWrite?.()
    await work()
  } catch (cause) {
    undo?.()
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function send() {
  if (busy.value || !sendable.value) return
  const submitted = body.value
  const into = replaces.value
  await run(async () => {
    if (!saved.value) {
      const selection = props.selection
      if (!selection) throw new Error('The selected passage is unavailable')
      draft ??= await props.service.draft(
        selection.note,
        selection.source,
        selection.from,
        selection.to,
        appearance.value,
        submitted
      )
      // A publication retry keeps identity and creation time, even when the draft was edited.
      draft.thread = {
        ...draft.thread,
        appearance: appearance.value,
        entries: [{ ...draft.thread.entries[0], body: submitted }],
      }
      if (draft.saved)
        draft.saved = await props.service.repository.write(draft.thread, draft.saved.revision)
      const previousKey = draftKey.value
      saved.value = await props.service.publish(draft)
      drafts.delete(previousKey)
      draft = undefined
    } else if (into) {
      saved.value = await props.service.edit(saved.value, into, submitted, appearance.value)
    } else {
      saved.value = await props.service.add(saved.value, submitted, appearance.value)
    }
    void toLatest()
    if (body.value === submitted) {
      body.value = ''
      replaces.value = null
    } else {
      // The field stays usable while saving. Words typed meanwhile continue the comment just
      // saved, so sending them again must change it rather than repeat it.
      replaces.value = into ?? saved.value.thread.entries.at(-1)!.id
    }
    props.changed?.(saved.value)
  })
}

async function edit(id: string) {
  const entry = saved.value?.thread.entries.find((entry) => entry.id === id)
  if (!entry) return
  editing.value = id
  editBody.value = entry.body
  // The comment being changed is where the reader looks now: the thread stops following its
  // latest comment, or the field growing as it draws would scroll the list away from it.
  pinned = false
  // A phone raises its keyboard only for a focus taken while the tap is handled. The field for
  // the change is drawn in this tap's own microtasks, so it takes the focus itself; focus passed
  // on from the reply field raised the keyboard and then lost it with the first keys.
  await nextTick()
  const field = editEditor.value?.[0]
  field?.focus()
  field?.$el?.scrollIntoView?.({ block: 'nearest' })
}
function cancelEdit() {
  editing.value = null
  editBody.value = ''
}
async function saveEdit() {
  const id = editing.value
  if (busy.value || !id || !saved.value || !editBody.value.trim()) return
  const submitted = editBody.value
  await run(async () => {
    saved.value = await props.service.edit(saved.value!, id, submitted, appearance.value)
    if (editing.value === id && editBody.value === submitted) cancelEdit()
    props.changed?.(saved.value)
  })
}

async function republish() {
  if (busy.value || !saved.value) return
  await run(async () => {
    await props.service.republish(saved.value!, props.selection)
    orphan.value = false
    unresolved.value = false
    props.changed?.(saved.value!)
  })
}

async function remove(id: string) {
  if (busy.value || !saved.value) return
  const last = saved.value.thread.entries.length === 1
  if (
    !(await confirm({
      title: 'Delete comment?',
      message: last
        ? 'This is the last comment. Its mark in the note goes too; the note text stays.'
        : 'Only this comment goes. The others stay.',
      confirmText: 'Delete',
    }))
  )
    return
  await run(async () => {
    const next = await props.service.deleteEntry(saved.value!, id)
    afterDelete(next, [id])
  })
}

async function removeThread() {
  if (busy.value || !saved.value) return
  if (
    !(await confirm({
      title: 'Delete the thread?',
      message: 'All its comments and its mark in the note go; the note text stays.',
      confirmText: 'Delete',
    }))
  )
    return
  await run(async () => {
    let next: ThreadSnapshot | null = saved.value!
    const ids = next.thread.entries.map((entry) => entry.id)
    for (const id of ids) if (next) next = await props.service.deleteEntry(next, id)
    afterDelete(next, ids)
  })
}

function afterDelete(next: ThreadSnapshot | null, ids: string[]) {
  const id = saved.value?.thread.id
  saved.value = next ?? undefined
  props.changed?.(next)
  if (editing.value && ids.includes(editing.value)) cancelEdit()
  if (replaces.value && ids.includes(replaces.value)) replaces.value = null
  if (next) return
  if (id) drafts.delete(id)
  orphan.value = false
  unresolved.value = false
  if (body.value.trim())
    error.value =
      'The thread was deleted. Your new text is still here; send it to start a new thread on this passage.'
  else emit('close')
}
</script>

<script lang="ts">
const drafts = new Map<string, string>()
</script>

<style lang="scss">
.abele-text-comments {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
  min-height: 0;
  overflow-wrap: anywhere;

  &__bar,
  &__meta,
  &__replaces,
  &__status,
  &__edit-actions {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    min-width: 0;
  }

  &__count {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  // How the passage is marked: the mark itself, small and round, as the note shows it.
  &__dot {
    display: block;
    width: var(--icon-s);
    height: var(--icon-s);
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--background-modifier-border);

    &_underline {
      border-radius: 0;
      box-shadow: none;
      border-bottom: 2px solid var(--text-muted);
    }
  }

  &__marks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-1);

    [aria-checked='true'] {
      background: var(--background-modifier-hover);
    }
  }

  &__status {
    justify-content: space-between;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  // The thread scrolls inside the card; the reply field stays in sight under it.
  &__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    // Keep the rows on the text edge, with room inside the scroll clip for their focus paint.
    padding-inline: var(--size-4-1);
    margin-inline: calc(-1 * var(--size-4-1));
  }

  &__entry {
    padding-block: var(--size-4-2);

    & + & {
      border-top: 1px solid var(--background-modifier-border);
    }

    // The comment's own words sit tight on its time below, as a reply does in a thread.
    :where(p, ul, ol, blockquote, pre):first-child {
      margin-top: 0;
    }

    :where(p, ul, ol, blockquote, pre):last-child {
      margin-bottom: 0;
    }
  }

  // When it was written, quiet; its glyphs come up under the pointer or the keyboard.
  &__meta {
    margin-top: var(--size-2-2);
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);

    .clickable-icon {
      opacity: 0;
    }
  }

  &__entry:hover &__meta .clickable-icon,
  &__meta:focus-within .clickable-icon {
    opacity: 1;
  }

  // A phone has neither pointer nor keyboard to bring them up: there they always stand.
  .is-mobile &__meta .clickable-icon {
    opacity: 1;
  }

  &__time {
    flex: 1 1 auto;
    min-width: 0;
  }

  &__edit-actions {
    justify-content: flex-end;
    margin-top: var(--size-4-2);
  }

  &__replaces {
    justify-content: space-between;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  // The reply: Obsidian's note editor in a field's frame, the send glyph at its end.
  &__reply {
    display: flex;
    align-items: flex-end;
    gap: var(--size-2-2);
    padding: var(--size-2-2) var(--size-2-2) var(--size-2-2) var(--size-4-2);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--input-radius);
    background: var(--background-modifier-form-field);

    &:focus-within {
      border-color: var(--background-modifier-border-focus);
    }

    .abele-note-editor-field {
      flex: 1 1 auto;
      min-width: 0;
      max-height: 10em;
      overflow-y: auto;
    }

    // The frame is the reply's: the note editor inside it drops its own border, ring and
    // ground, and grows with what is written from one line, so there is one outline, not two.
    .abele-note-editor-field__editor {
      min-height: 0;
      border: none;
      border-radius: 0;
      background: transparent;

      &:focus-within {
        box-shadow: none;
      }

      .markdown-source-view.mod-cm6 .cm-scroller {
        padding: 0;
      }

      .markdown-source-view.mod-cm6 .cm-content {
        min-height: 1lh;
      }
    }

    // A plain text box standing in for the editor does the same.
    .abele-note-editor-field textarea {
      field-sizing: content;
      width: 100%;
      min-height: 1lh;
      max-height: 8lh;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      resize: none;

      &:focus,
      &:focus-visible {
        box-shadow: none;
      }
    }
  }

  &__send.is-ready {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }

  &__error {
    margin: 0;
    color: var(--text-error);
    font-size: var(--font-ui-small);
  }
}

// In the card the thread is the card's own height, not a page.
.abele-text-comments_card {
  flex: 1 1 auto;
}

// In the dialog too the thread is no taller than the dialog lets it be: the body is a column the
// comments shrink into, so the list scrolls and the reply field stays in sight under it, where a
// long thread pushed it below the dialog's edge.
.abele-modal__body:has(> .abele-text-comments) {
  display: flex;
  flex-direction: column;
}

.abele-modal__body > .abele-text-comments {
  flex: 0 1 auto;
}
</style>
