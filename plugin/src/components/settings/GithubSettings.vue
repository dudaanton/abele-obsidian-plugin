<template>
  <div class="abele-settings__github">
    <Setting
      name="GitHub"
      desc="Open GitHub issues, pull requests, discussions, commits and files in tabs here, and your notifications in a sidebar. Nothing is written to GitHub except marking notifications read."
    >
      <Checkbox :is-enabled="settings.enabled" @toggle="toggle('enabled')" />
    </Setting>

    <template v-if="settings.enabled">
      <Setting
        name="Open GitHub links in Obsidian"
        desc="A click on a supported GitHub link in a note opens it in a tab here. Other GitHub links, and any link clicked with Alt held, still go to the browser."
      >
        <Checkbox :is-enabled="settings.openLinks" @toggle="toggle('openLinks')" />
      </Setting>

      <Setting
        name="Default repository"
        desc="Where the command Open GitHub link or item looks up a bare #123, a title, a branch or a commit when no GitHub tab is open. owner/repo, or a link into it."
      >
        <Input
          :model-value="settings.defaultRepo"
          placeholder="owner/repo"
          @update:model-value="updateDefaultRepo"
        />
      </Setting>

      <Section
        title="Pinned repositories"
        desc="First in Open GitHub repository…, and carried to your other devices with the settings. Pin one from that picker (Alt+Enter) or from a GitHub tab's menu."
      >
        <EmptyState v-if="!settings.pinnedRepos.length" text="Nothing pinned yet." />
        <Setting
          v-for="pin in settings.pinnedRepos"
          :key="pin.url"
          :name="pinName(pin.url)"
          :desc="pinHost(pin.url)"
        >
          <Icon icon="pin-off" with-bg tooltip="Unpin this repository" @click="unpin(pin.url)" />
        </Setting>
      </Section>

      <Section
        title="Connections"
        desc="A fine-grained personal access token with read-only access to Contents, Issues, Pull requests and Discussions for the repositories you want to read. Each connection has its own server and account; choose one default per server. Notifications need a classic token with the notifications scope, set in Notifications token below."
      >
        <EmptyState
          v-if="!settings.connections.length"
          text="No connections. Public github.com repositories are read anonymously."
        />
        <Setting
          v-for="connection in settings.connections"
          :key="connection.id"
          :name="connection.name + (connection.isDefault ? ' · Default' : '')"
          :desc="connectionDescription(connection)"
        >
          <Avatar :name="connection.account?.login || connection.name" :src="connection.account?.avatarUrl" />
          <Button
            text="Check"
            tooltip="Check this connection's account and repository access"
            @click="editConnection(connection, true)"
          />
          <Button
            text="Edit"
            tooltip="Edit this connection's name, server, token and owner preferences"
            @click="editConnection(connection)"
          />
          <Button
            text="Delete"
            tooltip="Remove this connection after confirmation"
            @click="deletingConnection = connection"
          />
        </Setting>
        <EmptyState v-if="connectionMessage" :text="connectionMessage" />
        <Button
          text="Add connection"
          tooltip="Create a connection with its own keychain token"
          @click="addConnection"
        />
      </Section>

      <Section
        title="Notifications"
        desc="A fine-grained personal access token can read repository content, but GitHub serves notifications only to a classic token with the notifications scope. Set the Notifications token below for the retained single inbox. It stays bound to the server where it was set."
      >
        <Setting
          name="Notifications token"
          desc="Optional. A classic personal access token with the notifications scope, used only by the notifications panel: GitHub does not let a fine-grained token read notifications. Empty: the panel uses the default connection. Stored in the keychain."
        >
          <SecretField
            v-model="notificationsInput"
            :value="storedNotifications"
            placeholder="ghp_..."
            replace-placeholder="New token..."
            save-tooltip="Save the notifications token"
            what="The notifications token"
            @save="saveNotificationsToken"
          >
            <template #actions>
              <Icon
                icon="trash-2"
                with-bg
                tooltip="Forget the notifications token"
                @click="confirmingForgetNotifications = true"
              />
            </template>
          </SecretField>
        </Setting>
      </Section>

      <Section title="Pages" desc="How a GitHub tab lays out what it shows.">
        <Setting
          name="Page width"
          desc="How wide the text of a tab runs: conversations, commit messages, rendered markdown and folder pages. Diffs and code always take the whole tab."
        >
          <Dropdown
            :options="widthOptions"
            :model-value="settings.pageWidth"
            @update:model-value="updatePageWidth"
          />
        </Setting>
        <Setting
          v-if="settings.pageWidth === 'custom'"
          name="Width in pixels"
          :desc="`From ${PAGE_WIDTH_MIN} to ${PAGE_WIDTH_MAX}. A tab narrower than this uses what it has.`"
        >
          <Input
            :model-value="String(settings.pageWidthPx)"
            placeholder="1000"
            @update:model-value="updatePageWidthPx"
          />
        </Setting>
        <Setting
          name="Markdown files open as"
          desc="Preview: rendered, and a link to lines of the file marks the paragraphs, lists or code blocks that hold them. Code: the file as it is written, line by line. The switch above a file changes it for that tab."
        >
          <Dropdown
            :options="markdownOptions"
            :model-value="settings.markdownView"
            @update:model-value="updateMarkdownView"
          />
        </Setting>
      </Section>

      <Section
        title="People"
        desc="Who wrote an issue, a comment, a review or a commit, with their picture. Names and pictures are asked of GitHub once and kept on this device for a week."
      >
        <Setting
          name="Show people by"
          desc="Their name as their profile gives it, or their login. The other one is in the tooltip, and a click or a tap on a person swaps the two right there. Someone whose profile has no name is shown by login either way."
        >
          <Dropdown
            :options="displayOptions"
            :model-value="settings.userDisplay"
            @update:model-value="updateUserDisplay"
          />
        </Setting>
        <Setting name="Kept names and pictures" :desc="peopleDesc">
          <Button
            text="Clear"
            :disabled="!peopleCount"
            :tooltip="
              peopleCount
                ? 'Forget every kept name and picture; they are asked for again as people are shown'
                : 'Nothing is kept yet'
            "
            @click="clearPeople"
          />
        </Setting>
      </Section>

      <Section
        title="Code search"
        desc="Search the code of the version a tab shows, and go to definition, from inside the tab. The repository at that version is downloaded once a session and searched here."
      >
        <Setting
          name="Largest repository to download (MB)"
          desc="Its files at that version, added up. A larger one is searched through GitHub's own code search instead, which knows only the default branch and needs a token."
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
      :connections="settings.connections"
      :is-new="newConnection"
      :check-on-open="checkOnOpen"
      :error-message="connectionMessage"
      @save="saveConnection"
      @close="editingConnection = null"
    />
    <ConfirmModal
      v-if="deletingConnection"
      title="Delete GitHub connection"
      :message="`Delete ${deletingConnection.name}? Its local token will be forgotten; other connections are kept.`"
      confirm-tooltip="Delete this connection and forget its local token"
      @confirm="deleteConnection"
      @close="deletingConnection = null"
    />
    <ConfirmModal
      v-if="confirmingForgetNotifications"
      title="Forget the notifications token"
      message="Remove the notifications token from the keychain? The notifications panel goes back to the main token."
      confirm-text="Forget"
      confirm-tooltip="Remove the notifications token from the keychain"
      @confirm="forgetNotificationsToken"
      @close="confirmingForgetNotifications = false"
    />
  </div>
