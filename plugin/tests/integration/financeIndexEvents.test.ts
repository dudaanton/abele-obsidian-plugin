import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

// The shared Obsidian mock runs debounce synchronously. This suite needs the
// documented deferred behaviour: reset only when requested, plus cancellation.
vi.mock('obsidian', async (original) => ({
  ...(await original<typeof import('obsidian')>()),
  debounce: (fn: (...args: unknown[]) => void, delay: number, resetTimer = false) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let latest: unknown[] = []
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const run = () => {
      cancel()
      fn(...latest)
    }
    return Object.assign(
      (...args: unknown[]) => {
        latest = args
        if (resetTimer) cancel()
        if (timer === undefined) timer = setTimeout(run, delay)
      },
      { cancel, run }
    )
  },
}))
let app: FakeApp
let al: AccountsList
let tl: TransactionsList
let bi: BalanceIndex
let delay: number
const at = dayjs('2024-03-01')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  delay = AbeleConfig.getInstance().refreshDelay
  AbeleConfig.getInstance().refreshDelay = 300
  app = useVault([
    {
      path: 'Cash.md',
      frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR', startingBalance: 10 },
    },
    {
      path: 'Tx.md',
      frontmatter: { type: 'transaction', date: '2024-03-01', to: '[[Cash]]', amount: 2 },
    },
    { path: 'Plain.md' },
    { path: 'Folder/Plain.md' },
  ])
  al = new AccountsList()
  tl = new TransactionsList()
  bi = new BalanceIndex(tl, al)
  app.emit('metadataCache', 'resolved')
  vi.advanceTimersByTime(300)
})
afterEach(() => {
  bi.cleanup()
  tl.cleanup()
  al.cleanup()
  VaultWatcherWrapper.destroy()
  vi.clearAllTimers()
  AbeleConfig.getInstance().refreshDelay = delay
  vi.useRealTimers()
})

describe('BalanceIndex deferred events', () => {
  it('rebuilds once for a metadata burst after the entity reload, including edits to an opening balance', async () => {
    const txFile = app.vault.getFileByPath('Tx.md')!
    const accountFile = app.vault.getFileByPath('Cash.md')!
    const version = bi.version.value
    app.setFrontmatter('Tx.md', {
      type: 'transaction',
      date: '2024-03-01',
      to: '[[Cash]]',
      amount: 3,
    })
    app.setFrontmatter('Cash.md', {
      type: 'account',
      accountType: 'asset',
      currency: 'EUR',
      startingBalance: 20,
    })
    app.emit('vault', 'modify', txFile)
    app.emit('vault', 'modify', accountFile)
    app.emit('metadataCache', 'changed', txFile)
    app.emit('metadataCache', 'changed', accountFile)
    app.emit('metadataCache', 'resolved')
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(12)
    await vi.advanceTimersByTimeAsync(300)
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(23)
    expect(bi.version.value).toBe(version + 1)
  })

  it('removes deleted transactions from balances once the list queue resolves, ignoring unrelated files and folders', async () => {
    const version = bi.version.value
    app.emit('vault', 'delete', app.vault.getFileByPath('Plain.md'))
    app.emit('vault', 'delete', app.vault.getAbstractFileByPath('Folder'))
    vi.advanceTimersByTime(300)
    expect(bi.version.value).toBe(version)
    const file = app.vault.getFileByPath('Tx.md')!
    await GlobalStore.getInstance().app.vault.delete(file)
    app.emit('vault', 'delete', file)
    app.emit('metadataCache', 'resolved')
    expect(tl.transactions.size).toBe(0)
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(12)
    vi.advanceTimersByTime(300)
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(10)
    expect(bi.version.value).toBe(version + 1)
  })

  it('removes deleted accounts from net worth after the queued removal', async () => {
    const file = app.vault.getFileByPath('Cash.md')!
    await GlobalStore.getInstance().app.vault.delete(file)
    app.emit('vault', 'delete', file)
    app.emit('metadataCache', 'resolved')
    vi.advanceTimersByTime(300)
    expect(al.accounts.size).toBe(0)
    expect(bi.getNetWorthAtDate(at)).toBe(0)
  })

  it('removes a retyped transaction from balances after the list queue resolves', () => {
    const version = bi.version.value
    app.setFrontmatter('Tx.md', { type: 'note' })
    app.emit('metadataCache', 'changed', app.vault.getFileByPath('Tx.md'))
    app.emit('metadataCache', 'resolved')
    vi.advanceTimersByTime(300)
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(10)
    expect(bi.version.value).toBe(version + 1)
  })

  it('cancels a scheduled rebuild on cleanup', () => {
    app.emit('metadataCache', 'changed', app.vault.getFileByPath('Tx.md'))
    const version = bi.version.value
    bi.cleanup()
    vi.advanceTimersByTime(300)
    expect(bi.version.value).toBe(version)
  })
})
