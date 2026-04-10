import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DATE_FORMAT } from '@/constants/dates'
import { cleanFileName } from '@/helpers/pathsHelpers'
import { renderTemplate } from '@/helpers/notesUtils'
import { Notice, requestUrl, TFile } from 'obsidian'
import { dump } from 'js-yaml'
import dayjs from 'dayjs'

interface FireflyAccount {
  id: string
  attributes: {
    name: string
    type: string
    currency_code: string
    opening_balance: string
    opening_balance_date: string
    liability_type?: string
    liability_direction?: string
    active: boolean
  }
}

interface FireflyCategory {
  id: string
  attributes: {
    name: string
  }
}

interface FireflyTransactionSplit {
  transaction_journal_id: string
  type: string
  date: string
  description: string
  amount: string
  currency_code: string
  foreign_amount: string | null
  foreign_currency_code: string | null
  source_name: string
  destination_name: string
  category_name: string | null
  tags: string[]
  notes: string | null
}

interface FireflyTransactionGroup {
  id: string
  attributes: {
    group_title: string | null
    transactions: FireflyTransactionSplit[]
  }
}

export interface MigrationConfig {
  baseUrl: string
  token: string
  accountsFolder: string
  categoriesFolder: string
  transactionPathTemplate: string
  accountNameTemplate: string
  dryRun: boolean
}

export interface MigrationResult {
  accountsCreated: number
  categoriesCreated: number
  transactionsCreated: number
  skipped: number
  errors: string[]
  preview: {
    accounts: string[]
    categories: string[]
    transactions: string[]
  }
}

export interface MigrationProgress {
  stage: string
  percent: number
  result: MigrationResult
}

export type MigrationProgressCallback = (progress: MigrationProgress) => void

const SYSTEM_ACCOUNT_TYPES = new Set(['initial-balance', 'reconciliation', 'import', 'cash'])

function isSystemAccount(type: string): boolean {
  return SYSTEM_ACCOUNT_TYPES.has(type)
}

function mapFireflyAccountType(type: string): string {
  switch (type) {
    case 'asset':
    case 'default':
      return 'asset'
    case 'expense':
      return 'expense'
    case 'revenue':
      return 'revenue'
    case 'liabilities':
      return 'liability'
    default:
      return 'asset'
  }
}

async function fetchAllPages<T>(
  baseUrl: string,
  endpoint: string,
  token: string,
  onPage?: (current: number, total: number, fetched: number) => void
): Promise<T[]> {
  const results: T[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const separator = endpoint.includes('?') ? '&' : '?'
    const url = `${baseUrl}/api/v1/${endpoint}${separator}page=${page}`

    const response = await requestUrl({
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      continue
    }

    if (response.status >= 400) {
      throw new Error(`API error: ${response.status} for ${url}`)
    }

    const json = response.json
    const data = json.data as T[]
    results.push(...data)

    const meta = json.meta?.pagination
    const totalPages = meta?.total_pages || 1
    onPage?.(page, totalPages, results.length)

    if (meta && meta.current_page < meta.total_pages) {
      page++
    } else {
      hasMore = false
    }
  }

  return results
}

async function createNoteIfNotExists(
  path: string,
  content: string,
  dryRun: boolean
): Promise<boolean> {
  const { app } = GlobalStore.getInstance()

  if (dryRun) return true

  const existing = app.vault.getAbstractFileByPath(path)
  if (existing instanceof TFile) {
    // Check if it was already migrated (has fireflyId)
    const cache = app.metadataCache.getFileCache(existing)
    if (cache?.frontmatter?.fireflyId) {
      return false // already migrated
    }
  }

  // Create parent directories
  const parentPath = path.split('/').slice(0, -1).join('/')
  if (parentPath) {
    const parentExists = await app.vault.adapter.exists(parentPath)
    if (!parentExists) {
      await app.vault.createFolder(parentPath)
    }
  }

  if (existing) {
    return false // file exists without fireflyId — skip to be safe
  }

  await app.vault.create(path, content)
  return true
}

function buildFrontmatter(data: Record<string, any>): string {
  // Remove undefined/null values
  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined && value !== '') {
      cleaned[key] = value
    }
  }

  const yaml = dump(cleaned, { quotingType: "'" })
  return `---\n${yaml}---\n`
}

