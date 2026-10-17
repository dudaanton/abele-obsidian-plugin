<template>
  <Modal
    :title="
      isNew
        ? t('settings.GithubConnectionEditor.add_git_connection.9e359dd8')
        : t('settings.GithubConnectionEditor.edit_git_connection.1e73be5f')
    "
    size="tall"
    @close="close"
  >
    <Setting
      :name="t('settings.GithubConnectionEditor.service.d677190e')"
      :desc="t('settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8')"
    >
      <Dropdown
        :model-value="draft.provider || 'github'"
        :options="providerOptions"
        :disabled="!isNew"
        @update:model-value="isNew && (draft.provider = $event)"
      />
    </Setting>
    <Setting
      v-if="draft.account && draft.provider !== 'forgejo'"
      :name="t('settings.GithubConnectionEditor.account.7e1b0d56')"
      :desc="draft.account.login"
    >
      <Avatar :name="draft.account.login" :src="draft.account.avatarUrl" />
    </Setting>
    <Setting
      :name="t('settings.GithubConnectionEditor.name.dcd1d522')"
      :desc="t('settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0')"
    >
      <Input
        v-model:model-value="draft.name"
        :placeholder="t('settings.GithubConnectionEditor.connection_name.686d4d5d')"
      />
    </Setting>
    <Setting
      :name="t('settings.GithubConnectionEditor.server.aef7de28')"
      :error="
        draft.server.trim() && !validServer ? t('settings.git.serverAddressError') : undefined
      "
      :desc="
        draft.provider === 'forgejo'
          ? t('settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1')
          : t('settings.GithubConnectionEditor.empty_is_github_com_for.0f201123')
      "
    >
      <Input
        v-model:model-value="draft.server"
        :placeholder="
          draft.provider === 'forgejo'
            ? 'https://git.example.test'
            : t('settings.GithubConnectionEditor.github_com.3aeb0024')
        "
      />
    </Setting>
    <Setting :name="t('settings.GithubConnectionEditor.token.d2089be6')" :desc="tokenState">
      <SecretField
        v-model="token"
        :value="forget ? '' : stored"
        :placeholder="
          draft.provider === 'forgejo'
            ? t('settings.GithubConnectionEditor.access_token.9a911b08')
            : t('settings.GithubConnectionEditor.github_pat.94238580')
        "
        :replace-placeholder="t('settings.GithubConnectionEditor.new_token.564f08bc')"
        :save-tooltip="t('settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882')"
        :what="t('settings.GithubConnectionEditor.the_token.d22bffce')"
        @save="token = token.trim()"
      >
        <template #actions>
          <Icon
            icon="trash-2"
            with-bg
            :tooltip="t('settings.GithubConnectionEditor.forget_the_token.961a44b9')"
            @click="forget = true"
          />
        </template>
      </SecretField>
    </Setting>
    <Setting
      :name="t('settings.GithubConnectionEditor.default_for_this_server.c7a4b365')"
      :desc="t('settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859')"
    >
      <Checkbox :is-enabled="draft.isDefault" @toggle="draft.isDefault = !draft.isDefault" />
    </Setting>
    <Setting
      :name="t('settings.GithubConnectionEditor.repository_owners.89c91e93')"
      :desc="t('settings.GithubConnectionEditor.one_per_line_sample_org.335517a9')"
    >
      <Input
        v-model:model-value="owners"
        as-text-area
        :rows="4"
        :placeholder="t('settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b')"
      />
    </Setting>
    <Setting
      :name="t('settings.GithubConnectionEditor.check_access.abb9a172')"
      :desc="t('settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0')"
    >
      <Input
        v-model:model-value="repoInput"
        :placeholder="
          draft.provider === 'forgejo'
            ? t('settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1')
            : t('settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009')
        "
      />
    </Setting>
    <Button
      :text="t('settings.GithubConnectionEditor.check_access.abb9a172')"
      :tooltip="t('settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799')"
      :disabled="checking || !validServer"
      @click="check"
    />
    <EmptyState v-if="message" :text="message" />
    <EmptyState v-if="errorMessage" :text="errorMessage" />
    <EmptyState
      v-if="duplicate"
      :text="t('settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327')"
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
      <Disclosure
        v-model="detailsOpen"
        :label="t('settings.GithubConnectionEditor.access_details.abe1adac')"
      >
        <GithubAccessReport :report="report" />
      </Disclosure>
    </template>
    <GithubAccessReport v-else-if="report" :report="report" />
    <!-- As Obsidian's dialogs order them: Cancel, then the answer last. -->
    <template #footer>
      <Button
        :text="t('settings.GithubConnectionEditor.cancel.19766ed6')"
        :tooltip="t('settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff')"
        @click="close"
      />
      <Button
        :text="t('settings.GithubConnectionEditor.save.1509f561')"
        :tooltip="t('settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364')"
        accent
        :disabled="!draft.name.trim() || !validServer"
        @click="save"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
  { value: 'forgejo', display: t('settings.GithubConnectionEditor.forgejo.f4e62146') },
]
const detailsOpen = ref(false)
const accessSummary = computed(() =>
  report.value?.login
    ? t('settings.GithubConnectionEditor.signed_in_as_value.682769b2', {
        value0: String(report.value.login),
      })
    : report.value?.tokenConfigured
      ? report.value.identityError?.includes('401')
        ? t('settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a')
        : t('settings.GithubConnectionEditor.the_account_could_not_be.71de8f27', {
            value0: String(report.value.identityError ?? ''),
          })
      : t('settings.GithubConnectionEditor.public_access_without_a_token.35b758c0')
)
const accessCapabilities = computed(
  () =>
    report.value?.rows
      .map((row) => `${row.state === 'ok' ? '✓' : '—'} ${row.permission}`)
      .join(' · ') || t('settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc')
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
  message.value = t('settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8')
  return true
}
const validServer = computed(() => validProviderServer(draft))
const tokenState = computed(() =>
  forget.value
    ? t('settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6')
    : stored.value
      ? t('settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e')
      : !props.isNew &&
          validProviderServer(draft) &&
          connectionBinding(draft) !== connectionBinding(props.connection) &&
          props.connection.keyId
        ? t('settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376')
        : secrets().status.value === 'locked'
          ? t('settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60')
          : t('settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf')
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
      message.value = t('settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3')
      return
    }
    checking.value = true
    message.value = t('settings.GithubConnectionEditor.asking_forgejo.f46aa9ff')
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
        message.value =
          error instanceof Error
            ? error.message
            : t('settings.GithubConnectionEditor.the_access_check_failed.90fa9dca')
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
    message.value = t('settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209')
    return
  }
  if (repo && repo.host !== ends.webHost) {
    message.value = t('settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d')
    return
  }
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text)
    const api = new URL(ends.api)
    if (![ends.origin, api.origin].includes(url.origin) || url.username || url.password) {
      message.value = t('settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4')
      return
    }
  }
  checking.value = true
  message.value = t('settings.GithubConnectionEditor.asking_github.5becc057')
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
      message.value =
        e instanceof Error
          ? e.message
          : t('settings.GithubConnectionEditor.the_access_check_failed.90fa9dca')
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
