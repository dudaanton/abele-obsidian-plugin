<template>
  <div v-if="ui" class="token-sync-settings">
    <!-- What waits for the person, above everything else, and only while something does. -->
    <Section
      v-if="candidates.length || questions.length"
      :title="t('settings.SyncSettings.waiting_for_you.9f760ab2')"
      :desc="t('settings.SyncSettings.code_that_came_from_another.89b6b46f')"
    >
      <Setting
        v-for="candidate in candidates"
        :key="candidate.id"
        :name="candidate.path"
        :desc="
          t('settings.sync.codeSource', {
            host: host(candidate.source.address),
            when: when(candidate.receivedAt),
          })
        "
      >
        <Icon
          icon="eye"
          :tooltip="t('settings.SyncSettings.view_the_exact_incoming_version.6497a546')"
          @click="dialog = { mode: 'review', candidate }"
        />
      </Setting>
      <Setting
        v-for="question in questions"
        :key="question.id"
        :name="question.path"
        :desc="t('settings.sync.privateQuestion', { scope: scopeName(question.source.scope) })"
      >
        <Icon
          icon="eye"
          :tooltip="t('settings.SyncSettings.allow_or_deny_this_file.5d819259')"
          @click="dialog = { mode: 'attachment', question }"
        />
      </Setting>
    </Section>
    <Section
      :title="t('settings.SyncSettings.connections.dc273117')"
      :desc="t('settings.SyncSettings.each_connection_works_on_its.4a88585e')"
    >
      <EmptyState
        v-if="!rows.length"
        icon="cloud"
        :title="t('settings.SyncSettings.no_connections_yet.8697571e')"
        :text="t('settings.SyncSettings.paste_a_token_or_scan.257b9a79')"
      />
      <!-- A connection as one row: its state as a dot, sync now, the rest in ⋯; the row opens it. -->
      <Setting
        v-for="row in rows"
        :key="row.id"
        :name="rowName(row)"
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
          v-if="
            !row.state['abele-sync-token-state:scope-deleted'] &&
            activity[row.id]?.error !== SCOPE_DELETED
          "
          icon="refresh-cw"
          :tooltip="t('settings.SyncSettings.sync_this_connection_now.52cd5ea4')"
          :disabled="
            !!row.rootIssue ||
            row.paused ||
            connectionBusy(row, activity[row.id]) ||
            busy.has(row.id)
          "
          @click.stop="act(row.id, () => ui!.sync(row.id))"
        />
        <Icon
          icon="more-horizontal"
          :tooltip="t('settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85')"
          @click.stop="more($event, row)"
        />
      </Setting>
      <Setting
        :name="t('settings.SyncSettings.connect_to_a_server.232ac7de')"
        :desc="t('settings.SyncSettings.by_a_token_you_were.d2dab8e7')"
      >
        <Button
          :text="t('settings.SyncSettings.connect.c0e20f6d')"
          :tooltip="t('settings.SyncSettings.paste_a_token_for_a.256b8463')"
          @click="dialog = { mode: 'connect' }"
        />
      </Setting>
      <p v-if="rows.length && !ui.available.value" class="setting-item-description">
        {{ t('settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6') }}
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
      @reveal="reveal"
      @share="dialog = { mode: 'share', connectionId: opened! }"
      @disconnect="dialog = { mode: 'disconnect', connectionId: opened! }"
    />
    <ServerDeleteModal
      v-if="deleting && deletingFacts && serverDeleteSource"
      :name="deletingName"
      :host="deletingHost"
      :facts="deletingFacts"
      :remove="() => serverDeleteSource!.remove(deleting!)"
      @close="deleting = null"
      @done="deleted"
    />
    <ShareDialog
      v-if="dialog?.mode === 'share' && sets?.several(dialog.connectionId)"
      :source="sets"
      :connection-id="dialog.connectionId"
      :host="shareHost"
      @close="closeDialog"
    />
    <TokenDialogs
      v-else-if="dialog"
      :key="
        dialog.mode + (dialog.connectionId ?? dialog.candidate?.id ?? dialog.question?.id ?? '')
      "
      :ui="ui"
      v-bind="dialog"
      @close="closeDialog"
    />
  </div>
  <EmptyState v-else :text="t('settings.SyncSettings.sync_is_opening_if_it.1225ed54')" />
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Menu, Notice, setTooltip } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import TokenDialogs from '../sync/TokenDialogs.vue'
import ConnectionWindow from '../sync/ConnectionWindow.vue'
import ServerDeleteModal from '../sync/ServerDeleteModal.vue'
import ShareDialog from '../sync/ShareDialog.vue'
import { setLine, setTitle, setTone, shareSetSource } from '@/sync/shareSets'
import {
  READ_ONLY,
  serverDeleteSource as designDeleteSource,
  type ServerDeleteFacts,
} from '../sync/serverDelete'
import { historyConnection } from '@/sync/tokenHistory'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  tokenUi,
  scopeName as syncScopeName,
  connectionError,
  SCOPE_DELETED,
  type TokenUi,
} from '@/sync/tokenUi'
import { settingsSyncText, settingsSyncWhen } from '@/i18n/settingsSync'
import { connectionBusy, connectionLine, connectionTone } from '@/sync/connectionLine'
import type { TokenConnectionRecord } from '@/sync/tokenConnectionRegistry'
import type { ExecutableCandidate } from '@/sync/executableReview'
import type { AttachmentQuestion } from '@/sync/attachmentConsent'
const props = defineProps<{ model?: TokenUi }>()
const ui = computed(() => props.model ?? tokenUi.value)
const deleteFacts = ref<Record<string, ServerDeleteFacts>>({})
const serverDeleteSource = computed(
  () =>
    designDeleteSource.value ??
    (ui.value
      ? {
          facts: (id: string) => deleteFacts.value[id] ?? null,
          remove: (id: string) => ui.value.deleteFromServer(id),
        }
      : null)
)
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
const when = (at: number) => settingsSyncWhen(new Date(at).toISOString())
const sets = computed(() => shareSetSource.value)
const itemsOf = (row: TokenConnectionRecord) => sets.value?.items(row.id) ?? null
const rowName = (row: TokenConnectionRecord) => {
  const items = itemsOf(row)
  return items ? setTitle(items, sets.value?.label(row.id)) : scopeName(row.scope)
}
const RANK = ['faint', 'green', 'accent', 'orange', 'red']
const tone = (row: TokenConnectionRecord) => {
  if (errors.value[row.id]) return 'red'
  const own = connectionTone(row, activity.value[row.id])
  const items = itemsOf(row)
  if (!items) return own
  if (items.length && items.every((item) => item.state.kind === 'detached')) return 'faint'
  if (items[0]?.state.kind === 'detached') return setTone(items)
  const worst = setTone(items)
  return RANK.indexOf(worst) > RANK.indexOf(own) ? worst : own
}
const line = (row: TokenConnectionRecord) => {
  if (errors.value[row.id]) return errors.value[row.id]
  const own = connectionLine(row, activity.value[row.id], settingsSyncText, settingsSyncWhen)
  const items = itemsOf(row)
  if (items?.[0]?.state.kind === 'detached')
    return setLine(
      items,
      items.every((item) => item.state.kind === 'detached')
        ? 'No longer shared · copy kept'
        : 'Synced'
    )
  return items ? setLine(items, own) : own
}
const shareHost = computed(() => {
  const row = rows.value.find((one) => one.id === dialog.value?.connectionId) ?? rows.value[0]
  return row ? host(row.address) : ''
})
function reveal(path: string) {
  const app = GlobalStore.getInstance().app as unknown as {
    vault: { getAbstractFileByPath(path: string): unknown }
    internalPlugins?: {
      getPluginById(id: string): { instance?: { revealInFolder?(file: unknown): void } } | null
    }
  }
  const file = app.vault.getAbstractFileByPath(path)
  if (file) app.internalPlugins?.getPluginById('file-explorer')?.instance?.revealInFolder?.(file)
}
const scopeName = (scope: Parameters<typeof syncScopeName>[0]) =>
  syncScopeName(scope, settingsSyncText)
