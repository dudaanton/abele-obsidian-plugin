<template>
  <Modal :title="name" size="tall" phone-sheet @close="emit('close')">
    <div class="abele-sync-window">
      <!-- What the connection is doing, as the row says it, and a bar while it runs. -->
      <div class="abele-sync-window__state">
        <div class="abele-sync-window__status">
          <StatusDot :tone="tone" :label="line" :pulse="tone === 'accent'" />
          <span class="abele-sync-window__line">{{ line }}</span>
          <span
            v-if="activity?.lastSync && row?.status === 'idle' && !progress"
            class="abele-sync-window__server"
            >· {{ settingsSyncWhen(new Date(activity.lastSync).toISOString()) }}</span
          >
        </div>
        <span class="abele-sync-window__server">{{ host }}</span>
      </div>
      <Progress
        v-if="progress"
        :label="t('sync.window.progress', { completed: progress.completed, total: progress.total })"
        :value="progress.completed"
        :max="progress.total"
      />
      <p v-if="counts" class="abele-sync-window__progress" role="status">{{ counts }}</p>
      <p v-if="activity?.transfer?.currentFile" class="abele-sync-window__progress">
        {{ activity.transfer.currentFile }}
      </p>
      <p v-if="failure" class="abele-sync-window__error mod-warning" role="alert">{{ failure }}</p>
      <Setting v-for="path in activity?.missingKeptCopies ?? []" :key="path" :name="path">
        <Button
          :text="t('sync.kept.forget')"
          :tooltip="t('sync.kept.forget')"
          @click="forgetting = path"
        />
      </Setting>
      <ConfirmModal
        v-if="forgetting"
        :title="t('sync.kept.confirm')"
        :message="t('sync.kept.message', { path: forgetting })"
        :confirm-text="t('sync.kept.forget')"
        :confirm-tooltip="t('sync.kept.forget')"
        @confirm="forgetCopy"
        @close="forgetting = ''"
      />

      <ConnectionItems
        v-if="setItems"
        :items="setItems"
        @pause="(item, paused) => act(() => sets!.pauseItem(connectionId, item.id, paused))"
        @follow="(item) => act(() => sets!.followItem(connectionId, item.id))"
        @reveal="(item) => emit('reveal', item.path)"
        @remove-copy="(item) => (removingCopy = item)"
      />

      <Section v-if="refused.length" :title="t('sync.window.notSent')">
        <Setting v-for="item in refused" :key="item.path" :name="item.path" :desc="item.reason" />
      </Section>

      <Section
        v-if="conflicts.length"
        :title="t('sync.window.conflicts')"
        :desc="t('sync.window.conflictsDesc')"
      >
        <EntryRow
          v-for="path in conflicts"
          :key="path"
          role="button"
          tabindex="0"
          @click="emit('open', path)"
          @keydown.enter="emit('open', path)"
          >{{ path
          }}<template #actions
            ><Icon
              icon="file-text"
              :tooltip="t('sync.window.openCopy')"
              @click.stop="emit('open', path)" /></template
        ></EntryRow>
      </Section>

      <Section v-if="held.length || changes.length" :title="t('sync.window.waiting')">
        <HeldDeletesBlock v-if="held.length" :held="held" :port="port" />
        <StagedSettingsBlock v-if="changes.length" :changes="changes" :names="{}" :port="port" />
      </Section>

      <SelectiveSync />

      <Setting :name="t('sync.window.trusted')" :desc="t('sync.window.trustedDesc')">
        <Checkbox :is-enabled="!!row?.trusted" @toggle="toggleTrusted" />
      </Setting>

      <Section v-if="events?.length" :title="t('sync.window.recent')">
        <p class="abele-sync-window__progress">
          {{ t('sync.window.recentDesc') }}
        </p>
        <ConnectionEvents :events="events ?? []" />
      </Section>
    </div>
    <template #footer>
      <Button
        :text="t('sync.window.disconnect')"
        warning
        class="abele-sync-window__disconnect"
        :tooltip="t('sync.window.disconnectTip')"
        @click="emit('disconnect')"
      />
      <Button
        :text="t('sync.window.close')"
        :tooltip="t('sync.window.closeTip')"
        @click="emit('close')"
      />
      <Button
        :text="t('sync.window.share')"
        :tooltip="t('sync.window.shareTip')"
        @click="emit('share')"
      />
    </template>
  </Modal>
  <RemoveCopyModal
    v-if="removingCopy && sets"
    :item="removingCopy"
    :remove="() => sets!.removeCopy(connectionId, removingCopy!.id)"
    @close="removingCopy = null"
    @done="removingCopy = null"
  />
