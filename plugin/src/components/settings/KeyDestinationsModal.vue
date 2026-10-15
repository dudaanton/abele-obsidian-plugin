<template>
  <ObsidianModal
    title="Review key destinations"
    modal-class="abele-key-destinations"
    @close="emit('close')"
  >
    <p ref="intro">
      Choose a key and recipient. Confirmation and HTTP allowance are local to this device.
    </p>
    <p role="status">{{ status }}</p>
    <Setting name="Saved key">
      <Dropdown
        :model-value="choice"
        aria-label="Saved key"
        :options="keyOptions"
        :disabled="busy"
        @update:model-value="chose"
      />
    </Setting>
    <Setting name="Recipient address">
      <Input
        v-model="address"
        aria-label="Recipient address"
        placeholder="Recipient URL"
        :disabled="busy"
      />
    </Setting>
    <template v-if="choice === 'new'">
      <Setting name="New key name">
        <Input v-model="name" aria-label="New key name" :disabled="busy" />
      </Setting>
      <Setting name="New key value" desc="Protected storage; saved only when you confirm.">
        <!-- `type`, not the kit's `password`: that one turns autocomplete off, and a new key
             field says `new-password` so no saved login is offered into it. -->
        <Input
          v-model="value"
          type="password"
          autocomplete="new-password"
          aria-label="New key value"
          :disabled="busy"
        />
      </Setting>
    </template>

    <Section v-if="pairs.length" title="Key permissions">
      <div v-for="pair in pairs" :key="pair.keyId + ' ' + pair.origin" data-key-destination="true">
        <Setting :name="pair.name || 'Saved key'" :desc="pair.desc">
          <Button
            v-if="pair.allowText"
            :text="pair.allowText"
            :tooltip="`Let ${pair.name || 'this key'} be sent to ${pair.origin} from this device`"
            @click="allowPair(pair)"
          />
          <Button
            text="Remove key permission"
            :tooltip="`Stop sending ${pair.name || 'this key'} to ${pair.origin}; the key stays saved`"
            @click="removePair(pair)"
          />
        </Setting>
      </div>
    </Section>

    <Section v-if="pending.length" title="Service destinations to confirm">
      <Setting
        v-for="row in pending"
        :key="row.destination.keyId + ' ' + row.destination.origin"
        :name="row.destination.name"
        :desc="row.desc"
      >
        <Button
          v-if="row.allowText"
          :text="row.allowText"
          :tooltip="`Let ${row.destination.name} receive its key at ${row.destination.origin} from this device`"
          @click="confirmPending(row)"
        />
      </Setting>
    </Section>

    <Section v-if="httpOrigins.length" title="HTTP transport on this device">
      <Setting
        v-for="origin in httpOrigins"
        :key="origin"
        :name="origin"
        desc="Unencrypted transport only; each key still needs its own recipient permission."
      >
        <Button
          text="Remove HTTP exception"
          :tooltip="`Stop allowing unencrypted key transport to ${origin}`"
          @click="removeHttp(origin)"
        />
      </Setting>
    </Section>

    <template #footer>
      <p>{{ summary }}</p>
      <Button
        text="Allow key and address"
        accent
        :disabled="!canAllow"
        tooltip="Save this key permission on this device; nothing is sent now"
        @click="allowForm"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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

const UNENCRYPTED = ' — Unencrypted: anyone on the network path can read the key.'
const PUBLIC_HTTP = ' — Public HTTP cannot receive keys. Change this address to HTTPS.'

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
  { value: '', display: 'Choose a key' },
  ...keys.value.map((key) => ({ value: key.id, display: key.name || 'Saved key' })),
  { value: 'new', display: 'Save a new named key…' },
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
    ? `${label.value} → ${origin}${canAllowHttp(origin) ? UNENCRYPTED : ''}${choice.value === 'new' ? ' Save this new key in protected storage.' : ''}`
    : validation || 'Choose a saved key and enter the recipient address.'
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
        desc: `${pair.origin} — ${allowed ? 'Allowed on this device' : 'Needs confirmation on this device'}${unencrypted ? UNENCRYPTED : ''}`,
        allowText: allowed ? null : unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device',
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
          desc: 'The store key cannot be sent to a recipient.',
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
        allowText: unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device',
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
      status.value = `Allowed ${allowed} → ${origin}. Retry the original script; nothing was sent automatically.`
    }
  )
}

function allowPair(pair: PairRow): void {
  run(
    () => allowKeyRecipient({ keyId: pair.keyId, address: pair.origin }, controller.signal),
    () => {
      status.value = `Allowed ${pair.name} → ${pair.origin}. Retry the original script.`
    }
  )
}

function removePair(pair: PairRow): void {
  run(
    () => removeKeyRecipient(pair.keyId, pair.origin, controller.signal),
    () => {
      status.value = `Removed ${pair.name} → ${pair.origin}. The saved key and other permissions remain.`
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
    status.value = `Confirmed ${destination.name} → ${destination.origin}.`
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
    status.value = 'HTTP exception removed. Keys cannot use this unencrypted address.'
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
