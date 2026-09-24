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
import { emptyBookModel, tocEntries, type BookModel } from '@/reader/model'
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
    await view.find('.abele-book-contents__head .abele-obsidian-icon').trigger('click')
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
    expect(selects).toHaveLength(6)
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
    expect(pdf).toEqual(['Page size', 'Two pages side by side', 'Dark pages in a dark theme'])
    const all = names(mount(ReaderSettingsForm, { props: { kind: 'all' } }))
    expect(all).toContain('Open PDF files in the Abele reader')
    expect(all).toContain('Font')
    expect(names(mount(ReaderSettingsForm, { props: { kind: 'epub' } }))).not.toContain('Page size')
  })

  it('save the page size and the switches', async () => {
    const form = mount(ReaderSettingsForm, { props: { kind: 'all' } })
    const config = AbeleConfig.getInstance()
    const pdfSelect = form.findAll('select').at(-1)!
    await pdfSelect.setValue('fit-width')
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
