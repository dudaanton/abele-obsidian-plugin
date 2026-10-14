<template>
  <div v-if="ui" class="token-sync-settings">
    <!-- What waits for the person, above everything else, and only while something does. -->
    <Section
      v-if="candidates.length || questions.length"
      title="Waiting for you"
      desc="Code that came from another device and private files a shared note links to."
    >
      <Setting
        v-for="candidate in candidates"
        :key="candidate.id"
        :name="candidate.path"
        :desc="'Code from ' + host(candidate.source.address) + ' · ' + when(candidate.receivedAt)"
      >
        <Icon
          icon="eye"
          tooltip="View the exact incoming version"
          @click="dialog = { mode: 'review', candidate }"
        />
      </Setting>
      <Setting
        v-for="question in questions"
        :key="question.id"
        :name="question.path"
        :desc="'Private file · share with ' + scopeName(question.source.scope) + '?'"
      >
        <Icon
          icon="eye"
          tooltip="Allow or deny this file for this connection"
          @click="dialog = { mode: 'attachment', question }"
        />
      </Setting>
    </Section>
    <Section
      title="Connections"
      desc="Each connection works on its own. Disconnecting keeps every file on this device."
    >
      <EmptyState
        v-if="!rows.length"
        icon="cloud"
        title="No connections yet"
        text="Paste a token or scan a QR code to connect."
      />
      <!-- A connection as one row: its state as a dot, sync now, the rest in ⋯; the row opens it. -->
      <Setting
        v-for="row in rows"
        :key="row.id"
        :name="scopeName(row.scope)"
        role="button"
        tabindex="0"
        class="abele-sync-row"
        @click="opened = row.id"
        @keydown.enter.self="opened = row.id"
      >
        <template #desc
          ><span class="abele-sync-row__line" :class="{ 'mod-warning': tone(row) === 'red' }">{{
            line(row)
          }}</span
          ><span class="abele-sync-row__server"> · {{ host(row.address) }}</span></template
        >
        <StatusDot :tone="tone(row)" :label="line(row)" :pulse="tone(row) === 'accent'" />
        <Icon
          icon="refresh-cw"
          tooltip="Sync this connection now"
          :disabled="row.paused || connectionBusy(row, activity[row.id]) || busy.has(row.id)"
          @click.stop="act(row.id, () => ui!.sync(row.id))"
        />
        <Icon
          icon="more-horizontal"
          tooltip="Pause, share, deleted files, disconnect"
          @click.stop="more($event, row)"
        />
      </Setting>
      <Setting name="Connect to a server" desc="By a token you were given, pasted or scanned.">
        <Button
          text="Connect…"
          tooltip="Paste a token for a server, folder or group"
          @click="dialog = { mode: 'connect' }"
        />
      </Setting>
      <p v-if="rows.length && !ui.available.value" class="setting-item-description">
        File exchange is opening. Connections that need attention keep their files here.
      </p>
    </Section>
    <ConnectionWindow
      v-if="opened && rows.some((one) => one.id === opened)"
      :key="opened"
      :ui="ui"
      :connection-id="opened"
      :error="errors[opened]"
      @close="opened = null"
      @open="openFile"
      @share="dialog = { mode: 'share', connectionId: opened! }"
      @disconnect="dialog = { mode: 'disconnect', connectionId: opened! }"
    />
    <TokenDialogs
      v-if="dialog"
      :key="
        dialog.mode + (dialog.connectionId ?? dialog.candidate?.id ?? dialog.question?.id ?? '')
      "
      :ui="ui"
      v-bind="dialog"
      @close="closeDialog"
    />
  </div>
  <EmptyState v-else text="Sync is opening. If it cannot open, restart Obsidian and try again." />
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Menu, Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import TokenDialogs from '../sync/TokenDialogs.vue'
import ConnectionWindow from '../sync/ConnectionWindow.vue'
import { historyConnection } from '@/sync/tokenHistory'
import { GlobalStore } from '@/stores/GlobalStore'
import { tokenUi, scopeName, connectionError, type TokenUi } from '@/sync/tokenUi'
import { connectionBusy, connectionLine, connectionTone } from '@/sync/connectionLine'
import { formatWhen } from '@/sync/format'
import type { TokenConnectionRecord } from '@/sync/tokenConnectionRegistry'
import type { ExecutableCandidate } from '@/sync/executableReview'
import type { AttachmentQuestion } from '@/sync/attachmentConsent'
const props = defineProps<{ model?: TokenUi }>()
const ui = computed(() => props.model ?? tokenUi.value)
const rows = computed(() => ui.value?.rows.value ?? [])
const activity = computed(() => ui.value?.activity.value ?? {})
const candidates = computed(() => ui.value?.candidates.value ?? [])
const questions = computed(() => ui.value?.questions.value ?? [])
const errors = ref<Record<string, string>>({}),
  busy = ref(new Set<string>())
/** The connection whose window is open. */
const opened = ref<string | null>(null)
const dialog = ref<{
  mode: 'connect' | 'share' | 'disconnect' | 'review' | 'attachment'
  connectionId?: string
  candidate?: ExecutableCandidate
  question?: AttachmentQuestion
} | null>(null)
const host = (address: string) => new URL(address).host
const when = (at: number) => formatWhen(new Date(at).toISOString())
const tone = (row: TokenConnectionRecord) =>
  errors.value[row.id] ? 'red' : connectionTone(row, activity.value[row.id])
const line = (row: TokenConnectionRecord) =>
  errors.value[row.id] ?? connectionLine(row, activity.value[row.id])
function closeDialog() {
  // A disconnected connection has no window left to go back to.
  if (dialog.value?.mode === 'disconnect' && !rows.value.some((one) => one.id === opened.value))
    opened.value = null
  dialog.value = null
}
function openTrash(id: string) {
  historyConnection.value = id
  GlobalStore.getInstance().deletedFilesModalOpened.value = true
}
/** The rarer things to do to a connection, with disconnecting apart at the end. */
function more(event: MouseEvent, row: TokenConnectionRecord) {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(row.paused ? 'Resume' : 'Pause')
      .setIcon(row.paused ? 'play' : 'pause')
      .onClick(() => act(row.id, () => ui.value!.pause(row.id, !row.paused)))
  )
  menu.addItem((item) =>
    item
      .setTitle('Share…')
      .setIcon('share-2')
      .onClick(() => (dialog.value = { mode: 'share', connectionId: row.id }))
  )
  menu.addItem((item) =>
    item
      .setTitle('Deleted files')
      .setIcon('trash-2')
      .onClick(() => openTrash(row.id))
  )
  menu.addItem((item) =>
    item
      .setTitle('What this device syncs')
      .setIcon('settings')
      .onClick(() => (opened.value = row.id))
  )
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle('Disconnect…')
      .setIcon('unlink')
      .setWarning(true)
      .onClick(() => (dialog.value = { mode: 'disconnect', connectionId: row.id }))
  )
  menu.showAtMouseEvent(event)
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
<style lang="scss">
// The whole row opens its connection; the glyphs at its end do their own thing.
.abele-sync-row {
  cursor: var(--cursor);
  border-radius: var(--radius-s);

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }
}
.abele-sync-row__line.mod-warning {
  color: var(--text-error);
}
.abele-sync-row__server {
  color: var(--text-faint);
}
</style>
