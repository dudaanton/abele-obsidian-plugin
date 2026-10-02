<template>
  <div class="abele-sync-settings">
    <ConnectCard v-if="!connected" :server-url="device.serverUrl" />
    <OwnerPublicationSettings />

    <template v-else>
      <!--
        A connection a transfer brought, onto a vault that may hold files, into one that may hold
        files too: nothing syncs until the join question is answered. The dialog opens by itself;
        this is where it is found again after it was closed.
      -->
      <Section
        v-if="joining"
        title="Choose how to join"
        desc="This device is connected, and waits for one answer before it syncs anything."
      >
        <Setting name="Vault" desc="The vault on the server this device was connected to.">
          <span class="abele-sync-settings__value">{{ device.vaultName || device.vaultId }}</span>
        </Setting>

        <Setting name="Not syncing yet" :desc="joinDesc">
          <Button
            text="Choose…"
            accent
            :disabled="joinBusy"
            tooltip="Say how this vault's files are joined with the server's"
            @click="askJoin"
          />
        </Setting>

        <Setting
          name="Stop syncing this device"
          desc="Disconnect tells the server to stop accepting this device and forgets its token; your files are not touched."
        >
          <Button
            text="Disconnect"
            warning
            tooltip="Leave this vault instead of joining it"
            @click="confirming = 'disconnect'"
          />
        </Setting>
      </Section>

      <Section
        v-else
        title="This device"
        desc="Where it syncs, what it is called there, and what it is doing right now."
      >
        <Setting name="Status" :desc="statusDesc">
          <Badge :text="statusLabel" :accent="status.state === 'syncing'" />
        </Setting>

        <!--
          Plain text rather than a `Badge`: a badge never wraps and never shrinks, and a server
          address, a vault id and a device name are all long enough to push a phone-width pane
          sideways. The badge is kept for the one thing it is for — a short status word.
        -->
        <Setting name="Server" desc="The address this device enrolled against.">
          <span class="abele-sync-settings__value">{{ device.serverUrl }}</span>
        </Setting>

        <Setting name="Vault" desc="The vault on that server this device belongs to.">
          <span class="abele-sync-settings__value">{{ device.vaultId }}</span>
        </Setting>

        <Setting name="This device" desc="What the vault's device list calls it.">
          <span class="abele-sync-settings__value">{{ device.deviceName }}</span>
        </Setting>

        <Setting v-if="status.lastError" name="Last failure" :desc="status.lastError">
          <Badge text="Error" />
        </Setting>

        <Setting name="Sync" :desc="pendingDesc">
          <!--
            Not offered while paused: the switch says nothing moves until Resume, and a button
            beside it that moved files anyway would make the switch a lie.
          -->
          <Button
            text="Sync now"
            :accent="!device.paused"
            :disabled="device.paused"
            :tooltip="
              device.paused
                ? 'Sync is paused; press Resume to sync this device'
                : 'Send and fetch everything outstanding, without waiting for a trigger'
            "
            @click="syncNow"
          />
          <Button
            v-if="device.paused"
            text="Resume"
            tooltip="Start syncing this device again"
            @click="resume"
          />
          <Button
            v-else
            text="Pause"
            tooltip="Stop syncing until you resume it; nothing is deleted"
            @click="pause"
          />
          <Button
            text="Rescan"
            :disabled="device.paused"
            :tooltip="
              device.paused
                ? 'Sync is paused; press Resume to sync this device'
                : 'Walk the whole vault again and sync whatever this device is now missing'
            "
            @click="rescan"
          />
        </Setting>

        <Setting
          name="Stop syncing this device"
          desc="Disconnect tells the server to stop accepting this device and forgets its token; your files and what this device syncs are kept. Forget also throws away the record of what has already been synced."
        >
          <Button
            text="Disconnect"
            warning
            tooltip="Stop syncing and forget how to reach the server"
            @click="confirming = 'disconnect'"
          />
          <Button
            text="Forget"
            warning
            tooltip="Disconnect and throw away what this device remembered about the vault"
            @click="confirming = 'forget'"
          />
        </Setting>
      </Section>

      <!--
        Many files deleted at once on this device, held back until somebody decides. The dialog
        asks once per new hold; this is where the question stays for as long as it lasts.
      -->
      <Section v-if="held.length > 0" title="Deletions held back">
        <HeldDeletesBlock :held="held" />
      </Section>

      <!--
        Obsidian settings changed on another device, staged until somebody says what to do with
        them. The dialog asks once per batch; this is where they wait after Later.
      -->
      <Section
        v-if="staged.length > 0 || stagedWritten.length > 0"
        :title="`Settings waiting (${staged.length})`"
      >
        <StagedSettingsBlock :changes="staged" :names="stagedNames" apply-text="Apply and reload" />
      </Section>

      <Section v-if="stagedCode.length" :title="`Plugin code waiting (${stagedCode.length})`">
        <Setting
          name="Review plugin code"
          desc="New or changed plugins need their own confirmation before installation."
        >
          <Button
            text="Review plugin code"
            tooltip="Open the separate plugin code confirmation"
            @click="sync.codePrompt.ask()"
          />
        </Setting>
      </Section>

      <SelectiveSync />

      <template v-if="!joining">
        <DeviceList />

        <VaultPolicy />

        <UsageCard />
      </template>
    </template>

    <Section v-if="!connected && stagedWritten.length > 0" title="Applied settings awaiting reload">
      <StagedSettingsBlock :changes="[]" :names="stagedNames" />
    </Section>

    <!-- Keyed by the question: see ConnectCard's. -->
    <JoinVaultModal
      v-if="joinAsking"
      :key="joinAsked"
      :question="joinAsking"
      :busy="joinBusy"
      :error="joinError"
      @connect="answerJoin($event.prefer)"
      @close="closeJoin"
    />

    <!--
      A Disconnect that could not reach the server: the token is kept to tell it later, and this
      is where the person sees that and may stop waiting. Shown on either screen — a device that
      left one vault offline and joined another is still waiting to tell the first. One on plain
      http to another machine is never told, and says so.
    -->
    <Setting
      v-for="entry in device.pendingRevoke"
      :key="entry.tokenId"
      :name="entry.plainHttp ? 'Cannot tell the server' : 'Waiting to tell the server'"
      :desc="pendingLine(entry)"
    >
      <Button
        text="Forget without telling the server"
        warning
        tooltip="Stop trying, and forget the token kept to tell the server with"
        @click="forgetting = entry"
      />
    </Setting>

    <ConfirmModal
      v-if="forgetting"
      title="Forget without telling the server?"
      :message="forgetMessage"
      confirm-text="Forget"
      confirm-tooltip="Forget the kept token; the server is not told"
      cancel-tooltip="Close this and keep the token to tell the server with"
      @confirm="forgetPending"
      @close="forgetting = null"
    />

    <ConfirmModal
      v-if="confirming === 'disconnect'"
      title="Disconnect this device?"
      message="The server will stop accepting this device. Connecting again needs the password. Files are not touched."
      confirm-text="Disconnect"
      confirm-tooltip="Stop syncing, and have the server stop accepting this device"
      cancel-tooltip="Close this and keep syncing"
      @confirm="disconnect"
      @close="confirming = null"
    />

    <ConfirmModal
      v-if="confirming === 'forget'"
      title="Forget this device's sync state?"
      message="The server will stop accepting this device. Connecting again needs the password. This device also throws away its record of what has already been synced. No file is deleted in the vault or on the server — the next connect walks the whole vault again instead of picking up where this one left off."
      confirm-text="Forget"
      confirm-tooltip="Disconnect and drop the record of what was synced"
      cancel-tooltip="Close this and keep the record"
      @confirm="forget"
      @close="confirming = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * The Sync tab.
 *
 * Two screens, really. A device nobody has set up gets the connect card and nothing else,
 * because none of the rest has anything to say about a vault it cannot reach. A device that
 * is set up gets five sections: what it is doing, what of the vault it takes, the devices that
 * sync the vault, the vault's own policy, and how much room that vault is using.
 *
 * The status is the service's own ref, so this screen redraws as the engine moves without
 * polling anything — and which of the two screens shows is read off it too. Anything but
 * `disconnected` is a device somebody set up: an engine that failed to build is `error`, and
 * that screen is the one that says why, where the sign-in card would only ask again.
 *
 * `joining` is a device a transfer connected to a vault, still to be told which side wins where
 * both hold a file (phase 3b, decision 7). It builds no engine until then, so the screen asks —
 * the join dialog opens by itself — and offers what makes sense before a first sync: what this
 * device takes, and leaving instead. The vault's policy and usage wait for an engine to ask with.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { JoinPrefer } from '@abele/sync-protocol'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import ConnectCard from './sync/ConnectCard.vue'
