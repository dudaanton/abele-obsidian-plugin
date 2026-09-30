import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Account } from '@/entities/Account'
import { Transaction } from '@/entities/Transaction'
import { TransactionNoteTemplate } from '@/templates/TransactionNoteTemplate'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
const entities: Array<Account | Transaction> = []
function transaction(wikilink = '[[Finance/Purchase|Receipt]]') {
  const tx = new Transaction({ wikilink })
  entities.push(tx)
  return tx
}
function account(wikilink = '[[Finance/Wallet|Card]]') {
  const a = new Account({ wikilink })
  entities.push(a)
  return a
}
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  app = useVault([
    {
      path: 'Finance/Purchase.md',
      frontmatter: {
        type: 'transaction',
        date: '2024-03-01',
        amount: '12.30',
        currency: 'USD',
        foreignAmount: '11.10',
        foreignCurrency: 'EUR',
        from: '[[Wallet]]',
        to: '[[Food]]',
        category: '[[Category]]',
        groups: ['[[Group]]'],
        custom: 'preserve',
        content: 'not the body',
      },
      content: '\nReceipt title\n\nDescription\n  More detail\n',
    },
    {
      path: 'Finance/Wallet.md',
      frontmatter: {
        type: 'account',
        accountType: 'computed',
        currency: 'EUR',
        startingBalance: '-12.30',
        startingBalanceDate: '2024-02-29',
        groups: ['[[Group]]'],
        accounts: ['[[Cash]]', '[[Bank]]'],
        excludeFromTotal: true,
      },
      content: '\nWallet title\n\nWallet description\n',
    },
    { path: 'Empty.md', frontmatter: {} },
    { path: 'No metadata.md', content: 'Body only' },
  ])
})
afterEach(() => {
  for (const entity of entities.splice(0)) entity.cleanup()
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Transaction — note-backed public surface', () => {
  it('loads metadata without reading the body, resolves aliases and keeps unknown properties', async () => {
    const tx = transaction()
    await tx.load()
    expect(tx.transactionPath).toBe('Finance/Purchase.md')
    expect(tx.transactionFolder).toBe('Finance')
    expect(tx.transactionName).toBe('Receipt')
    expect(tx).toMatchObject({
      loaded: true,
      watcherInitialized: true,
      title: '',
      amount: 12.3,
      currency: 'USD',
      foreignAmount: 11.1,
      foreignCurrency: 'EUR',
      from: '[[Wallet]]',
      to: '[[Food]]',
      category: '[[Category]]',
      groups: ['[[Group]]'],
    })
    expect(tx.date?.format('YYYY-MM-DD')).toBe('2024-03-01')
    expect(tx.oldProps).toMatchObject({ custom: 'preserve', content: undefined })
    expect(app.stats.read).toBe(0)
    await tx.loadContent()
    expect(tx.title).toBe('Receipt title')
    expect(tx.description).toBe('Description\n  More detail')
    expect(tx.content).toContain('\n\nDescription')
  })

  it('honours constructor fields including zero, and the DTO copies groups but shares oldProps', () => {
    const date = dayjs('2024-03-01T00:15:00')
    const tx = new Transaction({
      id: 'fixture-id',
      wikilink: '[[New]]',
      filePath: '/Origin',
      title: 'Title',
      description: 'Detail',
      date,
      amount: 0,
      foreignAmount: 0,
      from: '[[A]]',
      to: '[[B]]',
      currency: 'EUR',
      foreignCurrency: 'USD',
      category: '[[C]]',
      groups: ['[[G]]'],
      content: 'Body',
      oldProps: { custom: true },
    })
    entities.push(tx)
    expect(tx.id).toBe('fixture-id')
    expect(tx.filePath).toBe('Origin.md')
    expect(tx.transactionFolder).toBe('')
    expect(tx.getTransactionDate()).toBe(date)
    expect(tx.isTransactionRelatedToDate(dayjs('2024-03-01T23:59:00'))).toBe(true)
    expect(tx.isTransactionRelatedToDate(dayjs('2024-02-29T23:59:00'))).toBe(false)
    const dto = tx.toCreateDTO()
    expect(dto).toEqual({
      title: 'Title',
      description: 'Detail',
      date,
      amount: 0,
      foreignAmount: 0,
      from: '[[A]]',
      to: '[[B]]',
      currency: 'EUR',
      foreignCurrency: 'USD',
      category: '[[C]]',
      groups: ['[[G]]'],
      content: 'Body',
      oldProps: { custom: true },
    })
    dto.groups!.push('[[Other]]')
    expect(tx.groups).toEqual(['[[G]]'])
    expect(dto.oldProps).toBe(tx.oldProps)
    expect(transaction('[[Undated]]').isTransactionRelatedToDate(date)).toBe(false)
  })

  it.each([
    { amount: undefined, foreignAmount: undefined, expected: null },
    { amount: null, foreignAmount: null, expected: null },
    { amount: '', foreignAmount: '', expected: 0 },
    { amount: '0', foreignAmount: 0, expected: 0 },
    { amount: '-2.5', foreignAmount: '-2.5', expected: -2.5 },
    { amount: 'not money', foreignAmount: 'not money', expected: NaN },
  ])('pins numeric frontmatter coercion: $amount', async ({ amount, foreignAmount, expected }) => {
    app.setFrontmatter('Empty.md', {
      amount,
      foreignAmount,
      date: 'not a date',
      groups: '[[Group]]',
    })
    const tx = transaction('[[Empty]]')
    await tx.load()
    expect(tx.amount).toBe(expected)
    expect(tx.foreignAmount).toBe(expected)
    expect(tx.date).toBeNull()
    expect(tx.groups).toEqual([])
    expect(tx.from).toBeNull()
    expect(tx.to).toBeNull()
  })

  it('only refreshes loaded metadata on force, and watcher initialization is idempotent', async () => {
    const tx = transaction()
    await tx.load()
    const register = vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback')
    tx.initWatcher()
    expect(register).not.toHaveBeenCalled()
    app.setFrontmatter(tx.transactionPath, { amount: 0, groups: [], date: null })
    await tx.load()
    expect(tx.amount).toBe(12.3)
    await tx.load(true)
    expect(tx.amount).toBe(0)
    expect(tx.currency).toBeNull()
    expect(tx.groups).toEqual([])
  })

  it('uses the empty-body fallback and flags absent metadata or notes', async () => {
    const empty = transaction('[[Empty]]')
    await empty.loadContent()
    expect(empty.title).toBe('New Transaction')
    const missing = transaction('[[Missing]]')
    await missing.load()
    await missing.loadContent()
    expect(missing.loaded).toBe(true)
    expect(missing.transactionNotFound).toBe(true)
    const bodyOnly = transaction('[[No metadata]]')
    await bodyOnly.load()
    await bodyOnly.loadContent()
    expect(bodyOnly.transactionNotFound).toBe(true)
    expect(bodyOnly.title).toBe('Body only')
  })

  it('delegates writing with default and explicit focus/overwrite flags', async () => {
    const create = vi
      .spyOn(TransactionNoteTemplate.prototype, 'createNoteWithTemplate')
      .mockResolvedValue()
    const tx = transaction()
    await tx.writeTransactionToFile()
    expect(create).toHaveBeenLastCalledWith(tx, false, true)
    await tx.writeTransactionToFile(true, false)
    expect(create).toHaveBeenLastCalledWith(tx, true, false)
  })

  it('removes through the file manager to respect the trash preference, including an already absent note', async () => {
    const fm = GlobalStore.getInstance().app.fileManager
    const trash = vi.spyOn(fm, 'trashFile')
    const tx = transaction()
    await tx.load()
    const file = app.vault.getFileByPath(tx.transactionPath)
    await tx.remove()
    expect(trash).toHaveBeenCalledWith(file)
    expect(app.vault.getFileByPath('Finance/Purchase.md')).toBeNull()
    expect(tx.loaded).toBe(false)
    expect(tx.amount).toBeNull()
    await tx.remove()
    expect(trash).toHaveBeenCalledTimes(1)
  })
})

