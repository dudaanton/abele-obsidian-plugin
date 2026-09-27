<template>
  <Section
    title="Connect to a server"
    desc="Sign in once. This device then holds a token of its own, and the password is never stored."
  >
    <Setting name="Server address" :desc="urlProblem ?? ADDRESS_HINT">
      <Input
        :model-value="serverUrl"
        placeholder="https://sync.example.com"
        :disabled="busy"
        @update:model-value="onServerUrl"
      />
    </Setting>

    <Setting name="Email" desc="The account this vault belongs to.">
      <Input
        :model-value="email"
        placeholder="you@example.com"
        :disabled="busy"
        @update:model-value="email = $event"
      />
    </Setting>

    <Setting
      name="Password"
      desc="Used for this one sign-in. It is not written to the settings or to the log."
    >
      <Input
        :model-value="password"
        password
        :disabled="busy"
        @update:model-value="password = $event"
      />
    </Setting>

    <Setting :name="signInName" :desc="error ?? undefined">
      <Button
        text="Sign in"
        accent
        :disabled="busy || !canSignIn"
        :tooltip="
          canSignIn
            ? 'Sign in and list the vaults on this server'
            : urlProblem !== null
              ? 'Fix the server address first'
              : 'Fill in all three fields first'
        "
        @click="signIn"
      />
    </Setting>

    <template v-if="vaults !== null">
      <Section
        title="Choose a vault"
        desc="Pick the vault this device should sync with, or make a new one for it."
      >
        <Setting
          name="This device's name"
          desc="The name the server will know this device by. You can change it before choosing."
        >
          <Input :model-value="deviceName" :disabled="busy" @update:model-value="onDeviceName" />
        </Setting>

        <!--
          A device this one left while offline is told first, for up to ten seconds; said here so
          the wait does not read as a hang.
        -->
        <p v-if="busy && telling" class="abele-connect-card__hint">{{ telling }}</p>

        <CardGrid wide>
          <Card
            v-for="vault in vaults"
            :key="vault.id"
            :title="vault.name"
            :subtitle="vault.id"
            :meta="vaultMeta(vault)"
            clickable
            :selected="chosen === vault.id"
            @click="choose(vault)"
          >
            <template #badges>
              <Badge v-if="vault.role === 'owner'" text="Owner" />
            </template>
          </Card>

          <Card
            title="Create a new vault"
            description="An empty vault on this server, filled from what this device already holds."
          >
            <Input
              :model-value="newVaultName"
              placeholder="Name the new vault"
              :disabled="busy"
              @update:model-value="newVaultName = $event"
            />
            <Button
              text="Create and connect"
              :disabled="busy || newVaultName.trim() === ''"
              :tooltip="
                newVaultName.trim() === ''
                  ? 'Name the new vault first'
                  : 'Make this vault and enrol this device on it'
              "
              @click="createVault"
            />
          </Card>
        </CardGrid>

        <EmptyState
          v-if="vaults.length === 0"
          text="This account holds no vaults yet. Make one above."
        />
      </Section>
    </template>
  </Section>
</template>

<script setup lang="ts">
/**
 * Setting a device up: a server, an account, and the vault this device joins.
 *
 * The password is a field on this screen and nowhere else. `SyncService.connect` uses it for
 * one request and keeps the account token it answers with in memory until a vault is chosen,
 * so nothing here ever reaches `data.json` or the keychain.
 *
 * The device name is offered rather than demanded: there is no hostname to read inside
 * Obsidian, so the default is the platform and the vault it is joining — "Phone — Notes" —
 * which is at least true, and editable before anything is enrolled.
 */
import { computed, ref } from 'vue'
import { Platform } from 'obsidian'
import { serverUrlProblem, type VaultInfo } from '@abele/sync-protocol'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { formatBytes } from '@/helpers/reduceImage'
import { reasonOf } from '@/sync/format'

const props = defineProps<{
  /** What the settings already remember, so a reconnect does not retype the address. */
  serverUrl: string
}>()

const emit = defineEmits<{
  (e: 'connected'): void
}>()

