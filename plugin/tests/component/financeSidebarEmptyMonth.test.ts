import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import FinanceSidebar from '@/components/FinanceSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

// happy-dom has no canvas. The charts are drawn by a library the sidebar only hands data to.
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

let wrapper: VueWrapper | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T12:00:00'))
  installFakeIntersectionObserver()
  useVault([
    {
      path: 'Accounts/Card.md',
      frontmatter: {
        type: 'account',
        accountType: 'asset',
        currency: 'EUR',
        startingBalance: 100,
        startingBalanceDate: '2026-10-01',
      },
    },
    { path: 'Accounts/Food.md', frontmatter: { type: 'account', accountType: 'expense' } },
    {
      path: 'Transactions/October.md',
      frontmatter: {
        type: 'transaction',
        date: '2026-10-15',
        from: '[[Card]]',
        to: '[[Food]]',
        amount: 10,
        currency: 'EUR',
      },
    },
  ])
  AbeleConfig.getInstance().pinnedCurrencies = 'EUR'
  GlobalStore.getInstance().initFinance()
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
  vi.useRealTimers()
})

it('keeps chart tabs, calendar and historical balance available in an empty current month', async () => {
  wrapper = mount(FinanceSidebar, {
    shallow: true,
    props: { active: true },
    global: { stubs: { SidebarPanel: false, Section: false, EmptyState: false } },
  })
  await flushPromises()
  await nextTick()
  const tabs = wrapper.findComponent('.abele-finance-sidebar__chart-tabs')
  expect(tabs.exists()).toBe(true)
  expect(wrapper.find('.abele-finance-sidebar__pie-empty').text()).toBe('No expenses yet')
  tabs.vm.$emit('update:modelValue', 'income')
  await nextTick()
  expect(wrapper.find('.abele-finance-sidebar__pie-empty').text()).toBe('No income yet')
  tabs.vm.$emit('update:modelValue', 'calendar')
  await nextTick()
  expect(wrapper.find('.abele-finance-sidebar__calendar-chart').exists()).toBe(true)
  tabs.vm.$emit('update:modelValue', 'networth')
  await nextTick()
  expect(wrapper.find('.abele-finance-sidebar__networth-chart').exists()).toBe(true)
  expect(wrapper.text()).toContain('Nothing in')
})
