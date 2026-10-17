<template>
  <Section
    :title="t('settings.SecretStoreSettings.synced_keys.a764d83d')"
    :desc="t('settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab')"
  >
    <Setting :name="t('settings.SecretStoreSettings.status.920e413c')" :desc="statusDesc">
      <Badge :text="statusLabel" :color="statusColor" />
    </Setting>

    <Setting
      :name="t('settings.SecretStoreSettings.all_keys.9e5c5da4')"
      :desc="t('settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da')"
    >
      <Button
        :text="t('settings.SecretStoreSettings.show.0df6f1ca')"
        :tooltip="t('settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1')"
        @click="listing = true"
      />
    </Setting>
    <SecretsListModal v-if="listing" @close="listing = false" />

    <!-- Off: make one -->
    <template v-if="status === 'off'">
      <template v-if="form === 'create'">
        <Setting
          :name="t('settings.SecretStoreSettings.passphrase.e7611f05')"
          :desc="t('settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e')"
        >
          <Input
            v-model="passphrase"
            password
            :placeholder="t('settings.SecretStoreSettings.passphrase.e7611f05')"
          />
        </Setting>
        <Setting
          :name="t('settings.SecretStoreSettings.repeat_the_passphrase.4b93336c')"
          :desc="repeatDesc"
        >
          <Input
            v-model="repeat"
            password
            :placeholder="t('settings.SecretStoreSettings.passphrase_again.47b97578')"
          />
        </Setting>
        <Setting
          :name="
            t('settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573', {
              value0: String(pluginKeyCount),
            })
          "
        >
          <Button
            :text="t('settings.SecretStoreSettings.cancel.19766ed6')"
            :tooltip="t('settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492')"
            @click="closeForm"
          />
          <Button
            :text="t('settings.SecretStoreSettings.turn_on.5a1f096a')"
            accent
            :disabled="!newPassphraseOk || busy"
            :tooltip="t('settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24')"
            @click="enable"
          />
        </Setting>
      </template>
      <Setting
        v-else
        :name="t('settings.SecretStoreSettings.turn_on.5a1f096a')"
        :desc="t('settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910')"
      >
        <Button
          :text="t('settings.SecretStoreSettings.set_up.4da10f1f')"
          accent
          :tooltip="t('settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b')"
          @click="openForm('create')"
        />
      </Setting>
    </template>

    <!-- A store this device cannot open: locked, or its passphrase moved on -->
    <template v-if="status === 'locked' || status === 'stale'">
      <Setting :name="t('settings.SecretStoreSettings.passphrase.e7611f05')" :desc="unlockDesc">
        <Input
          v-model="passphrase"
          password
          :placeholder="t('settings.SecretStoreSettings.passphrase.e7611f05')"
        />
      </Setting>
      <Setting :name="t('settings.SecretStoreSettings.unlock_on_this_device.ec7699b7')">
        <Button
          :text="t('settings.SecretStoreSettings.unlock.4ac709aa')"
          accent
          :disabled="!passphrase || busy"
          :tooltip="t('settings.SecretStoreSettings.open_the_store_here_and.879288fd')"
          @click="unlock"
        />
      </Setting>
    </template>

    <!-- Open here -->
    <template v-if="status === 'unlocked'">
      <template v-if="form === 'change'">
        <Setting
          :name="t('settings.SecretStoreSettings.new_passphrase.5cc14549')"
          :desc="t('settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e')"
        >
          <Input
            v-model="passphrase"
            password
            :placeholder="t('settings.SecretStoreSettings.new_passphrase.5cc14549')"
          />
        </Setting>
        <Setting
          :name="t('settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be')"
          :desc="repeatDesc"
        >
          <Input
            v-model="repeat"
            password
            :placeholder="t('settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb')"
          />
        </Setting>
        <Setting :name="t('settings.SecretStoreSettings.change_the_passphrase.a9a3e51b')">
          <Button
            :text="t('settings.SecretStoreSettings.cancel.19766ed6')"
            :tooltip="t('settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492')"
            @click="closeForm"
          />
          <Button
            :text="t('settings.SecretStoreSettings.change.c0bf75bd')"
            accent
            :disabled="!newPassphraseOk || busy"
            :tooltip="t('settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af')"
            @click="change"
          />
        </Setting>
      </template>
      <Setting
        v-else
        :name="t('settings.SecretStoreSettings.change_passphrase.a0ffb851')"
        :desc="t('settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29')"
      >
        <Button
          :text="t('settings.SecretStoreSettings.change.c0bf75bd')"
          :tooltip="t('settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286')"
          @click="openForm('change')"
        />
      </Setting>

      <Setting
        :name="t('settings.SecretStoreSettings.remove_from_this_device.43b9a522')"
        :desc="t('settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0')"
      >
        <Button
          :text="t('settings.SecretStoreSettings.remove.c3812fc4')"
          warning
          :tooltip="t('settings.SecretStoreSettings.take_the_synced_keys_off.537f867f')"
          @click="confirming = 'lock'"
        />
      </Setting>

      <Setting
        :name="t('settings.SecretStoreSettings.turn_off.06f0e210')"
        :desc="t('settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0')"
      >
        <Button
          :text="t('settings.SecretStoreSettings.turn_off.06f0e210')"
          warning
          :tooltip="t('settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d')"
          @click="confirming = 'disable'"
        />
      </Setting>
    </template>

    <!-- Damaged: nobody can open it, so the one way on is a new one -->
    <Setting
      v-if="status === 'damaged' || status === 'locked' || status === 'stale'"
      :name="t('settings.SecretStoreSettings.start_over.5eed7e9f')"
      :desc="t('settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f')"
    >
      <Button
        :text="t('settings.SecretStoreSettings.start_over.5eed7e9f')"
        warning
        :tooltip="t('settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2')"
        @click="confirming = 'discard'"
      />
    </Setting>

    <ConfirmModal
      v-if="confirming === 'lock'"
      :title="t('settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195')"
      :message="
        t('settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae', {
          value0: String(keysText),
        })
      "
      :confirm-text="t('settings.SecretStoreSettings.remove.c3812fc4')"
      :confirm-tooltip="t('settings.SecretStoreSettings.take_the_synced_keys_off.537f867f')"
      @confirm="lock"
      @close="confirming = null"
    />
    <ConfirmModal
      v-if="confirming === 'disable'"
      :title="t('settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c')"
      :message="t('settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814')"
      :confirm-text="t('settings.SecretStoreSettings.turn_off.06f0e210')"
      :confirm-tooltip="t('settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d')"
      @confirm="disable"
      @close="confirming = null"
    />
    <ConfirmModal
      v-if="confirming === 'discard'"
      :title="t('settings.SecretStoreSettings.start_over.5eed7e9f')"
      :message="t('settings.SecretStoreSettings.the_store_is_removed_from.7d71216a')"
      :confirm-text="t('settings.SecretStoreSettings.start_over.5eed7e9f')"
      :confirm-tooltip="t('settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2')"
      @confirm="discard"
      @close="confirming = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { t } from '@/i18n'
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

