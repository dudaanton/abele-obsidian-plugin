<template>
  <ObsidianModal title="Migrate from Firefly III" @close="emit('close')">
    <div class="abele-migrate-firefly-modal">
      <Setting name="Firefly III URL" desc="Base URL of your Firefly III instance.">
        <Input v-model="baseUrl" placeholder="e.g. https://firefly.example.com" />
      </Setting>
      <Setting name="Personal Access Token" desc="Generate in Firefly III → Profile → OAuth.">
        <Input v-model="token" placeholder="Enter your token" />
      </Setting>
      <Setting
        name="Account name template"
        desc="Template for account note names. Variables: {{name}}, {{currency}}, {{accountType}}."
      >
        <Input v-model="accountNameTemplate" placeholder="e.g. {{name}} {{currency}}" />
      </Setting>
      <Setting name="Dry run" desc="Preview what will be created without writing files.">
        <Checkbox :is-enabled="dryRun" @toggle="dryRun = !dryRun" />
      </Setting>

      <div class="abele-migrate-firefly-modal__buttons">
        <ObsidianButton
          text="Start migration"
          accent
          :disabled="migrating || !baseUrl || !token"
          @click="startMigration"
        />
      </div>

      <div v-if="migrating || completed" class="abele-migrate-firefly-modal__progress">
        <div class="abele-migrate-firefly-modal__status">{{ statusText }}</div>
        <div class="abele-migrate-firefly-modal__bar-container">
          <div class="abele-migrate-firefly-modal__bar" :style="{ width: progressPercent + '%' }" />
        </div>
        <div class="abele-migrate-firefly-modal__counts">
          <span v-if="result.accountsCreated">Accounts: {{ result.accountsCreated }}</span>
          <span v-if="result.categoriesCreated">Categories: {{ result.categoriesCreated }}</span>
          <span v-if="result.transactionsCreated"
            >Transactions: {{ result.transactionsCreated }}</span
          >
          <span v-if="result.skipped">Skipped: {{ result.skipped }}</span>
        </div>
      </div>

      <template v-if="completed && result.preview">
        <div v-if="result.preview.accounts.length" class="abele-migrate-firefly-modal__preview">
          <h4>Accounts ({{ result.preview.accounts.length }})</h4>
          <div
            v-for="(item, i) in result.preview.accounts"
            :key="'a' + i"
            class="abele-migrate-firefly-modal__preview-item"
          >
            {{ item }}
          </div>
        </div>

        <div v-if="result.preview.categories.length" class="abele-migrate-firefly-modal__preview">
          <h4>Categories ({{ result.preview.categories.length }})</h4>
          <div
            v-for="(item, i) in result.preview.categories"
            :key="'c' + i"
            class="abele-migrate-firefly-modal__preview-item"
          >
            {{ item }}
          </div>
        </div>

        <div v-if="result.preview.transactions.length" class="abele-migrate-firefly-modal__preview">
          <h4>
            Transactions ({{ result.transactionsCreated || result.preview.transactions.length
            }}{{ result.preview.transactions.length >= 50 ? ', showing first 50' : '' }})
          </h4>
          <div
            v-for="(item, i) in result.preview.transactions"
            :key="'t' + i"
            class="abele-migrate-firefly-modal__preview-item"
          >
            {{ item }}
          </div>
        </div>
      </template>

      <div
        v-if="completed && !dryRun && verificationResults.length > 0"
        class="abele-migrate-firefly-modal__verification"
      >
        <h4>Balance verification</h4>
        <div
          v-for="v in verificationResults"
          :key="v.account"
          class="abele-migrate-firefly-modal__verify-row"
          :class="{ 'abele-migrate-firefly-modal__verify-row_mismatch': !v.match }"
        >
          <span class="abele-migrate-firefly-modal__verify-name">{{ v.account }}</span>
          <span>Firefly: {{ v.fireflyBalance }} {{ v.currency }}</span>
          <span>Calculated: {{ v.calculatedBalance }} {{ v.currency }}</span>
          <span v-if="v.match" class="abele-migrate-firefly-modal__verify-ok">OK</span>
          <span v-else class="abele-migrate-firefly-modal__verify-diff">
            Diff: {{ v.diff }} {{ v.currency }}
          </span>
        </div>
      </div>

      <div v-if="result.errors.length > 0" class="abele-migrate-firefly-modal__errors">
        <h4>Errors ({{ result.errors.length }})</h4>
        <div
          v-for="(err, i) in result.errors.slice(0, 20)"
          :key="i"
          class="abele-migrate-firefly-modal__error"
        >
          {{ err }}
        </div>
        <div v-if="result.errors.length > 20">...and {{ result.errors.length - 20 }} more</div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Checkbox from './obsidian/Checkbox.vue'