function closeDialog() {
  // A disconnected connection has no window left to go back to.
  if (dialog.value?.mode === 'disconnect' && !rows.value.some((one) => one.id === opened.value))
    opened.value = null
  dialog.value = null
}
/** The connection whose files are being deleted from the server, while it is asked about. */
const deleting = ref<string | null>(null)
const deletingSnapshot = ref<TokenConnectionRecord | null>(null)
const deletingRow = computed(
  () => rows.value.find((one) => one.id === deleting.value) ?? deletingSnapshot.value
)
const deletingFacts = computed(() =>
  deleting.value ? (serverDeleteSource.value?.facts(deleting.value) ?? null) : null
)
/** What goes, as a sentence says it: the whole vault, or a folder or group by its name. */
const deletingName = computed(() => {
  const scope = deletingRow.value?.scope
  if (!scope) return ''
  if (scope.path === '/') return t('settings.SyncSettings.the_whole_vault.0a409543')
  const name = scope.path.replace(/\.md$/, '').split('/').pop()
  return `“${name}”`
})
const deletingHost = computed(() => (deletingRow.value ? host(deletingRow.value.address) : ''))
/** Its files are in the server's trash: this device lets go of it and keeps every file. */
async function deleted() {
  const id = deleting.value
  const name = deletingName.value
  deleting.value = null
  if (!id) return
  if (opened.value === id) opened.value = null
  new Notice(
    t('settings.SyncSettings.deleted_value_from_the_server.70376e92', { value0: String(name) })
  )
}
function openTrash(id: string) {
  historyConnection.value = id
  GlobalStore.getInstance().deletedFilesModalOpened.value = true
}
/** The rarer things to do to a connection, with disconnecting apart at the end. */
function more(event: MouseEvent, row: TokenConnectionRecord) {
  const menu = new Menu()
  if (row.rootIssue?.kind === 'server-renamed')
    menu.addItem((item) =>
      item
        .setTitle(t('settings.SyncSettings.keep_syncing_into_the_same.12873e9a'))
        .setIcon('folder-input')
        .onClick(() =>
          act(row.id, async () => {
            const runtime = ui.value.runtimes.get(row.id)
            if (!runtime?.followServerRoot) throw new Error('Connection is unavailable')
            await runtime.followServerRoot()
          })
        )
    )
  if (row.rootIssue?.kind === 'moved')
    menu.addItem((item) =>
      item
        .setTitle(t('settings.SyncSettings.follow_moved_folder.bba3cc92'))
        .setIcon('folder-input')
        .onClick(() =>
          act(row.id, async () => {
            const runtime = ui.value.runtimes.get(row.id)
            if (!runtime?.followRoot) throw new Error('Connection is unavailable')
            await runtime.followRoot()
          })
        )
    )
  if (row.rootIssue && row.rootIssue.kind !== 'server-renamed')
    menu.addItem((item) =>
      item
        .setTitle(t('settings.SyncSettings.restore_from_the_server.6186b8b7'))
        .setIcon('download')
        .onClick(() =>
          act(row.id, async () => {
            const runtime = ui.value.runtimes.get(row.id)
            if (!runtime?.restoreRoot) throw new Error('Connection is unavailable')
            await runtime.restoreRoot()
          })
        )
    )
  if (!row.rootIssue)
    menu.addItem((item) =>
      item
        .setTitle(
          row.paused
            ? t('settings.SyncSettings.resume.d640c742')
            : t('settings.SyncSettings.pause.858e4ba7')
        )
        .setIcon(row.paused ? 'play' : 'pause')
        .onClick(() => act(row.id, () => ui.value.pause(row.id, !row.paused)))
    )
  menu.addItem((item) =>
    item
      .setTitle(t('settings.SyncSettings.share.51fc2d24'))
      .setIcon('share-2')
      .onClick(() => (dialog.value = { mode: 'share', connectionId: row.id }))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('settings.SyncSettings.deleted_files.5352e2e9'))
      .setIcon('trash-2')
      .onClick(() => openTrash(row.id))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('settings.SyncSettings.what_this_device_syncs.979d00ce'))
      .setIcon('settings')
      .onClick(() => (opened.value = row.id))
  )
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle(t('settings.SyncSettings.disconnect.f1142965'))
      .setIcon('unlink')
      .setWarning(true)
      .onClick(() => (dialog.value = { mode: 'disconnect', connectionId: row.id }))
  )
  menu.addItem((item) => {
    if (sets.value?.several(row.id) && !sets.value.owner(row.id)) {
      item
        .setTitle('Only the issuer can delete these files from the server')
        .setIcon('cloud-off')
        .setDisabled(true)
      return
    }
    const configure = (facts: ServerDeleteFacts | null) => {
      item
        .setTitle(
          facts
            ? (facts.unavailableReason ??
                (facts.canWrite
                  ? t('settings.SyncSettings.delete_from_the_server.b3acd04d')
                  : t('settings.SyncSettings.delete_from_the_server_read.5f7e4370')))
            : t('settings.SyncSettings.delete_from_the_server_unavailable.516a170e')
        )
        .setIcon('cloud-off')
        .setWarning(!!facts?.canWrite)
        .setDisabled(!facts?.canWrite)
      if (item.dom)
        setTooltip(item.dom, facts && !facts.canWrite ? (facts.unavailableReason ?? READ_ONLY) : '')
    }
    configure(serverDeleteSource.value?.facts(row.id) ?? null)
    item.onClick(() => {
      if (!serverDeleteSource.value?.facts(row.id)?.canWrite) return
      deletingSnapshot.value = row
      deleting.value = row.id
    })
    if (!designDeleteSource.value)
      void ui.value
        .serverDeleteFacts(row.id)
        .then((facts) => {
          deleteFacts.value[row.id] = facts
          configure(facts)
        })
        .catch((error) => {
          delete deleteFacts.value[row.id]
          configure(null)
          new Notice(connectionError(error, false, settingsSyncText))
        })
  })
  menu.showAtMouseEvent(event)
}
async function act(id: string, action: () => Promise<void>) {
  if (busy.value.has(id)) return
  busy.value.add(id)
  try {
    await action()
    delete errors.value[id]
  } catch (error) {
    errors.value[id] = connectionError(error, false, settingsSyncText)
  } finally {
    busy.value.delete(id)
  }
}
function openFile(path: string) {
  if (ui.value)
    void ui.value
      .openFile(path)
      .catch(() => new Notice(t('settings.SyncSettings.the_file_could_not_be.accad798')))
}
let active = true
onUnmounted(() => {
  active = false
})
onMounted(() => {
  void ui.value?.refreshReviews().catch(() => {
    if (active) new Notice(t('settings.SyncSettings.incoming_changes_could_not_be.24745c6e'))
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
