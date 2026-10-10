<template>
  <div v-if="ui" class="token-sync-settings">
    <Section
      title="Connections"
      desc="Each connection works independently. Disconnecting keeps all local files."
    >
      <Setting name="Add a connection"
        ><Button
          text="Connect…"
          tooltip="Paste a token for a server, folder or group"
          @click="dialog = { mode: 'connect' }"
      /></Setting>
      <EmptyState v-if="!rows.length" text="No connections yet. Ask for a token to connect." />
      <Setting
        v-for="row in rows"
        :key="row.id"
        :name="scopeName(row.scope)"
        :desc="description(row)"
      >
        <Icon
          icon="refresh-cw"
          tooltip="Sync this connection now"
          :disabled="row.paused || !ui.runtimes.has(row.id) || busy.has(row.id)"
          @click="act(row.id, () => ui!.sync(row.id))"
        />
        <Icon
          :icon="row.paused ? 'play' : 'pause'"
          :tooltip="row.paused ? 'Resume this connection' : 'Pause this connection'"
          :disabled="busy.has(row.id)"
          @click="act(row.id, () => ui!.pause(row.id, !row.paused))"
        />
        <Icon
          icon="share-2"
          tooltip="Share a folder or group, or connect another device"
          @click="dialog = { mode: 'share', connectionId: row.id }"
        />
        <Icon
          icon="unlink"
          tooltip="Review disconnecting this connection"
          @click="dialog = { mode: 'disconnect', connectionId: row.id }"
        />
        <Icon
          icon="trash-2"
          tooltip="Open this connection's deleted files"
          @click="openTrash(row.id)"
        />
        <Icon
          icon="settings"
          tooltip="What this device syncs and changes waiting for review"
          @click="configure(row.id)"
        />
      </Setting>
      <p v-if="rows.length && !ui.available.value">
        File exchange is opening. Connections that need attention keep their files here.
      </p>
    </Section>
    <Section
      v-for="row in activityRows"
      :key="'activity-' + row.id"
      :title="connectionName(row)"
      :desc="row.address"
    >
      <p v-if="errors[row.id] || activity[row.id]?.error" role="alert">
        {{ errors[row.id] || activity[row.id]?.error }}
      </p>
      <Setting
        v-if="activity[row.id]?.total !== undefined"
        name="Progress"
        :desc="(activity[row.id]?.completed ?? 0) + ' of ' + activity[row.id]?.total + ' files'"
      />
      <Setting
        v-for="item in activity[row.id]?.refused ?? []"
        :key="item.path"
        :name="item.path"
        :desc="'Not sent: ' + item.reason"
      />
      <Setting
        v-for="path in activity[row.id]?.conflicts ?? []"
        :key="path"
        name="Conflict copy saved"
        :desc="path"
        ><Icon icon="file-text" tooltip="Open the conflict copy" @click="openFile(path)"
      /></Setting>
    </Section>
    <Section
      title="Incoming code"
      desc="New code, changes, renames and deletions wait for your decision."
    >
      <EmptyState v-if="!candidates.length" text="No code changes waiting." />
      <Setting
        v-for="candidate in candidates"
        :key="candidate.id"
        :name="candidate.path"
        :desc="candidate.source.address + ' · ' + new Date(candidate.receivedAt).toLocaleString()"
      >
        <Icon
          icon="eye"
          tooltip="View the exact incoming version"
          @click="dialog = { mode: 'review', candidate }"
        />
      </Setting>
    </Section>
    <Section v-if="questions.length" title="Private files">
      <Setting
        v-for="question in questions"
        :key="question.id"
        :name="question.path"
        :desc="
          'Share through ' +
          question.source.address +
          ' · ' +
          scopeName(question.source.scope) +
          '?'
        "
      >
        <Icon
          icon="eye"
          tooltip="Allow or deny this file for this connection"
          @click="dialog = { mode: 'attachment', question }"
        />
      </Setting>
    </Section>
    <TokenDialogs
      v-if="dialog"
      :key="
        dialog.mode + (dialog.connectionId ?? dialog.candidate?.id ?? dialog.question?.id ?? '')
      "
      :ui="ui"
      v-bind="dialog"
      @close="dialog = null"
    />
    <Modal
      v-if="preferences"
      :title="preferences.name"
      size="tall"
      phone-sheet
      @close="preferences = null"
    >
      <HeldDeletesBlock v-if="preferences.held.length" :held="preferences.held" />
      <StagedSettingsBlock
        v-if="preferences.changes.length"
        :changes="preferences.changes"
        :names="{}"
      />
      <SelectiveSync />
    </Modal>
  </div>
  <EmptyState v-else text="Sync is opening. If it cannot open, restart Obsidian and try again." />
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import TokenDialogs from '../sync/TokenDialogs.vue'
import Modal from '../obsidian/Modal.vue'
import SelectiveSync from './sync/SelectiveSync.vue'
import HeldDeletesBlock from '../sync/HeldDeletesBlock.vue'
import StagedSettingsBlock from '../sync/StagedSettingsBlock.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
const preferences = ref<{
  name: string
  held: import('@abele/sync-core').HeldDelete[]
  changes: import('@abele/sync-protocol').ChangeItem[]
} | null>(null)
async function configure(id: string) {
  if (!ui.value) return
  await act(id, async () => {
    historyConnection.value = id
    const port = TokenSettingsPort.forConnection(ui.value, id)
    await port.settingsPrompt.refresh()
    preferences.value = {
      name: connectionName(rows.value.find((row) => row.id === id)),
      held: (await ui.value.runtimes.get(id)?.heldDeletes?.()) ?? [],
      changes: port.settingsPrompt.staged.value,
    }
  })
}
import { historyConnection } from '@/sync/tokenHistory'
import { GlobalStore } from '@/stores/GlobalStore'
function openTrash(id: string) {
  historyConnection.value = id
  GlobalStore.getInstance().deletedFilesModalOpened.value = true
}
import {
  tokenUi,
  scopeName,
  connectionName,
  statusName,
  connectionError,
  type TokenUi,
} from '@/sync/tokenUi'
import type { TokenConnectionRecord } from '@/sync/tokenConnectionRegistry'
import type { ExecutableCandidate } from '@/sync/executableReview'
import type { AttachmentQuestion } from '@/sync/attachmentConsent'
const props = defineProps<{ model?: TokenUi }>()
const ui = computed(() => props.model ?? tokenUi.value)
const rows = computed(() => ui.value?.rows.value ?? [])
const activity = computed(() => ui.value?.activity.value ?? {})
const activityRows = computed(() =>
  rows.value.filter(
    (row) =>
      errors.value[row.id] ||
      activity.value[row.id]?.error ||
      activity.value[row.id]?.total !== undefined ||
      activity.value[row.id]?.refused?.length ||
      activity.value[row.id]?.conflicts?.length
  )
)
const candidates = computed(() => ui.value?.candidates.value ?? [])
const questions = computed(() => ui.value?.questions.value ?? [])
const errors = ref<Record<string, string>>({}),
  busy = ref(new Set<string>())
