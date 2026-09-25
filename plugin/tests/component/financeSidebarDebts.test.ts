/**
 * What a currency card in the finance sidebar says about debts, in each of the four cases:
 * only others owe me, only I owe, both, neither.
 *
 * Both directions share one "Debts" row, each amount signed and tinted by which way the money
 * goes, with the net on a row of its own beneath — label on the left, amount on the right, the
 * same as the period summary under the cards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper, type DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import FinanceSidebar from '@/components/FinanceSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { formatAmount } from '@/helpers/moneyFormat'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/bases/echarts', () => ({
  echartsInit: () => ({
    on() {},
    setOption() {},
    clear() {},
    resize() {},
    dispose() {},
    isDisposed: () => false,
  }),
  getThemeColors: () => ({ text: '', textFaint: '', income: '', expense: '' }),
}))

function account(
  name: string,
  accountType: string,
  currency: string,
  startingBalance: number
): FakeFileSpec {
  return {
    path: `Accounts/${name}.md`,
    frontmatter: {
      type: 'account',
      accountType,
      currency,
      startingBalance,
      startingBalanceDate: '2020-01-01',
    },
  }
}

const fixture: FakeFileSpec[] = [
  // Both ways.
  account('Card EUR', 'asset', 'EUR', 1000),
  account('Loan from bank', 'liability', 'EUR', -400),
  account('Lent to Bob', 'liability', 'EUR', 300),
  // Only owed to me.
  account('Card USD', 'asset', 'USD', 500),
  account('Lent to Ann', 'liability', 'USD', 250),
  // Only I owe.
  account('Card GBP', 'asset', 'GBP', 800),
  account('Borrowed from Sam', 'liability', 'GBP', -120),
  // Neither.
  account('Card CHF', 'asset', 'CHF', 90),
]

let wrapper: VueWrapper | null = null

beforeEach(async () => {
  installFakeIntersectionObserver()
  useVault(fixture)
  AbeleConfig.getInstance().pinnedCurrencies = 'EUR,USD,GBP,CHF'
  GlobalStore.getInstance().initFinance()
  wrapper = mount(FinanceSidebar, { shallow: true, props: { active: true } })
  await flushPromises()
  await nextTick()
  await flushPromises()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  const store = GlobalStore.getInstance()
  store.balanceIndex.value?.cleanup()
  store.balanceIndex.value = null
  store.transactionsList.value?.cleanup()
  store.transactionsList.value = null
  store.accountsList.value?.cleanup()
  store.accountsList.value = null
})

function card(currency: string): DOMWrapper<Element> {
  const found = wrapper!
    .findAll('.abele-finance-sidebar__card')
    .find((c) => c.find('.abele-finance-sidebar__card-currency').text() === currency)
  if (!found) throw new Error(`no card for ${currency}`)
  return found
}

/** The signed amounts on the Debts row, each with what it means. */
function debts(c: DOMWrapper<Element>) {
  return c.findAll('.abele-finance-sidebar__card-debt-amount').map((a) => ({
    text: a.text(),
    meaning: a.attributes('aria-label'),
    tint: a.classes().find((cls) => cls.startsWith('abele-finance-sidebar__summary-value--')),
  }))
}

function net(c: DOMWrapper<Element>): string | undefined {
  return c.find('.abele-finance-sidebar__card-net').exists()
    ? c.find('.abele-finance-sidebar__card-net').text()
    : undefined
}

describe('finance sidebar — debts on a currency card', () => {
  it('shows both directions on one row, what I am owed first, and the net under it', () => {
    const eur = card('EUR')
    expect(eur.findAll('.abele-finance-sidebar__card-row')).toHaveLength(2)
    expect(debts(eur)).toEqual([
      {
        text: `+${formatAmount(300)}`,
        meaning: 'Owed to me',
        tint: 'abele-finance-sidebar__summary-value--income',
      },
      {
        text: `-${formatAmount(400)}`,
        meaning: 'I owe',
        tint: 'abele-finance-sidebar__summary-value--expense',
      },
    ])
    expect(net(eur)).toBe(formatAmount(900))
  })

  it('shows money owed to me when I owe nothing', () => {
    const usd = card('USD')
    expect(debts(usd)).toEqual([
      {
        text: `+${formatAmount(250)}`,
        meaning: 'Owed to me',
        tint: 'abele-finance-sidebar__summary-value--income',
      },
    ])
    expect(net(usd)).toBe(formatAmount(750))
  })

  it('shows what I owe when nobody owes me', () => {
    const gbp = card('GBP')
    expect(debts(gbp)).toEqual([
      {
        text: `-${formatAmount(120)}`,
        meaning: 'I owe',
        tint: 'abele-finance-sidebar__summary-value--expense',
      },
    ])
    expect(net(gbp)).toBe(formatAmount(680))
  })

  it('shows neither row when there are no debts, the balance being the net already', () => {
    const chf = card('CHF')
    expect(chf.find('.abele-finance-sidebar__card-balance').text()).toContain(formatAmount(90))
    expect(chf.findAll('.abele-finance-sidebar__card-row')).toHaveLength(0)
    expect(net(chf)).toBeUndefined()
  })

  it('sets the debts off from the balance with the dashed rule the lent rows have', () => {
    for (const cur of ['EUR', 'USD', 'GBP']) {
      expect(card(cur).find('.abele-finance-sidebar__card-details').classes()).toContain(
        'abele-finance-sidebar__dashed'
      )
    }
  })

  it('labels the rows in muted words, the way the period summary does', () => {
    const labels = card('EUR')
      .findAll('.abele-finance-sidebar__card-row .abele-finance-sidebar__summary-label')
      .map((l) => l.text())
    expect(labels).toEqual(['Debts', 'Net'])
  })
})