/** Synced ciphertext can be guessed offline; new passphrases need at least twelve characters. */
const MIN_PASSPHRASE = 12

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

const keysText = computed(() => settingsCount('key', count.value))

const pluginKeyCount = computed(() => pluginSecretIds().filter((id) => secrets().get(id)).length)

const LABELS: Record<string, { label: string; color: KitColor; desc: string }> = {
  off: {
    label: t('settings.SecretStoreSettings.off.ca7981b4'),
    color: 'grey',
    desc: t('settings.SecretStoreSettings.each_device_keeps_its_own.02c01692'),
  },
  locked: {
    label: t('settings.SecretStoreSettings.locked_on_this_device.e1223c06'),
    color: 'orange',
    desc: t('settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954'),
  },
  unlocked: {
    label: t('settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4'),
    color: 'green',
    desc: '',
  },
  stale: {
    label: t('settings.SecretStoreSettings.out_of_date.c8f1506a'),
    color: 'orange',
    desc: t('settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603'),
  },
  damaged: {
    label: t('settings.SecretStoreSettings.damaged.3604e21d'),
    color: 'red',
    desc: t('settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8'),
  },
}

const statusLabel = computed(() => LABELS[status.value].label)
const statusColor = computed(() => LABELS[status.value].color)
const statusDesc = computed(() =>
  status.value === 'unlocked'
    ? t('settings.SecretStoreSettings.value_in_the_store_a.02db016b', {
        value0: String(keysText.value),
      })
    : LABELS[status.value].desc
)

const unlockDesc = computed(() =>
  refused.value
    ? t('settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8')
    : status.value === 'stale'
      ? t('settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983')
      : t('settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36')
)

const newPassphraseOk = computed(
  () => passphrase.value.length >= MIN_PASSPHRASE && passphrase.value === repeat.value
)
const repeatDesc = computed(() =>
  repeat.value && repeat.value !== passphrase.value
    ? t('settings.SecretStoreSettings.the_two_do_not_match.184006b7')
    : passphrase.value && passphrase.value.length < MIN_PASSPHRASE
      ? t('settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6', {
          value0: String(MIN_PASSPHRASE),
        })
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
    new Notice(
      t('settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86', {
        value0: String(store.count()),
      })
    )
  }, t('settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c'))

const unlock = () =>
  run(async () => {
    if (!(await store.unlock(passphrase.value))) {
      refused.value = true
      return
    }
    new Notice(
      t('settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b', {
        value0: String(store.count()),
      })
    )
  }, t('settings.SecretStoreSettings.the_store_could_not_be.be373a49'))

const change = () =>
  run(async () => {
    await store.changePassphrase(passphrase.value)
    closeForm()
    new Notice(t('settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec'))
  }, t('settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1'))

const lock = () =>
  run(() => store.lock(), t('settings.SecretStoreSettings.the_keys_could_not_be.a70d217b'))
const disable = () =>
  run(() => store.disable(), t('settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f'))
const discard = () =>
  run(() => store.discard(), t('settings.SecretStoreSettings.the_store_could_not_be.76043571'))
</script>