const dialog = ref<{
  mode: 'connect' | 'share' | 'disconnect' | 'review' | 'attachment'
  connectionId?: string
  candidate?: ExecutableCandidate
  question?: AttachmentQuestion
} | null>(null)
function description(row: TokenConnectionRecord) {
  const last = activity.value[row.id]?.lastSync
  return (
    row.address +
    ' · ' +
    statusName(row.paused ? 'paused' : row.status) +
    ' · ' +
    (last ? 'Last synced ' + new Date(last).toLocaleString() : 'Not synced yet')
  )
}
async function act(id: string, action: () => Promise<void>) {
  if (busy.value.has(id)) return
  busy.value.add(id)
  try {
    await action()
    delete errors.value[id]
  } catch (error) {
    errors.value[id] = connectionError(error)
  } finally {
    busy.value.delete(id)
  }
}
function openFile(path: string) {
  if (ui.value)
    void ui.value
      .openFile(path)
      .catch(
        () =>
          new Notice(
            'The file could not be opened. Its contents have been kept. Try again when a server is available.'
          )
      )
}
let active = true
onUnmounted(() => {
  active = false
})
onMounted(() => {
  void ui.value?.refreshReviews().catch(() => {
    if (active)
      new Notice('Incoming changes could not be opened. Reopen sync settings to try again.')
  })
})
</script>
