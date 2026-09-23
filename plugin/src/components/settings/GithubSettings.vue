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

        <Setting name="Check access" :desc="checkResult || 'Ask GitHub who the token belongs to.'">
          <Button
            text="Check"
            :disabled="checking"
            tooltip="Send one request to GitHub with the token and show what it answers"
            @click="check"
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
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { GITHUB_TOKEN_KEY_ID, githubSettingsFrom, type GithubSettings } from '@/github/settings'
import { githubClient, resetGithubClients } from '@/github/GithubService'

const config = AbeleConfig.getInstance()
const { app } = GlobalStore.getInstance()

const settings = reactive<GithubSettings>(githubSettingsFrom(config.github))
const tokenInput = ref('')
const secretVersion = ref(0)
const checking = ref(false)
const checkResult = ref('')
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
  checkResult.value = 'Asking GitHub…'
  try {
    const client = githubClient()
    if (client.hasToken) {
      const user = await client.get<{ login: string }>('/user')
      checkResult.value = `The token works. It belongs to ${user.login}.`
    } else {
      const limit = await client.get<{ rate: { remaining: number; limit: number } }>('/rate_limit')
      checkResult.value = `GitHub answers without a token: ${limit.rate.remaining} of ${limit.rate.limit} requests left this hour.`
    }
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
}
</style>
