<template>
  <Modal :title="isNew ? 'Add Git connection' : 'Edit Git connection'" size="tall" @close="close">
    <Setting name="Service" desc="Choose the service before entering its server address and token.">
      <Dropdown
        :model-value="draft.provider || 'github'"
        :options="providerOptions"
        :disabled="!isNew"
        @update:model-value="isNew && (draft.provider = $event)"
      />
    </Setting>
    <Setting
      v-if="draft.account && draft.provider !== 'forgejo'"
      name="Account"
      :desc="draft.account.login"
    >
      <Avatar :name="draft.account.login" :src="draft.account.avatarUrl" />
    </Setting>
    <Setting
      name="Name"
      desc="A name for this connection, independent of the account discovered from its token."
    >
      <Input v-model:model-value="draft.name" placeholder="Connection name" />
    </Setting>
    <Setting
      name="Server"
      :error="
        draft.server.trim() && !validServer
          ? 'Only the address: no login, query or # part'
          : undefined
      "
      :desc="
        draft.provider === 'forgejo'
          ? 'Full Forgejo address, including any port or deployment path.'
          : 'Empty is github.com. For Enterprise, use its full address including any port.'
      "
    >
      <Input
        v-model:model-value="draft.server"
        :placeholder="draft.provider === 'forgejo' ? 'https://git.example.test' : 'github.com'"
      />
    </Setting>
    <Setting name="Token" :desc="tokenState">
      <SecretField
        v-model="token"
        :value="forget ? '' : stored"
        :placeholder="draft.provider === 'forgejo' ? 'Access token' : 'github_pat_...'"
        replace-placeholder="New token..."
        save-tooltip="Use this token when saving the connection"
        what="The token"
        @save="token = token.trim()"
      >
        <template #actions>
          <Icon icon="trash-2" with-bg tooltip="Forget the token" @click="forget = true" />
        </template>
      </SecretField>
    </Setting>
    <Setting
      name="Default for this server"
      desc="Used when no repository-owner preference selects another connection."
    >
      <Checkbox :is-enabled="draft.isDefault" @toggle="draft.isDefault = !draft.isDefault" />
    </Setting>
    <Setting
      name="Repository owners"
      desc="One per line: sample-org, sample-org/*, sample-*, or sample-org/project. More specific rules win."
    >
      <Input
        v-model:model-value="owners"
        as-text-area
        :rows="4"
        :placeholder="'sample-org\nsample-org/project'"
      />
    </Setting>
    <Setting
      name="Check access"
      desc="Checks only this connection. Leave the repository empty to discover the account."
    >
      <Input
        v-model:model-value="repoInput"
        :placeholder="
          draft.provider === 'forgejo'
            ? 'owner/repo or a Forgejo link'
            : 'owner/repo or a GitHub link'
        "
      />
    </Setting>
    <Button
      text="Check access"
      tooltip="Send read requests with this draft's token without storing it"
      :disabled="checking || !validServer"
      @click="check"
    />
    <EmptyState v-if="message" :text="message" />
    <EmptyState v-if="errorMessage" :text="errorMessage" />
    <EmptyState
      v-if="duplicate"
      text="Another connection uses the same account on this server. You can still save it."
    />
    <template v-if="report && draft.provider === 'forgejo'">
      <Setting :name="accessSummary" :desc="accessCapabilities">
        <StatusDot
          :tone="
            draft.checkState === 'ok' ? 'green' : draft.checkState === 'partial' ? 'orange' : 'red'
          "
          :label="accessSummary"
        />
      </Setting>
      <Disclosure v-model="detailsOpen" label="Access details">
        <GithubAccessReport :report="report" />
      </Disclosure>
    </template>
    <GithubAccessReport v-else-if="report" :report="report" />
    <!-- As Obsidian's dialogs order them: Cancel, then the answer last. -->
    <template #footer>
      <Button
        text="Cancel"
        tooltip="Discard this draft without changing settings or the keychain"
        @click="close"
      />
      <Button
        text="Save"
        tooltip="Store this connection and its token, then close the editor"
        accent
        :disabled="!draft.name.trim() || !validServer"
        @click="save"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import Avatar from '../obsidian/Avatar.vue'
