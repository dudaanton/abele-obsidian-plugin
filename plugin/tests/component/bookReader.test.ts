/**
 * What a book tab shows around the page (`BookReader.vue`) and its text and layout settings
 * (`ReaderSettingsForm.vue`). happy-dom lays nothing out: the drawer over a phone's page is the
 * e2e tier's (`tests/e2e/bookPhone.e2e.test.ts`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import BookReader from '@/components/reader/BookReader.vue'
import ReaderSettingsForm from '@/components/reader/ReaderSettingsForm.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { emptyBookModel, emptySearch, tocEntries, type BookModel } from '@/reader/model'
import { useVault } from '../helpers/testEnv'

const readyModel = (over: Partial<BookModel> = {}): BookModel =>
  reactive({
    ...emptyBookModel(),
    status: 'ready',
    title: 'Rich',
    chapter: 'Chapter 2',
    fraction: 0.425,
    toc: tocEntries([
      { label: 'Chapter 1', href: 'c1', subitems: [{ label: 'Part two', href: 'c1#s2' }] },
      { label: 'Chapter 2', href: 'c2' },
    ]),
    currentHref: 'c1#s2',
    ...over,
  }) as BookModel

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('the line under the page', () => {
  it('names the chapter and says how far into the book', () => {
    const view = mount(BookReader, { props: { model: readyModel() } })
    expect(view.find('.abele-book-reader__chapter').text()).toBe('Chapter 2')
    expect(view.find('.abele-book-reader__percent').text()).toBe('42%')
    expect((view.find('input.slider').element as HTMLInputElement).value).toBe('425')
  })

  it('goes to where the slider is let go, and shows the place while it is dragged', async () => {
    const view = mount(BookReader, { props: { model: readyModel() } })
    const slider = view.find('input.slider')
    ;(slider.element as HTMLInputElement).value = '800'
    await slider.trigger('input')
    expect(view.find('.abele-book-reader__percent').text()).toBe('80%')
    await slider.trigger('change')
    expect(view.emitted('seek')).toEqual([[0.8]])
  })

  it('shows the page of the chapter, and a tap goes round pages left, the place in the book and percent, kept', async () => {
    const config = AbeleConfig.getInstance()
    const progress = { page: 3, pages: 12, location: 120, locations: 830 }
    const view = mount(BookReader, { props: { model: readyModel({ progress }) } })
    const measure = () => view.find('.abele-book-reader__measure')
    expect(measure().text()).toBe('Page 3 of 12')
    await measure().trigger('click')
    expect(measure().text()).toBe('9 pages left in chapter')
    expect(config.reader?.progressShow).toBe('left')
    expect(config.saveSettings).toHaveBeenCalled()
    await measure().trigger('click')
    expect(measure().text()).toBe('Loc 120 of 830')
    await measure().trigger('click')
    expect(measure().text()).toBe('42%')
    await measure().trigger('click')
    expect(measure().text()).toBe('Page 3 of 12')
    // Held, the slider shows where it would go, as a percentage.
    const slider = view.find('input.slider')
    ;(slider.element as HTMLInputElement).value = '800'
    await slider.trigger('input')
    expect(measure().text()).toBe('80%')
  })

  it('opens a book with the way the measure was last shown', () => {
    AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS, progressShow: 'location' }
    const progress = { page: 3, pages: 12, location: 120, locations: 830 }
    const view = mount(BookReader, { props: { model: readyModel({ progress }) } })
    expect(view.find('.abele-book-reader__measure').text()).toBe('Loc 120 of 830')
  })

  it('offers the way back only after a link was followed', async () => {
    const model = readyModel()
    const view = mount(BookReader, { props: { model } })
    expect(view.find('.abele-book-reader__footer .abele-obsidian-icon').exists()).toBe(false)
    model.canGoBack = true
    await flushPromises()
    await view.find('.abele-book-reader__footer .abele-obsidian-icon').trigger('click')
    expect(view.emitted('back')).toHaveLength(1)
  })

  it('shows the message instead while the book opens or fails', () => {
    const view = mount(BookReader, {
      props: { model: readyModel({ status: 'error', message: 'This book could not be opened.' }) },
    })
    expect(view.find('.abele-book-reader__message').text()).toBe('This book could not be opened.')
    expect(view.find('.abele-book-reader__footer').exists()).toBe(false)
  })

  it('hands its stage to the tab once it is there', () => {
    const view = mount(BookReader, { props: { model: readyModel() } })
    const [[el]] = view.emitted('stage') as [[HTMLElement]]
    expect(el.classList.contains('abele-book-reader__stage')).toBe(true)
  })
})

describe('the contents panel', () => {
  it('opens the way to the chapter on screen and marks it', async () => {
    const view = mount(BookReader, { props: { model: readyModel({ panel: true }) } })
    await flushPromises()
    const rows = view.findAll('.abele-book-contents .tree-item-self')
    expect(rows.map((r) => r.text())).toEqual(['Chapter 1', 'Part two', 'Chapter 2'])
    expect(view.find('.tree-item-self.is-active').text()).toBe('Part two')
  })

  it('goes to a chapter picked in it, and closes from its own button', async () => {
    const view = mount(BookReader, { props: { model: readyModel({ panel: true }) } })
    await flushPromises()
    const chapter2 = view.findAll('.tree-item-self').find((r) => r.text() === 'Chapter 2')!
    await chapter2.trigger('click')
    expect(view.emitted('go')?.[0]?.[0]).toBe('c2')
    await view.find('.abele-book-reader__panel-head > .abele-obsidian-icon').trigger('click')
    expect(view.emitted('panel')).toEqual([[false]])
  })

  it('says so when the book has no contents', async () => {
    const view = mount(BookReader, { props: { model: readyModel({ panel: true, toc: [] }) } })
    await flushPromises()
    expect(view.find('.abele-book-contents').text()).toContain('no table of contents')
  })
})

describe('the text and layout settings', () => {
  it('save each choice at once, within range', async () => {
    const form = mount(ReaderSettingsForm, { props: { kind: 'epub' } })
    const selects = form.findAll('select')
    // Six for the text, two for reading aloud.
    expect(selects).toHaveLength(8)
    await selects[2].setValue('150')
    const config = AbeleConfig.getInstance()
    expect(config.reader.fontSize).toBe(150)
    expect(config.saveSettings).toHaveBeenCalled()
    await selects[0].setValue('scrolled')
    expect(config.reader.flow).toBe('scrolled')
  })

  it('switch theme colours and two columns', async () => {
    const form = mount(ReaderSettingsForm, { props: { kind: 'epub' } })
    const toggles = form.findAll('.checkbox-container')
    await toggles[0].trigger('click')
    await toggles[1].trigger('click')
    expect(AbeleConfig.getInstance().reader.columns).toBe(1)
    expect(AbeleConfig.getInstance().reader.themeColors).toBe(false)
  })
})

describe('the PDF settings', () => {
  const names = (form: ReturnType<typeof mount>) =>
    form.findAll('.setting-item-name').map((n) => n.text())

  it("show only a PDF's own in a PDF's tab, and the switch to open PDFs here in Settings", () => {
    const pdf = names(mount(ReaderSettingsForm, { props: { kind: 'pdf' } }))
    expect(pdf).toEqual(['Layout', 'Page size', 'Dark pages in a dark theme', 'Voice', 'Speed'])
    // Two pages side by side is a choice of the page-at-a-time layout only.
    AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS, pdfLayout: 'paginated' }
    expect(names(mount(ReaderSettingsForm, { props: { kind: 'pdf' } }))).toEqual([
      'Layout',
      'Page size',
      'Two pages side by side',
      'Dark pages in a dark theme',
      'Voice',
      'Speed',
    ])
    const all = names(mount(ReaderSettingsForm, { props: { kind: 'all' } }))
    expect(all).toContain('Open PDF files in the Abele reader')
    expect(all).toContain('Font')
    expect(names(mount(ReaderSettingsForm, { props: { kind: 'epub' } }))).not.toContain('Page size')
  })

  it('save the page size and the switches', async () => {
    AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS, pdfLayout: 'paginated' }
    const form = mount(ReaderSettingsForm, { props: { kind: 'all' } })
    const config = AbeleConfig.getInstance()
    const rowOf = (name: string) =>
      form.findAll('.setting-item').find((r) => r.find('.setting-item-name').text() === name)!
    await rowOf('Page size').find('select').setValue('fit-width')
    expect(config.reader.pdfZoom).toBe('fit-width')
    const rows = form.findAll('.setting-item')
    const toggle = (name: string) =>
      rows.find((r) => r.find('.setting-item-name').text() === name)!.find('.checkbox-container')
    await toggle('Open PDF files in the Abele reader').trigger('click')
    await toggle('Two pages side by side').trigger('click')
    await toggle('Dark pages in a dark theme').trigger('click')
    expect(config.reader).toMatchObject({ openPdf: true, pdfTwoPages: true, pdfDarkPages: false })
  })
})

describe('the panel', () => {
  it('switches between the contents, the search and the highlights', async () => {
    const model = readyModel({ panel: true })
    const view = mount(BookReader, { props: { model } })
    await flushPromises()
    const tabs = view.findAll('.abele-book-reader__panel-head .abele-tabs__tab')
    expect(tabs.map((t) => t.text())).toEqual(['Contents', 'Search', 'Highlights'])
    await tabs[1].trigger('click')
    expect(view.emitted('panel-tab')).toEqual([['search']])
  })
})

describe('the search', () => {
  const searching = (over: Partial<BookModel['search']>) =>
    readyModel({ panel: true, panelTab: 'search', search: { ...emptySearch(), ...over } })

  it('says how far it has got and lists what it found under each chapter', async () => {
    const view = mount(BookReader, {
      props: {
        model: searching({
          query: 'fox',
          running: true,
          progress: 0.5,
          count: 2,
          groups: [
            {
              label: 'Chapter 1',
              hits: [
                { cfi: 'a', excerpt: { pre: 'the quick brown ', match: 'fox', post: ' jumps' } },
                { cfi: 'b', excerpt: { pre: 'a ', match: 'Fox', post: '' } },
              ],
            },
          ],
        }),
      },
    })
    await flushPromises()
    expect(view.find('.abele-book-search__status').text()).toBe('2 results so far · 50%')
    expect(view.find('.abele-book-search__label').text()).toBe('Chapter 1')
    const hits = view.findAll('.abele-book-search__hit')
    expect(hits[0].find('mark').text()).toBe('fox')
    await hits[1].trigger('click')
    expect(view.emitted('search-hit')?.[0]?.[0]).toMatchObject({ cfi: 'b' })
  })

  it('says when nothing was found, and asks for two letters first', async () => {
    const done = mount(BookReader, { props: { model: searching({ query: 'zzz' }) } })
    await flushPromises()
    expect(done.find('.abele-book-search__status').text()).toBe('Nothing found.')
    const short = mount(BookReader, { props: { model: searching({ query: 'z' }) } })
    await flushPromises()
    expect(short.find('.abele-book-search__status').text()).toBe('Type at least two letters.')
  })

  it('searches a moment after typing stops', async () => {
    vi.useFakeTimers()
    try {
      const view = mount(BookReader, { props: { model: searching({}) } })
      await flushPromises()
      const input = view.find('.abele-book-search__field input')
      await input.setValue('fo')
      await input.setValue('fox')
      expect(view.emitted('search')).toBeUndefined()
      vi.advanceTimersByTime(450)
      expect(view.emitted('search')).toEqual([['fox']])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('highlights', () => {
  const h = {
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    color: 'green' as const,
    text: 'Fear is the mind-killer.',
    comment: 'A good line',
    label: 'Chapter 3',
  }

  it('are listed with their colour, words, comment and chapter, and go to their place', async () => {
    const view = mount(BookReader, {
      props: { model: readyModel({ panel: true, panelTab: 'highlights', highlights: [h] }) },
    })
    await flushPromises()
    const item = view.find('.abele-book-highlights__item')
    expect(item.classes()).toContain('abele-book-highlights__item_green')
    expect(item.text()).toContain('Fear is the mind-killer.')
    expect(item.text()).toContain('A good line')
    await item.trigger('click')
    expect(view.emitted('go-highlight')?.[0]?.[0]).toEqual(h)
  })

  it('say how to make one when there are none', async () => {
    const view = mount(BookReader, {
      props: { model: readyModel({ panel: true, panelTab: 'highlights' }) },
    })
    await flushPromises()
    expect(view.text()).toContain('No highlights yet')
  })

  it('are made from a selection by a colour, and the selection offers a link and a quote', async () => {
    const selection = { cfi: 'c', text: 'Words', label: 'Chapter 1' }
    const view = mount(BookReader, { props: { model: readyModel({ selection }) } })
    const bar = view.find('.abele-book-selection')
    const icons = bar.findAll('.abele-obsidian-icon')
    await icons[2].trigger('click') // the third colour, blue
    expect(view.emitted('highlight')).toEqual([['blue']])
    const action = (label: string) =>
      bar
        .findAll('.abele-book-selection__actions .abele-obsidian-icon')
        .find((el) => el.attributes('aria-label') === label)!
    await action('Copy a link to this place').trigger('click')
    expect(view.emitted('copy-link')).toEqual([[selection]])
    await action('Quote these words with a link into the note you were last in').trigger('click')
    expect(view.emitted('quote')).toEqual([[{ cfi: 'c', label: 'Chapter 1', text: 'Words' }]])
    await action('Read aloud from here').trigger('click')
    expect(view.emitted('read-aloud')).toHaveLength(1)
  })

  it('once tapped, can be recoloured, commented, removed and closed', async () => {
    const view = mount(BookReader, { props: { model: readyModel({ active: h }) } })
    const bar = view.find('.abele-book-selection')
    await bar.findAll('.abele-book-selection__colors .abele-obsidian-icon')[0].trigger('click')
    expect(view.emitted('recolor')).toEqual([[h, 'yellow']])
    const actions = bar.findAll('.abele-book-selection__actions .abele-obsidian-icon')
    expect(actions).toHaveLength(6)
    await actions[0].trigger('click')
    expect(view.emitted('edit-comment')).toEqual([[h]])
    await actions[4].trigger('click')
    expect(view.emitted('delete-highlight')).toEqual([[h]])
    await actions[5].trigger('click')
    expect(view.emitted('close-active')).toHaveLength(1)
  })
})

describe('reading aloud', () => {
  it('shows its bar while reading, and each control says what it does', async () => {
    const model = readyModel()
    const view = mount(BookReader, { props: { model } })
    expect(view.find('.abele-book-speech').exists()).toBe(false)
    model.speech = 'playing'
    await flushPromises()
    const icons = view.findAll('.abele-book-speech .abele-obsidian-icon')
    expect(icons.map((i) => i.attributes('aria-label'))).toEqual([
      'Read the last sentence again',
      'Pause',
      'Skip to the next sentence',
      'Voice and speed',
      'Stop reading aloud',
    ])
    for (const icon of icons) await icon.trigger('click')
    expect(view.emitted('speech')).toEqual([['prev'], ['toggle'], ['next'], ['settings'], ['stop']])
    model.speech = 'paused'
    await flushPromises()
    expect(view.find('.abele-book-speech__label').text()).toBe('Paused')
  })

  it('saves the voice and the speed', async () => {
    const form = mount(ReaderSettingsForm, { props: { kind: 'epub' } })
    const row = (name: string) =>
      form.findAll('.setting-item').find((r) => r.find('.setting-item-name').text() === name)!
    await row('Speed').find('select').setValue('1.5')
    expect(AbeleConfig.getInstance().reader.ttsRate).toBe(1.5)
  })
})