import SelectiveSync from './sync/SelectiveSync.vue'
import VaultPolicy from './sync/VaultPolicy.vue'
import DeviceList from './sync/DeviceList.vue'
import UsageCard from './sync/UsageCard.vue'
import OwnerPublicationSettings from './sync/OwnerPublicationSettings.vue'
import JoinVaultModal from './sync/JoinVaultModal.vue'
import HeldDeletesBlock from '../sync/HeldDeletesBlock.vue'
import StagedSettingsBlock from '../sync/StagedSettingsBlock.vue'
import type { JoinQuestion } from '@/sync/join'
import { Notice } from 'obsidian'
import { SyncService } from '@/sync/SyncService'
import type { PendingRevoke } from '@/sync/connection'
import { changesAre, statusLabel as labelOf } from '@/sync/status'
import { formatWhen, reasonOf } from '@/sync/format'

const sync = SyncService.getInstance()

/**
 * What this screen says about the device: its connection, which the service holds as a ref and
 * rewrites whole on every change. A Pause pressed mid-sync shows at once — the engine does not
 * publish `paused` until the run in flight has finished, but the connection says it the moment
 * the button is pressed.
 */
const device = sync.connection
const status = sync.status
/** What the engine holds back after many files went at once (`HeldDeletesPrompt`). */
const held = sync.heldPrompt.held
/** Settings changed on another device, waiting for Apply or Keep (`StagedSettingsPrompt`). */
const stagedCode = sync.codePrompt.staged
const staged = sync.settingsPrompt.staged
const stagedNames = sync.settingsPrompt.names
const stagedWritten = computed(() => sync.settingsPrompt.appliedWaiting?.value ?? [])
const connected = computed(() => status.value.state !== 'disconnected')
const confirming = ref<'disconnect' | 'forget' | null>(null)
/** The waiting revoke whose kept token the person asked to forget, while that is asked. */
const forgetting = ref<PendingRevoke | null>(null)

