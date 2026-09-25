<template>
  <Section
    title="Synced keys"
    desc="Every API key and token kept in one encrypted store that syncs with the plugin's settings. Each device needs only the passphrase, typed once. Without it the store is unreadable, on any device and in any copy of the settings file."
  >
    <Setting name="Status" :desc="statusDesc">
      <Badge :text="statusLabel" :color="statusColor" />
    </Setting>

    <Setting
      name="All keys"
      desc="Every key the plugin uses on this device: what it is for, whether it is synced, and a way to show or copy it."
    >
      <Button text="Show" tooltip="List every key on this device" @click="listing = true" />
    </Setting>
    <SecretsListModal v-if="listing" @close="listing = false" />

    <!-- Off: make one -->
    <template v-if="status === 'off'">
      <template v-if="form === 'create'">
        <Setting
          name="Passphrase"
          desc="At least 8 characters. Typed on every device that should have the keys; nothing can recover it."
        >
          <Input v-model="passphrase" password placeholder="Passphrase" />
        </Setting>
        <Setting name="Repeat the passphrase" :desc="repeatDesc">
          <Input v-model="repeat" password placeholder="Passphrase again" />
        </Setting>
        <Setting :name="`Keys moving into the store: ${pluginKeyCount}`">
          <Button text="Cancel" tooltip="Close this and change nothing" @click="closeForm" />
          <Button
            text="Turn on"
            accent
            :disabled="!newPassphraseOk || busy"
            tooltip="Encrypt this device's keys into the store and sync them"
            @click="enable"
          />
        </Setting>
      </template>
      <Setting
        v-else
        name="Turn on"
        desc="Moves the keys this device has into the store, under a passphrase you choose."
      >
        <Button
          text="Set up"
          accent
          tooltip="Choose a passphrase for the synced keys"
          @click="openForm('create')"
        />
      </Setting>
    </template>

    <!-- A store this device cannot open: locked, or its passphrase moved on -->
    <template v-if="status === 'locked' || status === 'stale'">
      <Setting name="Passphrase" :desc="unlockDesc">
        <Input v-model="passphrase" password placeholder="Passphrase" />
      </Setting>
      <Setting name="Unlock on this device">
        <Button
          text="Unlock"
          accent
          :disabled="!passphrase || busy"
          tooltip="Open the store here and put its keys in this device's keychain"
          @click="unlock"
        />
      </Setting>
    </template>

    <!-- Open here -->
    <template v-if="status === 'unlocked'">
      <template v-if="form === 'change'">
        <Setting
          name="New passphrase"
          desc="Every other device asks for it once, the next time the settings reach it."
        >
          <Input v-model="passphrase" password placeholder="New passphrase" />
        </Setting>
        <Setting name="Repeat the new passphrase" :desc="repeatDesc">
          <Input v-model="repeat" password placeholder="New passphrase again" />
        </Setting>
        <Setting name="Change the passphrase">
          <Button text="Cancel" tooltip="Close this and change nothing" @click="closeForm" />
          <Button
            text="Change"
            accent
            :disabled="!newPassphraseOk || busy"
            tooltip="Encrypt the store again under the new passphrase"
            @click="change"
          />
        </Setting>
      </template>
      <Setting
        v-else
        name="Change passphrase"
        desc="The keys are encrypted again. Other devices keep working with their keys, and ask for the new passphrase."
      >
        <Button text="Change" tooltip="Choose a new passphrase" @click="openForm('change')" />
      </Setting>

      <Setting
        name="Remove from this device"
        desc="The passphrase and every key in the store leave this device. The store and other devices keep them; unlock again to get them back."
      >
        <Button
          text="Remove"
          warning
          tooltip="Take the synced keys off this device"
          @click="confirming = 'lock'"
        />
      </Setting>

      <Setting
        name="Turn off"
        desc="The store leaves the settings. Every device that was unlocked keeps its keys in its own keychain; any other device will need them entered by hand."
      >
        <Button
          text="Turn off"
          warning
          tooltip="Stop syncing keys, keeping them on each device"
          @click="confirming = 'disable'"
        />
      </Setting>
    </template>

    <!-- Damaged: nobody can open it, so the one way on is a new one -->
    <Setting
      v-if="status === 'damaged' || status === 'locked' || status === 'stale'"
      name="Start over"
      desc="Removes the store from the settings on every device, for a new one with a new passphrase. The keys this device has stay here."
    >
      <Button
        text="Start over"
        warning
        tooltip="Remove the synced keys from the settings"
        @click="confirming = 'discard'"
      />
    </Setting>

    <ConfirmModal
      v-if="confirming === 'lock'"
      title="Remove the synced keys from this device"
      :message="`The passphrase and the ${keysText} in the store leave this device's keychain. Features using them stop working here until it is unlocked again.`"
      confirm-text="Remove"
      confirm-tooltip="Take the synced keys off this device"
      @confirm="lock"
      @close="confirming = null"
    />
    <ConfirmModal
      v-if="confirming === 'disable'"
      title="Turn off synced keys"
      message="The store leaves the settings on every device. Devices that were unlocked keep their keys; a new device will not get them."
      confirm-text="Turn off"
      confirm-tooltip="Stop syncing keys, keeping them on each device"
      @confirm="disable"
      @close="confirming = null"
    />
    <ConfirmModal
      v-if="confirming === 'discard'"
      title="Start over"
      message="The store is removed from the settings on every device, with every key in it that no device holds. This device's own keys stay."
      confirm-text="Start over"
      confirm-tooltip="Remove the synced keys from the settings"
      @confirm="discard"
      @close="confirming = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import SecretsListModal from './SecretsListModal.vue'
