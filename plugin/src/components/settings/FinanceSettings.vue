<template>
  <div class="abele-settings__finance">
    <h3>{{ t('settings.FinanceSettings.transactions.3e5136fd') }}</h3>
    <Setting
      :name="t('settings.FinanceSettings.transaction_path_template.39b564b9')"
      :desc="
        t('settings.FinanceSettings.template_for_new_transaction_file.0e3740ec', {
          literalDate: '{{date:FORMAT}}',
          literal0: String('{{title}}'),
          literal1: String('{{from}}'),
          literal2: String('{{to}}'),
          literal3: String('{{amount}}'),
          literal4: String('{{currency}}'),
        })
      "
    >
      <Input
        :model-value="transactionPathTemplate"
        :placeholder="
          t('settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45', {
            literal1: String('Finance/Transactions/{{date:YYYY/MM}}/{{title}}'),
          })
        "
        @update:model-value="transactionPathTemplateChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.transaction_template_note.010eab6c')"
      :desc="t('settings.FinanceSettings.path_to_a_template_note.397b813a')"
    >
      <Search
        :model-value="transactionTemplatePath"
        :placeholder="t('settings.FinanceSettings.path_to_template_note.18b70a08')"
        :suggester="FileSuggest"
        @update:model-value="transactionTemplatePathChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.default_currency.67e65877')"
      :desc="t('settings.FinanceSettings.default_currency_code_for_new.7d536f52')"
    >
      <Input
        :model-value="defaultCurrency"
        :placeholder="t('settings.FinanceSettings.e_g_eur.00afdaf5', { literal0: String('EUR') })"
        @update:model-value="defaultCurrencyChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.pinned_currencies.b882d6bc')"
      :desc="t('settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698')"
    >
      <Input
        :model-value="pinnedCurrencies"
        :placeholder="
          t('settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64', {
            literal0: String('EUR, USD, GBP'),
          })
        "
        @update:model-value="pinnedCurrenciesChanged"
      />
    </Setting>

    <h3>{{ t('settings.FinanceSettings.exchange_rates.a1875e41') }}</h3>
    <Setting
      :name="t('settings.FinanceSettings.fetch_today_s_rates.c175748e')"
      :desc="t('settings.FinanceSettings.once_a_day_from_a.73d47942')"
    >
      <Checkbox :is-enabled="exchangeRates.enabled" @toggle="fetchRatesToggled" />
    </Setting>
    <template v-if="exchangeRates.enabled">
      <Setting
        :name="t('settings.FinanceSettings.show_sums_in.86b3b3d2')"
        :desc="t('settings.FinanceSettings.the_currency_a_sum_of.42c9988d')"
      >
        <Input
          :model-value="exchangeRates.display"
          placeholder="USD"
          @update:model-value="displayChanged"
        />
      </Setting>
      <!-- Where the rates stand, in one quiet line: their day and source, what failed, which
           currency has none. -->
      <Setting :name="t('settings.FinanceSettings.rates.54dd2169')" :desc="ratesLine">
        <Icon
          icon="refresh-cw"
          :disabled="exchangeRates.updating || !exchangeRates.refresh"
          :tooltip="t('settings.FinanceSettings.fetch_today_s_rates_now.68e35189')"
          @click="exchangeRates.refresh?.()"
        />
      </Setting>
    </template>

    <h3>{{ t('settings.FinanceSettings.firefly_iii_migration.59031cf7') }}</h3>
    <Setting
      :name="t('settings.FinanceSettings.firefly_iii_url.3050cc31')"
      :desc="t('settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a')"
    >
      <Input
        :model-value="fireflyBaseUrl"
        :placeholder="
          t('settings.FinanceSettings.e_g_https_firefly_example.6999e343', {
            literal1: String('https://firefly.example.com'),
          })
        "
        @update:model-value="fireflyBaseUrlChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.firefly_iii_token.45c3acb2')"
      :desc="t('settings.FinanceSettings.personal_access_token_for_firefly.7deff96a')"
    >
      <SecretField
        v-model="tokenInput"
        :value="fireflyToken"
        :placeholder="t('settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788')"
        :replace-placeholder="t('settings.FinanceSettings.new_token.564f08bc')"
        :save-tooltip="t('settings.FinanceSettings.save_the_token.8326f085')"
        :what="t('settings.FinanceSettings.the_token.d22bffce')"
        @save="saveToken"
      >
        <template #actions>
          <Icon
            icon="trash-2"
            with-bg
            :tooltip="t('settings.FinanceSettings.forget_the_token.961a44b9')"
            @click="forgetToken"
          />
        </template>
      </SecretField>
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.accounts_folder.8f9b5bf3')"
      :desc="t('settings.FinanceSettings.folder_for_account_notes_created.dab1fa98')"
    >
      <Search
        :model-value="accountsFolder"
        :placeholder="t('settings.FinanceSettings.enter_accounts_folder_path.93935780')"
        :suggester="FolderSuggest"
        @update:model-value="accountsFolderChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.FinanceSettings.categories_folder.60253c7c')"
      :desc="t('settings.FinanceSettings.folder_for_category_notes_created.9f0764fe')"
    >
      <Search
        :model-value="financeCategoriesFolder"
        :placeholder="t('settings.FinanceSettings.enter_categories_folder_path.306fac3f')"
        :suggester="FolderSuggest"
        @update:model-value="financeCategoriesFolderChanged"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
