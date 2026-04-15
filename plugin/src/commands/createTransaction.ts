import { Transaction, TransactionCreateDTO } from '@/entities/Transaction'
import {
  cleanFileName,
  normalizePath,
  pathToWikilink,
  wikilinkToPath,
} from '@/helpers/pathsHelpers'
import { renderTemplate } from '@/helpers/notesUtils'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DATE_FORMAT } from '@/constants/dates'
import { Editor, Notice } from 'obsidian'

const DEFAULT_TRANSACTION_NAME = 'New Transaction'

function getNewTransactionPath(params?: {
  title?: string
  date?: dayjs.Dayjs
  from?: string
  to?: string
  amount?: number
  currency?: string
}): string {
  const config = AbeleConfig.getInstance()
  const template = config.transactionPathTemplate

  const stripWikilink = (s?: string | null) => (s ? s.replace(/\[\[|\]\]/g, '').trim() : '')

  const data: Record<string, string> = {
    date: (params?.date || dayjs()).format(DATE_FORMAT),
    title: cleanFileName(params?.title || '') || DEFAULT_TRANSACTION_NAME,
    from: stripWikilink(params?.from),
    to: stripWikilink(params?.to),
    amount: params?.amount != null ? String(params.amount) : '',
    currency: params?.currency || config.defaultCurrency || '',
  }

  let rendered = renderTemplate(template, data)
  if (!rendered.endsWith('.md')) {
    rendered += '.md'
  }

  return rendered
}

export const createTransaction = async (
  data?: TransactionCreateDTO,
  focus = true
): Promise<{ transaction: Transaction; wikilink: string } | undefined> => {
  const availablePath = await getAvailablePath(
    getNewTransactionPath({
      title: data?.title,
      date: data?.date,
      from: data?.from,
      to: data?.to,
      amount: data?.amount,
      currency: data?.currency,
    })
  )
  if (!availablePath) {
    new Notice('Failed to determine available path for the new transaction.', 3000)
    return
  }

  const wikilink = pathToWikilink(availablePath)

  // Resolve currency from accounts if not explicitly provided
  let resolvedCurrency = data?.currency
  let resolvedForeignCurrency = data?.foreignCurrency
  if (!resolvedCurrency) {
    const al = GlobalStore.getInstance().accountsList.value
    if (al) {
      const resolveAccountCurrency = (wl?: string) => {
        if (!wl) return null
        const path = wikilinkToPath(wl)
        if (!path) return null
        const { app } = GlobalStore.getInstance()
        const file = app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ''), '')
        return file ? al.accounts.get(normalizePath(file.path))?.currency || null : null
      }
      const fromCur = resolveAccountCurrency(data?.from)
      const toCur = resolveAccountCurrency(data?.to)

      if (fromCur && toCur && fromCur !== toCur) {
        resolvedCurrency = fromCur
        resolvedForeignCurrency = toCur
      } else {
        resolvedCurrency = fromCur || toCur || undefined
      }
    }
  }

  const config = AbeleConfig.getInstance()
  let transactionModel: Transaction

  if (data) {
    transactionModel = new Transaction({
      ...data,
      date: data.date ?? dayjs(),
      currency: resolvedCurrency || config.defaultCurrency,
      foreignCurrency: resolvedForeignCurrency || data.foreignCurrency,
      id: '',
      wikilink,
    })
  } else {
    transactionModel = new Transaction({
      id: '',
      wikilink,
      date: dayjs(),
      currency: resolvedCurrency || config.defaultCurrency,
    })
  }

  await transactionModel.writeTransactionToFile(focus)

  return { transaction: transactionModel, wikilink }
}

export const createTransactionAndInsert = async (editor: Editor) => {
  if (!editor) {
    new Notice('No active markdown editor found.', 3000)
    return
  }

  const cursor = editor.getCursor()
  const shouldCreateNewLine = cursor.ch > 0
  const selection = editor.getSelection()

  const title = cleanFileName(selection) || DEFAULT_TRANSACTION_NAME

  const availablePath = await getAvailablePath(getNewTransactionPath({ title }))
  if (!availablePath) {
    new Notice('Failed to determine available path for the new transaction.', 3000)
    return
  }

  const wikilink = pathToWikilink(availablePath)
  const link = `${shouldCreateNewLine ? '\n' : ''}${wikilink}\n`

  if (selection) {
    editor.replaceSelection(link)
  } else {
    editor.replaceRange(link, cursor)
  }

  editor.setSelection({ line: cursor.line + (shouldCreateNewLine ? 2 : 1), ch: 0 })

  const transactionModel = new Transaction({
    id: '',
    wikilink,
    date: dayjs(),
    currency: AbeleConfig.getInstance().defaultCurrency,
  })
  if (selection) {
    transactionModel.title = selection.split('\n')[0] || DEFAULT_TRANSACTION_NAME
    transactionModel.description = selection.split('\n').slice(1).join('\n') || ''
    transactionModel.content = selection
  }

  return transactionModel.writeTransactionToFile(true)
}