import type { KitColor } from '@/constants/colors'
import { secrets } from '@/secrets/SecretStore'
import { pluginSecretIds } from '@/secrets/host'

/** Short enough to type on a phone, long enough that a guess is not a matter of minutes. */
const MIN_PASSPHRASE = 8

const store = secrets()
const status = computed(() => store.status.value)
const count = computed(() => {
  void store.version.value
  return store.count()
})

const form = ref<'create' | 'change' | null>(null)
const passphrase = ref('')
const repeat = ref('')
const busy = ref(false)
const listing = ref(false)
const confirming = ref<'lock' | 'disable' | 'discard' | null>(null)
/** Said under the unlock field after a passphrase that does not open the store. */
const refused = ref(false)

// Whatever was typed goes when the state it was typed for does.
watch(status, () => {
  passphrase.value = ''
  repeat.value = ''
  form.value = null
  refused.value = false
})
watch(passphrase, () => {
  refused.value = false
})

const keysText = computed(() => `${count.value} ${count.value === 1 ? 'key' : 'keys'}`)

const pluginKeyCount = computed(() => pluginSecretIds().filter((id) => secrets().get(id)).length)

const LABELS: Record<string, { label: string; color: KitColor; desc: string }> = {
  off: {
    label: 'Off',
    color: 'grey',
    desc: 'Each device keeps its own keys, entered on that device.',
  },
  locked: {
    label: 'Locked on this device',
    color: 'orange',
    desc: 'Another device keeps keys in the store. Enter its passphrase to have them here too.',
  },
  unlocked: {
    label: 'Unlocked on this device',
    color: 'green',
    desc: '',
  },
  stale: {
    label: 'Out of date',
    color: 'orange',
    desc: 'The passphrase was changed on another device. Keys already here keep working; enter the new passphrase to get changes again.',
  },
  damaged: {
    label: 'Damaged',
    color: 'red',
    desc: 'The store in the settings file cannot be decrypted, though this device has the right passphrase: the file was changed by something other than the plugin. Keys already on this device keep working.',
  },
}

const statusLabel = computed(() => LABELS[status.value].label)
const statusColor = computed(() => LABELS[status.value].color)
const statusDesc = computed(() =>
  status.value === 'unlocked'
    ? `${keysText.value} in the store. A key added or changed anywhere in the plugin goes into it and reaches your other devices with the settings.`
    : LABELS[status.value].desc
)

const unlockDesc = computed(() =>
  refused.value
    ? 'That passphrase does not open the store.'
    : status.value === 'stale'
      ? 'The new passphrase, as set on the other device.'
      : 'The passphrase chosen when synced keys were turned on.'
)

const newPassphraseOk = computed(
  () => passphrase.value.length >= MIN_PASSPHRASE && passphrase.value === repeat.value
)
const repeatDesc = computed(() =>
  repeat.value && repeat.value !== passphrase.value
    ? 'The two do not match.'
    : passphrase.value && passphrase.value.length < MIN_PASSPHRASE
      ? `At least ${MIN_PASSPHRASE} characters.`
      : ''
)

const openForm = (which: 'create' | 'change') => {
  passphrase.value = ''
  repeat.value = ''
  form.value = which
}

const closeForm = () => {
  passphrase.value = ''
  repeat.value = ''
  form.value = null
}

/** Runs one of the store's operations with the buttons held, and says if it failed. */
async function run(action: () => Promise<void>, failed: string): Promise<void> {
  busy.value = true
  try {
    await action()
  } catch (e) {
    console.error(`[Abele] ${failed}`, (e as Error)?.message)
    new Notice(`${failed}.`)
  } finally {
    busy.value = false
  }
}

const enable = () =>
  run(async () => {
    await store.enable(passphrase.value)
    new Notice(`Synced keys are on: ${store.count()} keys in the store.`)
  }, 'Synced keys could not be turned on')

const unlock = () =>
  run(async () => {
    if (!(await store.unlock(passphrase.value))) {
      refused.value = true
      return
    }
    new Notice(`Unlocked: ${store.count()} keys on this device.`)
  }, 'The store could not be unlocked')

const change = () =>
  run(async () => {
    await store.changePassphrase(passphrase.value)
    closeForm()
    new Notice('The passphrase is changed. Other devices will ask for it.')
  }, 'The passphrase could not be changed')

const lock = () => run(() => store.lock(), 'The keys could not be removed from this device')
const disable = () => run(() => store.disable(), 'Synced keys could not be turned off')
const discard = () => run(() => store.discard(), 'The store could not be removed')
</script>
