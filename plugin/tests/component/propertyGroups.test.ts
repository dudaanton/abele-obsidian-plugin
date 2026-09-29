/**
 * A groups property drawn by the plugin: Obsidian's own list editor, untouched — its pills, its
 * `[[` link suggester, anything typed into it — with one button beside it that offers the notes
 * the vault already uses as groups, most members first. A group picked there is added at the end,
 * the others kept as written; an empty or missing value takes one too.
 *
 * The registry is a stand-in shaped like Obsidian's, as in `propertyKinds.test.ts`: the stock
 * list draws a marker and remembers the value it was given, as the real one does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { type App, type TFile } from 'obsidian'
import { PropertyWidgets, type TypeWidget } from '@/properties/widgets'
import { GroupPicker } from '@/properties/groupsWidget'
import type { GroupNote } from '@/properties/groups'
import { useVault } from '../helpers/testEnv'

const stock = (type: string): TypeWidget => ({
  type,
  name: () => type,
  icon: 'lucide-text',
  validate: () => true,
  render(el, value) {
    const marker = el.createDiv({ cls: `stock-${type}`, text: JSON.stringify(value ?? null) })
    return {
      containerEl: el,
      type,
      setValue: (v: unknown) => marker.setText(JSON.stringify(v ?? null)),
    }
  },
})

let table: Record<string, TypeWidget>
let app: App
let widgets: PropertyWidgets
let host: HTMLElement

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

const button = (el: HTMLElement) => el.querySelector<HTMLElement>('.abele-property-groups__pick')

/** Presses the button and hands back the picker it opened. */
const press = (el: HTMLElement): GroupPicker => {
  button(el)!.click()
  const picker = GroupPicker.last
  expect(picker).not.toBeNull()
  return picker!
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
  const extra = fake as unknown as Record<string, unknown>
  extra.metadataTypeManager = { registeredTypeWidgets: table }
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
  GroupPicker.last?.close()
})

describe('a groups property', () => {
  it('is Obsidian’s own list editor with the button beside it, whatever it holds', () => {
    for (const value of [['[[Garden]]', '[[Nowhere]]', 'free text'], '[[Garden]]', null, '']) {
      const el = draw('multitext', value, ctx('groups'))
      expect(el.querySelector('.stock-multitext')).not.toBeNull()
      expect(button(el)).not.toBeNull()
    }
  })

  it('draws an empty or missing value held as text with the list editor too', () => {
    const el = draw('text', null, ctx('groups'))
    expect(el.querySelector('.stock-multitext')).not.toBeNull()
    expect(el.querySelector('.stock-text')).toBeNull()
    expect(button(el)).not.toBeNull()
  })

  it('offers the vault’s groups, most members first, less those held and the note itself', () => {
    const el = draw('multitext', ['[[Garden]]'], ctx('groups'))
    const picker = press(el)
    expect((picker.getSuggestions('') as GroupNote[]).map((g) => g.title)).toEqual([
      'Kitchen',
      'Reading list',
    ])
    expect((picker.getSuggestions('ga') as GroupNote[]).map((g) => g.title)).toEqual(['Garage'])
  })

  it('adds a picked group at the end, as a wikilink, keeping the rest as written', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['[[Nowhere|Somewhere]]', 'free text'], ctx('groups', changes))
    const note = app.vault.getAbstractFileByPath('Inbox/Sample note.md') as TFile
    app.metadataCache.getFileCache(note)!.frontmatter!.groups = [
      '[[Nowhere|Somewhere]]',
      'free text',
    ]
    press(el).selectSuggestion(
      { path: 'Projects/Kitchen.md', title: 'Kitchen', members: 2 },
      new MouseEvent('click')
    )
    expect(changes).toEqual([['[[Nowhere|Somewhere]]', 'free text', '[[Kitchen]]']])
    expect(el.querySelector('.stock-multitext')?.textContent).toBe(
      JSON.stringify(['[[Nowhere|Somewhere]]', 'free text', '[[Kitchen]]'])
    )
  })

  it('adds to what the note holds now, after an edit made in the list itself', () => {
    const changes: unknown[] = []
    const el = draw('multitext', ['[[Garden]]'], ctx('groups', changes))
    // Typed into Obsidian's own editor since the row was drawn: the note has it already.
    const note = app.vault.getAbstractFileByPath('Inbox/Sample note.md') as TFile
    app.metadataCache.getFileCache(note)!.frontmatter!.groups = ['[[Garden]]', '[[New idea]]']
    press(el).selectSuggestion(
      { path: 'Projects/Kitchen.md', title: 'Kitchen', members: 2 },
      new MouseEvent('click')
    )
    expect(changes).toEqual([['[[Garden]]', '[[New idea]]', '[[Kitchen]]']])
  })

  it('adds to an empty or missing value', () => {
    for (const empty of [null, undefined, '', []]) {
      const changes: unknown[] = []
      const el = draw('text', empty, ctx('groups', changes, 'Inbox/Two.md'))
      const note = app.vault.getAbstractFileByPath('Inbox/Two.md') as TFile
      app.metadataCache.getFileCache(note)!.frontmatter!.groups = empty
      press(el).selectSuggestion(
        { path: 'Projects/Garden.md', title: 'Garden', members: 2 },
        new MouseEvent('click')
      )
      expect(changes).toEqual([['[[Garden]]']])
    }
  })

  it('leaves a name not listed, and a value it cannot read, to Obsidian alone', () => {
    const plain = draw('multitext', ['[[A]]'], ctx('related'))
    expect(plain.querySelector('.stock-multitext')).not.toBeNull()
    expect(button(plain)).toBeNull()
    const odd = draw('multitext', [{ a: 1 }], ctx('groups'))
    expect(button(odd)).toBeNull()
  })
})
