<template>
  <ObsidianModal
    :title="t('settings.KeyDestinationsModal.review_key_destinations.2058c462')"
    modal-class="abele-key-destinations"
    @close="emit('close')"
  >
    <p ref="intro">
      {{ t('settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597') }}
    </p>
    <p role="status">{{ status }}</p>
    <Setting :name="t('settings.KeyDestinationsModal.saved_key.85ec79d9')">
      <Dropdown
        :model-value="choice"
        :aria-label="t('settings.KeyDestinationsModal.saved_key.85ec79d9')"
        :options="keyOptions"
        :disabled="busy"
        @update:model-value="chose"
      />
    </Setting>
    <Setting :name="t('settings.KeyDestinationsModal.recipient_address.454d0391')">
      <Input
        v-model="address"
        :aria-label="t('settings.KeyDestinationsModal.recipient_address.454d0391')"
        :placeholder="t('settings.KeyDestinationsModal.recipient_url.59ef2635')"
        :disabled="busy"
      />
    </Setting>
    <template v-if="choice === 'new'">
      <Setting :name="t('settings.KeyDestinationsModal.new_key_name.0e18145f')">
        <Input
          v-model="name"
          :aria-label="t('settings.KeyDestinationsModal.new_key_name.0e18145f')"
          :disabled="busy"
        />
      </Setting>
      <Setting
        :name="t('settings.KeyDestinationsModal.new_key_value.7a7e9552')"
        :desc="t('settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477')"
      >
        <!-- `type`, not the kit's `password`: that one turns autocomplete off, and a new key
             field says `new-password` so no saved login is offered into it. -->
        <Input
          v-model="value"
          type="password"
          autocomplete="new-password"
          :aria-label="t('settings.KeyDestinationsModal.new_key_value.7a7e9552')"
          :disabled="busy"
        />
      </Setting>
    </template>

    <Section
      v-if="pairs.length"
      :title="t('settings.KeyDestinationsModal.key_permissions.1f24b6b7')"
    >
      <div v-for="pair in pairs" :key="pair.keyId + ' ' + pair.origin" data-key-destination="true">
        <Setting
          :name="pair.name || t('settings.KeyDestinationsModal.saved_key.85ec79d9')"
          :desc="pair.desc"
        >
          <Button
            v-if="pair.allowText"
            :text="pair.allowText"
            :tooltip="
              t('settings.KeyDestinationsModal.let_value_be_sent_to.3057160b', {
                value0: String(pair.name || t('settings.terms.thisKey')),
                value1: String(pair.origin),
              })
            "
            @click="allowPair(pair)"
          />
          <Button
            :text="t('settings.KeyDestinationsModal.remove_key_permission.60713985')"
            :tooltip="
              t('settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd', {
                value0: String(pair.name || t('settings.terms.thisKey')),
                value1: String(pair.origin),
              })
            "
            @click="removePair(pair)"
          />
        </Setting>
      </div>
    </Section>

    <Section
      v-if="pending.length"
      :title="t('settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5')"
    >
      <Setting
        v-for="row in pending"
        :key="row.destination.keyId + ' ' + row.destination.origin"
        :name="row.destination.name"
        :desc="row.desc"
      >
        <Button
          v-if="row.allowText"
          :text="row.allowText"
          :tooltip="
            t('settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2', {
              value0: String(row.destination.name),
              value1: String(row.destination.origin),
            })
          "
          @click="confirmPending(row)"
        />
      </Setting>
    </Section>

    <Section
      v-if="httpOrigins.length"
      :title="t('settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3')"
    >
      <Setting
        v-for="origin in httpOrigins"
        :key="origin"
        :name="origin"
        :desc="t('settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f')"
      >
        <Button
          :text="t('settings.KeyDestinationsModal.remove_http_exception.ae72ff92')"
          :tooltip="
            t('settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28', {
              value0: String(origin),
            })
          "
          @click="removeHttp(origin)"
        />
      </Setting>
    </Section>

    <template #footer>
      <p>{{ summary }}</p>
      <Button
        :text="t('settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc')"
        accent
        :disabled="!canAllow"
        :tooltip="t('settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82')"
        @click="allowForm"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Section from '@/components/obsidian/Section.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  allowKeyRecipient,
  keyConsentError,
  recipientKeys,
  recipientOrigin,
  removeKeyRecipient,
} from '@/secrets/manualConsent'
import { httpOrigin, type Destination } from '@/secrets/DestinationPolicy'
import {
  acceptDestinations,
  destinationAccepted,
  forgetDestination,
  pendingDestinations,
} from '@/secrets/destinations'
import {
  allowedHttpOrigins,
  allowHttpOrigin,
  canAllowHttp,
  checkKeyTransport,
  forgetHttpOrigin,
} from '@/secrets/keyTransport'

