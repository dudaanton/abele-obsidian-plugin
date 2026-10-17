<template>
  <div class="abele-settings__github">
    <Setting
      :name="t('settings.GithubSettings.git_hosting.a3002011')"
      :desc="t('settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c')"
    >
      <Checkbox :is-enabled="settings.enabled" @toggle="toggle('enabled')" />
    </Setting>

    <template v-if="settings.enabled">
      <Setting
        :name="t('settings.GithubSettings.open_github_links_in_obsidian.815b1959')"
        :desc="t('settings.GithubSettings.a_click_on_a_supported.f005fa1f')"
      >
        <Checkbox :is-enabled="settings.openLinks" @toggle="toggle('openLinks')" />
      </Setting>

      <Setting
        :name="t('settings.GithubSettings.default_repository.525a8366')"
        :desc="t('settings.GithubSettings.where_the_command_open_github.750aa580')"
      >
        <Input
          :model-value="settings.defaultRepo"
          :placeholder="t('settings.GithubSettings.owner_repo.65e817ee')"
          @update:model-value="updateDefaultRepo"
        />
      </Setting>

      <Section
        :title="t('settings.GithubSettings.pinned_repositories.03dccfeb')"
        :desc="t('settings.GithubSettings.first_in_open_github_repository.067f8a9c')"
      >
        <EmptyState
          v-if="!settings.pinnedRepos.length"
          :text="t('settings.GithubSettings.nothing_pinned_yet.0b27e4d1')"
        />
        <Setting
          v-for="pin in settings.pinnedRepos"
          :key="pin.url"
          :name="pinName(pin.url)"
          :desc="pinHost(pin.url)"
        >
          <Icon
            icon="pin-off"
            with-bg
            :tooltip="t('settings.GithubSettings.unpin_this_repository.91038877')"
            @click="unpin(pin.url)"
          />
        </Setting>
      </Section>

      <Section
        :title="t('settings.GithubSettings.connections.dc273117')"
        :desc="t('settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9')"
      >
        <EmptyState
          v-if="!settings.connections.length"
          :text="t('settings.GithubSettings.no_connections_public_github_com.534d40f4')"
        />
        <Setting
          v-for="connection in settings.connections"
          :key="connection.id"
          :name="
            (isBrowsableConnection(connection) && connection.isDefault
              ? t('settings.GithubSettings.default.2ae2ecc2')
              : '') + connection.name
          "
          :desc="connectionDescription(connection)"
        >
          <StatusDot
            :tone="connectionStatus(connection).tone"
            :label="connectionStatus(connection).label"
          />
          <Icon
            v-if="isBrowsableConnection(connection)"
            icon="pencil"
            with-bg
            :tooltip="t('settings.GithubSettings.edit_connection.047f9f95')"
            @click="editConnection(connection)"
          />
          <Icon
            icon="more-horizontal"
            with-bg
            :tooltip="t('settings.GithubSettings.connection_actions.9e1bbb65')"
            @click="connectionMenu(connection, $event)"
          />
        </Setting>
        <Setting
          v-if="
            !settings.connections.some(
              (c) => isGithubConnection(c) && endpoints(c.server).webHost === 'github.com'
            )
          "
          :name="t('settings.GithubSettings.public_github_com_anonymous.c18bb859')"
          :desc="
            anonymousGithubRate
              ? t('settings.GithubSettings.value_of_value_requests_remaining.037c7ebe', {
                  value0: String(anonymousGithubRate.remaining),
                  value1: String(anonymousGithubRate.limit),
                  value2: String(
                    anonymousGithubRate.reset
                      ? t('settings.terms.resetsSuffix') +
                          new Date(anonymousGithubRate.reset).toLocaleTimeString()
                      : ''
                  ),
                })
              : t('settings.GithubSettings.quota_not_observed_yet_normally.b802706a')
          "
        />
        <EmptyState v-if="connectionMessage" :text="connectionMessage" />
        <Button
          :text="t('settings.GithubSettings.add_connection.685f88ae')"
          :tooltip="t('settings.GithubSettings.create_a_connection_with_its.a4245461')"
          @click="addConnection"
        />
      </Section>

      <Section
        :title="t('settings.GithubSettings.notifications.78801183')"
        :desc="t('settings.GithubSettings.a_fine_grained_personal_access.259d3619')"
      >
        <Setting
          :name="t('settings.GithubSettings.notifications_token.e314ce9b')"
          :desc="t('settings.GithubSettings.optional_a_classic_personal_access.0e7b2561')"
        >
          <SecretField
            v-model="notificationsInput"
            :value="storedNotifications"
            :placeholder="t('settings.GithubSettings.ghp.ff475c83')"
            :replace-placeholder="t('settings.GithubSettings.new_token.564f08bc')"
            :save-tooltip="t('settings.GithubSettings.save_the_notifications_token.d4a25b6f')"
            :what="t('settings.GithubSettings.the_notifications_token.266dfc35')"
            @save="saveNotificationsToken"
          >
            <template #actions>
              <Icon
                icon="trash-2"
                with-bg
                :tooltip="t('settings.GithubSettings.forget_the_notifications_token.5f48625d')"
                @click="confirmingForgetNotifications = true"
              />
            </template>
          </SecretField>
        </Setting>
      </Section>

      <Section
        :title="t('settings.GithubSettings.pages.9046da16')"
        :desc="t('settings.GithubSettings.how_a_github_tab_lays.f030133b')"
      >
        <Setting
          :name="t('settings.GithubSettings.page_width.217fbef1')"
          :desc="t('settings.GithubSettings.how_wide_the_text_of.8d0e20a7')"
        >
          <Dropdown
            :options="widthOptions"
            :model-value="settings.pageWidth"
            @update:model-value="updatePageWidth"
          />
        </Setting>
        <Setting
          v-if="settings.pageWidth === 'custom'"
          :name="t('settings.GithubSettings.width_in_pixels.b3f8f713')"
          :desc="
            t('settings.GithubSettings.from_value_to_value_a.87f8c5fb', {
              value0: String(PAGE_WIDTH_MIN),
              value1: String(PAGE_WIDTH_MAX),
            })
          "
        >
          <Input
            :model-value="String(settings.pageWidthPx)"
            placeholder="1000"
            @update:model-value="updatePageWidthPx"
          />
        </Setting>
        <Setting
          :name="t('settings.GithubSettings.markdown_files_open_as.5541a0b8')"
          :desc="t('settings.GithubSettings.preview_rendered_and_a_link.7f27338b')"
        >
          <Dropdown
            :options="markdownOptions"
            :model-value="settings.markdownView"
            @update:model-value="updateMarkdownView"
          />
        </Setting>
      </Section>

      <Section
        :title="t('settings.GithubSettings.people.7db20897')"
        :desc="t('settings.GithubSettings.who_wrote_an_issue_a.deb19dbb')"
      >
        <Setting
          :name="t('settings.GithubSettings.show_people_by.989a820c')"
          :desc="t('settings.GithubSettings.their_name_as_their_profile.2452b5a6')"
        >
          <Dropdown
            :options="displayOptions"
            :model-value="settings.userDisplay"
            @update:model-value="updateUserDisplay"
          />
        </Setting>
        <Setting
          :name="t('settings.GithubSettings.kept_names_and_pictures.586c5b5f')"
          :desc="peopleDesc"
        >
          <Button
            :text="t('settings.GithubSettings.clear.83b12c22')"
            :disabled="!peopleCount"
            :tooltip="
              peopleCount
                ? t('settings.GithubSettings.forget_every_kept_name_and.ddf1b164')
                : t('settings.GithubSettings.nothing_is_kept_yet.7287d9c8')
            "
            @click="clearPeople"
          />
        </Setting>
      </Section>

      <Section
        :title="t('settings.GithubSettings.code_search.ca5e7167')"
        :desc="t('settings.GithubSettings.search_the_code_of_the.1ce06300')"
      >
        <Setting
          :name="t('settings.GithubSettings.largest_repository_to_download_mb.c4edc368')"
          :desc="t('settings.GithubSettings.its_files_at_that_version.5d039cfc')"
        >
          <Input
            :model-value="String(settings.searchLimitMb)"
            placeholder="100"
            @update:model-value="updateSearchLimit"
          />
        </Setting>
      </Section>
    </template>

    <GithubConnectionEditor
      v-if="editingConnection"
      :connection="editingConnection"
      :connections="settings.connections.filter(isBrowsableConnection)"
      :is-new="newConnection"
      :check-on-open="checkOnOpen"
      :error-message="connectionMessage"
      @save="saveConnection"
      @close="editingConnection = null"
    />
    <ConfirmModal
      v-if="deletingConnection"
      :title="
        isGithubConnection(deletingConnection)
          ? t('settings.GithubSettings.delete_github_connection.e4dfa050')
          : t('settings.GithubSettings.delete_connection.e960651b')
      "
      :message="
        t('settings.GithubSettings.delete_value_its_local_token.b78722f1', {
          value0: String(deletingConnection.name),
        })
      "
      :confirm-tooltip="t('settings.GithubSettings.delete_this_connection_and_forget.1a526c31')"
      @confirm="deleteConnection"
      @close="deletingConnection = null"
    />
    <ConfirmModal
      v-if="confirmingForgetNotifications"
      :title="t('settings.GithubSettings.forget_the_notifications_token.5f48625d')"
      :message="t('settings.GithubSettings.remove_the_notifications_token_from.5b3f8312')"
      :confirm-text="t('settings.GithubSettings.forget.a6bd489d')"
      :confirm-tooltip="t('settings.GithubSettings.remove_the_notifications_token_from.d1453607')"
      @confirm="forgetNotificationsToken"
      @close="confirmingForgetNotifications = false"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { secrets } from '@/secrets/SecretStore'