const who = (entry: PendingRevoke): string => entry.deviceName || entry.deviceId

/** What a waiting revoke's line says: who left where, since when, and what forgetting leaves. */
function pendingLine(entry: PendingRevoke): string {
  const since = `Since ${formatWhen(entry.since)}.`
  if (entry.plainHttp) {
    return (
      `${who(entry)} left ${entry.serverUrl}, which cannot be told over plain http: the token ` +
      `is not sent that way. The server there still has ${who(entry)} enrolled. ${since}`
    )
  }
  return (
    `The server has not been told that ${who(entry)} left ${entry.serverUrl}. It will be ` +
    `retried. ${since}`
  )
}

const forgetMessage = computed(() => {
  const entry = forgetting.value
  if (entry === null) return ''
  return (
    `${who(entry)} stays enrolled on ${entry.serverUrl}: anyone holding a copy of its token can ` +
    'still sync that vault until it is revoked there, under Devices on this vault on any device ' +
    'that still syncs it. This device forgets the token ' +
    'it kept to tell the server with.'
  )
})

function forgetPending(): void {
  const entry = forgetting.value
  forgetting.value = null
  if (entry !== null) sync.forgetPendingRevoke(entry.tokenId)
}

// A sign-in that was never followed by a vault holds an account token; closing the tab ends it.
onUnmounted(() => sync.endConnect())

