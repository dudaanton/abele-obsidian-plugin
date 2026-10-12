<template>
  <ObsidianModal size="wide" title="Import from Firefly III" @close="emit('close')">
    <div class="abele-migrate-firefly-modal">
      <Setting name="Firefly III address" desc="Where your Firefly III opens in a browser.">
        <Input v-model="baseUrl" placeholder="https://firefly.example.com" />
      </Setting>
      <Setting name="Personal access token" desc="In Firefly III: Profile, then OAuth.">
        <Input v-model="token" password placeholder="Token" />
      </Setting>
      <Setting
        name="Account note names"
        desc="{{name}}, {{currency}} and {{accountType}} are filled in from each account."
      >
        <Input v-model="accountNameTemplate" placeholder="{{name}} {{currency}}" />
      </Setting>
      <Setting name="Try first" desc="Shows what would be created and writes nothing.">
        <Checkbox :is-enabled="dryRun" @toggle="dryRun = !dryRun" />
      </Setting>

      <RunReport
        v-if="migrating || completed"
        class="abele-migrate-firefly-modal__report"
        :running="migrating"
        :status="statusText"
        :percent="progressPercent"
        :facts="facts"
        :errors="result.errors"
      >
        <template v-if="completed && result.preview">
          <ShortList
            v-if="result.preview.accounts.length"
            :heading="dryRun ? 'Accounts it would create' : 'Accounts'"
            :items="result.preview.accounts.map((title) => ({ title }))"
          />
          <ShortList
            v-if="result.preview.categories.length"
            :heading="dryRun ? 'Categories it would create' : 'Categories'"
            :items="result.preview.categories.map((title) => ({ title }))"
          />
          <ShortList
            v-if="result.preview.transactions.length"
            heading="Transactions, the first 50"
            :items="result.preview.transactions.map((title) => ({ title }))"
          />
        </template>
        <!-- Each account's balance as Firefly has it beside the one the notes add up to. -->
        <div
          v-if="completed && !dryRun && verificationResults.length > 0"
          class="abele-migrate-firefly-modal__verification"
        >
          <GroupHeading label="Balances checked">
            {{ verificationResults.filter((v) => v.match).length }} of
            {{ verificationResults.length }} agree
          </GroupHeading>
          <EntryRow
            v-for="v in verificationResults"
            :key="v.account"
            class="abele-migrate-firefly-modal__verify-row"
          >
            {{ v.account }}
            <template #codes>
              <ResultMark
                :state="v.match ? 'done' : 'error'"
                :text="
                  v.match
                    ? 'The notes add up to Firefly\'s balance'
                    : `The notes add up to ${v.diff} ${v.currency} more than Firefly`
                "
              />
            </template>
            <template #meta>
              <span>Firefly {{ v.fireflyBalance }} {{ v.currency }}</span>
              <span>notes {{ v.calculatedBalance }} {{ v.currency }}</span>
              <span v-if="!v.match" class="abele-migrate-firefly-modal__verify-diff"
                >differs by {{ v.diff }}</span
              >
            </template>
          </EntryRow>
        </div>
      </RunReport>
    </div>
    <template #footer>
      <ObsidianButton
        :text="dryRun ? 'Try' : 'Import'"
        :tooltip="
          dryRun
            ? 'See what would be created, writing nothing'
            : 'Read accounts, categories and transactions from Firefly III and write them as notes'
        "
        accent
        :loading="migrating"
        :disabled="migrating || !baseUrl || !token"
        @click="startMigration"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { fireflyToken, setFireflyToken } from '@/secrets/legacy'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Checkbox from './obsidian/Checkbox.vue'
import EntryRow from './obsidian/EntryRow.vue'
import GroupHeading from './obsidian/GroupHeading.vue'
import ResultMark from './obsidian/ResultMark.vue'
import RunReport from './obsidian/RunReport.vue'
import ShortList from './obsidian/ShortList.vue'
import { computed, ref } from 'vue'
import { request as requestUrl } from '@/helpers/http'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  migrateFromFirefly,
  type MigrationConfig,
  type MigrationResult,
} from '@/commands/migrateFromFirefly'
import { GlobalStore } from '@/stores/GlobalStore'
import { cleanFileName } from '@/helpers/pathsHelpers'
import dayjs from 'dayjs'

const config = AbeleConfig.getInstance()

