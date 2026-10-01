import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Notice } from 'obsidian'
import TemplateVariablesModal from '@/components/TemplateVariablesModal.vue'
import { parseTemplateVariables } from '@/templates/TemplateParser'
import { pickImageFile } from '@/helpers/suggesters/ImagePicker'
import { importClipboardImage, importExternalFile } from '@/ai/attachments'
import { templateHarness } from '../helpers/templateHarness'

vi.mock('@/helpers/suggesters/ImagePicker', () => ({ pickImageFile: vi.fn() }))
vi.mock('@/ai/attachments', () => ({ importClipboardImage: vi.fn(), importExternalFile: vi.fn() }))
const wrappers: VueWrapper[] = []
const shell = defineComponent({ template: '<div><slot /><slot name="footer" /></div>' })
function draw(text: string, initialValues?: Map<string, string>) {
  const wrapper = mount(TemplateVariablesModal, {
    props: { variables: parseTemplateVariables(text).userVariables, initialValues },
    global: { stubs: { Modal: shell } },
  })
  wrappers.push(wrapper)
  return wrapper
}
const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text)!
const values = (w: VueWrapper) => w.emitted('confirm')!.at(-1)![0] as Map<string, string>
beforeEach(() => {
  vi.clearAllMocks()
  Notice.shown.length = 0
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})

describe('template variable input', () => {
  it('applies defaults before external values, initializes lists, and retains empty overrides', async () => {
    templateHarness()
    const w = draw(
      '{{text::default(seed)}} {{choice::select(red,blue)::default(blue)}} {{items::list}} {{links::wiki_list}} {{plugin;method;Input}}',
      new Map([['text', '']])
    )
    await flushPromises()
    expect(w.get('select').element.value).toBe('blue')
    expect(w.get('input[placeholder="Enter text"]').element.value).toBe('')
    expect(w.find('input[placeholder="Enter value for Input"]').exists()).toBe(true)
    await button(w, 'Apply').trigger('click')
    expect(Object.fromEntries(values(w))).toEqual({
      text: '',
      choice: 'blue',
      items: '[]',
      links: '[]',
    })
    await button(w, 'Cancel').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('edits scalar, select, wikilink and line-list values without trimming retained lines', async () => {
    templateHarness()
    const w = draw(
      '{{text}} {{choice::select(red,blue)}} {{note::wikilink}} {{items::list::default(one,two)}}'
    )
    await flushPromises()
    expect(w.get('textarea').element.value).toBe('one\ntwo')
    await w.get('input[placeholder="Enter text"]').setValue('sample')
    await w.get('select').setValue('red')
    await w.get('input[type="search"]').setValue('Notes/sample.md')
    await w.get('textarea').setValue(' first \n\n  \nsecond')
    await button(w, 'Apply').trigger('click')
    expect(Object.fromEntries(values(w))).toEqual({
      text: 'sample',
      choice: 'red',
      note: 'Notes/sample.md',
      items: '[" first ","second"]',
    })
  })

  it('adds, edits and removes wiki-list rows, retaining an unfilled row as an empty item', async () => {
    templateHarness()
    const w = draw('{{links::wiki_list::default(Notes/one.md)}}')
    await flushPromises()
    expect(w.findAll('input[type="search"]')).toHaveLength(1)
    await w.get('.variable-wiki-list__add').trigger('click')
    await w.findAll('input[type="search"]')[0].setValue('Notes/two.md')
    await button(w, 'Apply').trigger('click')
    expect(values(w).get('links')).toBe('["Notes/two.md",""]')
    await w.findAll('.variable-wiki-list__remove')[0].trigger('click')
    await button(w, 'Apply').trigger('click')
    expect(values(w).get('links')).toBe('[""]')
  })

  it('renders malformed list defaults as empty controls rather than crashing', async () => {
    templateHarness()
    const w = draw(
      '{{list::list}} {{links::wiki_list}}',
      new Map([
        ['list', 'bad-json'],
        ['links', 'bad-json'],
      ])
    )
    await flushPromises()
    expect(w.get('textarea').element.value).toBe('')
    expect(w.findAll('.variable-wiki-list__row')).toHaveLength(0)
    await w.get('.variable-wiki-list__add').trigger('click')
    await button(w, 'Apply').trigger('click')
    expect(values(w).get('links')).toBe('[""]')
  })

  it('resolves a default image, changes it through the vault picker, and clears it', async () => {
    const env = templateHarness([{ path: 'Media/one.png' }, { path: 'Media/two.png' }])
    const w = draw('{{image::image::default(Media/one.png)}}')
    await flushPromises()
    expect(w.get('.variable-image__path').text()).toBe('one.png')
    expect(w.get('img').attributes('src')).toBe('app://sample/Media/one.png?0-0')
    vi.mocked(pickImageFile).mockResolvedValue(env.app.vault.getFileByPath('Media/two.png'))
    await button(w, 'Vault').trigger('click')
    await flushPromises()
    expect(w.get('.variable-image__path').text()).toBe('two.png')
    vi.mocked(pickImageFile).mockResolvedValue(null)
    await button(w, 'Vault').trigger('click')
    await flushPromises()
    expect(w.get('.variable-image__path').text()).toBe('two.png')
    await w.get('.variable-image__clear').trigger('click')
    await button(w, 'Apply').trigger('click')
    expect(values(w).has('image')).toBe(false)
    expect(w.find('img').exists()).toBe(false)
  })

  it('handles clipboard success, no image, and denied access', async () => {
    templateHarness([{ path: 'Media/clipboard.png' }])
    const w = draw('{{image::image}}')
    vi.mocked(importClipboardImage).mockResolvedValue('Media/clipboard.png')
    await button(w, 'Clipboard').trigger('click')
    await flushPromises()
    expect(w.get('.variable-image__path').text()).toBe('clipboard.png')
    vi.mocked(importClipboardImage).mockResolvedValue(null)
    await button(w, 'Clipboard').trigger('click')
    await flushPromises()
    vi.mocked(importClipboardImage).mockRejectedValue(new Error('denied'))
    await button(w, 'Clipboard').trigger('click')
    await flushPromises()
    expect(Notice.shown).toEqual(['No images found in clipboard', 'Could not read clipboard'])
    await button(w, 'Apply').trigger('click')
    expect(values(w).get('image')).toBe('Media/clipboard.png')
  })

  it('imports a picked disk image and leaves cancellation alone', async () => {
    const env = templateHarness([{ path: 'Media/imported.png' }])
    const w = draw('{{image::image}}')
    const clicked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await button(w, 'Disk').trigger('click')
    const input = clicked.mock.contexts[0] as HTMLInputElement
    expect(input!.accept).toBe('image/*')
    input!.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(importExternalFile).not.toHaveBeenCalled()
    const external = new File(['sample'], 'sample.png', { type: 'image/png' })
    Object.defineProperty(input!, 'files', { value: [external] })
    vi.mocked(importExternalFile).mockResolvedValue(
      env.app.vault.getFileByPath('Media/imported.png')!
    )
    input!.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(importExternalFile).toHaveBeenCalledWith(external)
    expect(w.get('.variable-image__path').text()).toBe('imported.png')
  })
})
