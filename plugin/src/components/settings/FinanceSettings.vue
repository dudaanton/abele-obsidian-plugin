<template>
  <div class="abele-settings__finance">
    <h3>Transactions</h3>
    <Setting
      name="Transaction path template"
      desc="Template for new transaction file paths. Variables: {{title}}, {{date:FORMAT}}, {{from}}, {{to}}, {{amount}}, {{currency}}."
    >
      <Input
        :model-value="transactionPathTemplate"
        placeholder="e.g. Finance/Transactions/{{date:YYYY/MM}}/{{title}}"
        @update:model-value="transactionPathTemplateChanged"
      />
    </Setting>
    <Setting
      name="Transaction template note"
      desc="Path to a template note used when creating new transactions."
    >
      <Search
        :model-value="transactionTemplatePath"
        placeholder="Path to template note"
        :suggester="FileSuggest"
        @update:model-value="transactionTemplatePathChanged"
      />
    </Setting>
    <Setting name="Default currency" desc="Default currency code for new transactions.">
      <Input
        :model-value="defaultCurrency"
        placeholder="e.g. EUR"
        @update:model-value="defaultCurrencyChanged"
      />
    </Setting>
    <Setting
      name="Pinned currencies"
      desc="Comma-separated currencies to show balance summaries in the sidebar. Order is preserved."
    >
      <Input
        :model-value="pinnedCurrencies"
        placeholder="e.g. EUR, USD, GBP"
        @update:model-value="pinnedCurrenciesChanged"
      />
    </Setting>

    <h3>Firefly III Migration</h3>
    <Setting name="Firefly III URL" desc="Base URL of your Firefly III instance.">
      <Input
        :model-value="fireflyBaseUrl"
        placeholder="e.g. https://firefly.example.com"
        @update:model-value="fireflyBaseUrlChanged"
      />
    </Setting>
    <Setting
      name="Firefly III token"
      desc="Personal Access Token for Firefly III API. Stored in the keychain, never in the settings file."
    >
      <SecretField
        v-model="tokenInput"
        :value="fireflyToken"
        placeholder="Enter your Firefly III token"
        replace-placeholder="New token..."
        save-tooltip="Save the token"
        what="The token"
        @save="saveToken"
      >
        <template #actions>
          <Icon icon="trash-2" with-bg tooltip="Forget the token" @click="forgetToken" />
        </template>
      </SecretField>
    </Setting>
    <Setting name="Accounts folder" desc="Folder for account notes created during migration.">
      <Search
        :model-value="accountsFolder"
        placeholder="Enter accounts folder path"
        :suggester="FolderSuggest"
        @update:model-value="accountsFolderChanged"
      />
    </Setting>
    <Setting name="Categories folder" desc="Folder for category notes created during migration.">
      <Search
        :model-value="financeCategoriesFolder"
        placeholder="Enter categories folder path"
        :suggester="FolderSuggest"
        @update:model-value="financeCategoriesFolderChanged"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { fireflyToken as readFireflyToken, setFireflyToken } from '@/secrets/legacy'
import { computed, ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Search from '../obsidian/Search.vue'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import SecretField from './SecretField.vue'
import { secrets } from '@/secrets/SecretStore'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'

const transactionPathTemplate = ref(AbeleConfig.getInstance().transactionPathTemplate)
const transactionTemplatePath = ref(AbeleConfig.getInstance().transactionTemplatePath)
const accountsFolder = ref(AbeleConfig.getInstance().accountsFolder)
const financeCategoriesFolder = ref(AbeleConfig.getInstance().financeCategoriesFolder)
const defaultCurrency = ref(AbeleConfig.getInstance().defaultCurrency)
const pinnedCurrencies = ref(AbeleConfig.getInstance().pinnedCurrencies)
const fireflyBaseUrl = ref(AbeleConfig.getInstance().fireflyBaseUrl)
const tokenInput = ref('')
/** Bumped on a save here, for a keychain that changes nothing the store can see. */
const tokenVersion = ref(0)
const fireflyToken = computed(() => {
  void tokenVersion.value
  void secrets().version.value
  return readFireflyToken()
})

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.transactionPathTemplate = transactionPathTemplate.value.trim()
  config.transactionTemplatePath = transactionTemplatePath.value.trim()
  config.accountsFolder = accountsFolder.value.endsWith('/')
    ? accountsFolder.value.slice(0, -1).trim()
    : accountsFolder.value.trim()
  config.financeCategoriesFolder = financeCategoriesFolder.value.endsWith('/')
    ? financeCategoriesFolder.value.slice(0, -1).trim()
    : financeCategoriesFolder.value.trim()
  config.defaultCurrency = defaultCurrency.value.trim().toUpperCase()
  config.pinnedCurrencies = pinnedCurrencies.value.trim()
  config.fireflyBaseUrl = fireflyBaseUrl.value.trim().replace(/\/$/, '')

  await config.saveSettings()
}, 500)

const transactionPathTemplateChanged = (value: string) => {
  transactionPathTemplate.value = value
  saveSettings()
}

const transactionTemplatePathChanged = (value: string) => {
  transactionTemplatePath.value = value.trim()
  saveSettings()
}

const accountsFolderChanged = (value: string) => {
  accountsFolder.value = value.trim()
  saveSettings()
}

const financeCategoriesFolderChanged = (value: string) => {
  financeCategoriesFolder.value = value.trim()
  saveSettings()
}

const defaultCurrencyChanged = (value: string) => {
  defaultCurrency.value = value.trim()
  saveSettings()
}

const pinnedCurrenciesChanged = (value: string) => {
  pinnedCurrencies.value = value
  saveSettings()
}

const fireflyBaseUrlChanged = (value: string) => {
  fireflyBaseUrl.value = value.trim()
  saveSettings()
}

const saveToken = () => {
  if (!tokenInput.value.trim()) return
  setFireflyToken(tokenInput.value)
  tokenInput.value = ''
  tokenVersion.value++
}

const forgetToken = () => {
  setFireflyToken('')
  tokenVersion.value++
}
</script>
