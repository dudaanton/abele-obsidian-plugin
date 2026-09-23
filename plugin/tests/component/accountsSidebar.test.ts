/**
 * The accounts panel: every account with its balance, largest first, each row opening its
 * note, and the options it is given kept in settings so they travel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import AccountsSidebar from '@/components/AccountsSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_ACCOUNTS_LIST } from '@/helpers/accountRows'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

const opened: string[] = []
vi.mock('@/helpers/vaultUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/vaultUtils')>()),
  openFile: async (path: string) => void opened.push(path),
}))

const account = (name: string, fm: Record<string, unknown>): FakeFileSpec => ({
  path: `Accounts/${name}.md`,
  frontmatter: { type: 'account', ...fm },
})

let n = 0
const tx = (from: string, to: string, amount: number, currency: string): FakeFileSpec => ({
  path: `Transactions/tx ${++n}.md`,
  frontmatter: {
    type: 'transaction',
    date: '2026-01-10',
    from: `[[${from}]]`,
    to: `[[${to}]]`,
    amount,
    currency,
  },
})

function fixture(): FakeFileSpec[] {
  return [
    account('Card', { accountType: 'asset', currency: 'EUR', startingBalance: 200 }),
    account('Savings', { accountType: 'asset', currency: 'EUR', startingBalance: 5000 }),
    account('Empty', { accountType: 'asset', currency: 'EUR' }),
    account('Mortgage', { accountType: 'liability', currency: 'EUR', startingBalance: -9000 }),
    account('Lent to Bob', { accountType: 'liability', currency: 'EUR' }),
    account('Food', { accountType: 'expense' }),
    tx('Card', 'Lent to Bob', 50, 'EUR'),
    tx('Card', 'Food', 30, 'EUR'),
  ]
}

let wrapper: VueWrapper | null = null

async function render() {
  wrapper = mount(AccountsSidebar)
  await flushPromises()
  await nextTick()
  return wrapper
}

const rowNames = (w: VueWrapper) =>
  w.findAll('.abele-accounts-sidebar__name').map((el) => el.text())

const headings = (w: VueWrapper) => w.findAll('.abele-section__heading').map((el) => el.text())

beforeEach(() => {
  opened.length = 0
  useVault(fixture())
  const config = AbeleConfig.getInstance()
  config.accountsList = { ...DEFAULT_ACCOUNTS_LIST, types: [...DEFAULT_ACCOUNTS_LIST.types] }
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  GlobalStore.getInstance().initFinance()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  const store = GlobalStore.getInstance()
  store.balanceIndex.value?.cleanup()
  store.balanceIndex.value = null
  store.transactionsList.value?.cleanup()
  store.transactionsList.value = null
  store.accountsList.value?.cleanup()
  store.accountsList.value = null
})

describe('accounts sidebar', () => {
  it('lists money and debts, largest first, leaving out empty accounts and categories', async () => {
    const w = await render()

    expect(headings(w)).toEqual(['Assets', 'Debts'])
    expect(rowNames(w)).toEqual(['Savings', 'Card', 'Mortgage', 'Lent to Bob'])
    expect(w.text()).toContain('5,120.00')
    expect(w.text()).toContain('50.00')
  })

  it('opens the note of the account that was picked', async () => {
    const w = await render()
    const rows = w.findAll('.abele-table__row')
    await rows[1].trigger('click')
    expect(opened).toEqual(['Accounts/Card.md'])
  })

  it('keeps the options it is given in settings', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const config = AbeleConfig.getInstance()
    const w = await render()

    await w.find('.abele-accounts-sidebar__header .abele-obsidian-icon').trigger('click')
    const grouping = w.findAll('.setting-item').find((row) => row.text().includes('Group by type'))!
    await grouping.find('.checkbox-container').trigger('click')
    await nextTick()

    expect(config.accountsList.groupByType).toBe(false)
    expect(headings(w)).toEqual([])
    expect(rowNames(w)).toEqual(['Mortgage', 'Savings', 'Card', 'Lent to Bob'])

    vi.advanceTimersByTime(500)
    expect(config.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('does not recalculate while hidden', async () => {
    wrapper = mount(AccountsSidebar, { props: { active: false } })
    await flushPromises()
    expect(rowNames(wrapper)).toEqual(['Savings', 'Card', 'Mortgage', 'Lent to Bob'])

    const bi = toRaw(GlobalStore.getInstance().balanceIndex.value!)
    const spy = vi.spyOn(bi, 'getBalanceAtDate')
    bi.version.value++
    await nextTick()
    expect(spy).not.toHaveBeenCalled()

    await wrapper.setProps({ active: true })
    expect(spy).toHaveBeenCalled()
  })
})