</template>

<script setup lang="ts">
/**
 * One connection, opened from its row: what it is doing, what it could not send, the conflict
 * copies it saved, what waits for the person, what this device takes, and the last few things
 * that happened. Sharing and disconnecting are at the foot, the dangerous one apart.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import Progress from '../obsidian/Progress.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import HeldDeletesBlock from './HeldDeletesBlock.vue'
import StagedSettingsBlock from './StagedSettingsBlock.vue'
import SelectiveSync from '../settings/sync/SelectiveSync.vue'
import ConnectionEvents from './ConnectionEvents.vue'
import ConnectionItems from './ConnectionItems.vue'
import RemoveCopyModal from './RemoveCopyModal.vue'
import { setTone, setLine, shareSetSource, type ConnectionItem } from '@/sync/shareSets'
import { type TokenUi } from '@/sync/tokenUi'
import { connectionLine, connectionProgress, connectionTone } from '@/sync/connectionLine'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { historyConnection } from '@/sync/tokenHistory'
import type { HeldDelete } from '@abele/sync-sdk/core'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { useI18n } from '@/i18n/useI18n'
import { settingsSyncText, settingsSyncWhen } from '@/i18n/settingsSync'

const { t } = useI18n()

const props = defineProps<{ ui: TokenUi; connectionId: string; error?: string }>()
const emit = defineEmits<{
  close: []
  share: []
  disconnect: []
  open: [path: string]
  reveal: [path: string]
}>()

/** A token for several: its items, each with its own state, and the copy being removed. */
const sets = computed(() => shareSetSource.value)
const setItems = computed(() => sets.value?.items(props.connectionId) ?? null)
const removingCopy = ref<ConnectionItem | null>(null)
async function act(action: () => Promise<void>): Promise<void> {
  trustError.value = ''
  try {
    await action()
  } catch {
    trustError.value = 'The action could not finish. Try again when the server is available.'
  }
}

const row = computed(() => props.ui.rows.value.find((one) => one.id === props.connectionId))
const trustError = ref('')
const forgetting = ref('')
async function forgetCopy(): Promise<void> {
  const path = forgetting.value
  forgetting.value = ''
  try {
    await props.ui.forgetMissingKeptCopy(path)
  } catch {
    trustError.value = t('sync.kept.error')
  }
}
async function toggleTrusted(): Promise<void> {
  trustError.value = ''
  try {
    props.ui.setTrusted(props.connectionId, !row.value?.trusted)
    await props.ui.refreshReviews()
  } catch {
    trustError.value = t('sync.window.error')
  }
}
const liveActivity = computed(() => props.ui.activity.value[props.connectionId])
/**
 * What the window shows, at most a few times a second: a pull publishes progress for every
 * file, and redrawing the window that often costs the phone more than the file itself.
 */
