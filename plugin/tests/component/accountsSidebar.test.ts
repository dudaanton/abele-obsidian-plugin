/**
 * The accounts panel: every account with its balance, largest first, each row opening its
 * note, and the options it is given kept in settings so they travel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import { Menu, MenuItem } from 'obsidian'
import AccountsSidebar from '@/components/AccountsSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_ACCOUNTS_LIST } from '@/helpers/accountRows'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

// Native menu labels are not represented by the shared test double yet.
Object.assign(MenuItem.prototype, {
  setIsLabel(this: MenuItem, isLabel: boolean) {
    Object.assign(this, { isLabel })
    return this
  },
})

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

const headings = (w: VueWrapper) => w.findAll('.abele-group-heading__label').map((el) => el.text())

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
    // The head counts what is listed; a group's total stands at the end of its heading, an
    // account's balance at the end of its row.
    expect(w.get('.abele-list-section-header').text()).toMatch(/Accounts\s*4/)
    expect(w.findAll('.abele-group-heading__summary')[0].text()).toContain('5,120.00')
    const card = w.findAll('.abele-accounts-sidebar__row')[1]
    expect(card.get('.abele-entry-row__codes .abele-accounts-sidebar__amount').text()).toBe(
      '120.00 EUR'
    )
    expect(w.text()).toContain('50.00')
  })

  it('opens the note of the account that was picked', async () => {
    const w = await render()
    const rows = w.findAll('.abele-accounts-sidebar__row')
    await rows[1].trigger('click')
    expect(opened).toEqual(['Accounts/Card.md'])
    await rows[0].trigger('keydown', { key: 'Enter' })
    expect(opened).toEqual(['Accounts/Card.md', 'Accounts/Savings.md'])
  })

  it('keeps the options it is given in settings', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const config = AbeleConfig.getInstance()
    const w = await render()

    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    await w
      .get('.abele-accounts-sidebar__header button[aria-label="What the list shows and its order"]')
      .trigger('click')
    const menu = shown.mock.contexts.at(-1) as Menu
    // Obsidian's own menu: its parts under headings, the current choices ticked.
    expect(
      menu.items.filter((i) => (i as MenuItem & { isLabel?: boolean }).isLabel).map((i) => i.title)
    ).toEqual(['Order', 'Show'])
    expect(menu.items.find((i) => i.title === 'Size of balance')!.checked).toBe(true)
    const grouping = menu.items.find((i) => i.title === 'Group by type')!
    expect(grouping.checked).toBe(true)
    grouping.handler!()
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

  it('says how an account comes to be when there are none at all', async () => {
    const store = GlobalStore.getInstance()
    store.balanceIndex.value?.cleanup()
    store.balanceIndex.value = null
    store.transactionsList.value?.cleanup()
    store.transactionsList.value = null
    store.accountsList.value?.cleanup()
    store.accountsList.value = null
    useVault([])
    store.initFinance()
    const w = await render()
    expect(w.get('.abele-empty-state__title').text()).toBe('No accounts yet')
    expect(w.text()).toContain('A note with type: account shows here')
  })

  it('says only that none match when the options leave every account out', async () => {
    const config = AbeleConfig.getInstance()
    config.accountsList = { ...DEFAULT_ACCOUNTS_LIST, types: [] }
    const w = await render()
    expect(rowNames(w)).toEqual([])
    expect(w.find('.abele-empty-state__title').exists()).toBe(false)
    expect(w.text()).toContain('No accounts match these options.')
  })
})
