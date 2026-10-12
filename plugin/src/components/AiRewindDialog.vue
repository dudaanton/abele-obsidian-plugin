<template>
  <!-- The files the agent changed, as tree rows: what happens to each is its glyph, a dot when
       it has to be left as it is; a row opens to the difference. A rewind is one button: the
       two switches above say whether it puts the files back, goes back in the chat, or both. -->
  <ObsidianModal :title="title" size="tall" close-in-footer @close="emit('close')">
    <div class="abele-rewind">
      <template v-if="mode === 'since'">
        <Setting name="Put files back" :desc="restorable ? '' : 'Nothing here can be put back'">
          <Checkbox
            :is-enabled="files && restorable"
            :disabled="!restorable || busy"
            @toggle="files = !files"
          />
        </Setting>
        <Setting name="Go back in chat" desc="To this message, as editing it does">
          <Checkbox
            :is-enabled="conversation"
            :disabled="busy"
            @toggle="conversation = !conversation"
          />
        </Setting>
      </template>

      <EmptyState v-if="loading" text="Reading the files…" />
      <EmptyState v-else-if="!items.length" icon="file-check" :text="emptyText" />

      <div v-else class="abele-rewind__files">
        <ListSectionHeader :text="lead" :count="items.length" />
        <TreeItem
          v-for="item in items"
          :key="item.path"
          :ref="(row) => describe(row, item)"
          :text="item.path.split('/').pop() ?? item.path"
          :note="
            item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : undefined
          "
          :icon="ICONS[item.action]"
          :path="item.path"
          collapsible
          :collapsed="open !== item.path"
          @click="open = open === item.path ? null : item.path"
        >
          <template v-if="stateOf(item)" #end>
            <StatusDot :tone="stateOf(item)!.tone" :label="stateOf(item)!.label" />
          </template>
          <div class="abele-rewind__detail">
            <p class="abele-rewind__note">{{ explain(item) }}</p>
            <Diff
              v-if="item.diff"
              :text-left="item.diff.old"
              :text-right="item.diff.new"
              :path="item.path"
            />
          </div>
        </TreeItem>
      </div>

      <p v-if="error" class="abele-rewind__error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <Button
        text="Cancel"
        tooltip="Leave the conversation and files unchanged"
        :disabled="busy"
        @click="emit('close')"
      />
      <!-- Files go back only by a button that says so, red, in the window that lists them: going
           back in the chat alone is the quiet accent one. -->
      <Button
        :text="actionText"
        :tooltip="actionTooltip"
        :accent="!puttingBack"
        :warning="puttingBack"
        :disabled="busy || loading || !acting"
        @click="mode === 'since' ? finish(files && restorable, conversation) : finish(true, false)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Notice, setTooltip } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import StatusDot from './obsidian/StatusDot.vue'
import TreeItem from './obsidian/TreeItem.vue'
import Diff from './Diff.vue'
import type { ChatRewind } from '@/ai/rewind/ChatRewind'
import type { ItemAction, RestoreItem, RestorePlan, RestoreResult } from '@/ai/rewind/types'

/**
 * Taking back what a chat's agent changed in the vault.
 *
 * `since` is a rewind to a message: every change made from the moment it was sent, by any turn,
 * and the choice to go back in the conversation too. `turn` undoes what that message's turn
 * alone changed. Each file says what will happen to it, opens to the difference, and — when
 * somebody changed it after the agent — explains why it must be left untouched.
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

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const plan = ref<RestorePlan | null>(null)
const open = ref<string | null>(null)
// Files are put back only when asked for here: the switch starts off.
const files = ref(false)
const conversation = ref(true)

const items = computed(() => plan.value?.items ?? [])
const restorable = computed(() =>
  items.value.some((i) => i.action !== 'unrestorable' && !i.conflict)
)

const title = computed(() => (props.mode === 'since' ? 'Rewind to here' : 'Undo changes'))
const lead = computed(() =>
  props.mode === 'since' ? 'Changed from here on' : 'Changed by this turn'
)
const emptyText = computed(() =>
  props.mode === 'since'
    ? 'The agent changed no files from here on.'
    : 'This turn changed no files that are still to be put back.'
)
/** One button does what the switches say; with both off there is nothing for it to do. */
const acting = computed(() =>
  props.mode === 'since'
    ? conversation.value || (files.value && restorable.value)
    : restorable.value
)
/** The button puts files back: it says so and is drawn as the dangerous one. */
const puttingBack = computed(() => restorable.value && (props.mode === 'turn' || files.value))
const actionText = computed(() => {
  if (!puttingBack.value) return 'Go back in chat'
  return props.mode === 'since' && conversation.value
    ? 'Put files back and go back'
    : 'Put files back'
})
const actionTooltip = computed(() => {
  if (props.mode === 'turn')
    return restorable.value ? 'Put the files back as they were' : 'Nothing here can be put back'
  const doFiles = files.value && restorable.value
  if (doFiles && conversation.value) return 'Put the files back and go back to this message'
  if (doFiles) return 'Put the files back; the chat stays as it is'
  if (conversation.value) return 'Go back to this message; the files stay as they are'
  return 'Switch on what to take back'
})

/** A file that cannot follow the rewind says so with a dot; the words are its tooltip. */
function stateOf(item: RestoreItem): { tone: 'orange' | 'red'; label: string } | undefined {
  if (item.action === 'unrestorable') return { tone: 'red', label: 'Cannot be put back' }
  if (item.reason) return { tone: 'orange', label: `Left as it is: ${item.reason}` }
  if (item.conflict) return { tone: 'orange', label: 'Changed since; left as it is' }
}

function describe(row: unknown, item: RestoreItem): void {
  const el = (row as { $el?: unknown } | null)?.$el
  const self =
    el instanceof HTMLElement ? el.querySelector<HTMLElement>('.abele-tree-item__glyph') : null
  if (self) setTooltip(self, flairOf(item))
}

function flairOf(item: RestoreItem): string {
  if (item.action === 'unrestorable') return 'Cannot be put back'
  if (item.reason) return 'Owner not verified'
  if (item.conflict) return 'Changed since'
  const words: Record<ItemAction, string> = {
    rewrite: 'Text put back',
    recreate: 'Made again',
    remove: 'To the trash',
    'move-back': 'Moved back',
    'remove-folder': 'Removed if empty',
    'recreate-folder': 'Made again',
    unrestorable: '',
  }
  return words[item.action]
}

function explain(item: RestoreItem): string {
  // The dot's tooltip is out of reach on a touch screen: the opened row says why too.
  if (item.reason) return item.reason
  if (item.conflict)
    return 'Undo will not change this file. The comparison below is for reference only.'
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
      const result = await props.rewind.apply(plan.value, {})
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