import SecretField from './SecretField.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import Disclosure from '../obsidian/Disclosure.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubAccessReport from './GithubAccessReport.vue'
import { secrets } from '@/secrets/SecretStore'
import { GithubClient, type GithubRate } from '@/github/client'
import { endpoints } from '@/github/urls'
import { checkAccess, parseRepoInput, type AccessReport } from '@/github/accessCheck'
import { validProviderServer, connectionBinding, type GithubConnection } from '@/github/connections'
import { deployment } from '@/forge/identity'
import { ForgejoClient } from '@/forge/forgejoClient'
import { checkForgejoAccess, forgejoRepoInput } from '@/forge/forgejoAccessCheck'
import { singleHopRequest } from '@/github/transport'

const props = defineProps<{
  connection: GithubConnection
  connections: GithubConnection[]
  isNew?: boolean
  checkOnOpen?: boolean
  errorMessage?: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', connection: GithubConnection, token?: string | null, rate?: GithubRate): void
}>()
const draft = reactive<GithubConnection>(JSON.parse(JSON.stringify(props.connection)))
const providerOptions = [
  { value: 'github', display: 'GitHub' },
  { value: 'forgejo', display: 'Forgejo' },
]
const detailsOpen = ref(false)
const accessSummary = computed(() =>
  report.value?.login
    ? `Signed in as ${report.value.login}`
    : report.value?.tokenConfigured
      ? report.value.identityError?.includes('401')
        ? 'The host did not accept this token (401).'
        : `The account could not be checked. ${report.value.identityError ?? ''}`
      : 'Public access without a token'
)
const accessCapabilities = computed(
  () =>
    report.value?.rows
      .map((row) => `${row.state === 'ok' ? '✓' : '—'} ${row.permission}`)
      .join(' · ') || 'Choose a repository to check read access.'
)
function recordCheck(result: AccessReport): void {
  if (!result.login) {
    delete draft.account
    delete draft.expiresAt
  }
  draft.checkedAt = Date.now()
  draft.checkState =
    result.login || (!result.tokenConfigured && result.rows.some((row) => row.state === 'ok'))
      ? result.rows.some((row) => row.state === 'refused')
        ? 'partial'
        : 'ok'
      : result.identityError?.includes('401')
        ? 'refused'
        : 'error'
}
const token = ref('')
const forget = ref(false)
const owners = ref(draft.owners.join('\n'))
const repoInput = ref('')
const report = ref<AccessReport | null>(null)
let lastRate: GithubRate | null = null
const message = ref('')
const checking = ref(false)
let generation = 0
let open = true
const readStored = () => {
  if (
    !validProviderServer(draft) ||
    connectionBinding(draft) !== connectionBinding(props.connection)
  )
    return ''
  return draft.keyId ? (secrets().get(draft.keyId) ?? '') : ''
}
const stored = computed(() => {
  void secrets().version.value
  return readStored()
})
const draftCredential = () => token.value.trim() || (forget.value ? '' : readStored())
const credentialChanged = (credential: string) => {
  if (credential === draftCredential()) return false
  report.value = null
  lastRate = null
  delete draft.account
  delete draft.checkState
  delete draft.checkedAt
  delete draft.expiresAt
  message.value = 'The connection token changed. Check access again.'
  return true
}
const validServer = computed(() => validProviderServer(draft))
const tokenState = computed(() =>
  forget.value
    ? 'The token will be forgotten when you save.'
    : stored.value
      ? 'A token is stored on this device. Enter a replacement, or leave empty to keep it. Changes are saved only with Save.'
      : !props.isNew &&
          validProviderServer(draft) &&
          connectionBinding(draft) !== connectionBinding(props.connection) &&
          props.connection.keyId
        ? 'The stored token belongs to the previous server. Enter a new token for this address.'
        : secrets().status.value === 'locked'
          ? 'Synced keys are locked; unlock them to use the token, or enter a new one.'
          : 'No token on this device. Stored in the keychain only when you save.'
)
const duplicate = computed(
  () =>
    !!draft.account &&
    props.connections.some(
      (c) =>
        c.id !== draft.id &&
        validProviderServer(draft) &&
        connectionBinding(c) === connectionBinding(draft) &&
        c.account?.login.toLowerCase() === draft.account?.login.toLowerCase()
    )
)