</template>

<script setup lang="ts">
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
import Avatar from '../obsidian/Avatar.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import GithubConnectionEditor from './GithubConnectionEditor.vue'
import { keychainId } from '@/secrets/keychainId'
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
import { projectLegacy } from '@/github/connections'
import { endpoints } from '@/github/urls'

const config = AbeleConfig.getInstance()
const editingConnection = ref<GithubConnection | null>(null)
const deletingConnection = ref<GithubConnection | null>(null)
const newConnection = ref(false)
const checkOnOpen = ref(false)
const connectionMessage = ref('')
let originalConnection = ''

const connectionDescription = (connection: GithubConnection) => {
  void secrets().version.value
  const token = connection.keyId ? secrets().get(connection.keyId) : ''
  const available = token
    ? 'Token available on this device'
    : secrets().status.value === 'locked'
      ? 'Synced keys locked'
      : 'No token on this device'
  const expiry = connection.expiresAt ? Date.parse(connection.expiresAt) - Date.now() : Infinity
  const rate = config.github.connections?.some(c=>c.id===connection.id) ? connectionClient(connection.id).rate.value : null
  return [
    connection.account?.login ?? 'Account not checked',
    connection.server || 'github.com',
    available,
    rate ? `${rate.remaining} of ${rate.limit} requests remaining${rate.reset ? ` · resets ${new Date(rate.reset).toLocaleTimeString()}` : ''}` : '',
    expiry < 7 * 86400000 ? 'Token expires within seven days' : '',
    connection.owners.join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}
const editConnection = (connection: GithubConnection, check = false) => {
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
async function saveConnection(connection: GithubConnection, token?: string | null): Promise<void> {
  connection = { ...connection, keyId: connection.keyId || keychainId('abele-gh', connection.id) }
  const current = githubSettingsFrom(config.github)
  const index = current.connections.findIndex((c) => c.id === connection.id)
  if (
    !newConnection.value &&
    (index < 0 || JSON.stringify(current.connections[index]) !== originalConnection)
  ) {
    connectionMessage.value =
      'This connection changed elsewhere. Close this draft and edit its current settings.'
    return
  }
  try {
    if (token !== undefined) secrets().set(connection.keyId, token ?? '')
  } catch {
    connectionMessage.value =
      'Could not save the token to the keychain. Nothing was changed; try again.'
    return
  }
  if (connection.isDefault) {
    const origin = endpoints(connection.server).origin
    current.connections = current.connections.map((c) =>
      endpoints(c.server).origin === origin ? { ...c, isDefault: false } : c
    )
  }
  if (index < 0) current.connections.push(connection)
  else current.connections[index] = connection
  config.github = projectLegacy(githubSettingsFrom(current))
  Object.assign(settings, config.github)
  await config.saveSettings()
  editingConnection.value = null
  connectionMessage.value = ''
}
async function deleteConnection(): Promise<void> {
  const connection = deletingConnection.value
  if (!connection) return
  const current = githubSettingsFrom(config.github)
  current.connections = current.connections.filter((c) => c.id !== connection.id)
  // An imported duplicate secret slot may still belong to another connection.
  if (connection.keyId && !current.connections.some((c) => c.keyId === connection.keyId))
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
  { value: 'readable', display: 'Readable line width, like notes' },
  { value: 'custom', display: 'Width in pixels' },
  { value: 'full', display: 'Full width' },
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
  { value: 'preview', display: 'Preview' },
  { value: 'code', display: 'Code' },
]

const updateMarkdownView = (value: string) => {
  settings.markdownView = value === 'code' ? 'code' : 'preview'
  void save()
}

const displayOptions = [
  { value: 'name', display: 'Name' },
  { value: 'login', display: 'Login' },
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
    ? `${peopleCount.value} ${peopleCount.value === 1 ? 'person is' : 'people are'} kept on this device. Clear them to have every name and picture asked for again — after someone changed theirs, say.`
    : 'None kept on this device yet.'
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

<style lang="scss">
.abele-github-settings {
  &__row {
    display: flex;
    align-items: center;
    gap: var(--size-4-1);
  }

  // On a phone Obsidian makes every field and button in a settings row full width, so the two
  // take a line each there rather than squeezing the field to nothing beside the button.
  &__row_wrap {
    flex-wrap: wrap;
  }

  &__repo {
    flex: 1 1 12em;
    min-width: 0;
  }
}
</style>
