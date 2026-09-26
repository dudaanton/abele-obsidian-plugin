<template>
  <div class="abele-sync-settings">
    <ConnectCard v-if="!connected" :server-url="device.serverUrl" />

    <template v-else>
      <Section
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
          <Button
            text="Sync now"
            accent
            tooltip="Send and fetch everything outstanding, without waiting for a trigger"
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
            tooltip="Walk the whole vault again and sync whatever this device is now missing"
            @click="rescan"
          />
        </Setting>

        <Setting
          name="Stop syncing this device"
          desc="Disconnect forgets the server and the device token, and keeps your files and what this device syncs. Forget also throws away the record of what has already been synced."
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

      <SelectiveSync />

      <VaultPolicy />

      <UsageCard />
    </template>

    <ConfirmModal
      v-if="confirming === 'disconnect'"
      title="Disconnect this device?"
      message="This device stops syncing and forgets its token. Not one file is deleted, here or on the server, and what this device syncs is remembered for when you connect again."
      confirm-text="Disconnect"
      confirm-tooltip="Stop syncing and forget the token"
      cancel-tooltip="Close this and keep syncing"
      @confirm="disconnect"
      @close="confirming = null"
    />

    <ConfirmModal
      v-if="confirming === 'forget'"
      title="Forget this device's sync state?"
      message="This device disconnects and throws away its record of what has already been synced. No file is deleted in the vault or on the server — the next connect walks the whole vault again instead of picking up where this one left off."
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
 * is set up gets four sections: what it is doing, what of the vault it takes, the vault's own
 * policy, and how much room that vault is using.
 *
 * The status is the service's own ref, so this screen redraws as the engine moves without
 * polling anything — and which of the two screens shows is read off it too. Anything but
 * `disconnected` is a device somebody set up: an engine that failed to build is `error`, and
 * that screen is the one that says why, where the sign-in card would only ask again.
 */
import { computed, onUnmounted, ref } from 'vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import ConnectCard from './sync/ConnectCard.vue'
import SelectiveSync from './sync/SelectiveSync.vue'
import VaultPolicy from './sync/VaultPolicy.vue'
import UsageCard from './sync/UsageCard.vue'
import { SyncService } from '@/sync/SyncService'
import { STATUS_LABEL } from '@/sync/status'
import { formatWhen } from '@/sync/format'

const sync = SyncService.getInstance()

/**
 * What this screen says about the device: its connection, which the service holds as a ref and
 * rewrites whole on every change. A Pause pressed mid-sync shows at once — the engine does not
 * publish `paused` until the run in flight has finished, but the connection says it the moment
 * the button is pressed.
 */
const device = sync.connection
const status = sync.status
const connected = computed(() => status.value.state !== 'disconnected')
const confirming = ref<'disconnect' | 'forget' | null>(null)

// A sign-in that was never followed by a vault holds an account token; closing the tab ends it.
onUnmounted(() => sync.endConnect())

const statusLabel = computed(() => STATUS_LABEL[status.value.state])

const statusDesc = computed(() => `Last synced ${formatWhen(status.value.lastSyncAt)}.`)

const pendingDesc = computed(() =>
  status.value.pending === 0
    ? 'Nothing is waiting to be sent.'
    : `${status.value.pending} ${status.value.pending === 1 ? 'change is' : 'changes are'} waiting to be sent.`
)

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

async function disconnect(): Promise<void> {
  await sync.disconnect()
}

async function forget(): Promise<void> {
  await sync.forget()
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