import SecretField from './SecretField.vue'
import { computed, reactive, ref, watch } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import { Menu } from 'obsidian'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import GithubConnectionEditor from './GithubConnectionEditor.vue'
import { keychainId } from '@/secrets/keychainId'
import { anonymousGithubRate, type GithubRate } from '@/github/client'
import type { GithubConnection } from '@/github/connections'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
  githubSettingsFrom,
  type GithubSettings,
} from '@/github/settings'
import { resetGithubClients, connectionClient } from '@/github/GithubService'
import { githubUsers } from '@/github/users'
import { PAGE_WIDTH_MAX, PAGE_WIDTH_MIN } from '@/github/pageWidth'
import {
  projectLegacy,
  isGithubConnection,
  isBrowsableConnection,
  connectionUnavailableReason,
  connectionBinding,
} from '@/github/connections'
import { endpoints } from '@/github/urls'

const config = AbeleConfig.getInstance()
const editingConnection = ref<GithubConnection | null>(null)
const deletingConnection = ref<GithubConnection | null>(null)
const newConnection = ref(false)
const checkOnOpen = ref(false)
const connectionMessage = ref('')
let originalConnection = ''

const connectionDescription = (connection: GithubConnection) => {
  const unavailable = isBrowsableConnection(connection)
    ? ''
    : connectionUnavailableReason(connection)
  if (unavailable) return `${unavailable} · ${connection.server}`
  void secrets().version.value
  const token = connection.keyId ? secrets().get(connection.keyId) : ''
  const available = token
    ? t('settings.GithubSettings.token_available_on_this_device.8141399a')
    : !connection.keyId && connection.provider === 'forgejo'
      ? t('settings.GithubSettings.public_access_without_a_token.35b758c0')
      : secrets().status.value === 'locked'
        ? t('settings.GithubSettings.synced_keys_locked.1673153c')
        : t('settings.GithubSettings.no_token_on_this_device.a87b4f4f')
  const expiry = connection.expiresAt ? Date.parse(connection.expiresAt) - Date.now() : Infinity
  const rate = config.github.connections?.some(
    (c) => c.id === connection.id && isGithubConnection(c)
  )
    ? connectionClient(connection.id).rate.value
    : null
  return [
    connection.provider === 'forgejo' ? t('settings.GithubSettings.forgejo.f4e62146') : 'GitHub',
    connection.server || 'github.com',
    connection.account?.login ?? t('settings.GithubSettings.account_not_checked.d2a6562d'),
    available,
    rate
      ? t('settings.GithubSettings.value_of_value_requests_remaining.037c7ebe', {
          value0: String(rate.remaining),
          value1: String(rate.limit),
          value2: String(
            rate.reset
              ? t('settings.parts.fa11c9afc868fc1e', {
                  value0: String(new Date(rate.reset).toLocaleTimeString()),
                })
              : ''
          ),
        })
      : '',
    expiry < 7 * 86400000
      ? t('settings.GithubSettings.token_expires_within_seven_days.1b81c28c')
      : '',
    connection.owners.join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}
const connectionStatus = (
  connection: GithubConnection
): { tone: 'green' | 'orange' | 'red' | 'faint'; label: string } => {
  if (!isBrowsableConnection(connection))
    return { tone: 'faint', label: connectionUnavailableReason(connection) }
  void secrets().version.value
  if (connection.keyId && !secrets().get(connection.keyId))
    return {
      tone: 'orange',
      label: t('settings.GithubSettings.token_unavailable_on_this_device.0bd03b33'),
    }
  if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now())
    return { tone: 'red', label: t('settings.GithubSettings.the_token_has_expired.0b52627f') }
  if (connection.checkState === 'refused')
    return { tone: 'red', label: t('settings.GithubSettings.the_server_did_not_accept.1d7560a4') }
  if (connection.checkState === 'error')
    return {
      tone: 'red',
      label: t('settings.GithubSettings.the_last_access_check_failed.72f4e393'),
    }
  if (connection.checkState === 'partial')
    return {
      tone: 'orange',
      label: t('settings.GithubSettings.some_repository_access_checks_failed.1b573ceb'),
    }
  if (connection.checkState === 'ok' || (connection.checkedAt && connection.account))
    return { tone: 'green', label: t('settings.GithubSettings.access_checked.d2518d23') }
  return { tone: 'faint', label: t('settings.GithubSettings.not_checked_yet.881d23f6') }
}
const connectionMenu = (connection: GithubConnection, event: MouseEvent) => {
  const menu = new Menu()
  if (isBrowsableConnection(connection)) {
    menu.addItem((item) =>
      item
        .setTitle(t('settings.GithubSettings.check_access.abb9a172'))
        .setIcon('shield-check')
        .onClick(() => editConnection(connection, true))
    )
    menu.addItem((item) =>
      item
        .setTitle(
          t('settings.GithubSettings.make_default_for_value.ded3e105', {
            value0: String(connection.server || 'github.com'),
          })
        )
        .setIcon('check')
        .setChecked(connection.isDefault)
        .onClick(async () => {
          const current = githubSettingsFrom(config.github),
            binding = connectionBinding(connection)
          current.connections = current.connections.map((c) =>
            connectionBinding(c) === binding ? { ...c, isDefault: c.id === connection.id } : c
          )
          config.github = projectLegacy(githubSettingsFrom(current))
          Object.assign(settings, config.github)
          await config.saveSettings()
        })
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(t('settings.GithubSettings.delete.e2d0a549'))
      .setIcon('trash-2')
      .onClick(() => {
        deletingConnection.value = connection
      })
  )
  menu.showAtMouseEvent(event)
}
const editConnection = (connection: GithubConnection, check = false) => {
  if (!isBrowsableConnection(connection)) return
  newConnection.value = false
  originalConnection = JSON.stringify(connection)
  checkOnOpen.value = check
  editingConnection.value = connection
}
const addConnection = () => {
  newConnection.value = true
  checkOnOpen.value = false
  const id = crypto.randomUUID()
  editingConnection.value = {
    id,
    name: '',
    server: '',
    keyId: keychainId('abele-gh', id),
    owners: [],
    isDefault: false,
  }
}
async function saveConnection(
  connection: GithubConnection,
  token?: string | null,
  rate?: GithubRate
): Promise<void> {
  const current = githubSettingsFrom(config.github)
  const index = current.connections.findIndex((c) => c.id === connection.id)
  if (
    !newConnection.value &&
    (index < 0 || JSON.stringify(current.connections[index]) !== originalConnection)
  ) {
    connectionMessage.value = t(
      'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4'
    )
    return
  }
  const rebound =
    index >= 0 && connectionBinding(current.connections[index]) !== connectionBinding(connection)
  connection = {
    ...connection,
    keyId: rebound
      ? keychainId('abele-gh', crypto.randomUUID())
      : connection.keyId || keychainId('abele-gh', connection.id),
  }
  if (
    connection.provider === 'forgejo' &&
    (newConnection.value || rebound || !current.connections[index]?.keyId) &&
    !token
  )
    connection.keyId = ''
  try {
    if (connection.keyId && token !== undefined) secrets().set(connection.keyId, token ?? '')
  } catch {
    connectionMessage.value = t('settings.GithubSettings.could_not_save_the_token.8edbb7d6')
    return
  }
  if (connection.isDefault) {
    const binding = connectionBinding(connection)
    current.connections = current.connections.map((c) =>
      connectionBinding(c) === binding ? { ...c, isDefault: false } : c
    )
  }
  if (index < 0) current.connections.push(connection)
  else current.connections[index] = connection
  config.github = projectLegacy(githubSettingsFrom(current))
  Object.assign(settings, config.github)
  await config.saveSettings()
  if (rate) connectionClient(connection.id).rate.value = rate
  editingConnection.value = null
  connectionMessage.value = ''
}
async function deleteConnection(): Promise<void> {
  const connection = deletingConnection.value
  if (!connection) return
  const current = githubSettingsFrom(config.github)
  current.connections = current.connections.filter((c) => c.id !== connection.id)
  // An imported duplicate secret slot may still belong to another connection.
  if (
    connection.keyId &&
    !current.connections.some((c) => c.keyId === connection.keyId) &&
    connection.keyId !== current.notifications.boundKeyId &&
    connection.keyId !== current.notifications.keyId
  )
    secrets().forgetLocal(connection.keyId)
  config.github = projectLegacy(githubSettingsFrom(current))
  Object.assign(settings, config.github)
  await config.saveSettings()
  deletingConnection.value = null
}

const settings = reactive<GithubSettings>(githubSettingsFrom(config.github))
const secretVersion = ref(0)
const notificationsInput = ref('')
const confirmingForgetNotifications = ref(false)

// Settings changed on disk — synced from another device — are shown rather than overwritten.
watch(config.version, () => Object.assign(settings, githubSettingsFrom(config.github)))

const storedNotifications = computed(() => {
  void secretVersion.value
  void secrets().version.value
  const id = settings.notifications.boundKeyId ?? settings.notifications.keyId
  return id ? secrets().get(id) : ''
})

const save = async () => {
  config.github = projectLegacy(githubSettingsFrom(settings))
  Object.assign(settings, config.github)
  await config.saveSettings()
}

const widthOptions = [
  {
    value: 'readable',
    display: t('settings.GithubSettings.readable_line_width_like_notes.526184e3'),
  },
  { value: 'custom', display: t('settings.GithubSettings.width_in_pixels.b3f8f713') },
  { value: 'full', display: t('settings.GithubSettings.full_width.d34008d2') },
]

const updatePageWidth = (value: string) => {
  settings.pageWidth = value === 'readable' || value === 'full' ? value : 'custom'
  void save()
}

const updatePageWidthPx = (value: string) => {
  const px = Number(value.trim())
  if (!Number.isFinite(px) || px < PAGE_WIDTH_MIN || px > PAGE_WIDTH_MAX) return
  settings.pageWidthPx = Math.round(px)
  saveServer()
}

const markdownOptions = [
  { value: 'preview', display: t('settings.GithubSettings.preview.324b134f') },
  { value: 'code', display: t('settings.GithubSettings.code.340f4630') },
]

const updateMarkdownView = (value: string) => {
  settings.markdownView = value === 'code' ? 'code' : 'preview'
  void save()
}

const displayOptions = [
  { value: 'name', display: t('settings.GithubSettings.name.dcd1d522') },
  { value: 'login', display: t('settings.GithubSettings.login.9d6322c1') },
]

const updateUserDisplay = (value: string) => {
  settings.userDisplay = value === 'login' ? 'login' : 'name'
  void save()
}

const peopleCount = ref(githubUsers().size)
void githubUsers()
  .ready()
  .then(() => (peopleCount.value = githubUsers().size))
const peopleDesc = computed(() =>
  peopleCount.value
    ? t('settings.GithubSettings.value_value_kept_on_this.ceefdd92', {
        count: peopleCount.value,
      })
    : t('settings.GithubSettings.none_kept_on_this_device.bfb58c42')
)
const clearPeople = async () => {
  await githubUsers().clear()
  peopleCount.value = 0
}

const toggle = (key: 'enabled' | 'openLinks') => {
  settings[key] = !settings[key]
  void save()
}

const saveServer = debounce((): void => void save(), 500)

/** `owner/repo` of a pinned address, and the server it is on. */
const pinName = (url: string) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).slice(0, 2).join('/')
  } catch {
    return url
  }
}
const pinHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
const unpin = (url: string) => {
  settings.pinnedRepos = settings.pinnedRepos.filter((p) => p.url !== url)
  void save()
}

const updateDefaultRepo = (value: string) => {
  settings.defaultRepo = value.trim()
  saveServer()
}

const updateSearchLimit = (value: string) => {
  const mb = Number(value.trim())
  if (!Number.isFinite(mb) || mb <= 0) return
  settings.searchLimitMb = Math.round(mb)
  saveServer()
}

const saveNotificationsToken = () => {
  const value = notificationsInput.value.trim()
  if (!value) return
  settings.notifications = {
    keyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
    boundKeyId: GITHUB_NOTIFICATIONS_TOKEN_KEY_ID,
    boundServer: settings.server,
  }
  secrets().set(GITHUB_NOTIFICATIONS_TOKEN_KEY_ID, value)
  notificationsInput.value = ''
  secretVersion.value++
  resetGithubClients()
  void save()
}

const forgetNotificationsToken = () => {
  const keyId = settings.notifications.boundKeyId ?? settings.notifications.keyId
  if (keyId) secrets().set(keyId, '')
  settings.notifications = { keyId: '' }
  secretVersion.value++
  resetGithubClients()
  void save()
}
</script>