describe('Account — note-backed public surface', () => {
  it('loads computed sources and financial properties without reading content', async () => {
    const a = account()
    await a.load()
    expect(a.accountPath).toBe('Finance/Wallet.md')
    expect(a.accountName).toBe('Card')
    expect(a).toMatchObject({
      accountType: 'computed',
      currency: 'EUR',
      startingBalance: -12.3,
      groups: ['[[Group]]'],
      excludeFromTotal: true,
      sourceAccounts: ['[[Cash]]', '[[Bank]]'],
      loaded: true,
    })
    expect(a.startingBalanceDate?.format('YYYY-MM-DD')).toBe('2024-02-29')
    expect(app.stats.read).toBe(0)
    await a.loadContent()
    expect(a.title).toBe('Wallet title')
    expect(a.description).toBe('Wallet description')
    expect(a.content).toContain('\n\nWallet description')
  })

  it.each([undefined, null, '', 'invalid', 0])(
    'defaults invalid/missing starting balance %s and non-array groups/sources',
    async (value) => {
      app.setFrontmatter('Empty.md', {
        startingBalance: value,
        startingBalanceDate: 'invalid',
        accounts: '[[One]]',
        groups: '[[Group]]',
      })
      const a = account('[[Empty]]')
      await a.load()
      expect(a).toMatchObject({
        accountType: null,
        currency: null,
        startingBalance: 0,
        startingBalanceDate: null,
        sourceAccounts: [],
        groups: [],
        excludeFromTotal: false,
      })
    }
  )

  it('pins truthy excludeFromTotal coercion and force-reloading cleared properties', async () => {
    const a = account()
    await a.load()
    app.setFrontmatter(a.accountPath, { excludeFromTotal: 'false' })
    await a.load()
    expect(a.accountType).toBe('computed')
    await a.load(true)
    expect(a).toMatchObject({
      accountType: null,
      startingBalance: 0,
      sourceAccounts: [],
      excludeFromTotal: true,
    })
  })

  it('uses the link name for an empty body and flags missing notes', async () => {
    const a = account('[[Empty|Empty wallet]]')
    await a.loadContent()
    expect(a.title).toBe('Empty wallet')
    const missing = account('[[Missing]]')
    await missing.load()
    await missing.loadContent()
    expect(missing.accountNotFound).toBe(true)
    expect(missing.loaded).toBe(true)
  })
})

