/**
 * The balance at the top of an account note when its money is in several currencies: a computed
 * account converts the sources in another currency into its own rather than adding them as if
 * they were the same money, and both it and a category get one approximate line at today's rates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderView from '@/components/Header.vue'
import { Header } from '@/entities/Header'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { exchangeRates } from '@/finance/rates/exchangeRates'
import type { RateTable } from '@/finance/rates/convert'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { configureAbele, useVault } from '../helpers/testEnv'

const wallet = (name: string, currency: string, startingBalance: number): FakeFileSpec => ({
  path: `Accounts/${name}.md`,
  frontmatter: {
    type: 'account',
    accountType: 'asset',
    currency,
    startingBalance,
    startingBalanceDate: '2020-01-01',
  },
})

const fixture: FakeFileSpec[] = [
  wallet('Sample card', 'EUR', 120),
  wallet('Sample lari', 'GEL', 400),
  {
    path: 'Accounts/Sample both.md',
    frontmatter: {
      type: 'account',
      accountType: 'computed',
      currency: 'EUR',
      accounts: ['[[Sample card]]', '[[Sample lari]]'],
    },
  },
  { path: 'Accounts/Sample food.md', frontmatter: { type: 'account', accountType: 'expense' } },
  {
    path: 'Tx/one.md',
    frontmatter: {
      type: 'transaction',
      date: '2026-01-02',
      from: '[[Sample card]]',
      to: '[[Sample food]]',
      amount: 10,
      currency: 'EUR',
    },
  },
  {
    path: 'Tx/two.md',
    frontmatter: {
      type: 'transaction',
      date: '2026-01-03',
      from: '[[Sample lari]]',
      to: '[[Sample food]]',
      amount: 40,
      currency: 'GEL',
    },
  },
]

const table: RateTable = {
  base: 'USD',
  fetchedAt: new Date().toISOString(),
  fetchedOn: new Date().toISOString().slice(0, 10),
  rates: {
    EUR: { perUsd: 0.5, date: '2026-03-10', source: 'sample' },
    GEL: { perUsd: 2, date: '2026-03-10', source: 'sample' },
  },
}

async function render(path: string) {
  const header = new Header({ id: 'h1', filePath: path })
  await header.load()
  const wrapper = mount(HeaderView, { props: { header } })
  await flushPromises()
  await nextTick()
  return wrapper
}

const lines = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.findAll('.abele-header-view__balance').map((l) => l.text().replace(/\s+/g, ''))

beforeEach(() => {
  useVault(fixture)
  configureAbele()
  const config = AbeleConfig.getInstance()
  config.timeTrackableNoteTypes = []
  config.timeTrackAllNotes = false
  config.headerButtons = []
  config.pinnedCurrencies = 'EUR'
  GlobalStore.getInstance().initFinance()
  exchangeRates.enabled = true
  exchangeRates.display = 'USD'
  exchangeRates.table = null
})

afterEach(() => {
  exchangeRates.table = null
})

describe('an account note in several currencies', () => {
  it('leaves a source with no rate out of a computed account instead of counting it as its own', async () => {
    const wrapper = await render('Accounts/Sample both.md')
    // 110 EUR on the card; the 360 GEL cannot be converted, so it is not added as euros.
    expect(lines(wrapper)).toEqual(['110.00EUR'])
  })

  it('converts a computed account’s source into its currency and marks the sum approximate', async () => {
    exchangeRates.table = table
    const wrapper = await render('Accounts/Sample both.md')
    // 360 GEL is 180 USD is 90 EUR at these rates.
    expect(lines(wrapper)).toEqual(['200.00EUR', '≈200.00EUR'])
  })

  it('adds a category’s currencies up in one approximate line', async () => {
    exchangeRates.table = table
    const wrapper = await render('Accounts/Sample food.md')
    // 10 EUR is 20 USD, 40 GEL is 20 USD.
    expect(lines(wrapper)).toEqual(['10.00EUR', '40.00GEL', '≈40.00USD'])
  })
})