import { ref } from 'vue'
import { requestUrl } from 'obsidian'
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
const token = ref(config.fireflyToken || '')
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

const startMigration = async () => {
  migrating.value = true
  completed.value = false
  statusText.value = 'Starting...'
  progressPercent.value = 0
  verificationResults.value = []

  // Save settings for future use
  config.fireflyBaseUrl = baseUrl.value.trim().replace(/\/$/, '')
  config.fireflyToken = token.value.trim()
  await config.saveSettings()

  const migrationConfig: MigrationConfig = {
    baseUrl: config.fireflyBaseUrl,
    token: config.fireflyToken,
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
.modal:has(.abele-migrate-firefly-modal) {
  width: 600px;
}

.abele-migrate-firefly-modal__buttons {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
  margin: var(--p-spacing) 0;
}

.abele-migrate-firefly-modal__progress {
  margin: var(--p-spacing) 0;
}

.abele-migrate-firefly-modal__status {
  color: var(--text-muted);
  margin-bottom: calc(var(--p-spacing) / 4);
}

.abele-migrate-firefly-modal__bar-container {
  height: 6px;
  background: var(--background-modifier-border);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: calc(var(--p-spacing) / 2);
}

.abele-migrate-firefly-modal__bar {
  height: 100%;
  background: var(--interactive-accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.abele-migrate-firefly-modal__counts {
  display: flex;
  gap: var(--p-spacing);
  color: var(--text-muted);
  font-size: var(--font-smallest);
}

.abele-migrate-firefly-modal__verification {
  margin: var(--p-spacing) 0;

  h4 {
    margin: 0 0 calc(var(--p-spacing) / 2);
  }
}

.abele-migrate-firefly-modal__verify-row {
  display: flex;
  gap: var(--p-spacing);
  padding: calc(var(--p-spacing) / 4) 0;
  font-size: var(--font-smallest);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-migrate-firefly-modal__verify-name {
  font-weight: var(--font-semibold);
  flex: 1;
}

.abele-migrate-firefly-modal__verify-ok {
  color: var(--text-success);
}

.abele-migrate-firefly-modal__verify-diff {
  color: var(--text-error);
}

.abele-migrate-firefly-modal__verify-row_mismatch {
  color: var(--text-error);
}

.abele-migrate-firefly-modal__errors {
  margin: var(--p-spacing) 0;

  h4 {
    margin: 0 0 calc(var(--p-spacing) / 2);
    color: var(--text-error);
  }
}

.abele-migrate-firefly-modal__error {
  font-size: var(--font-smallest);
  color: var(--text-error);
  padding: calc(var(--p-spacing) / 8) 0;
}

.abele-migrate-firefly-modal__preview {
  margin: var(--p-spacing) 0;
  max-height: 300px;
  overflow-y: auto;

  h4 {
    margin: 0 0 calc(var(--p-spacing) / 4);
  }
}

.abele-migrate-firefly-modal__preview-item {
  font-size: var(--font-smallest);
  color: var(--text-muted);
  padding: calc(var(--p-spacing) / 8) 0;
  border-bottom: 1px solid var(--background-modifier-border);
}
</style>