export async function migrateFromFirefly(
  config?: MigrationConfig,
  onProgress?: MigrationProgressCallback
): Promise<MigrationResult> {
  const settings = AbeleConfig.getInstance()
  const result: MigrationResult = {
    accountsCreated: 0,
    categoriesCreated: 0,
    transactionsCreated: 0,
    skipped: 0,
    errors: [],
    preview: { accounts: [], categories: [], transactions: [] },
  }

  if (!config) {
    // Use settings from plugin config — baseUrl and apiToken
    config = {
      baseUrl: settings.fireflyBaseUrl.replace(/\/$/, ''),
      token: settings.fireflyToken,
      accountsFolder: settings.accountsFolder,
      categoriesFolder: settings.financeCategoriesFolder,
      transactionPathTemplate: settings.transactionPathTemplate,
      accountNameTemplate: '{{name}} {{currency}}',
      dryRun: false,
    }
  }

  if (!config.baseUrl || !config.token) {
    new Notice(
      'Firefly III base URL and API token are required. Set them in plugin settings.',
      5000
    )
    return result
  }

  const report = (stage: string, percent: number) => {
    onProgress?.({ stage, percent, result })
  }

  report('Starting...', 0)

  try {
    // 1. Fetch accounts
    const accounts = await fetchAllPages<FireflyAccount>(
      config.baseUrl,
      'accounts?type=all',
      config.token,
      (page, total, fetched) => report(`Fetching accounts... page ${page}/${total} (${fetched})`, 5)
    )
    report(`Creating ${accounts.length} accounts...`, 10)

    const accountNameMap = new Map<string, string>()

    // 2. Create account notes (skip system accounts)
    for (const account of accounts) {
      const attr = account.attributes

      // Render account name from template
      const templateData: Record<string, string> = {
        name: attr.name,
        currency: attr.currency_code || '',
        accountType: mapFireflyAccountType(attr.type),
      }
      const renderedName =
        cleanFileName(renderTemplate(config.accountNameTemplate, templateData)) ||
        cleanFileName(attr.name)

      // Always map name for transaction linking, even for inactive/system accounts
      accountNameMap.set(attr.name, renderedName)

      // Skip system accounts (initial-balance, reconciliation, etc.)
      if (isSystemAccount(attr.type)) continue
      if (!attr.active) continue

      const frontmatter: Record<string, any> = {
        type: 'account',
        accountType: mapFireflyAccountType(attr.type),
        currency: attr.currency_code,
        fireflyId: parseInt(account.id),
      }

      const content = buildFrontmatter(frontmatter)
      const path = `${config.accountsFolder}/${renderedName}.md`

      result.preview.accounts.push(
        `${renderedName} (${mapFireflyAccountType(attr.type)}, ${attr.currency_code})`
      )
      const created = await createNoteIfNotExists(path, content, config.dryRun)
      if (created) {
        result.accountsCreated++
      } else {
        result.skipped++
      }
    }

    // 3. Fetch and create categories
    const categories = await fetchAllPages<FireflyCategory>(
      config.baseUrl,
      'categories',
      config.token,
      (page, total, fetched) =>
        report(`Fetching categories... page ${page}/${total} (${fetched})`, 25)
    )
    report(`Creating ${categories.length} categories...`, 30)

    const categoryNameMap = new Map<string, string>()
    for (const category of categories) {
      const name = cleanFileName(category.attributes.name)
      categoryNameMap.set(category.attributes.name, name)

      const content = buildFrontmatter({
        type: 'finance-category',
        fireflyId: parseInt(category.id),
      })
      const path = `${config.categoriesFolder}/${name}.md`

      result.preview.categories.push(name)
      const created = await createNoteIfNotExists(path, content, config.dryRun)
      if (created) {
        result.categoriesCreated++
      } else {
        result.skipped++
      }
    }

    // 4. Fetch and create transactions
    const earliest = '2000-01-01'
    const today = dayjs().format(DATE_FORMAT)
    const transactions = await fetchAllPages<FireflyTransactionGroup>(
      config.baseUrl,
      `transactions?type=all&start=${earliest}&end=${today}`,
      config.token,
      (page, total, fetched) =>
        report(
          `Fetching transactions... page ${page}/${total} (${fetched})`,
          40 + Math.round((page / total) * 10)
        )
    )
    const totalGroups = transactions.length

    for (let gi = 0; gi < transactions.length; gi++) {
      const group = transactions[gi]
      for (const split of group.attributes.transactions) {
        const date = dayjs(split.date.substring(0, 10))
        if (!date.isValid()) {
          result.errors.push(`Invalid date for transaction ${split.transaction_journal_id}`)
          continue
        }

        const sourceName = accountNameMap.get(split.source_name) || cleanFileName(split.source_name)
        const destName =
          accountNameMap.get(split.destination_name) || cleanFileName(split.destination_name)
        const categoryName = split.category_name
          ? categoryNameMap.get(split.category_name) || cleanFileName(split.category_name)
          : null

        const frontmatter: Record<string, any> = {
          type: 'transaction',
          date: date.format(DATE_FORMAT),
          from: `[[${sourceName}]]`,
          to: `[[${destName}]]`,
          amount: parseFloat(split.amount),
          currency: split.currency_code,
          fireflyId: parseInt(split.transaction_journal_id),
        }

        if (split.foreign_amount && split.foreign_currency_code) {
          frontmatter.foreignAmount = parseFloat(split.foreign_amount)
          frontmatter.foreignCurrency = split.foreign_currency_code
        }

        if (categoryName) {
          frontmatter.category = `[[${categoryName}]]`
        }

        if (split.tags && split.tags.length > 0) {
          frontmatter.groups = split.tags.map((tag) => `[[${cleanFileName(tag)}]]`)
        }

        const title = cleanFileName(split.description) || 'Transaction'
        if (result.preview.transactions.length < 50) {
          result.preview.transactions.push(
            `${date.format(DATE_FORMAT)} ${title} — ${sourceName} → ${destName} (${parseFloat(split.amount)} ${split.currency_code})`
          )
        }
        let body = title + '\n'
        if (split.notes) {
          body += '\n' + split.notes + '\n'
        }

        const content = buildFrontmatter(frontmatter) + body

        // Build path from template
        const templateData: Record<string, string> = {
          date: date.format(DATE_FORMAT),
          title,
          from: sourceName,
          to: destName,
          amount: String(parseFloat(split.amount)),
          currency: split.currency_code,
        }
        const renderedPath = renderTemplate(config.transactionPathTemplate, templateData)
        const path = renderedPath.endsWith('.md') ? renderedPath : `${renderedPath}.md`

        // Ensure unique path
        const { app } = GlobalStore.getInstance()
        let finalPath = path
        let counter = 1
        while (await app.vault.adapter.exists(finalPath)) {
          const existing = app.vault.getAbstractFileByPath(finalPath)
          if (existing instanceof TFile) {
            const cache = app.metadataCache.getFileCache(existing)
            if (cache?.frontmatter?.fireflyId === parseInt(split.transaction_journal_id)) {
              break // same transaction, skip
            }
          }
          finalPath = path.replace('.md', ` ${counter}.md`)
          counter++
        }

        const created = await createNoteIfNotExists(finalPath, content, config.dryRun)
        if (created) {
          result.transactionsCreated++
        } else {
          result.skipped++
        }
      }
      const pct = 50 + Math.round(((gi + 1) / totalGroups) * 45)
      report(`Creating transactions... ${gi + 1}/${totalGroups}`, pct)
    }

    report('Complete', 100)
    new Notice(
      `Migration complete: ${result.accountsCreated} accounts, ${result.categoriesCreated} categories, ${result.transactionsCreated} transactions. ${result.skipped} skipped.`,
      10000
    )

    if (result.errors.length > 0) {
      console.warn('Migration errors:', result.errors)
      new Notice(
        `${result.errors.length} errors during migration. Check console for details.`,
        5000
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    result.errors.push(msg)
    new Notice(`Migration failed: ${msg}`, 10000)
    console.error('Firefly III migration error:', e)
  }

  return result
}
