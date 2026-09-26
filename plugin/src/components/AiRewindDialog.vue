<template>
  <ObsidianModal :title="title" size="tall" @close="emit('close')">
    <div class="abele-rewind">
      <p class="abele-rewind__lead">{{ lead }}</p>

      <EmptyState v-if="loading" text="Reading the files…" />
      <EmptyState v-else-if="!items.length" :text="emptyText" />

      <div v-else class="abele-rewind__files">
        <TreeItem
          v-for="item in items"
          :key="item.path"
          :text="item.path"
          :icon="ICONS[item.action]"
          :flair="flairOf(item)"
          :path="item.path"
          collapsible
          :collapsed="open !== item.path"
          @click="open = open === item.path ? null : item.path"
        >
          <div class="abele-rewind__detail">
            <Setting
              v-if="item.conflict"
              name="Changed since"
              desc="Somebody changed this file after the agent's last change to it. Putting it back
                loses that change."
            >
              <Dropdown
                :model-value="choices[item.path] ?? 'skip'"
                :options="CHOICES"
                @update:model-value="choices[item.path] = $event as ConflictChoice"
              />
            </Setting>
            <p class="abele-rewind__note">{{ explain(item) }}</p>
            <Diff v-if="item.diff" :text-left="item.diff.old" :text-right="item.diff.new" />
          </div>
        </TreeItem>
      </div>

      <p v-if="error" class="abele-rewind__error">{{ error }}</p>
    </div>

    <template #footer>
      <template v-if="mode === 'since'">
        <Button
          text="Conversation only"
          tooltip="Go back to this message in the chat and leave the files as they are"
          :disabled="busy"
          @click="finish(false, true)"
        />
        <Button
          text="Files only"
          :tooltip="filesTooltip"
          :disabled="busy || loading || !restorable"
          @click="finish(true, false)"
        />
        <Button
          text="Files and conversation"
          :tooltip="
            restorable
              ? 'Put the files back and go back to this message in the chat'
              : 'Nothing to put back: this goes back in the chat only'
          "
          accent
          :disabled="busy || loading"
          @click="finish(true, true)"
        />
      </template>
      <Button
        v-else
        text="Undo changes"
        :tooltip="filesTooltip"
        accent
        :disabled="busy || loading || !restorable"
        @click="finish(true, false)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Notice } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Dropdown from './obsidian/Dropdown.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Setting from './obsidian/Setting.vue'
import TreeItem from './obsidian/TreeItem.vue'
import Diff from './Diff.vue'
import type { ChatRewind } from '@/ai/rewind/ChatRewind'
import type {
  ConflictChoice,
  ItemAction,
  RestoreItem,
  RestorePlan,
  RestoreResult,
} from '@/ai/rewind/types'

/**
 * Taking back what a chat's agent changed in the vault.
 *
 * `since` is a rewind to a message: every change made from the moment it was sent, by any turn,
 * and the choice to go back in the conversation too. `turn` undoes what that message's turn
 * alone changed. Each file says what will happen to it, opens to the difference, and — when
 * somebody changed it after the agent — asks whether to leave it or put it back regardless.
 */
const props = defineProps<{
  rewind: ChatRewind
  mode: 'since' | 'turn'
  /** The user message: its id, and the time it was sent. */
  messageId: string
  since: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Go back to the message in the conversation, as editing it does. */
  (e: 'conversation', messageId: string): void
}>()

const ICONS: Record<ItemAction, string> = {
  rewrite: 'file-pen',
  recreate: 'file-plus',
  remove: 'trash-2',
  'move-back': 'undo-2',
  'remove-folder': 'folder-minus',
  'recreate-folder': 'folder-plus',
  unrestorable: 'file-x',
}

const CHOICES = [
  { value: 'skip', display: 'Leave as it is' },
  { value: 'overwrite', display: 'Put it back anyway' },
]

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const plan = ref<RestorePlan | null>(null)
const open = ref<string | null>(null)
const choices = reactive<Record<string, ConflictChoice>>({})

const items = computed(() => plan.value?.items ?? [])
const restorable = computed(() => items.value.some((i) => i.action !== 'unrestorable'))

const title = computed(() => (props.mode === 'since' ? 'Rewind to here' : 'Undo changes'))
const lead = computed(() =>
  props.mode === 'since'
    ? 'The files the agent changed from this message on, as they will be put back.'
    : "The files this message's turn changed, as they will be put back."
)
const emptyText = computed(() =>
  props.mode === 'since'
    ? 'The agent changed no files from here on.'
    : 'This turn changed no files that are still to be put back.'
)
const filesTooltip = computed(() =>
  restorable.value ? 'Put the files back as they were' : 'Nothing here can be put back'
)

function flairOf(item: RestoreItem): string {
  if (item.action === 'unrestorable') return 'cannot be put back'
  if (item.conflict) return 'changed since'
  const words: Record<ItemAction, string> = {
    rewrite: 'put back',
    recreate: 'made again',
    remove: 'to the trash',
    'move-back': 'moved back',
    'remove-folder': 'removed if empty',
    'recreate-folder': 'made again',
    unrestorable: '',
  }
  return words[item.action]
}

function explain(item: RestoreItem): string {
  switch (item.action) {
    case 'rewrite':
      return item.diff
        ? 'Its text goes back to what it was. First as it is now, then as it will be.'
        : 'Its content goes back to what it was.'
    case 'recreate':
      return 'It was deleted or moved away, and is made again as it was.'
    case 'remove':
      return 'The agent made it. It goes to the trash.'
    case 'move-back':
      return `Moved back from ${item.from}.`
    case 'remove-folder':
      return 'The agent made this folder. It goes once nothing is left in it.'
    case 'recreate-folder':
      return 'The agent removed this folder. It is made again.'
    case 'unrestorable':
      return 'Too large to have been kept, and not simply moved: it stays as it is.'
  }
}

onMounted(async () => {
  try {
    plan.value =
      props.mode === 'since'
        ? await props.rewind.planSince(props.since)
        : await props.rewind.planTurn(props.messageId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})

function report(result: RestoreResult): void {
  const parts: string[] = []
  if (result.restored.length) parts.push(`${result.restored.length} put back`)
  if (result.skipped.length) parts.push(`${result.skipped.length} left as they are`)
  if (result.failed.length) parts.push(`${result.failed.length} failed`)
  if (parts.length) new Notice(`Files: ${parts.join(', ')}.`)
  for (const failure of result.failed) {
    console.warn('[Abele] Rewind could not restore', failure.path, failure.error)
  }
}

async function finish(files: boolean, conversation: boolean): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    if (files && plan.value && restorable.value) {
      const result = await props.rewind.apply(plan.value, { ...choices })
      report(result)
      if (result.failed.length && !conversation) {
        error.value = result.failed.map((f) => `${f.path}: ${f.error}`).join('\n')
        plan.value = await (props.mode === 'since'
          ? props.rewind.planSince(props.since)
          : props.rewind.planTurn(props.messageId))
        return
      }
    }
    if (conversation) emit('conversation', props.messageId)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss">
.abele-rewind {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-rewind__lead,
.abele-rewind__note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-rewind__detail {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-1) 0 var(--size-4-3) var(--size-4-4);
}

.abele-rewind__error {
  margin: 0;
  color: var(--text-error);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
