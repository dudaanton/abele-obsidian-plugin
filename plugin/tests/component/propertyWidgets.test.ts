/**
 * The plugin's drawing of properties is a swap of `render` on Obsidian's property types, and
 * everything rests on putting the originals back: switched off, the types must be exactly
 * Obsidian's again, and unloaded, the type the plugin added must be gone.
 *
 * The registry here is a stand-in shaped like Obsidian 1.13's (probed in the running app, see
 * the plan): a number field that reads its input on Enter, a text field, the hidden File type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import type { App } from 'obsidian'
import { FILES_TYPE, PropertyWidgets, type TypeWidget } from '@/properties/widgets'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

interface Ctx {
  app: App
  key: string
  sourcePath: string
  onChange: (v: unknown) => void
  blur: () => void
}

function stockRegistry() {
  const number: TypeWidget = {
    type: 'number',
    name: () => 'Number',
    icon: 'lucide-binary',
    validate: (v) => typeof v === 'number',
    render(el, value, ctx) {
      const input = el.ownerDocument.createElement('input')
      input.className = 'metadata-input metadata-input-number'
      input.type = 'number'
      input.setAttribute('inputmode', 'decimal')
      el.appendChild(input)
      input.value = value == null ? '' : String(value)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const n = +input.value
          if (Number.isNaN(n)) el.addClass('stock-error')
          else ctx.onChange(n)
        }
      })
      return { containerEl: el, type: 'number', inputEl: input }
    },
  }
  const text: TypeWidget = {
    type: 'text',
    name: () => 'Text',
    icon: 'lucide-text',
    validate: (v) => typeof v === 'string',
    // Like Obsidian's: the object it returns keeps the value and draws its cell again by itself,
    // emptying it — when the value is set, and when the field is clicked into to edit it.
    render(el, value) {
      const widget = {
        containerEl: el,
        type: 'text',
        value,
        render() {
          el.empty()
          el.createDiv({ cls: 'stock-text', text: String(this.value ?? '') })
        },
        setValue(next: unknown) {
          this.value = next
          this.render()
        },
        edit() {
          el.empty()
          el.createDiv({ cls: 'metadata-input-longtext', text: String(this.value ?? '') })
        },
      }
      widget.render()
      return widget
    },
  }
  const multitext: TypeWidget = {
    type: 'multitext',
    name: () => 'List',
    icon: 'lucide-list',
    validate: () => true,
    render(el, value) {
      el.createDiv({ cls: 'stock-list', text: JSON.stringify(value) })
      return { containerEl: el, type: 'multitext' }
    },
  }
  const file: TypeWidget = {
    type: 'file',
    name: () => 'File',
    icon: 'lucide-file',
    reservedKeys: [],
    validate: (v) => typeof v === 'string',
    render(el, value) {
      el.createDiv({ cls: 'stock-file', text: String(value ?? '') })
      return { containerEl: el, type: 'file' }
    },
  }
  return { number, text, multitext, file } as Record<string, TypeWidget>
}

let table: Record<string, TypeWidget>
let app: App
let widgets: PropertyWidgets
let host: HTMLElement

const ctx = (key: string, changes: unknown[] = []): Ctx => ({
  app,
  key,
  sourcePath: 'Note.md',
  onChange: (v) => changes.push(v),
  blur: () => {},
})

const draw = (type: string, value: unknown, c: Ctx) => {
  const el = host.createDiv({ cls: 'metadata-property-value' })
  table[type]!.render(el, value, c)
  return el
}

beforeEach(() => {
  const fake = useVault([
    { path: 'Note.md', content: '' },
    { path: 'Books/Dune.epub', content: '' },
    { path: 'Media/poster.png', content: '' },
    { path: 'Wallet.md', content: '' },
    { path: 'Work/Wallet.md', content: '' },
    { path: 'Work/Taxi.md', content: '' },
    { path: 'Card.md', content: '' },
    { path: 'Food.md', content: '' },
  ])
  ;(fake.vault as unknown as { getResourcePath: (f: { path: string }) => string }).getResourcePath =
    (f) => `app://vault/${f.path}`
  ;(fake.metadataCache as unknown as Record<string, unknown>).fileToLinktext = (f: {
    path: string
  }) => f.path.replace(/\.md$/, '')
  table = stockRegistry()
  ;(fake as unknown as Record<string, unknown>).metadataTypeManager = {
    registeredTypeWidgets: table,
  }
  app = fake as unknown as App
  widgets = new PropertyWidgets(app)
  host = document.body.createDiv()
})

afterEach(() => {
  widgets.destroy()
  host.remove()
})

describe('putting Obsidian back', () => {
  it('restores the very functions it replaced, and the hidden File type', () => {
    const originals = Object.fromEntries(Object.entries(table).map(([k, w]) => [k, w.render]))
    expect(widgets.load()).toBe(true)
    widgets.apply(true)
    expect(table.number.render).not.toBe(originals.number)
    expect(table.text.render).not.toBe(originals.text)
    expect(table.file.render).not.toBe(originals.file)
    expect(table.file.reservedKeys).toBeUndefined()

    widgets.apply(false)
    for (const key of ['number', 'text', 'file', 'multitext'])
      expect(table[key].render).toBe(originals[key])
    expect(table.file.reservedKeys).toEqual([])
  })

  it('keeps Files registered while off, drawn as a list, and takes it out on unload', () => {
    widgets.load()
    expect(table[FILES_TYPE]).toBeDefined()
    const el = draw(FILES_TYPE, ['[[a.pdf]]'], ctx('attachments'))
    expect(el.querySelector('.stock-list')).not.toBeNull()

    widgets.destroy()
    expect(table[FILES_TYPE]).toBeUndefined()
  })

  it('patches nothing when this Obsidian keeps no table of types', () => {
    const bare = new PropertyWidgets({ workspace: {} } as unknown as App)
    expect(bare.load()).toBe(false)
    expect(() => bare.apply(true)).not.toThrow()
    bare.destroy()
  })
})

describe('a number property', () => {
  it('works out a sum on Enter, and the stock field stores the answer', () => {
    widgets.load()
    widgets.apply(true)
    const changes: unknown[] = []
    const el = draw('number', 5, ctx('amount', changes))
    const input = el.querySelector('input')!
    expect(input.type).toBe('text')
    expect(input.hasAttribute('inputmode')).toBe(false)

    input.value = '120+35*2'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(changes).toEqual([190])
    expect(input.value).toBe('190')
  })

  it('leaves what is not a sum to the stock field, which calls it an error', () => {
    widgets.load()
    widgets.apply(true)
    const changes: unknown[] = []
    const el = draw('number', 5, ctx('amount', changes))
    const input = el.querySelector('input')!
    input.value = '12+'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(changes).toEqual([])
    expect(el.classList.contains('stock-error')).toBe(true)
  })

  it('is Obsidian’s own field when switched off', () => {
    widgets.load()
    widgets.apply(true)
    widgets.apply(false)
    const el = draw('number', 5, ctx('amount'))
    expect(el.querySelector('input')!.type).toBe('number')
  })
})

describe('files as cards', () => {
  it('draws a File property as a card named after the file', async () => {
    widgets.load()
    widgets.apply(true)
    const el = draw('file', '[[Books/Dune.epub]]', ctx('book'))
    await nextTick()
    expect(el.querySelector('.stock-file')).toBeNull()
    expect(el.querySelector('.abele-card__name')?.textContent).toBe('Dune.epub')
  })

  it('draws the cover as a card with its picture', async () => {
    widgets.load()
    widgets.apply(true)
    const el = draw('text', '[[Media/poster.png]]', ctx('cover'))
    await nextTick()
    await nextTick()
    expect(el.querySelector('.abele-card__name')?.textContent).toBe('poster.png')
    expect(el.querySelector('img')?.getAttribute('src')).toBe('app://vault/Media/poster.png')
  })

  it('draws a Files list as a card each, and removing one writes the rest back', async () => {
    widgets.load()
    widgets.apply(true)
    const changes: unknown[] = []
    const el = draw(FILES_TYPE, ['[[Books/Dune.epub]]', '[[Media/poster.png]]'], ctx('f', changes))
    await nextTick()
    const cards = el.querySelectorAll('.abele-card')
    expect(cards).toHaveLength(2)
    ;(cards[0].querySelector('.abele-property-files__remove') as HTMLElement).click()
    expect(changes).toEqual([['[[Media/poster.png]]']])
  })

  it('keeps every row drawn before the panel puts them on the page', async () => {
    widgets.load()
    widgets.apply(true)
    // The panel draws each row into a cell of its own, off the page, and adds them after.
    const cells = ['[[Books/Dune.epub]]', '[[Media/poster.png]]'].map((value) => {
      const el = document.createElement('div')
      table.file.render(el, value, ctx('pw'))
      return el
    })
    for (const el of cells) host.appendChild(el)
    await nextTick()
    expect(cells.map((el) => el.querySelector('.abele-card__name')?.textContent)).toEqual([
      'Dune.epub',
      'poster.png',
    ])
  })

  it('leaves an ordinary text property to Obsidian', () => {
    widgets.load()
    widgets.apply(true)
    const el = draw('text', 'hello', ctx('title'))
    expect(el.querySelector('.stock-text')?.textContent).toBe('hello')
  })
})

describe('a wallet’s balance beside a link to it', () => {
  interface StockText {
    render(): void
    setValue(v: unknown): void
    edit(): void
  }
  const balances: Record<string, number> = {}
  const store = () => GlobalStore.getInstance()

  const financeReady = () => {
    const accounts = new Map([
      ['Wallet.md', { accountType: 'asset', currency: 'EUR' }],
      ['Work/Wallet.md', { accountType: 'asset', currency: 'EUR' }],
      ['Card.md', { accountType: 'liability', currency: 'EUR' }],
      ['Food.md', { accountType: 'expense', currency: 'EUR' }],
    ])
    store().accountsList.value = { accounts } as never
    store().balanceIndex.value = {
      version: ref(1),
      getBalanceAtDate: (path: string) => balances[path] ?? 0,
    } as never
  }

  const flush = () => new Promise((r) => setTimeout(r, 0))

  const drawText = (value: unknown) => {
    const el = host.createDiv({ cls: 'metadata-property-value' })
    const widget = table.text.render(el, value, ctx('from')) as unknown as StockText
    return { el, widget }
  }

  const badge = (el: HTMLElement) => {
    const b = el.querySelector<HTMLElement>('.abele-property-balance')
    return b && b.style.display !== 'none' ? b.textContent : null
  }

  beforeEach(() => {
    balances['Wallet.md'] = 70
    balances['Work/Wallet.md'] = 488
    balances['Card.md'] = -20
    widgets.load()
    widgets.apply(true)
  })

  afterEach(() => {
    store().balanceIndex.value = null
    store().accountsList.value = null
  })

  it('shows the balance of the wallet a text property links to, and none for a category', () => {
    financeReady()
    expect(badge(drawText('[[Wallet]]').el)).toBe('70.00 EUR')
    expect(badge(drawText('[[Food]]').el)).toBeNull()
  })

  it('keeps the balance when the field draws itself again, as it does after an edit', async () => {
    financeReady()
    const { el, widget } = drawText('[[Wallet]]')
    widget.edit()
    await flush()
    expect(badge(el)).toBeNull()
    widget.render()
    await flush()
    expect(badge(el)).toBe('70.00 EUR')
  })

  it('follows the value the field was given, to another wallet or away from one', async () => {
    financeReady()
    const { el, widget } = drawText('[[Wallet]]')
    widget.setValue('[[Card]]')
    await flush()
    expect(badge(el)).toBe('-20.00 EUR')
    widget.setValue('[[Food]]')
    await flush()
    expect(badge(el)).toBeNull()
    widget.setValue('[[Wallet]]')
    await flush()
    expect(badge(el)).toBe('70.00 EUR')
  })

  it('shows the balance once the finance index is ready, for a row drawn before it', async () => {
    const { el } = drawText('[[Wallet]]')
    expect(badge(el)).toBeNull()
    financeReady()
    await nextTick()
    await flush()
    expect(badge(el)).toBe('70.00 EUR')
  })

  it('draws the new balance when a transaction changes it', async () => {
    financeReady()
    const { el } = drawText('[[Wallet]]')
    balances['Wallet.md'] = 55
    ;(store().balanceIndex.value as unknown as { version: number }).version++
    await nextTick()
    expect(badge(el)).toBe('55.00 EUR')
  })
  it('reads the wallet from the note on screen when the panel moves the row to another note', async () => {
    financeReady()
    const el = host.createDiv({ cls: 'metadata-property-value' })
    // The panel keeps one context per row and changes its note in place when another opens.
    const c = ctx('from')
    const widget = table.text.render(el, '[[Wallet]]', c) as unknown as StockText
    expect(badge(el)).toBe('70.00 EUR')
    c.sourcePath = 'Work/Taxi.md'
    widget.setValue('[[Wallet]]')
    await flush()
    expect(badge(el)).toBe('488.00 EUR')
  })
  it('reads the wallet from the note now open in the tab, when the same link stays in the row', async () => {
    financeReady()
    // A tab showing a note, and the workspace telling of notes opened in it.
    const view = { containerEl: host, file: { path: 'Note.md' } }
    const handlers: (() => void)[] = []
    const fake = GlobalStore.getInstance().app as unknown as Record<string, unknown>
    fake.workspace = {
      iterateAllLeaves: (fn: (leaf: unknown) => void) => fn({ view }),
      on: (_name: string, fn: () => void) => (handlers.push(fn), { fn }),
      offref: () => {},
    }
    try {
      const { el } = drawText('[[Wallet]]')
      expect(badge(el)).toBe('70.00 EUR')
      // Another note opens in the tab with the same link; the panel keeps the row as it is.
      view.file = { path: 'Work/Taxi.md' }
      for (const h of handlers) h()
      await new Promise((r) => setTimeout(r, 20))
      expect(badge(el)).toBe('488.00 EUR')
    } finally {
      delete fake.workspace
    }
  })
})
