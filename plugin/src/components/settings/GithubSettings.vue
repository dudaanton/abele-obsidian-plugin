<template>
  <div class="abele-settings__github">
    <Setting
      name="GitHub"
      desc="Open GitHub issues, pull requests, discussions, commits and files in tabs here. Read only: nothing is ever written to GitHub."
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
        title="Access"
        desc="A fine-grained personal access token with read-only access to Contents, Issues, Pull requests and Discussions for the repositories you want to read. Without one, only public repositories can be read, 60 requests an hour, and discussions not at all."
      >
        <Setting name="Token" desc="Stored in the keychain, never in the settings file.">
          <div class="abele-github-settings__secret">
            <span v-if="masked" class="abele-github-settings__mask">{{ masked }}</span>
            <div class="abele-github-settings__row">
              <input
                v-model="tokenInput"
                type="password"
                class="abele-obsidian-input"
                :placeholder="masked ? 'New token...' : 'github_pat_...'"
                @keydown.enter="saveToken"
              />
              <Icon
                v-if="tokenInput"
                icon="check"
                with-bg
                tooltip="Save the token"
                @click="saveToken"
              />
              <Icon
                v-else-if="masked"
                icon="trash-2"
                with-bg
                tooltip="Forget the token"
                @click="confirmingForget = true"
              />
            </div>
          </div>
        </Setting>

        <Setting
          name="Server"
          desc="Only for GitHub Enterprise: its address, like https://github.example.com. Leave empty for github.com."
        >
          <Input
            :model-value="settings.server"
            placeholder="github.com"
            @update:model-value="updateServer"
          />
        </Setting>

        <Setting
          name="Check access"
          desc="Ask GitHub what the token can read. Give a repository — owner/name or any link into it — to try each permission on it; leave it empty to see only whose token it is."
        >
          <div class="abele-github-settings__row abele-github-settings__row_wrap">
            <Input
              v-model="checkRepo"
              class="abele-github-settings__repo"
              placeholder="owner/repo or a GitHub link"
            />
            <Button
              text="Check"
              :disabled="checking"
              tooltip="Send a few read requests to GitHub with the token and show what each one answers"
              @click="check"
            />
          </div>
        </Setting>
        <EmptyState v-if="checkResult" :text="checkResult" />
        <GithubAccessReport v-if="report" :report="report" />
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

    <ConfirmModal
      v-if="confirmingForget"
      title="Forget the GitHub token"
      message="Remove the token from the keychain? Private repositories and discussions stop opening until a new one is set."
      confirm-text="Forget"
      confirm-tooltip="Remove the token from the keychain"
      @confirm="forgetToken"
      @close="confirmingForget = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubAccessReport from './GithubAccessReport.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { GITHUB_TOKEN_KEY_ID, githubSettingsFrom, type GithubSettings } from '@/github/settings'
import { checkGithubAccess, resetGithubClients } from '@/github/GithubService'
import type { AccessReport } from '@/github/accessCheck'

const config = AbeleConfig.getInstance()
const { app } = GlobalStore.getInstance()

const settings = reactive<GithubSettings>(githubSettingsFrom(config.github))
const tokenInput = ref('')
const secretVersion = ref(0)
const checking = ref(false)
const checkResult = ref('')
const checkRepo = ref('')
const report = ref<AccessReport | null>(null)
const confirmingForget = ref(false)

// Settings changed on disk — synced from another device — are shown rather than overwritten.
watch(config.version, () => Object.assign(settings, githubSettingsFrom(config.github)))

const masked = computed(() => {
  void secretVersion.value
  const secret = settings.keyId ? app.secretStorage.getSecret(settings.keyId) : ''
  if (!secret) return ''
  return secret.length <= 8 ? '••••••••' : `${secret.slice(0, 4)}••••${secret.slice(-4)}`
})

const save = async () => {
  config.github = { ...settings }
  resetGithubClients()
  checkResult.value = ''
  report.value = null
  await config.saveSettings()
}

const toggle = (key: 'enabled' | 'openLinks') => {
  settings[key] = !settings[key]
  void save()
}

const saveServer = debounce((): void => void save(), 500)

const updateServer = (value: string) => {
  settings.server = value.trim()
  saveServer()
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

const saveToken = () => {
  const value = tokenInput.value.trim()
  if (!value) return
  settings.keyId = GITHUB_TOKEN_KEY_ID
  app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, value)
  tokenInput.value = ''
  secretVersion.value++
  void save()
}

const forgetToken = () => {
  if (settings.keyId) app.secretStorage.setSecret(settings.keyId, '')
  settings.keyId = ''
  secretVersion.value++
  void save()
}

const check = async () => {
  checking.value = true
  report.value = null
  checkResult.value = 'Asking GitHub…'
  try {
    report.value = await checkGithubAccess(checkRepo.value)
    checkResult.value = ''
  } catch (e) {
    checkResult.value = e instanceof Error ? e.message : String(e)
  } finally {
    checking.value = false
  }
}
</script>

<style lang="scss">
.abele-github-settings {
  &__secret {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-1);
  }

  &__mask {
    font-family: var(--font-monospace);
    font-size: var(--font-small);
    color: var(--text-muted);
  }

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
