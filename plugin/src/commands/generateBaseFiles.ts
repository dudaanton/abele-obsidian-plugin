import { GlobalStore } from '@/stores/GlobalStore'
import { normalizePath } from 'obsidian'

const TRANSACTIONS_BASE_CONTENT = `filters: 'type == "transaction"'
properties:
  note.date:
    displayName: Date
  note.from:
    displayName: From
  note.to:
    displayName: To
  note.amount:
    displayName: Amount
  note.currency:
    displayName: Currency
  note.category:
    displayName: Category
views:
  - name: All Transactions
    type: table
    order:
      - note.date
      - note.from
      - note.to
      - note.amount
      - note.currency
      - note.category
`

const ACCOUNTS_BASE_CONTENT = `filters: 'type == "account"'
properties:
  note.accountType:
    displayName: Type
  note.currency:
    displayName: Currency
  note.startingBalance:
    displayName: Starting Balance
views:
  - name: Accounts
    type: table
    order:
      - note.accountType
      - note.currency
      - note.startingBalance
`

async function ensureFolder(folderPath: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const normalized = normalizePath(folderPath)

  if (!app.vault.getAbstractFileByPath(normalized)) {
    await app.vault.createFolder(normalized)
  }
}

async function createBaseFileIfMissing(path: string, content: string): Promise<boolean> {
  const { app } = GlobalStore.getInstance()
  const normalized = normalizePath(path)

  if (app.vault.getAbstractFileByPath(normalized)) {
    return false
  }

  const folder = normalized.split('/').slice(0, -1).join('/')
  if (folder) {
    await ensureFolder(folder)
  }

  await app.vault.create(normalized, content)
  return true
}

export async function generateBaseFiles(): Promise<void> {
  await createBaseFileIfMissing('Finance/Transactions.base', TRANSACTIONS_BASE_CONTENT)
  await createBaseFileIfMissing('Finance/Accounts.base', ACCOUNTS_BASE_CONTENT)
}
