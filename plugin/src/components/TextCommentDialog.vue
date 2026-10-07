<template>
  <ObsidianModal title="Text comments" size="tall" :can-close="canClose" @close="emit('close')">
    <div class="abele-text-comments">
      <blockquote>{{ quote }}</blockquote>
      <p v-if="unresolved" role="status">
        The quoted passage changed or is missing. This comment is still available here.
      </p>
      <label class="abele-text-comments__appearance">
        Appearance
        <select v-model="appearance" aria-label="Comment appearance" :disabled="busy">
          <option v-for="choice in COMMENT_APPEARANCES" :key="choice" :value="choice">
            {{ choice === 'underline' ? 'Underline' : choice[0].toUpperCase() + choice.slice(1) }}
          </option>
        </select>
      </label>
      <article
        v-for="entry in saved?.thread.entries ?? []"
        :key="entry.id"
        class="abele-text-comments__entry"
        :data-entry-id="entry.id"
      >
        <p class="abele-text-comments__time">
          Created {{ localTime(entry.createdAt)
          }}<template v-if="entry.editedAt"> · Edited {{ localTime(entry.editedAt) }}</template>
        </p>
        <Markdown :text="entry.body" :file-path="saved?.thread.anchor.note" />
        <div class="abele-text-comments__actions">
          <Button text="Edit" :disabled="busy" @click="edit(entry.id)" />
          <Button text="Delete" :disabled="busy" @click="remove(entry.id)" />
        </div>
      </article>
      <h3>{{ editing ? 'Edit comment' : saved ? 'Add another comment' : 'Add comment' }}</h3>
      <NoteEditorField ref="editor" v-model="body" placeholder="Write a comment…" @submit="save" />
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="error && saved">
        Your draft is kept here. Copy it before closing if you need to reopen an externally changed
        thread.
      </p>
    </div>
    <template #footer>
      <Button text="Save" :disabled="busy || !saveable" @click="save" />
      <Button v-if="editing" text="Cancel edit" :disabled="busy" @click="cancelEdit" />
      <Button text="Close" :disabled="busy" @click="close" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Markdown from './obsidian/Markdown.vue'
import NoteEditorField from './NoteEditorField.vue'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
const confirm = (options: Parameters<typeof confirmAction>[1]) =>
  confirmAction(GlobalStore.getInstance().app, options)
import { COMMENT_APPEARANCES, type CommentAppearance } from '@/comments/model'
import type {
  CommentDraft,
  CommentSelection,
  TextCommentService,
  ThreadSnapshot,
} from '@/comments/service'

const props = defineProps<{
  service: TextCommentService
  initial?: ThreadSnapshot
  selection?: CommentSelection
  unresolved?: boolean
  /** Flush the originating view before marker publication/removal, never a stale editor buffer. */
  beforeWrite?: () => Promise<void>
  changed?: (saved: ThreadSnapshot | null) => void
}>()
const emit = defineEmits<{ (e: 'close'): void }>()
const saved = shallowRef(props.initial)
const appearance = ref<CommentAppearance>(props.initial?.thread.appearance ?? 'yellow')
const body = ref('')
const editing = ref<string | null>(null)
const originalBody = ref('')
const editor = ref<{ focus(): void } | null>(null)
const busy = ref(false)
const error = ref('')
let draft: CommentDraft | undefined
const quote = computed(
  () =>
    saved.value?.thread.anchor.quote ??
    props.selection?.source.slice(props.selection.from, props.selection.to) ??
    ''
)
const appearanceDirty = computed(
  () => appearance.value !== (saved.value?.thread.appearance ?? 'yellow')
)
const dirty = computed(() => body.value !== originalBody.value || appearanceDirty.value)
const saveable = computed(() => !!body.value.trim() || (!!saved.value && appearanceDirty.value))
const localTime = (value: string) => new Date(value).toLocaleString()

async function canClose(): Promise<boolean> {
  if (busy.value) return false
  return (
    !dirty.value ||
    (await confirm({
      title: 'Discard unsaved comment?',
      message: 'The text and appearance you have not saved will be lost.',
      confirmText: 'Discard',
    }))
  )
}
async function close() {
  if (await canClose()) emit('close')
}
async function cancelEdit() {
  if (
    body.value !== originalBody.value &&
    !(await confirm({
      title: 'Discard edit?',
      message: 'Your unsaved changes will be lost.',
      confirmText: 'Discard',
    }))
  )
    return
  body.value = ''
  originalBody.value = ''
  editing.value = null
}
async function edit(id: string) {
  if (dirty.value && !(await canClose())) return
  const entry = saved.value?.thread.entries.find((entry) => entry.id === id)
  if (!entry) return
  editing.value = id
  body.value = entry.body
  originalBody.value = entry.body
  editor.value?.focus()
}
async function save() {
  if (busy.value || !saveable.value) return
  busy.value = true
  error.value = ''
  try {
    await props.beforeWrite?.()
    if (!saved.value) {
      const selection = props.selection
      if (!selection) throw new Error('The selected passage is unavailable')
      draft ??= await props.service.draft(
        selection.note,
        selection.source,
        selection.from,
        selection.to,
        appearance.value,
        body.value
      )
      // A publication retry keeps identity and creation time, even when the draft was edited.
      draft.thread = {
        ...draft.thread,
        appearance: appearance.value,
        entries: [{ ...draft.thread.entries[0], body: body.value }],
      }
      if (draft.saved)
        draft.saved = await props.service.repository.write(draft.thread, draft.saved.revision)
      saved.value = await props.service.publish(draft)
    } else if (editing.value) {
      saved.value = await props.service.edit(
        saved.value,
        editing.value,
        body.value,
        appearance.value
      )
    } else if (body.value.trim()) {
      saved.value = await props.service.add(saved.value, body.value, appearance.value)
    } else {
      saved.value = await props.service.appearance(saved.value, appearance.value)
    }
    body.value = ''
    originalBody.value = ''
    editing.value = null
    draft = undefined
    props.changed?.(saved.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function remove(id: string) {
  if (busy.value || !saved.value) return
  if (
    !(await confirm({
      title: 'Delete comment?',
      message:
        saved.value.thread.entries.length === 1
          ? 'This is the last entry. Its marker and thread will also be removed. The note text will stay.'
          : 'Only this entry will be removed. The other comments will stay.',
      confirmText: 'Delete',
    }))
  )
    return
  busy.value = true
  error.value = ''
  try {
    await props.beforeWrite?.()
    const next = await props.service.deleteEntry(saved.value, id)
    saved.value = next ?? undefined
    props.changed?.(next)
    if (editing.value === id) {
      body.value = ''
      originalBody.value = ''
      editing.value = null
    }
    if (!next) emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss">
.abele-text-comments {
  min-width: 0;
  overflow-wrap: anywhere;
  &__appearance,
  &__actions {
    display: flex;
    gap: var(--size-4-2);
    align-items: center;
    flex-wrap: wrap;
  }
  &__entry {
    border-bottom: 1px solid var(--background-modifier-border);
    padding-block: var(--size-4-3);
  }
  &__time {
    color: var(--text-muted);
  }
  [role='alert'] {
    color: var(--text-error);
  }
}
</style>