// A device left while the server could not be reached: opening the tab is a moment to try again.
onMounted(() => void sync.retryPendingRevokes())

const joining = computed(() => status.value.state === 'joining')
/** The join question, while its dialog is open. */
const joinAsking = ref<JoinQuestion | null>(null)
/** Numbers each question asked, for the dialog's key. */
const joinAsked = ref(0)
const joinBusy = ref(false)
const joinError = ref<string | null>(null)

const joinDesc = computed(
  () =>
    joinError.value ??
    `Choose which copy is kept where this vault and ${device.value.vaultName || 'the server'} ` +
      'both have a file. Nothing syncs until you do.'
)

/** Count both sides and open the join dialog. A count that fails says why on the row. */
async function askJoin(): Promise<void> {
  if (joinBusy.value) return
  joinBusy.value = true
  joinError.value = null
  try {
    joinAsking.value = await sync.joinQuestion()
    joinAsked.value++
  } catch (error) {
    joinError.value = `The join could not be prepared: ${reasonOf(error)}`
  } finally {
    joinBusy.value = false
  }
}

/** The dialog answered: the engine is built on the answer, and the dialog closes. */
async function answerJoin(prefer: JoinPrefer | null | undefined): Promise<void> {
  if (joinBusy.value) return
  joinBusy.value = true
  joinError.value = null
  try {
    await sync.answerJoin(prefer)
    joinAsking.value = null
  } catch (error) {
    joinError.value = reasonOf(error)
  } finally {
    joinBusy.value = false
  }
}

/**
 * The dialog closed: let go of it at once, busy or not — Obsidian closes it whatever this tab
 * thinks. An answer already under way goes on, and a failure shows on the row.
 */
function closeJoin(): void {
  joinAsking.value = null
  if (joinBusy.value) return
  joinError.value = null
}

// The question asks itself as soon as the tab shows a join waiting, and again whenever one
// arrives while it is open — a transfer applied in the meantime.
watch(joining, (waiting) => (waiting ? void askJoin() : closeJoin()), { immediate: true })

const statusLabel = computed(() => labelOf(status.value))

const statusDesc = computed(() => `Last synced ${formatWhen(status.value.lastSyncAt)}.`)

/**
 * During a sync the number is what its scan found, not what is left — the engine does not count
 * it down — so it is said as that. Outside one it is what the last push kept back for the next.
 */
const pendingDesc = computed(() => {
  const { state, pending } = status.value
  if (pending === 0) return 'Nothing is waiting to be sent.'
  if (state === 'syncing') {
    return `Sending the ${pending === 1 ? 'change' : `${pending} changes`} this sync found.`
  }
  return `${changesAre(pending)} waiting to be sent.`
})

const syncNow = (): void => {
  void sync.syncNow()
}

const rescan = (): void => {
  void sync.rescan()
}

function pause(): void {
  sync.pause()
}

function resume(): void {
  sync.resume()
}

/** A Disconnect can be refused — the keychain would not keep the token — and says why. */
async function disconnect(): Promise<void> {
  try {
    await sync.disconnect()
  } catch (error) {
    new Notice(`Not disconnected: ${reasonOf(error)}`)
  }
}

async function forget(): Promise<void> {
  try {
    await sync.forget()
  } catch (error) {
    new Notice(`Not forgotten: ${reasonOf(error)}`)
  }
}
</script>

<style lang="scss">
/**
 * A server address, a vault id and a device name are each long enough to outgrow a settings
 * pane on a phone, and none of them has a space to break at. Breaking anywhere is what keeps
 * the tab from scrolling sideways; the monospace face is because two of the three are ids, and
 * an id is read character by character.
 */
.abele-sync-settings__value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
</style>
