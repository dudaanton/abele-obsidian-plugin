/**
 * Dates, priorities and labels drawn by the plugin in the Properties panel: the names listed for
 * each get their own row, drawn whole, and every button writes the value in the shape the note
 * had it. A listed property holding what the row cannot read is left to Obsidian, and so is every
 * name not listed.
 *
 * The registry is a stand-in shaped like Obsidian's, as in `propertyWidgets.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AbstractInputSuggest, type App } from 'obsidian'
import { PropertyWidgets, type TypeWidget } from '@/properties/widgets'
import { AbeleConfig } from '@/services/AbeleConfig'
import { formatDay } from '@/properties/dates'
import { useVault } from '../helpers/testEnv'

interface Ctx {
  app: App
  key: string
  sourcePath: string
  onChange: (v: unknown) => void
  blur: () => void
}

const stock = (type: string): TypeWidget => ({
  type,
  name: () => type,
  icon: 'lucide-text',
  validate: () => true,
  render(el, value) {
    el.createDiv({ cls: `stock-${type}`, text: JSON.stringify(value ?? null) })
    return { containerEl: el, type }
  },
})

let table: Record<string, TypeWidget>
let app: App
let widgets: PropertyWidgets
let host: HTMLElement

const ctx = (key: string, changes: unknown[] = [], sourcePath = 'Task.md'): Ctx => ({
  app,
  key,
  sourcePath,
  onChange: (v) => changes.push(v),
  blur: () => {},
})

const draw = (type: string, value: unknown, c: Ctx) => {
  const el = host.createDiv({ cls: 'metadata-property-value' })
  table[type]!.render(el, value, c)
  return el
}

const click = (el: HTMLElement, selector: string) =>
  el.querySelector<HTMLElement>(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

beforeEach(() => {
  const fake = useVault([
    { path: 'Task.md', content: '', frontmatter: { due: '2026-05-10', dueTime: '14:30' } },
    { path: 'Plain.md', content: '', frontmatter: { date: '2026-05-10' } },
    { path: 'One.md', content: '', frontmatter: { labels: ['work', 'errands'] } },
    { path: 'Two.md', content: '', frontmatter: { labels: ['work', 'home'] } },
    { path: 'Three.md', content: '', frontmatter: { labels: 'reading' } },
  ])
  table = Object.fromEntries(
    ['number', 'text', 'date', 'datetime', 'multitext', 'file'].map((t) => [t, stock(t)])
  )
  ;(fake as unknown as Record<string, unknown>).metadataTypeManager = {
    registeredTypeWidgets: table,
  }
  app = fake as unknown as App
  widgets = new PropertyWidgets(app, {
    dateKeys: () => ['date', 'Due'],
    priorityKeys: () => ['priority'],
    labelKeys: () => ['labels'],
  })
  widgets.load()
  widgets.apply(true)
  host = document.body.createDiv()
})

afterEach(() => {
  widgets.destroy()
  host.remove()
})

describe('a date property', () => {
  const row = (el: HTMLElement) => el.querySelector('.abele-property-date')
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!

  it('steps a day either way, over a month’s end', () => {
    const changes: unknown[] = []
    const el = draw('date', '2026-01-31', ctx('due', changes))
    expect(row(el)).not.toBeNull()
    expect(input(el).type).toBe('date')
    expect(input(el).value).toBe('2026-01-31')
    click(el, '.abele-property-date__later')
    expect(changes).toEqual(['2026-02-01'])
    click(el, '.abele-property-date__earlier')
    click(el, '.abele-property-date__earlier')
    expect(changes).toEqual(['2026-02-01', '2026-01-31', '2026-01-30'])
    expect(input(el).value).toBe('2026-01-30')
  })

  it('keeps the time of a date and time', () => {
    const changes: unknown[] = []
    const el = draw('datetime', '2026-05-10T09:30', ctx('date', changes))
    expect(input(el).type).toBe('datetime-local')
    expect(input(el).value).toBe('2026-05-10T09:30')
    click(el, '.abele-property-date__later')
    expect(changes).toEqual(['2026-05-11T09:30'])
  })

  it('counts an empty property as today, drawn as text since it has no type yet', () => {
    const changes: unknown[] = []
    const el = draw('text', null, ctx('date', changes))
    expect(row(el)).not.toBeNull()
    expect(input(el).value).toBe('')
    click(el, '.abele-property-date__later')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(changes).toEqual([formatDay(tomorrow)])
  })

  it('says how far away the day is, with the time kept beside it', () => {
    const el = draw('date', '2026-05-10', ctx('due', [], 'Task.md'))
    const text = el.querySelector('.abele-property-date__relative')!.textContent ?? ''
    // Far in the past or the future depending on when this runs; hours show only with a time.
    expect(text).toMatch(
      /^(in \d+ d( \d+ h)?|\d+ d( \d+ h)? ago|in \d+ h|\d+ h ago|now|in \d+ min|\d+ min ago)$/
    )
    const plain = draw('date', '2026-05-10', ctx('date', [], 'Plain.md'))
    expect(plain.querySelector('.abele-property-date__relative')!.textContent).toMatch(
      /^(today|tomorrow|yesterday|in \d+ days|\d+ days ago)$/
    )
  })

  it('takes a day picked in the field, and an emptied field as empty', () => {
    const changes: unknown[] = []
    const el = draw('datetime', '2026-05-10 09:30', ctx('date', changes))
    input(el).value = '2026-06-01T10:15'
    input(el).dispatchEvent(new Event('change'))
    expect(changes).toEqual(['2026-06-01 10:15'])
    input(el).value = ''
    input(el).dispatchEvent(new Event('change'))
    expect(changes).toEqual(['2026-06-01 10:15', null])
  })

  it('leaves a value that is not a date, and a name not listed, to Obsidian', () => {
    expect(row(draw('text', 'someday', ctx('due')))).toBeNull()
    expect(row(draw('date', '2026-05-10', ctx('created')))).toBeNull()
  })

  it('shows a value the panel gives it later', () => {
    const changes: unknown[] = []
    const el = host.createDiv()
    const drawn = table.date.render(el, '2026-05-10', ctx('due', changes)) as {
      setValue(v: unknown): void
    }
    drawn.setValue('2026-12-31')
    click(el, '.abele-property-date__later')
    expect(changes).toEqual(['2027-01-01'])
  })
})

describe('a priority property', () => {
  const name = (el: HTMLElement) => el.querySelector('.abele-property-priority__name')?.textContent
  const lit = (el: HTMLElement) => el.querySelectorAll('.abele-property-priority__bar.is-on').length

  it('raises from none to high and lowers back to none, a step at a time', () => {
    const changes: unknown[] = []
    const el = draw('text', null, ctx('priority', changes))
    expect(name(el)).toBe('None')
    expect(lit(el)).toBe(0)
    for (let i = 0; i < 4; i++) click(el, '.abele-property-priority__raise')
    expect(changes).toEqual(['low', 'medium', 'high'])
    expect(name(el)).toBe('High')
    expect(lit(el)).toBe(3)
    for (let i = 0; i < 4; i++) click(el, '.abele-property-priority__lower')
    expect(changes).toEqual(['low', 'medium', 'high', 'medium', 'low', null])
    expect(name(el)).toBe('None')
  })

  it('reads the level whatever its case and colours it as tasks do', () => {
    const el = draw('text', 'Medium', ctx('priority'))
    expect(name(el)).toBe('Medium')
    expect(lit(el)).toBe(2)
    expect(el.querySelector('.abele-property-priority_orange')).not.toBeNull()
  })

  it('leaves a value off the scale to Obsidian', () => {
    const el = draw('text', 'urgent', ctx('priority'))
    expect(el.querySelector('.abele-property-priority')).toBeNull()
    expect(el.querySelector('.stock-text')).not.toBeNull()
  })
})

describe('a labels property', () => {
  const pills = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.multi-select-pill')].map((p) => p.dataset.label)
  const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!
  const suggest = (el: HTMLElement) =>
    AbstractInputSuggest.attachedTo.get(field(el)) as unknown as AbstractInputSuggest<{
      label: string
      fresh: boolean
    }> & { suggestionsNow(): { label: string; fresh: boolean }[] }

  it('draws each label as a pill, and a cross takes one off', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['work', 'todo'], ctx('labels', changes))
    expect(pills(el)).toEqual(['work', 'todo'])
    click(el, '.multi-select-pill[data-label="work"] .multi-select-pill-remove-button')
    expect(changes).toEqual([['todo']])
    expect(pills(el)).toEqual(['todo'])
    click(el, '.multi-select-pill-remove-button')
    expect(changes).toEqual([['todo'], null])
    expect(pills(el)).toEqual([])
  })

  it('offers the vault’s labels, most used first, less those already there', () => {
    const el = draw('multitext', ['errands'], ctx('labels'))
    const s = suggest(el)
    field(el).value = ''
    expect(s.suggestionsNow().map((c) => c.label)).toEqual(['work', 'home', 'reading'])
    field(el).value = 'ho'
    expect(s.suggestionsNow()).toEqual([
      { label: 'home', fresh: false },
      { label: 'ho', fresh: true },
    ])
  })

  it('adds a label picked from the list, or typed and entered, as a list', () => {
    const changes: unknown[] = []
    const el = draw('text', null, ctx('labels', changes))
    const s = suggest(el)
    s.selectSuggestion({ label: 'work', fresh: false })
    expect(changes).toEqual([['work']])
    field(el).value = 'Garden'
    field(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(changes).toEqual([['work'], ['work', 'Garden']])
    expect(pills(el)).toEqual(['work', 'Garden'])
    expect(field(el).value).toBe('')
  })

  it('takes the last label off with Backspace in the empty field', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['a', 'b'], ctx('labels', changes))
    field(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(changes).toEqual([['a']])
  })

  it('tints a label with the colour it has in the task settings', () => {
    const config = AbeleConfig.getInstance()
    const saved = config.taskLabelColors
    config.taskLabelColors = [{ value: 'Work', color: 'green' }]
    try {
      const el = draw('multitext', ['work', 'home'], ctx('labels'))
      expect(el.querySelector('[data-label="work"]')?.classList).toContain(
        'abele-property-labels__pill_green'
      )
      expect(el.querySelector('[data-label="home"]')?.className).not.toMatch(/_pill_/)
    } finally {
      config.taskLabelColors = saved
    }
  })

  it('leaves a name not listed to Obsidian', () => {
    const el = draw('multitext', ['x'], ctx('aliases'))
    expect(el.querySelector('.abele-property-labels')).toBeNull()
    expect(el.querySelector('.stock-multitext')).not.toBeNull()
  })
})

describe('switched off', () => {
  it('is Obsidian’s own drawing for every kind', () => {
    widgets.apply(false)
    expect(draw('date', '2026-05-10', ctx('due')).querySelector('.stock-date')).not.toBeNull()
    expect(draw('text', 'low', ctx('priority')).querySelector('.stock-text')).not.toBeNull()
    expect(draw('multitext', ['a'], ctx('labels')).querySelector('.stock-multitext')).not.toBeNull()
  })
})
