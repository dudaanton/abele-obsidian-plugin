<template>
  <Section
    title="Devices on this vault"
    desc="Every device of this account that syncs this vault. Revoking one stops it syncing; its files stay on it."
  >
    <EmptyState v-if="devices === null" :text="loadError ?? 'Asking the server for its devices…'" />

    <template v-else>
      <Setting
        v-for="one in devices"
        :key="one.id"
        :name="one.name"
        :desc="lineOf(one)"
        :data-device="one.id"
      >
        <Badge v-if="one.id === ownId" text="This device" accent />
        <Button
          v-else
          text="Revoke"
          warning
          :disabled="busy"
          :tooltip="
            busy
              ? 'Wait: a revoke is under way'
              : `Stop ${one.name} syncing this vault; its files stay on it`
          "
          @click="revoking = one"
        />
      </Setting>

      <p v-if="error !== null" class="abele-device-list__error">{{ error }}</p>
    </template>

    <ConfirmModal
      v-if="revoking"
      :title="`Revoke ${revoking.name}?`"
      :message="confirmMessage"
      confirm-text="Revoke"
      :confirm-tooltip="`Have the server stop accepting ${revoking.name}`"
      cancel-tooltip="Close this; the device goes on syncing"
      @confirm="revoke"
      @close="revoking = null"
    />
  </Section>
</template>

<script setup lang="ts">
/**
 * The devices on this vault, from the server (phase 3b, the ruling after the task-4 review,
 * #2b): every live device of this account that syncs it, asked with this device's own token —
 * no password.
 *
 * This device is marked and has no Revoke: it leaves by Disconnect, which also forgets its token;
 * revoked from here it would keep a token the server no longer takes. Any other device can be
 * revoked — a laptop that was sold, a phone that was lost, or a device made for a transfer nobody
 * applied. It is asked about first, since a device revoked needs the password to come back.
 *
 * Read once when the tab opens and again after a revoke, like the vault's usage: it changes
 * when a device is added or removed, not while one is being looked at. And once more when an
 * engine that was being built as the tab opened — at a start, after a join was answered — is up:
 * until then there is no client to ask, and the section would say "not connected" for good.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import type { DeviceInfo } from '@abele/sync-protocol'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Badge from '../../obsidian/Badge.vue'
import Button from '../../obsidian/Button.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { formatWhen, reasonOf } from '@/sync/format'

const sync = SyncService.getInstance()

/** What each platform is called on a screen. */
const PLATFORM: Record<DeviceInfo['platform'], string> = {
  desktop: 'Desktop',
  mobile: 'Phone or tablet',
  daemon: 'Command-line client',
}

const devices = ref<DeviceInfo[] | null>(null)
const loadError = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)
/** The device a revoke is being asked about. */
const revoking = ref<DeviceInfo | null>(null)

const ownId = computed(() => sync.connection.value.deviceId)

/** "Phone or tablet · enrolled by Mac · last seen 3 minutes ago". */
function lineOf(one: DeviceInfo): string {
  let by = 'enrolled with the account password'
  if (one.enrolled_by !== null) {
    const parent = devices.value?.find((other) => other.id === one.enrolled_by)
    by = parent ? `enrolled by ${parent.name}` : 'enrolled by a device no longer on this vault'
  }
  const seen =
    one.last_seen_at === null ? 'never seen syncing' : `last seen ${formatWhen(one.last_seen_at)}`
  return `${PLATFORM[one.platform] ?? one.platform} · ${by} · ${seen}`
}

const confirmMessage = computed(() => {
  const name = revoking.value?.name ?? ''
  return (
    `${name} stops syncing; its files stay on it. The server stops accepting it at once, and ` +
    `nothing is deleted anywhere. Connecting ${name} again needs the account password.`
  )
})

/** Read the list from the server; on a device with no engine there is no server to ask. */
async function load(): Promise<void> {
  try {
    const listed = await sync.listDevices()
    if (listed === null) {
      devices.value = null
      loadError.value = 'The device list is on the server, and this device is not connected to one.'
      return
    }
    devices.value = listed
    loadError.value = null
  } catch (failure) {
    devices.value = null
    loadError.value = `The devices could not be read: ${reasonOf(failure)}`
  }
}

/** The error code the server answered with, where there was one. */
const codeOf = (failure: unknown): unknown => (failure as { code?: unknown } | null)?.code

async function revoke(): Promise<void> {
  const one = revoking.value
  revoking.value = null
  if (one === null || busy.value) return
  busy.value = true
  error.value = null
  try {
    await sync.revokeDevice(one.id)
    new Notice(`${one.name} was revoked; it no longer syncs this vault.`)
    await load()
  } catch (failure) {
    const code = codeOf(failure)
    if (code === 'not_found') {
      new Notice(`${one.name} was already gone from this vault.`)
      await load()
    } else if (code === 'rate_limited') {
      error.value = `${one.name} was not revoked: the server was asked too often; try again in a minute.`
    } else {
      error.value = `${one.name} was not revoked: ${reasonOf(failure)}`
    }
  } finally {
    busy.value = false
  }
}

/** The states in which no engine runs, so no client can be asked. */
const UNBUILT = new Set(['disconnected', 'joining', 'error'])

watch(
  () => sync.status.value.state,
  (state, before) => {
    if (UNBUILT.has(before) && !UNBUILT.has(state)) void load()
  }
)

onMounted(() => void load())
</script>

<style lang="scss">
.abele-device-list__error {
  margin: 0;
  color: var(--text-error);
  overflow-wrap: anywhere;
}
</style>
