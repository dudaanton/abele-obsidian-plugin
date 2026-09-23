/**
 * Backlinks as cards.
 *
 * They were bare links with two dates under them, and a list of names says little about what
 * each note is. A card carries the note's own `description` and a thumbnail of its `cover`
 * when it has them, and stays a single line of title and dates when it has neither — the list
 * is scanned, so a note with nothing to add must not take more room than it did.
 *
 * Everything on the card comes from the metadata cache: a footer can gather thousands of
 * backlinks, and reading their files to decorate them is the cost the paging exists to avoid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Note } from '@/entities/Note'
import NotesList from '@/components/NotesList.vue'
import Card from '@/components/obsidian/Card.vue'
import { coverLink } from '@/helpers/resourceUrl'
import { compactDate } from '@/helpers/datesHelper'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

let wrapper: VueWrapper | null = null
const loaded: Note[] = []

function vault(specs: FakeFileSpec[]) {
  const app = useVault(specs)
  ;(app.vault as unknown as { getResourcePath: (f: { path: string }) => string }).getResourcePath =
    (f) => `app://vault/${f.path}`
  return app
}

async function load(path: string): Promise<Note> {
  const note = new Note(path)
  await note.load()
  loaded.push(note)
  return note
}

describe('coverLink', () => {
  it('reads a cover however it was written', () => {
    expect(coverLink('[[poster.jpg]]')).toBe('poster.jpg')
    expect(coverLink('![[poster.jpg|300]]')).toBe('poster.jpg')
    expect(coverLink(' Media/poster.jpg ')).toBe('Media/poster.jpg')
    expect(coverLink('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(coverLink(['[[first.png]]', 'second.png'])).toBe('first.png')
  })

  it('finds nothing where nothing is named', () => {
    expect(coverLink(undefined)).toBeNull()
    expect(coverLink('')).toBeNull()
    expect(coverLink(42)).toBeNull()
    expect(coverLink([])).toBeNull()
  })
})

describe('compactDate', () => {
  const now = dayjs('2026-09-23')

  it('leaves out this year, keeps any other', () => {
    expect(compactDate(dayjs('2026-03-05'), now)).toBe('05.03')
    expect(compactDate(dayjs('2025-12-31'), now)).toBe('31.12.2025')
  })
})

describe('Note — what a backlink card needs, from the metadata cache', () => {
  beforeEach(() => configureAbele())
  afterEach(() => loaded.splice(0).forEach((n) => n.cleanup()))

  it('carries the description and the cover as the frontmatter names them', async () => {
    vault([
      {
        path: 'Notes/Film.md',
        frontmatter: { description: 'A quiet film about a holiday.', cover: '[[poster.jpg]]' },
        content: 'Body',
      },
      { path: 'Notes/Plain.md', frontmatter: { type: 'note' }, content: 'Body' },
    ])

    const film = await load('Notes/Film.md')
    const plain = await load('Notes/Plain.md')

    expect(film.description).toBe('A quiet film about a holiday.')
    expect(film.cover).toBe('poster.jpg')
    expect(plain.description).toBeNull()
    expect(plain.cover).toBeNull()
  })
})

describe('NotesList — a backlink is a card', () => {
  beforeEach(() => {
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    configureAbele()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function note(
    path: string,
    fields: Partial<Pick<Note, 'description' | 'cover' | 'createdAt' | 'updatedAt'>> = {}
  ): Note {
    return Object.assign(new Note(path), fields)
  }

  function render(notes: Note[]): VueWrapper {
    wrapper = mount(NotesList, { props: { notes } }) as VueWrapper
    return wrapper
  }

  it('shows the title, the description and the cover on the right', () => {
    vault([{ path: 'Attachments/poster.jpg', content: '' }])
    const view = render([
      note('Notes/Film.md', {
        description: 'A quiet film about a holiday.',
        cover: 'poster.jpg',
        createdAt: dayjs('2026-01-01'),
      }),
    ])

    const card = view.find('.abele-notes-list__item')
    expect(card.classes()).toContain('abele-card')
    expect(card.find('.abele-card__name').text()).toBe('Film')
    const description = card.find('.abele-card__description')
    expect(description.text()).toBe('A quiet film about a holiday.')
    // A long description must not turn one backlink into a page.
    expect(description.classes()).toContain('abele-card__description_clamped')

    const thumb = card.find('img.abele-card__thumbnail')
    expect(thumb.attributes('src')).toBe('app://vault/Attachments/poster.jpg')
    // Pictures further down the list are not fetched until they are scrolled to.
    expect(thumb.attributes('loading')).toBe('lazy')
    expect(card.classes()).toContain('abele-card_thumbed')
  })

  it('stays a title and dates when the note has nothing more to say', () => {
    vault([])
    const view = render([note('Notes/Plain.md', { createdAt: dayjs('2026-01-01') })])

    const card = view.find('.abele-notes-list__item')
    expect(card.find('.abele-card__description').exists()).toBe(false)
    expect(card.find('.abele-card__thumbnail').exists()).toBe(false)
    expect(card.classes()).not.toContain('abele-card_thumbed')
  })

  it('draws no picture for a cover that names nothing in the vault', () => {
    vault([])
    const view = render([note('Notes/Film.md', { cover: 'gone.jpg' })])

    expect(view.find('.abele-card__thumbnail').exists()).toBe(false)
  })

  it('takes a cover from the web as it is', () => {
    vault([])
    const view = render([note('Notes/Film.md', { cover: 'https://example.com/p.jpg' })])

    expect(view.find('img.abele-card__thumbnail').attributes('src')).toBe(
      'https://example.com/p.jpg'
    )
  })

  it('says the dates briefly, and the update only when it is another day', () => {
    vault([])
    const created = dayjs().startOf('year').add(10, 'day')
    const view = render([
      note('Notes/Edited.md', { createdAt: created, updatedAt: created.add(5, 'day') }),
      note('Notes/Same day.md', {
        createdAt: created.subtract(1, 'day'),
        updatedAt: created.subtract(1, 'day').add(3, 'hour'),
      }),
    ])

    const metas = view.findAllComponents(Card).map((c) => c.props('meta'))
    expect(metas[0]).toEqual([
      compactDate(created),
      `updated ${compactDate(created.add(5, 'day'))}`,
    ])
    expect(metas[1]).toEqual([compactDate(created.subtract(1, 'day'))])
  })

  it('opens the note when the card is pressed', async () => {
    const app = vault([{ path: 'Notes/Film.md', content: '' }])
    const opened: string[] = []
    ;(app as unknown as { workspace: unknown }).workspace = {
      getActiveViewOfType: () => ({
        leaf: { openFile: (f: { path: string }) => opened.push(f.path) },
      }),
    }
    const view = render([note('Notes/Film.md')])

    await view.find('.abele-notes-list__item').trigger('click')

    expect(opened).toEqual(['Notes/Film.md'])
  })
})