import dayjs from 'dayjs'
import Checkbox from '../obsidian/Checkbox.vue'
import { exchangeRates, ratesStatus } from '@/finance/rates/exchangeRates'
import { GlobalStore } from '@/stores/GlobalStore'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'

// Both are settings that travel; the store follows them once they are saved.
const fetchRatesToggled = () => {
  const config = AbeleConfig.getInstance()
  config.editSettings(() => {
    config.fetchExchangeRates = !config.fetchExchangeRates
  })
  exchangeRates.enabled = config.fetchExchangeRates
  void config.saveSettings()
}

const saveDisplay = debounce(async () => {
  await AbeleConfig.getInstance().saveSettings()
}, 500)

const displayChanged = (value: string) => {
  const config = AbeleConfig.getInstance()
  config.editSettings(() => {
    config.displayCurrency = value.trim().toUpperCase() || 'USD'
  })
  exchangeRates.display = config.displayCurrency
  saveDisplay()
}

/** Held currencies today's table has no rate for. */
const withoutRate = computed(() => {
  const table = exchangeRates.table
  if (!table) return []
  const held = new Set<string>()
  const list = GlobalStore.getInstance().accountsList.value
  for (const [, account] of list?.accounts ?? [])
    if (account.currency) held.add(account.currency.toUpperCase())
  return [...held].filter((c) => c !== 'USD' && !table.rates[c]).sort()
})

const ratesLine = computed(() => {
  const table = exchangeRates.table
  if (exchangeRates.updating) return t('settings.FinanceSettings.fetching_today_s_rates.1182bcb9')
  if (!table)
    return exchangeRates.lastError
      ? t('settings.FinanceSettings.could_not_fetch_value.ae250f78', {
          value0: String(exchangeRates.lastError),
        })
      : t('settings.FinanceSettings.not_fetched_yet.21ca804f')
  const day = dayjs(table.fetchedOn).format('D MMM')
  const parts = [
    ratesStatus() === 'stale'
      ? t('settings.FinanceSettings.could_not_update_since_value.9af0a0fc', {
          value0: String(day),
          value1: String(exchangeRates.lastError ? `: ${exchangeRates.lastError}` : ''),
        })
      : t('settings.FinanceSettings.from_value_value.11c05045', {
          value0: String(day),
          value1: String(exchangeRates.source),
        }),
  ]
  if (withoutRate.value.length)
    parts.push(
      t('settings.FinanceSettings.no_rate_for_value_left.b8718978', {
        value0: String(withoutRate.value.join(', ')),
      })
    )
  return `${parts.join('. ')}.`
})

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
  const before = keyDestinations(config)
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

  acceptIntroducedDestinations(before, keyDestinations(config))
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
