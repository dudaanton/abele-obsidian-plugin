/**
 * A groups property drawn by the plugin: each group a link pill that opens its note and has a ×,
 * and a field adding one from the notes the vault uses as groups. Values are written as they are
 * stored — the others kept as written, a new one a plain wikilink — and an empty or missing value
 * draws an empty row.
 *
 * The registry is a stand-in shaped like Obsidian's, as in `propertyKinds.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AbstractInputSuggest, type App, type TFile } from 'obsidian'
import { PropertyWidgets, type TypeWidget } from '@/properties/widgets'
import type { GroupNote } from '@/properties/groups'
import { useVault } from '../helpers/testEnv'

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
let opened: [string, string, unknown][]

const ctx = (key: string, changes: unknown[] = [], sourcePath = 'Inbox/Sample note.md') => ({
  app,
  key,
  sourcePath,
  onChange: (v: unknown) => changes.push(v),
  blur: () => {},
})

const draw = (type: string, value: unknown, c: ReturnType<typeof ctx>) => {
  const el = host.createDiv({ cls: 'metadata-property-value' })
  table[type]!.render(el, value, c)
  return el
}

const pills = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('.multi-select-pill .multi-select-pill-content')].map(
    (p) => p.textContent
  )
const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!
const suggest = (el: HTMLElement) =>
  AbstractInputSuggest.attachedTo.get(field(el)) as unknown as AbstractInputSuggest<GroupNote> & {
    suggestionsNow(): GroupNote[]
  }

beforeEach(() => {
  const fake = useVault([
    { path: 'Projects/Garden.md', content: '' },
    { path: 'Projects/Kitchen.md', content: '' },
    { path: 'Projects/Reading list.md', content: '' },
    { path: 'Archive/Garage.md', content: '' },
    { path: 'Inbox/Sample note.md', content: '', frontmatter: { groups: ['[[Garden]]'] } },
    { path: 'Inbox/One.md', content: '', frontmatter: { groups: ['[[Kitchen]]', '[[Garden]]'] } },
    { path: 'Inbox/Two.md', content: '', frontmatter: { groups: '[[Kitchen]]' } },
    { path: 'Inbox/Three.md', content: '', frontmatter: { groups: ['[[Reading list]]'] } },
  ])
  table = Object.fromEntries(
    ['number', 'text', 'date', 'datetime', 'multitext', 'file'].map((t) => [t, stock(t)])
  )
  opened = []
  const extra = fake as unknown as Record<string, unknown>
  extra.metadataTypeManager = { registeredTypeWidgets: table }
  extra.workspace = {
    openLinkText: (link: string, source: string, newLeaf: unknown) => {
      opened.push([link, source, newLeaf])
    },
    trigger: () => {},
  }
  const cache = fake.metadataCache as unknown as Record<string, unknown>
  cache.fileToLinktext = (file: TFile) => file.basename
  app = fake as unknown as App
  widgets = new PropertyWidgets(app, { groupKeys: () => ['groups'], labelKeys: () => ['labels'] })
  widgets.load()
  widgets.apply(true)
  host = document.body.createDiv()
})

afterEach(() => {
  widgets.destroy()
  host.remove()
})

describe('a groups property', () => {
  it('draws each group as a link pill with its note’s name, a missing note as unresolved', () => {
    const el = draw(
      'multitext',
      ['[[Projects/Garden]]', '[[Kitchen|Cooking]]', '[[Nowhere]]'],
      ctx('groups')
    )
    expect(pills(el)).toEqual(['Garden', 'Cooking', 'Nowhere'])
    const links = el.querySelectorAll<HTMLElement>('.internal-link')
    expect(links[0].dataset.href).toBe('Projects/Garden')
    expect(links[0].classList).not.toContain('is-unresolved')
    expect(links[2].classList).toContain('is-unresolved')
  })

  it('opens the group note when its pill is clicked', () => {
    const el = draw('multitext', ['[[Garden]]'], ctx('groups'))
    el.querySelector<HTMLElement>('.internal-link')!.click()
    expect(opened).toEqual([['Garden', 'Inbox/Sample note.md', false]])
  })

  it('takes a group off with its cross, keeping the others as written, empty after the last', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['[[Kitchen|Cooking]]', '[[Garden]]'], ctx('groups', changes))
    el.querySelector<HTMLElement>('.multi-select-pill-remove-button')!.click()
    expect(changes).toEqual([['[[Garden]]']])
    expect(pills(el)).toEqual(['Garden'])
    el.querySelector<HTMLElement>('.multi-select-pill-remove-button')!.click()
    expect(changes).toEqual([['[[Garden]]'], null])
    expect(pills(el)).toEqual([])
  })

  it('offers the vault’s groups, most members first, less those held and the note itself', () => {
    const el = draw('multitext', ['[[Garden]]'], ctx('groups'))
    field(el).value = ''
    expect(
      suggest(el)
        .suggestionsNow()
        .map((g) => g.title)
    ).toEqual(['Kitchen', 'Reading list'])
    field(el).value = 'ga'
    expect(
      suggest(el)
        .suggestionsNow()
        .map((g) => g.title)
    ).toEqual(['Garage'])
    field(el).value = 'sample'
    expect(suggest(el).suggestionsNow()).toEqual([])
  })

  it('adds a picked group as a plain wikilink, to an empty or missing value too', () => {
    for (const empty of [null, undefined, '', []]) {
      const changes: unknown[] = []
      const el = draw('text', empty, ctx('groups', changes))
      expect(pills(el)).toEqual([])
      suggest(el).selectSuggestion({ path: 'Projects/Kitchen.md', title: 'Kitchen', members: 2 })
      expect(changes).toEqual([['[[Kitchen]]']])
      expect(pills(el)).toEqual(['Kitchen'])
    }
  })

  it('does not add a group already there by another spelling, nor free text on Enter', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['[[Projects/Kitchen|Cooking]]'], ctx('groups', changes))
    suggest(el).selectSuggestion({ path: 'Projects/Kitchen.md', title: 'Kitchen', members: 2 })
    field(el).value = 'Brand new'
    field(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(changes).toEqual([])
  })

  it('takes the last group off with Backspace in the empty field', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['[[Garden]]', '[[Kitchen]]'], ctx('groups', changes))
    field(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(changes).toEqual([['[[Garden]]']])
  })

  it('leaves a name not listed, and a value it cannot read, to Obsidian', () => {
    expect(
      draw('multitext', ['[[A]]'], ctx('related')).querySelector('.stock-multitext')
    ).not.toBeNull()
    expect(
      draw('multitext', [{ a: 1 }], ctx('groups')).querySelector('.abele-property-groups')
    ).toBeNull()
  })
})
