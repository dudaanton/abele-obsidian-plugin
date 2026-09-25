/**
 * Reading a transaction note into the transaction dialog, and writing the dialog back into it.
 */
import { createTransaction } from '@/commands/createTransaction'
import { DATE_FORMAT } from '@/constants/dates'
import {
  applyFrontmatterPatch,
  joinNoteBody,
  replaceNoteBody,
  splitNoteBody,
  transactionFrontmatterPatch,
  transactionValuesToCreateDTO,
  type TransactionFormValues,
} from '@/helpers/entryForms'
import { getNoteBody } from '@/helpers/notesUtils'
import { parseDateOrNull } from '@/helpers/datesHelper'
import { getFileByPath } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** The form's values for a transaction note as it is on disk. */
export async function loadTransactionValues(path: string): Promise<TransactionFormValues | null> {
  const { app } = GlobalStore.getInstance()
  const file = getFileByPath(path)
  if (!(file instanceof TFile)) return null
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
  const raw = await app.vault.read(file)
  const { title, description } = splitNoteBody(getNoteBody(raw))
  return {
    title,
    description,
    date: (parseDateOrNull(fm.date as string) ?? dayjs()).format(DATE_FORMAT),
    from: text(fm.from),
    to: text(fm.to),
    amount: number(fm.amount),
    currency: text(fm.currency),
    foreignAmount: number(fm.foreignAmount),
    foreignCurrency: text(fm.foreignCurrency),
    category: text(fm.category),
    groups: Array.isArray(fm.groups) ? fm.groups.map(String) : [],
  }
}

/**
 * Writes the form. A new transaction goes through `createTransaction`, the same path the old
 * button took — same folder and name template, same currencies read off the accounts. An
 * existing one has its text and the properties the form shows rewritten, and every other
 * property left alone. Answers the path of the note, or null when nothing could be written.
 */
export async function saveTransactionForm(
  values: TransactionFormValues,
  path?: string
): Promise<string | null> {
  const { app } = GlobalStore.getInstance()
  if (!path) {
    const created = await createTransaction(transactionValuesToCreateDTO(values), false)
    return created?.transaction.transactionPath ?? null
  }
  const file = getFileByPath(path)
  if (!(file instanceof TFile)) return null
  await app.vault.process(file, (raw) =>
    replaceNoteBody(raw, joinNoteBody(values.title, values.description))
  )
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
    applyFrontmatterPatch(fm, transactionFrontmatterPatch(values))
  )
  return file.path
}