watch(
  [() => draft.server, () => draft.provider],
  () => {
    token.value = ''
    forget.value = false
  },
  { flush: 'sync' }
)
watch(
  [token, () => draft.server, () => draft.provider, forget, stored],
  () => {
    generation++
    checking.value = false
    report.value = null
    lastRate = null
    delete draft.account
    delete draft.checkState
    delete draft.checkedAt
    delete draft.expiresAt
    message.value = ''
  },
  { flush: 'sync' }
)
const close = () => {
  open = false
  generation++
  token.value = ''
  emit('close')
}
onBeforeUnmount(() => {
  open = false
  generation++
  token.value = ''
})
onMounted(() => {
  if (props.checkOnOpen && validServer.value) void check()
})

async function check(): Promise<void> {
  if (draft.provider === 'forgejo') {
    const mine = ++generation
    const credential = draftCredential()
    const client = new ForgejoClient(
      deployment('forgejo', draft.server),
      {
        connectionId: draft.id,
        generation: String(mine),
        assertCurrent() {
          if (!open || generation !== mine || credentialChanged(credential))
            throw new Error('This access check was cancelled.')
        },
      },
      singleHopRequest,
      credential
    )
    const text = repoInput.value.trim(),
      repo = text ? forgejoRepoInput(client, text) : null
    if (text && !repo) {
      message.value = 'Give owner/repo or a repository link on this connection’s server.'
      return
    }
    checking.value = true
    message.value = 'Asking Forgejo…'
    try {
      const result = await checkForgejoAccess(client, repo, credential)
      if (!open || generation !== mine) return
      report.value = result
      recordCheck(result)
      message.value = ''
      if (result.login) {
        draft.account = { login: result.login }
        draft.checkedAt = Date.now()
      }
    } catch (error) {
      if (open && generation === mine)
        message.value = error instanceof Error ? error.message : 'The access check failed.'
    } finally {
      if (generation === mine) checking.value = false
    }
    return
  }
  const requestGeneration = ++generation
  const ends = endpoints(draft.server)
  const text = repoInput.value.trim()
  const repo = text ? parseRepoInput(text, ends.webHost) : null
  if (text && !repo) {
    message.value = 'Give owner/repo or a repository link.'
    return
  }
  if (repo && repo.host !== ends.webHost) {
    message.value = 'This repository is on another server. Choose its connection instead.'
    return
  }
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text)
    const api = new URL(ends.api)
    if (![ends.origin, api.origin].includes(url.origin) || url.username || url.password) {
      message.value =
        'This repository is on a different server address, scheme or port. Use this connection’s server.'
      return
    }
  }
  checking.value = true
  message.value = 'Asking GitHub…'
  const credential = draftCredential()
  const client = new GithubClient(ends, credential)
  try {
    const result = await checkAccess({
      client,
      repo,
      tokenConfigured: client.hasToken,
      tokenHost: ends.webHost,
    })
    if (!open || generation !== requestGeneration || credentialChanged(credential)) return
    report.value = result
    recordCheck(result)
    lastRate = client.rate.value
    message.value = ''
    if (result.login) {
      draft.account = {
        login: result.login,
        ...(result.avatarUrl ? { avatarUrl: result.avatarUrl } : {}),
      }
      draft.checkedAt = Date.now()
      draft.expiresAt = result.expires
    }
  } catch (e) {
    if (open && generation === requestGeneration)
      message.value = e instanceof Error ? e.message : 'The access check failed.'
  } finally {
    client.retire()
    if (generation === requestGeneration) checking.value = false
  }
}

function save(): void {
  if (!draft.name.trim() || !validServer.value) return
  const connection = {
    ...draft,
    name: draft.name.trim(),
    server: draft.server.trim(),
    owners: owners.value
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
    ...(draft.account ? { account: { ...draft.account } } : {}),
  }
  const value = token.value.trim() || (forget.value ? null : undefined)
  if (lastRate) emit('save', connection, value, lastRate)
  else emit('save', connection, value)
}
</script>