const baseUrl = ref(config.fireflyBaseUrl || '')
const token = ref(fireflyToken())
const accountNameTemplate = ref('{{name}} {{currency}}')
const dryRun = ref(false)

const migrating = ref(false)
const completed = ref(false)
const statusText = ref('')
const progressPercent = ref(0)

const result = ref<MigrationResult>({
  accountsCreated: 0,
  categoriesCreated: 0,
  transactionsCreated: 0,
  skipped: 0,
  errors: [],
  preview: { accounts: [], categories: [], transactions: [] },
})

interface VerificationRow {
  account: string
  currency: string
  fireflyBalance: number
  calculatedBalance: number
  diff: number
  match: boolean
}

const verificationResults = ref<VerificationRow[]>([])

const facts = computed(() =>
  [
    { label: 'Accounts', value: result.value.accountsCreated },
    { label: 'Categories', value: result.value.categoriesCreated },
    { label: 'Transactions', value: result.value.transactionsCreated },
    { label: 'Skipped', value: result.value.skipped },
  ].filter((fact) => fact.value)
)

const startMigration = async () => {
  migrating.value = true
  completed.value = false
  statusText.value = 'Starting...'
  progressPercent.value = 0
  verificationResults.value = []

  // Save settings for future use
  const before = keyDestinations(config)
  config.fireflyBaseUrl = baseUrl.value.trim().replace(/\/$/, '')
  setFireflyToken(token.value)
  acceptIntroducedDestinations(before, keyDestinations(config))
  await config.saveSettings()

  const migrationConfig: MigrationConfig = {
    baseUrl: config.fireflyBaseUrl,
    token: fireflyToken(),
    accountsFolder: config.accountsFolder,
    categoriesFolder: config.financeCategoriesFolder,
    accountNameTemplate: accountNameTemplate.value.trim() || '{{name}} {{currency}}',
    transactionPathTemplate: config.transactionPathTemplate,
    dryRun: dryRun.value,
  }

  result.value = await migrateFromFirefly(migrationConfig, (progress) => {
    statusText.value = progress.stage
    progressPercent.value = progress.percent
    result.value = { ...progress.result }
  })

  // Balance verification
  if (!dryRun.value) {
    statusText.value = 'Verifying balances...'
    verificationResults.value = await verifyBalances(migrationConfig)
  }

  migrating.value = false
  completed.value = true
  statusText.value = dryRun.value ? 'Dry run complete' : 'Migration complete'
  progressPercent.value = 100
}

async function verifyBalances(migrationConfig: MigrationConfig): Promise<VerificationRow[]> {
  const rows: VerificationRow[] = []

  try {
    const url = `${migrationConfig.baseUrl}/api/v1/accounts?type=asset`
    const response = await requestUrl({
      url,
      headers: {
        Authorization: `Bearer ${migrationConfig.token}`,
        Accept: 'application/json',
      },
    })

    if (response.status >= 400) return rows

    const json = response.json
    const accounts = json.data || []

    const balanceIndex = GlobalStore.getInstance().balanceIndex.value
    const accountsList = GlobalStore.getInstance().accountsList.value

    if (!balanceIndex || !accountsList) return rows

    const today = dayjs()

    for (const acc of accounts) {
      const attr = acc.attributes
      if (!attr.active) continue

      const fireflyBalance = parseFloat(attr.current_balance) || 0
      const name = cleanFileName(attr.name)

      // Find the account in our list
      let accountPath: string | null = null
      for (const [path, account] of accountsList.accounts) {
        if (account.accountName === name || account.accountName === `${name}.md`) {
          accountPath = path
          break
        }
      }

      if (!accountPath) continue

      const calculatedBalance = balanceIndex.getBalanceAtDate(accountPath, today)
      const diff = Math.round((fireflyBalance - calculatedBalance) * 100) / 100

      rows.push({
        account: attr.name,
        currency: attr.currency_code,
        fireflyBalance,
        calculatedBalance,
        diff,
        match: Math.abs(diff) < 0.01,
      })
    }
  } catch (e) {
    console.error('Balance verification failed:', e)
  }

  return rows
}

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<style lang="scss">
.abele-migrate-firefly-modal__report {
  margin-top: var(--size-4-4);
}

.abele-migrate-firefly-modal__verification {
  display: flex;
  flex-direction: column;

  .abele-group-heading {
    margin-bottom: var(--size-2-2);
  }
}

.abele-migrate-firefly-modal__verify-diff {
  color: var(--text-error);
}
</style>
