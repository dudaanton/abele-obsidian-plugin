import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { Menu } from 'obsidian'
import TransactionItem from '@/components/TransactionItem.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { Transaction } from '@/entities/Transaction'
import { openFile } from '@/helpers/vaultUtils'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { formatAmount } from '@/helpers/moneyFormat'
import { useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

vi.mock('@/helpers/vaultUtils', async (original) => ({
  ...(await original<typeof import('@/helpers/vaultUtils')>()),
  openFile: vi.fn(),
}))
let wrapper: VueWrapper | undefined
let tx: Transaction
beforeEach(() => {
  installFakeIntersectionObserver()
  useVault([
    {
      path: 'Receipt.md',
      frontmatter: {
        type: 'transaction',
        date: '2024-03-01',
        amount: 12.3,
        currency: 'EUR',
        from: '[[Cash]]',
        to: '[[Food]]',
      },
      content: 'Groceries\n\nApples and pears',
    },
  ])
  tx = reactive(new Transaction({ wikilink: '[[Receipt]]' })) as Transaction
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  tx.cleanup()
  VaultWatcherWrapper.destroy()
  resetFakeIntersectionObservers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function show(txType: 'income' | 'expense' | 'transfer' = 'expense') {
  wrapper = mount(TransactionItem, { shallow: true, props: { transaction: tx, txType } })
  await nextTick()
  await flushPromises()
}
async function visible() {
  expect(scrollIntoView(wrapper!.find('.abele-transaction-view').element)).toBe(1)
  await nextTick()
  await flushPromises()
}

describe('TransactionItem', () => {
  it('loads metadata on mount but reads title, description and links only when visible, once', async () => {
    const content = vi.spyOn(tx, 'loadContent')
    await show()
    expect(tx.loaded).toBe(true)
    expect(content).not.toHaveBeenCalled()
    expect(wrapper!.find('.abele-transaction-view__title').exists()).toBe(false)
    await visible()
    expect(content).toHaveBeenCalledTimes(1)
    expect(wrapper!.findComponent('.abele-transaction-view__title').props('text')).toBe('Groceries')
    expect(wrapper!.findComponent('.abele-transaction-view__title').props('filePath')).toBe(
      'Receipt.md'
    )
    expect(
      wrapper!.findAllComponents('.abele-transaction-view__link').map((c) => c.props('text'))
    ).toEqual(['[[Cash]]', '[[Food]]'])
    expect(wrapper!.find('.abele-transaction-view__description').exists()).toBe(false)
    await visible()
    expect(content).toHaveBeenCalledTimes(1)
  })

  it('expands and collapses description without opening the note', async () => {
    await show()
    await visible()
    const icon = wrapper!.findComponent(Icon)
    expect(icon.props('icon')).toBe('chevron-down')
    await icon.trigger('click')
    expect(wrapper!.findComponent('.abele-transaction-view__description').props('text')).toBe(
      'Apples and pears'
    )
    expect(icon.props('icon')).toBe('chevron-up')
    expect(openFile).not.toHaveBeenCalled()
    await icon.trigger('click')
    expect(wrapper!.find('.abele-transaction-view__description').exists()).toBe(false)
  })

  it.each(['income', 'expense', 'transfer'] as const)(
    'formats the primary amount and type class for %s',
    async (type) => {
      await show(type)
      const amount = wrapper!.find('.abele-transaction-view__amount')
      expect(amount.text()).toBe(`${type === 'expense' ? '-' : ''}${formatAmount(12.3)} EUR`)
      expect(amount.classes()).toContain(`abele-transaction-view__amount--${type}`)
      tx.amount = null
      await nextTick()
      expect(amount.text()).toBe(`${type === 'expense' ? '-' : ''}${formatAmount(0)} EUR`)
    }
  )

  it('opens the card but not an internal link or icon nested inside it', async () => {
    await show()
    await wrapper!.find('.abele-transaction-view').trigger('click')
    expect(openFile).toHaveBeenCalledWith('Receipt.md')
    vi.mocked(openFile).mockClear()
    for (const className of ['internal-link', 'abele-obsidian-icon']) {
      const target = document.createElement(className === 'internal-link' ? 'a' : 'span')
      target.className = className
      wrapper!.element.append(target)
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(openFile).not.toHaveBeenCalled()
      target.remove()
    }
  })

  it.each([false, true])(
    'offers Delete and only removes after confirmation %s',
    async (confirmed) => {
      const menu = vi.spyOn(Menu.prototype, 'showAtPosition')
      const remove = vi.spyOn(tx, 'remove').mockResolvedValue()
      const confirm = vi.fn(() => confirmed)
      vi.stubGlobal('confirm', confirm)
      await show()
      await wrapper!
        .find('.abele-transaction-view')
        .trigger('contextmenu', { clientX: 10, clientY: 20 })
      expect(menu).toHaveBeenCalledWith({ x: 10, y: 20 })
      // The Obsidian test double retains menu items; production Menu has no public items field.
      const instance = menu.mock.instances[0] as unknown as {
        items: Array<{ title: string; icon: string; handler: () => void }>
      }
      expect(instance.items).toHaveLength(1)
      expect(instance.items[0]).toMatchObject({ title: 'Delete', icon: 'trash' })
      instance.items[0].handler()
      expect(remove).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
      const dialog = document.querySelector('.abele-modal')!
      expect(dialog?.querySelector('.abele-confirm__message')?.textContent).toBe(
        'Are you sure you want to delete this transaction?'
      )
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent === (confirmed ? 'Delete' : 'Cancel'))!
        .click()
      await flushPromises()
      expect(remove).toHaveBeenCalledTimes(confirmed ? 1 : 0)
    }
  )

  it('shows a missing-note placeholder instead of an amount or clickable content', async () => {
    tx.transactionNotFound = true
    await show()
    expect(wrapper!.text()).toBe('Transaction not found')
    expect(wrapper!.find('.abele-transaction-view__amount').exists()).toBe(false)
    await wrapper!.trigger('click')
    expect(openFile).not.toHaveBeenCalled()
  })
})
