/**
 * The transaction dialog.
 *
 * It writes a new transaction the way the old button did — the same folder and name, the same
 * currencies read off the accounts — and shows what the money does: the wallet's balance on
 * that day and after, the sum as it is typed, the rate between two currencies starting from the
 * one last used. "Next" saves and starts another on the same day between the same accounts.
 * Obsidian's note editor is replaced by a stand-in; the e2e tier drives the real one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useVault } from '../helpers/testEnv'
import type { FakeApp, FakeFileSpec } from '../helpers/fakeVault'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'

const editorState = vi.hoisted(() => ({
  available: true,
  onChange: null as null | ((value: string) => void),
  value: '',
}))

vi.mock('@/editor/embeddedEditor', () => ({
  isEmbeddedEditorAvailable: () => editorState.available,
  createEmbeddedEditor: (
    _app: unknown,
    host: HTMLElement,
    options: { value: string; onChange: (v: string) => void }
  ) => {
    editorState.value = options.value
    editorState.onChange = (v: string) => {
      editorState.value = v
      options.onChange(v)
    }
    return {
      get: () => editorState.value,
      set: (v: string) => void (editorState.value = v),
      focus: () => {},
      contentEl: host,
      destroy: () => {},
    }
  },
}))

import { openTransactionForm } from '@/commands/transactionForm'

const account = (name: string, fm: Record<string, unknown>): FakeFileSpec => ({
  path: `Accounts/${name}.md`,
  frontmatter: { type: 'account', ...fm },
})

function fixture(): FakeFileSpec[] {
  return [
    account('Card', { accountType: 'asset', currency: 'EUR', startingBalance: 200 }),
    account('Cash USD', { accountType: 'asset', currency: 'USD', startingBalance: 0 }),
    account('Food', { accountType: 'expense' }),
    { path: 'Finance/Categories/Coffee.md', frontmatter: {} },
    {
      path: 'Finance/Transactions/2026/01/Exchange.md',
      frontmatter: {
        type: 'transaction',
        date: '2026-01-05',
        from: '[[Card]]',
        to: '[[Cash USD]]',
        amount: 100,
        currency: 'EUR',
        foreignAmount: 110,
        foreignCurrency: 'USD',
        labels: ['keep'],
      },
      content: 'Exchange\n',
    },
  ]
}

let app: FakeApp & { workspace: { openLinkText: ReturnType<typeof vi.fn> } }

const read = (path: string) => {
  const file = app.vault.getFileByPath(path)
  return file ? app.vault.read(file) : Promise.resolve(null)
}

const modal = () => document.querySelector('.modal')!
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
    (b) => b.textContent?.trim() === text
  )
const type = (el: HTMLInputElement, value: string) => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const title = () => modal().querySelector<HTMLInputElement>('.abele-entry-form__title')!
const amount = () => modal().querySelector<HTMLInputElement>('.abele-amount-field__input')!
const linkFields = () => [...modal().querySelectorAll<HTMLInputElement>('.abele-link-field')]
const pick = async (el: HTMLInputElement, name: string) => {
  type(el, name)
  el.dispatchEvent(new Event('blur'))
  await flushPromises()
}

async function open(options: Parameters<typeof openTransactionForm>[0] = {}) {
  await openTransactionForm(options)
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  editorState.available = true
  app = useVault(fixture()) as typeof app
  ;(app as unknown as Record<string, unknown>).workspace = {
    getActiveViewOfType: () => null,
    openLinkText: vi.fn(),
  }
  const config = AbeleConfig.getInstance()
  config.transactionPathTemplate = 'Finance/Transactions/{{date:YYYY/MM}}/{{title}}'
  config.defaultCurrency = 'EUR'
  config.financeCategoriesFolder = 'Finance/Categories'
  config.transactionTemplatePath = ''
  GlobalStore.getInstance().initFinance()
})

afterEach(() => {
  document.body.replaceChildren()
  const store = GlobalStore.getInstance()
  store.balanceIndex.value?.cleanup()
  store.balanceIndex.value = null
  store.transactionsList.value?.cleanup()
  store.transactionsList.value = null
  store.accountsList.value?.cleanup()
  store.accountsList.value = null
})

describe('a new transaction', () => {
  it('works out a sum typed into the amount', async () => {
    await open()
    type(amount(), '12.5 + 3*2')
    await nextTick()

    expect(modal().textContent).toContain('= 18.50')
  })

  it('shows the wallet balance on that day and after the money leaves', async () => {
    await open({ defaults: { date: '2026-01-10', from: '[[Accounts/Card|Card]]' } })
    type(amount(), '18.5')
    await nextTick()

    expect(modal().textContent).toContain('Balance on 10.01.2026: 100.00 EUR → 81.50 EUR')
  })

  it('is written with the accounts, the category and the currency they are in', async () => {
    await open({ defaults: { date: '2026-01-10' } })
    type(title(), 'Coffee')
    type(amount(), '3 + 0.5')
    const [from, to, category] = linkFields()
    await pick(from, 'Card')
    await pick(to, 'Food')
    await pick(category, 'Coffee')
    editorState.onChange!('With [[Anna]]')
    button('Save')!.click()
    await flushPromises()

    const raw = (await read('Finance/Transactions/2026/01/Coffee.md'))!
    expect(raw).toContain('type: transaction')
    expect(raw).toMatch(/from: '?\[\[Accounts\/Card\|Card\]\]'?/)
    expect(raw).toMatch(/to: '?\[\[Accounts\/Food\|Food\]\]'?/)
    expect(raw).toMatch(/category: '?\[\[Finance\/Categories\/Coffee\|Coffee\]\]'?/)
    expect(raw).toContain('amount: 3.5')
    expect(raw).toContain('currency: EUR')
    expect(raw).toMatch(/---\nCoffee\nWith \[\[Anna\]\]\n$/)
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('between currencies, starts from the rate last used and works out the other side', async () => {
    await open({ defaults: { date: '2026-01-10' } })
    type(title(), 'Dollars')
    const [from, to] = linkFields()
    await pick(from, 'Card')
    await pick(to, 'Cash USD')
    type(amount(), '50')
    await nextTick()

    expect(modal().textContent).toContain('Received in USD')
    expect(modal().textContent).toContain('Last used 1.1 on 05.01.2026')
    const fields = [...modal().querySelectorAll<HTMLInputElement>('.abele-amount-field__input')]
    expect(fields[1].value).toBe('55')

    button('Save')!.click()
    await flushPromises()
    const raw = (await read('Finance/Transactions/2026/01/Dollars.md'))!
    expect(raw).toContain('currency: EUR')
    expect(raw).toContain('foreignCurrency: USD')
    expect(raw).toContain('foreignAmount: 55')
  })

  it('"Next" saves, then keeps the day and the accounts for the next one', async () => {
    await open({ defaults: { date: '2026-01-10', from: '[[Accounts/Card|Card]]' } })
    type(title(), 'Bread')
    type(amount(), '2')
    button('Next')!.click()
    await flushPromises()

    expect(await read('Finance/Transactions/2026/01/Bread.md')).toContain('amount: 2')
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(title().value).toBe('')
    expect(amount().value).toBe('')
    expect(linkFields()[0].value).toBe('Card')
    expect(modal().textContent).toContain('Saved “Bread 2.00 EUR”')

    type(title(), 'Milk')
    type(amount(), '1.2')
    button('Save')!.click()
    await flushPromises()
    const milk = (await read('Finance/Transactions/2026/01/Milk.md'))!
    expect(milk).toMatch(/date: '?2026-01-10'?/)
    expect(milk).toMatch(/from: '?\[\[Accounts\/Card\|Card\]\]'?/)
  })
})

describe('an existing transaction', () => {
  it('rewrites what the form shows and leaves every other property alone', async () => {
    await open({ path: 'Finance/Transactions/2026/01/Exchange.md' })
    expect(title().value).toBe('Exchange')
    expect(amount().value).toBe('100')

    type(amount(), '200')
    button('Save')!.click()
    await flushPromises()

    const raw = (await read('Finance/Transactions/2026/01/Exchange.md'))!
    expect(raw).toContain('amount: 200')
    expect(raw).toContain('foreignAmount: 220')
    expect(raw).toContain('- keep')
  })
})

describe('without Obsidian’s editor to borrow', () => {
  it('creates the note and opens it, as the button always did', async () => {
    editorState.available = false
    await open({ defaults: { date: '2026-01-10' } })

    expect(document.querySelector('.modal')).toBeNull()
    expect(await read('Finance/Transactions/2026/01/New Transaction.md')).toContain(
      'type: transaction'
    )
    expect(app.workspace.openLinkText).toHaveBeenCalled()
  })
})
