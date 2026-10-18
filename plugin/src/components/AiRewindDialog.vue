<template>
  <!-- The files the agent changed, as tree rows: what happens to each is its glyph, a dot when
       it has to be left as it is; a row opens to the difference. A rewind is one button: the
       two switches above say whether it puts the files back, goes back in the chat, or both. -->
  <ObsidianModal :title="title" size="tall" close-in-footer @close="emit('close')">
    <div class="abele-rewind">
      <template v-if="mode === 'since'">
        <Setting
          :name="t('streamB.putFilesBack.2a77d8')"
          :desc="restorable ? '' : t('streamB.nothingHereCanBePutBack.400ae2')"
        >
          <Checkbox
            :is-enabled="files && restorable"
            :disabled="!restorable || busy"
            @toggle="files = !files"
          />
        </Setting>
        <Setting
          :name="t('streamB.goBackInChat.1cec2a')"
          :desc="t('streamB.toThisMessageAsEditingItDoes.134485')"
        >
          <Checkbox
            :is-enabled="conversation"
            :disabled="busy"
            @toggle="conversation = !conversation"
          />
        </Setting>
      </template>

      <EmptyState v-if="loading" :text="t('streamB.readingTheFiles.86a22c')" />
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

      <p v-if="error" class="abele-rewind__error" role="alert">{{ presentUiError(error) }}</p>
    </div>

    <template #footer>
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.leaveTheConversationAndFilesUnchanged.bfec57')"
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
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'

import { t } from '@/i18n'
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

const title = computed(() =>
  props.mode === 'since' ? t('streamB.rewindToHere.447575') : t('streamB.undoChanges.ba0624')
)
const lead = computed(() =>
  props.mode === 'since'
    ? t('streamB.changedFromHereOn.047528')
    : t('streamB.changedByThisTurn.a30d48')
)
const emptyText = computed(() =>
  props.mode === 'since'
    ? t('streamB.theAgentChangedNoFilesFromHere.fd371d')
    : t('streamB.thisTurnChangedNoFilesThatAre.c4ff8f')
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
  if (!puttingBack.value) return t('streamB.goBackInChat.1cec2a')
  return props.mode === 'since' && conversation.value
    ? t('streamB.putFilesBackAndGoBack.d25972')
    : t('streamB.putFilesBack.2a77d8')
})
const actionTooltip = computed(() => {
  if (props.mode === 'turn')
    return restorable.value
      ? t('streamB.putTheFilesBackAsTheyWere.a6c276')
      : t('streamB.nothingHereCanBePutBack.400ae2')
  const doFiles = files.value && restorable.value
  if (doFiles && conversation.value) return t('streamB.putTheFilesBackAndGoBack.699c27')
  if (doFiles) return t('streamB.putTheFilesBackTheChatStays.7df626')
  if (conversation.value) return t('streamB.goBackToThisMessageTheFiles.6c1885')
  return t('streamB.switchOnWhatToTakeBack.fb162f')
})

/** A file that cannot follow the rewind says so with a dot; the words are its tooltip. */
function stateOf(item: RestoreItem): { tone: 'orange' | 'red'; label: string } | undefined {
  if (item.action === 'unrestorable')
    return { tone: 'red', label: t('streamB.cannotBePutBack.997377') }
  if (item.reason)
    return {
      tone: 'orange',
      label: t('streamB.leftAsItIs.a4be48', { v0: presentUiField(item, 'reason') }),
    }
  if (item.conflict) return { tone: 'orange', label: t('streamB.changedSinceLeftAsItIs.f18403') }
}

function describe(row: unknown, item: RestoreItem): void {
  const el = (row as { $el?: unknown } | null)?.$el
  const self =
    el instanceof HTMLElement ? el.querySelector<HTMLElement>('.abele-tree-item__glyph') : null
  if (self) setTooltip(self, flairOf(item))
}

function flairOf(item: RestoreItem): string {
  if (item.action === 'unrestorable') return t('streamB.cannotBePutBack.997377')
  if (item.reason) return t('streamB.ownerNotVerified.48629d')
  if (item.conflict) return t('streamB.changedSince.3441d8')
  const words: Record<ItemAction, string> = {
    rewrite: t('streamB.textPutBack.0591c3'),
    recreate: t('streamB.madeAgain.1cd6bb'),
    remove: t('streamB.toTheTrash.55b6e4'),
    'move-back': t('streamB.movedBack.c6bc4e'),
    'remove-folder': t('streamB.removedIfEmpty.c7dabc'),
    'recreate-folder': t('streamB.madeAgain.1cd6bb'),
    unrestorable: '',
  }
  return words[item.action]
}

function explain(item: RestoreItem): string {
  // The dot's tooltip is out of reach on a touch screen: the opened row says why too.
  if (item.reason) return presentUiField(item, 'reason')
  if (item.conflict) return t('streamB.undoWillNotChangeThisFileThe.bbb8a4')
  switch (item.action) {
    case 'rewrite':
      return item.diff
        ? t('streamB.itsTextGoesBackToWhatIt.a829e2')
        : t('streamB.itsContentGoesBackToWhatIt.065757')
    case 'recreate':
      return t('streamB.itWasDeletedOrMovedAwayAnd.3f4699')
    case 'remove':
      return t('streamB.theAgentMadeItItGoesTo.03907a')
    case 'move-back':
      return t('streamB.movedBackFrom.9118ee', { v0: String(item.from) })
    case 'remove-folder':
      return t('streamB.theAgentMadeThisFolderItGoes.c73453')
    case 'recreate-folder':
      return t('streamB.theAgentRemovedThisFolderItIs.bc8795')
    case 'unrestorable':
      return t('streamB.tooLargeToHaveBeenKeptAnd.3a10b5')
  }
}

onMounted(async () => {
  try {
    plan.value =
      props.mode === 'since'
        ? await props.rewind.planSince(props.since)
        : await props.rewind.planTurn(props.messageId)
  } catch (err) {
    error.value = presentUiError(err)
  } finally {
    loading.value = false
  }
})

function report(result: RestoreResult): void {
  const parts: string[] = []
  if (result.restored.length)
    parts.push(t('streamB.putBack.313739', { v0: String(result.restored.length) }))
  if (result.skipped.length)
    parts.push(t('streamB.leftAsTheyAre.69c9f8', { v0: String(result.skipped.length) }))
  if (result.failed.length) parts.push(`${result.failed.length} failed`)
  if (parts.length) new Notice(t('streamB.files.3affc3', { v0: String(parts.join(', ')) }))
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
        error.value = result.failed
          .map((f) => `${f.path}: ${presentUiField(f, 'error')}`)
          .join('\n')
        plan.value = await (props.mode === 'since'
          ? props.rewind.planSince(props.since)
          : props.rewind.planTurn(props.messageId))
        return
      }
    }
    if (conversation) emit('conversation', props.messageId)
    emit('close')
  } catch (err) {
    error.value = presentUiError(err)
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