const sync = () => SyncService.getInstance()

const serverUrl = ref(props.serverUrl)
const email = ref('')
const password = ref('')
const vaults = ref<VaultInfo[] | null>(null)
const deviceName = ref('')
const newVaultName = ref('')
const chosen = ref<string | null>(null)
/** Once a person has typed a name, no vault they click renames their device under them. */
const nameEdited = ref(false)
const busy = ref(false)
/** Who the enrolment is telling that a device left, while it waits on that. */
const telling = computed(() => sync().telling.value)
const error = ref<string | null>(null)

/** What the address row says while nothing is wrong with it. */
const ADDRESS_HINT = 'An https address. Plain http only reaches a server on this device.'

/**
 * Why the typed address will not be signed in to, said under the field as it is typed: the
 * password and every later request would cross the network readable over plain http. Nothing
 * is said about an empty field, which is only not filled in yet.
 */
const urlProblem = computed(() =>
  serverUrl.value.trim() === '' ? null : serverUrlProblem(serverUrl.value.trim())
)

const canSignIn = computed(
  () =>
    serverUrl.value.trim() !== '' &&
    urlProblem.value === null &&
    email.value.trim() !== '' &&
    password.value !== ''
)

/** The heading of the sign-in row doubles as where a failure is reported. */
const signInName = computed(() => (error.value === null ? 'Sign in' : 'Could not sign in'))

/** What a device calls itself when nobody has said: the platform, and the vault it joins. */
const suggestedName = (vaultName: string): string =>
  `${Platform.isMobile ? 'Phone' : 'Desktop'} — ${vaultName}`

const vaultMeta = (vault: VaultInfo): string[] => [
  `${formatBytes(vault.usage.live_bytes)} in files`,
  vault.usage.quota_bytes === null ? 'No quota' : `${formatBytes(vault.usage.quota_bytes)} allowed`,
]

/**
 * Everything the two verbs share: one at a time, and a failure that says what it was.
 *
 * Answers whether it got through, so a caller that marked something as chosen before asking
 * can unmark it — a card left looking selected after a refusal says the device enrolled.
 */
async function attempt(what: () => Promise<void>): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  error.value = null
  try {
    await what()
    return true
  } catch (failure) {
    error.value = reasonOf(failure)
    return false
  } finally {
    busy.value = false
  }
}

function onServerUrl(value: string): void {
  serverUrl.value = value
  // The vault list belongs to the server it came from: pointing elsewhere makes it a lie.
  vaults.value = null
}

function onDeviceName(value: string): void {
  deviceName.value = value
  nameEdited.value = true
}

/** The suggestion follows the vault being joined, right up until somebody types over it. */
function suggest(vaultName: string): void {
  if (!nameEdited.value) deviceName.value = suggestedName(vaultName)
}

async function signIn(): Promise<void> {
  // Trimmed once, here, and written back: the field, the request and what a reconnect
  // remembers are then all the same string, rather than three that differ by a space.
  const baseUrl = serverUrl.value.trim()
  const account = email.value.trim()
  serverUrl.value = baseUrl
  email.value = account
  await attempt(async () => {
    const listed = await sync().connect(baseUrl, account, password.value)
    // The moment the token is in the service's hands, the password has no further use here.
    password.value = ''
    vaults.value = listed
    suggest(listed[0]?.name ?? 'vault')
  })
}

async function choose(vault: VaultInfo): Promise<void> {
  chosen.value = vault.id
  suggest(vault.name)
  const enrolled = await attempt(async () => {
    await sync().chooseVault(vault.id, deviceName.value)
    emit('connected')
  })
  // A card still marked as chosen after a refusal would say the device is on that vault.
  if (!enrolled) chosen.value = null
}

async function createVault(): Promise<void> {
  const name = newVaultName.value.trim()
  suggest(name)
  await attempt(async () => {
    await sync().chooseVault({ create: name }, deviceName.value)
    emit('connected')
  })
}
</script>

<style lang="scss">
.abele-connect-card__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