/**
 * One recipient decision, with named-key permissions kept visible rather than only transport
 * exceptions: a form to allow a saved (or new) key to an address, then the permissions this
 * device holds, the service destinations still waiting for a yes, and the HTTP exceptions.
 *
 * Opened through `reviewKeyDestinations()`. Answers nothing; `opened` hands the dialog's element
 * to the opener, which gives its callers the shell's elements as before.
 */
const emit = defineEmits<{
  (e: 'opened', modalEl: HTMLElement): void
  (e: 'close'): void
}>()

const UNENCRYPTED = t('settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d')
const PUBLIC_HTTP = t('settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1')

/** Aborts a save still running when the dialog goes, so nothing lands after it is closed. */
const controller = new AbortController()
const address = ref('')
const choice = ref('')
const name = ref('')
const value = ref('')
const status = ref('')
const busy = ref(false)
/**
 * Bumped after every action: the lists below are read from settings and stores that are not
 * reactive, and this is what tells them to be read again.
 */
const revision = ref(0)
const intro = ref<HTMLElement>()

const config = () => AbeleConfig.getInstance()

const keys = computed(() => {
  void revision.value
  return recipientKeys()
})
const keyOptions = computed(() => [
  { value: '', display: t('settings.KeyDestinationsModal.choose_a_key.68bb8fb8') },
  ...keys.value.map((key) => ({
    value: key.id,
    display: key.name || t('settings.KeyDestinationsModal.saved_key.85ec79d9'),
  })),
  { value: 'new', display: t('settings.KeyDestinationsModal.save_a_new_named_key.7982a2de') },
])

const label = computed(() =>
  choice.value === 'new'
    ? name.value.trim()
    : keys.value.find((key) => key.id === choice.value)?.name
)
const checked = computed(() => {
  if (!address.value) return { origin: '', validation: '' }
  try {
    return { origin: recipientOrigin(address.value), validation: '' }
  } catch (error) {
    return { origin: '', validation: keyConsentError(error) }
  }
})
const summary = computed(() => {
  const { origin, validation } = checked.value
  return origin && label.value
    ? `${label.value} → ${origin}${canAllowHttp(origin) ? UNENCRYPTED : ''}${choice.value === 'new' ? t('settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb') : ''}`
    : validation || t('settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0')
})
const canAllow = computed(
  () =>
    !busy.value &&
    !!checked.value.origin &&
    !!label.value &&
    !(choice.value === 'new' && !value.value)
)

interface PairRow extends Destination {
  desc: string
  /** The allow action's label, or null when the pair is allowed or cannot be. */
  allowText: string | null
}
const pairs = computed<PairRow[]>(() => {
  void revision.value
  return config()
    .ai.secrets.flatMap((key) =>
      (key.allowedOrigins ?? [])
        .filter((origin) => httpOrigin(origin) === origin)
        .map((origin) => ({ keyId: key.keyId, name: key.name, origin }))
    )
    .filter((pair) => !pair.keyId.startsWith('abele-store-key'))
    .map((pair) => {
      let allowed = destinationAccepted(pair)
      let blockedTransport = false
      const unencrypted = canAllowHttp(pair.origin)
      try {
        checkKeyTransport(pair.origin)
      } catch {
        allowed = false
        blockedTransport = true
      }
      if (blockedTransport && !unencrypted)
        return { ...pair, desc: pair.origin + PUBLIC_HTTP, allowText: null }
      return {
        ...pair,
        desc: `${pair.origin} — ${allowed ? t('settings.KeyDestinationsModal.allowed_on_this_device.bac894b7') : t('settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda')}${unencrypted ? UNENCRYPTED : ''}`,
        allowText: allowed
          ? null
          : unencrypted
            ? t('settings.KeyDestinationsModal.allow_unencrypted_http.e905502b')
            : t('settings.KeyDestinationsModal.allow_on_this_device.a92ce243'),
      }
    })
})