describe.each(['account', 'transaction'] as const)('%s lifecycle through vault events', (kind) => {
  it('reloads edits, follows a move and rename, and unsubscribes on cleanup', async () => {
    const entity = kind === 'account' ? account() : transaction()
    const path = kind === 'account' ? 'Finance/Wallet.md' : 'Finance/Purchase.md'
    const file = app.vault.getFileByPath(path)!
    await entity.load()
    app.setFrontmatter(path, { amount: 7, startingBalance: 7 })
    app.emit('vault', 'modify', file)
    await flushPromises()
    expect(
      kind === 'account' ? (entity as Account).startingBalance : (entity as Transaction).amount
    ).toBe(7)
    await GlobalStore.getInstance().app.fileManager.renameFile(file, 'Archive/Renamed.md')
    app.emit('vault', 'rename', file, path)
    await flushPromises()
    expect(
      kind === 'account' ? (entity as Account).accountPath : (entity as Transaction).transactionPath
    ).toBe('Archive/Renamed.md')
    expect(
      kind === 'account' ? (entity as Account).accountName : (entity as Transaction).transactionName
    ).toBe('Renamed')
    entity.cleanup()
    entity.cleanup()
    app.emit('vault', 'modify', file)
    await entity.load(true)
    await flushPromises()
    expect(entity).toMatchObject({
      loaded: false,
      watcherInitialized: false,
      title: '',
      description: '',
      content: '',
      groups: [],
    })
    if (entity instanceof Account)
      expect(entity).toMatchObject({
        accountType: null,
        currency: null,
        startingBalance: 0,
        sourceAccounts: [],
        excludeFromTotal: false,
        accountNotFound: false,
      })
    else
      expect(entity).toMatchObject({
        amount: null,
        foreignAmount: null,
        date: null,
        from: null,
        to: null,
        category: null,
        oldProps: {},
        transactionNotFound: false,
      })
  })
})
