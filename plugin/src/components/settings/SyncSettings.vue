<template>
  <div class="abele-sync-settings">
    <ConnectCard v-if="!connected" :server-url="settings.serverUrl" @connected="onConnected" />

    <template v-else>
      <Section
        title="This device"
        desc="Where it syncs, what it is called there, and what it is doing right now."
      >
        <Setting name="Status" :desc="statusDesc">
          <Badge :text="statusLabel" :accent="status.state === 'syncing'" />
        </Setting>

        <Setting name="Server" desc="The address this device enrolled against.">
          <Badge :text="settings.serverUrl" />
        </Setting>

        <Setting name="Vault" desc="The vault on that server this device belongs to.">
          <Badge :text="settings.vaultId" />
        </Setting>

        <Setting name="This device" desc="What the vault's device list calls it.">
          <Badge :text="settings.deviceName" />
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
            v-if="settings.paused"
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
 * polling anything. `connected` is a ref rather than a computed over `isConnected()`: that is
 * a method on a service, not reactive state, so it is read when the screen opens and again
 * whenever something here changes it.
 */
import { computed, ref } from 'vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import ConnectCard from './sync/ConnectCard.vue'
import SelectiveSync from './sync/SelectiveSync.vue'
import VaultPolicy from './sync/VaultPolicy.vue'
import UsageCard from './sync/UsageCard.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { STATUS_LABEL } from '@/sync/status'
import { formatWhen } from '@/sync/format'

const sync = SyncService.getInstance()

const settings = computed(() => AbeleConfig.getInstance().sync)
const status = sync.status
const connected = ref(sync.isConnected())
const confirming = ref<'disconnect' | 'forget' | null>(null)

const statusLabel = computed(() => STATUS_LABEL[status.value.state])

const statusDesc = computed(() => `Last synced ${formatWhen(status.value.lastSyncAt)}.`)

const pendingDesc = computed(() =>
  status.value.pending === 0
    ? 'Nothing is waiting to be sent.'
    : `${status.value.pending} ${status.value.pending === 1 ? 'change is' : 'changes are'} waiting to be sent.`
)

function onConnected(): void {
  connected.value = sync.isConnected()
}

const syncNow = (): void => {
  void sync.syncNow()
}

const rescan = (): void => {
  void sync.rescan()
}

const pause = (): void => sync.pause()

const resume = (): void => sync.resume()

async function disconnect(): Promise<void> {
  await sync.disconnect()
  connected.value = sync.isConnected()
}

async function forget(): Promise<void> {
  await sync.forget()
  connected.value = sync.isConnected()
}
</script>