interface PendingRow {
  destination: Destination
  desc: string
  unencrypted: boolean
  allowText: string | null
}
const pending = computed<PendingRow[]>(() => {
  void revision.value
  const shown = pairs.value
  return pendingDestinations(config())
    .filter(
      (destination) =>
        !shown.some(
          (pair) => pair.keyId === destination.keyId && pair.origin === destination.origin
        )
    )
    .map((destination) => {
      let unencrypted = false
      try {
        checkKeyTransport(destination.origin)
      } catch {
        unencrypted = true
      }
      if (destination.keyId.startsWith('abele-store-key'))
        return {
          destination,
          unencrypted,
          desc: t('settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8'),
          allowText: null,
        }
      if (unencrypted && !canAllowHttp(destination.origin))
        return {
          destination,
          unencrypted,
          desc: destination.origin + PUBLIC_HTTP,
          allowText: null,
        }
      return {
        destination,
        unencrypted,
        desc: destination.origin + (unencrypted ? UNENCRYPTED : ''),
        allowText: unencrypted
          ? t('settings.KeyDestinationsModal.allow_unencrypted_http.e905502b')
          : t('settings.KeyDestinationsModal.allow_on_this_device.a92ce243'),
      }
    })
})

const httpOrigins = computed(() => {
  void revision.value
  return allowedHttpOrigins()
})

/** A known address fills the empty field when the key picked has exactly one. */
function chose(next: string): void {
  choice.value = next
  value.value = ''
  if (address.value || next === 'new') return
  const known = [
    ...new Set(
      config()
        .ai.secrets.filter((key) => key.keyId === next)
        .flatMap((key) =>
          (key.allowedOrigins ?? []).filter((origin) => httpOrigin(origin) === origin)
        )
    ),
  ]
  if (known.length === 1) address.value = known[0]
}

/** One save at a time; the form is locked while it runs and its outcome is the status line. */
function run(work: () => Promise<void>, success: () => void): void {
  if (busy.value || controller.signal.aborted) return
  busy.value = true
  status.value = ''
  void work()
    .then(() => {
      if (!controller.signal.aborted) success()
    })
    .catch((error) => {
      if (!controller.signal.aborted) status.value = keyConsentError(error)
    })
    .finally(() => {
      busy.value = false
      revision.value++
    })
}

function allowForm(): void {
  if (!canAllow.value) return
  const request =
    choice.value === 'new'
      ? { address: address.value, newKey: { name: name.value, value: value.value } }
      : { address: address.value, keyId: choice.value }
  const origin = recipientOrigin(address.value)
  const allowed = label.value
  // The value is in the request now; the field does not keep it while the save runs.
  value.value = ''
  run(
    () => allowKeyRecipient(request, controller.signal),
    () => {
      if (choice.value === 'new')
        choice.value = config().ai.secrets.find((key) => key.name === allowed)?.keyId ?? ''
      address.value = origin
      status.value = t('settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46', {
        value0: String(allowed),
        value1: String(origin),
      })
    }
  )
}

function allowPair(pair: PairRow): void {
  run(
    () => allowKeyRecipient({ keyId: pair.keyId, address: pair.origin }, controller.signal),
    () => {
      status.value = t('settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642', {
        value0: String(pair.name),
        value1: String(pair.origin),
      })
    }
  )
}

function removePair(pair: PairRow): void {
  run(
    () => removeKeyRecipient(pair.keyId, pair.origin, controller.signal),
    () => {
      status.value = t('settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad', {
        value0: String(pair.name),
        value1: String(pair.origin),
      })
    }
  )
}

/** Confirms a service destination; a failure undoes each half it had written, on its own. */
function confirmPending({ destination, unencrypted }: PendingRow): void {
  if (busy.value) return
  const accepted = destinationAccepted(destination)
  const hadHttp = allowedHttpOrigins().includes(destination.origin)
  try {
    if (config().settingsUnreadable) throw new Error('Settings are unreadable')
    acceptDestinations([destination])
    if (unencrypted) allowHttpOrigin(destination.origin)
    status.value = t('settings.KeyDestinationsModal.confirmed_value_value.b96426a6', {
      value0: String(destination.name),
      value1: String(destination.origin),
    })
  } catch (error) {
    try {
      if (unencrypted && !hadHttp) forgetHttpOrigin(destination.origin)
    } catch {
      /* Continue independent rollback. */
    }
    try {
      if (!accepted) forgetDestination(destination)
    } catch {
      /* Keep reporting failure. */
    }
    status.value = keyConsentError(error)
  }
  revision.value++
}

function removeHttp(origin: string): void {
  if (busy.value) return
  try {
    forgetHttpOrigin(origin)
    status.value = t('settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86')
  } catch (error) {
    status.value = keyConsentError(error)
  }
  revision.value++
}

onMounted(() => {
  const modalEl = intro.value?.closest<HTMLElement>('.modal')
  if (modalEl) emit('opened', modalEl)
})

onBeforeUnmount(() => {
  controller.abort()
  // A typed key value is not left behind in a field of a closed dialog.
  value.value = ''
  for (const input of Array.from(intro.value?.parentElement?.querySelectorAll('input') ?? []))
    input.value = ''
})
</script>