const activity = shallowRef(liveActivity.value)
const ACTIVITY_REDRAW_MS = 250
let shownAt = 0
let redraw: number | undefined
watch(liveActivity, (next) => {
  if (redraw !== undefined) return
  const wait = shownAt + ACTIVITY_REDRAW_MS - Date.now()
  if (wait <= 0) {
    shownAt = Date.now()
    activity.value = next
    return
  }
  redraw = window.setTimeout(() => {
    redraw = undefined
    shownAt = Date.now()
    activity.value = liveActivity.value
  }, wait)
})
onBeforeUnmount(() => window.clearTimeout(redraw))
const name = computed(() => (row.value ? new URL(row.value.address).host : ''))
const host = computed(() => (row.value ? new URL(row.value.address).host : ''))
const line = computed(() =>
  setItems.value?.[0]?.state.kind === 'detached'
    ? setLine(
        setItems.value,
        setItems.value.every((item) => item.state.kind === 'detached')
          ? 'No longer shared · your copy stays'
          : 'Synced'
      )
    : row.value
      ? connectionLine(row.value, activity.value, settingsSyncText, settingsSyncWhen)
      : ''
)
const tone = computed(() =>
  setItems.value
    ? setTone(setItems.value)
    : row.value
      ? connectionTone(row.value, activity.value)
      : 'faint'
)
const progress = computed(() => connectionProgress(activity.value))
const counts = computed(() => {
  const one = activity.value
  if (one?.transfer) return ''
  if (one?.pull)
    return `${settingsSyncText(one.pull.stage)} · ${t('sync.window.progress', one.pull)}`
  const stage =
    one?.startup?.stage ??
    (one?.inspection
      ? t('settings.sync.presentation.54272d517782b52a')
      : one?.comparison
        ? t('settings.sync.presentation.6a534e2d9b68ac18')
        : t('settings.sync.presentation.5c8b9e1ce0a2bc31'))
  return progress.value
    ? `${settingsSyncText(stage)} · ${t('sync.window.progress', progress.value)}`
    : ''
})
const failure = computed(() => trustError.value || props.error || activity.value?.error || '')
const refused = computed(() => activity.value?.refused ?? [])
const conflicts = computed(() => activity.value?.conflicts ?? [])
// The same list until an event is added, so the rows below are left alone on progress ticks.
const events = computed(() => activity.value?.events)
const port = shallowRef<TokenSettingsPort>()
const held = shallowRef<HeldDelete[]>([])
const changes = ref<ChangeItem[]>([])

onMounted(async () => {
  historyConnection.value = props.connectionId
  try {
    port.value = TokenSettingsPort.forConnection(props.ui, props.connectionId)
    await port.value.settingsPrompt.refresh()
    changes.value = port.value.settingsPrompt.staged.value
    held.value = (await props.ui.runtimes.get(props.connectionId)?.heldDeletes?.()) ?? []
  } catch {
    // The window still says what the row knows; what waits is shown again on the next open.
  }
})
</script>

<style lang="scss">
.abele-sync-window {
  .abele-section:first-of-type {
    margin-top: var(--size-4-6);
  }

  // This block is part of the scrolling connection body, rather than the body itself.
  // A sticky answer row here covers paths still in the block above it.
  .abele-held-deletes__actions {
    position: static;
  }
}
.abele-sync-window__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-3) var(--size-4-2);
  margin-bottom: var(--size-4-2);
}
.abele-sync-window__status {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: var(--size-4-2);
  min-width: 0;
  max-width: 100%;

  .abele-status-dot {
    // Centre on the first line even when the status text wraps.
    margin-block-start: calc((1lh - var(--size-4-2)) / 2);
  }
}
.abele-sync-window__line {
  min-width: 0;
  color: var(--text-normal);
}
.abele-sync-window__server {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-sync-window__progress {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin-block: var(--size-2-2);
}
.abele-sync-window__error {
  margin-block: var(--size-4-2) 0;
  color: var(--text-error);
}
.abele-sync-window__events {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: var(--size-4-3);
    padding-block: var(--size-2-2);
    font-size: var(--font-ui-small);
  }
}
.abele-sync-window__time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
// Apart from Share and Close, at the footer's start: it ends the connection.
.abele-sync-window__disconnect {
  margin-inline-end: auto;
}
</style>
