import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WordParagraphEditor from '@/word/WordParagraphEditor.vue'
import { mountWordEditor, type DesktopEditHost } from '@/word/desktopEditor'
import { openDocx } from '@/word/package'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

afterEach(() => document.body.replaceChildren())

async function editor(number: number, host: Partial<DesktopEditHost> = {}) {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const apply = vi.fn(async () => {})
  const cancel = vi.fn()
  const wrapper = mount(WordParagraphEditor, {
    props: {
      doc,
      paragraph: doc.paragraphs[number - 1],
      host: { app: app as never, apply, cancel, ...host },
    },
    attachTo: document.body,
  })
  const button = (text: string) => {
    const found = wrapper.findAll('button').find((b) => b.text() === text)
    if (!found) throw Error(`No button ${text}`)
    return found
  }
  return { doc, wrapper, apply, cancel, button }
}

const labels = (root: { findAll(selector: string): { attributes(name: string): unknown }[] }) =>
  root
    .findAll('input[aria-label],select[aria-label],textarea[aria-label]')
    .map((el) => el.attributes('aria-label'))

it('lays out the paragraph controls in their order, with their labels', async () => {
  const { wrapper } = await editor(1)
  expect(wrapper.classes()).toContain('abele-word-editor')
  expect(wrapper.findAll('button').map((b) => b.text())).toEqual([
    'Save',
    'Cancel',
    'Bold',
    'Italic',
    'Underline',
    'Strikethrough',
    'Apply style',
    'Apply list',
    'Add paragraph below',
    'Split at cursor',
    'Merge with next',
    'Delete paragraph',
    'Apply link',
    'Remove link',
    'Insert image',
    'Replace image',
    'Resize image',
    'Delete image',
  ])
  expect(labels(wrapper)).toEqual([
    'Edit paragraph 1',
    'Paragraph style',
    'List kind',
    'New paragraph text',
    'Link URL',
    'Image',
    'Vault image path',
    'Width (px)',
    'Height (px)',
  ])
  expect(wrapper.findAll('.abele-word-editor-label').map((l) => l.text())).toEqual([
    'Formatting',
    'Paragraphs',
    'Links',
    'Inline images',
  ])
  expect(wrapper.find('button.mod-cta').text()).toBe('Save')
  expect(wrapper.find('[aria-label="New paragraph text"]').attributes('placeholder')).toBe(
    'New paragraph text'
  )
  expect(wrapper.find('[aria-label="Link URL"]').attributes('placeholder')).toBe('Link address')
  const style = wrapper.find<HTMLSelectElement>('select[aria-label="Paragraph style"]')
  expect(style.element.value).toBe('Heading1')
  expect(style.findAll('option').map((o) => o.text())).toEqual(['heading 1', 'Normal'])
  expect(
    wrapper.findAll('select[aria-label="List kind"] option').map((o) => o.attributes('value'))
  ).toEqual(['none', 'bullet', 'decimal'])
  expect(wrapper.find('textarea').element).toBe(document.activeElement)
  wrapper.unmount()
})

it('saves the typed text and applies structure through the same operations', async () => {
  const { wrapper, apply, button } = await editor(1)
  await wrapper.find('textarea').setValue('Sample title')
  await button('Save').trigger('click')
  expect(apply).toHaveBeenLastCalledWith({
    operation: 'replace',
    paragraph: 1,
    old_text: 'report',
    offset: 7,
    new_text: 'title',
  })
  // A successful edit leaves the form waiting for the host to redraw it.
  await vi.waitFor(() => expect(button('Cancel').attributes('disabled')).toBeDefined())
  wrapper.unmount()

  const second = await editor(1)
  await second.wrapper.find('[aria-label="New paragraph text"]').setValue('Added words')
  await second.button('Add paragraph below').trigger('click')
  expect(second.apply).toHaveBeenLastCalledWith({
    operation: 'paragraph_add',
    paragraph: 1,
    text: 'Added words',
  })
  second.wrapper.unmount()

  const third = await editor(1)
  await third.wrapper.find('select[aria-label="List kind"]').setValue('decimal')
  await third.button('Apply list').trigger('click')
  expect(third.apply).toHaveBeenLastCalledWith({ operation: 'list', paragraph: 1, list: 'decimal' })
  third.wrapper.unmount()

  const fourth = await editor(1)
  await fourth.wrapper.find('[aria-label="Link URL"]').setValue('https://example.com')
  fourth.wrapper.find('textarea').element.setSelectionRange(0, 6)
  await fourth.button('Apply link').trigger('click')
  expect(fourth.apply).toHaveBeenLastCalledWith({
    operation: 'link',
    paragraph: 1,
    from: 0,
    to: 6,
    url: 'https://example.com',
  })
  fourth.wrapper.unmount()
})

it('says why an edit failed and lets it be tried again', async () => {
  const { wrapper, apply, button } = await editor(1)
  apply.mockRejectedValueOnce(new Error('Sample failure'))
  await button('Delete paragraph').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('[role="status"]').text()).toBe('Sample failure'))
  expect(button('Delete paragraph').attributes('disabled')).toBeUndefined()
  await button('Delete paragraph').trigger('click')
  expect(apply).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it('asks for the text to be saved before formatting it', async () => {
  const { wrapper, apply, button } = await editor(1)
  await wrapper.find('textarea').setValue('Unsaved words')
  await button('Underline').trigger('click')
  expect(apply).not.toHaveBeenCalled()
  expect(wrapper.find('[role="status"]').text()).toBe(
    'Save text changes before formatting or changing structure.'
  )
  wrapper.unmount()
})

it('cancels through the host', async () => {
  const { wrapper, cancel, button } = await editor(1)
  await button('Cancel').trigger('click')
  expect(cancel).toHaveBeenCalledOnce()
  wrapper.unmount()
})

it('fills a chosen picture size and sends it with the picture operations', async () => {
  const { wrapper, apply, button } = await editor(7)
  expect(wrapper.text()).toContain('This paragraph contains read-only structure.')
  expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  expect(button('Save').attributes('disabled')).toBeDefined()
  const width = wrapper.find<HTMLInputElement>('[aria-label="Width (px)"]')
  const height = wrapper.find<HTMLInputElement>('[aria-label="Height (px)"]')
  expect([width.element.value, height.element.value]).toEqual(['120', '80'])
  expect(width.attributes('min')).toBe('1')
  await wrapper.find('select[aria-label="Image"]').setValue('1')
  expect([width.element.value, height.element.value]).toEqual(['100', '100'])
  await wrapper.find('[aria-label="Vault image path"]').setValue('sample-image.png')
  await button('Resize image').trigger('click')
  expect(apply).toHaveBeenLastCalledWith({
    operation: 'image_resize',
    paragraph: 7,
    image: 1,
    image_path: 'sample-image.png',
    width: 100,
    height: 100,
  })
  wrapper.unmount()
})

it('offers the table operations on an editable cell', async () => {
  const { wrapper, apply, button } = await editor(3)
  expect(wrapper.findAll('.abele-word-editor-label').map((l) => l.text())).toContain('Table 1')
  for (const label of ['Row', 'Grid column', 'Last row', 'Last column'])
    expect(wrapper.find<HTMLInputElement>(`[aria-label="${label}"]`).element.value).toBe('1')
  await wrapper.find('[aria-label="Last column"]').setValue('2')
  await button('Merge cells').trigger('click')
  expect(apply).toHaveBeenLastCalledWith({
    operation: 'cells_merge',
    paragraph: 3,
    table: 1,
    row: 1,
    column: 1,
    to_row: 1,
    to_column: 2,
  })
  wrapper.unmount()
})

it('leaves only Cancel working when the document is read only', async () => {
  const { wrapper, apply, button } = await editor(1, { readOnly: true })
  for (const control of wrapper.findAll('input,select,textarea,button'))
    expect(control.attributes('disabled'), control.text()).toBe(
      control.text() === 'Cancel' ? undefined : ''
    )
  await button('Cancel').trigger('click')
  expect(apply).not.toHaveBeenCalled()
  expect(wrapper.find('textarea').element).not.toBe(document.activeElement)
  wrapper.unmount()
})

it('mounts beside what the row holds, selects the given range and takes itself out again', async () => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const row = document.body.createDiv()
  const kept = row.createSpan({ text: 'Kept' })
  const dispose = mountWordEditor(row, doc, doc.paragraphs[0], {
    app: app as never,
    apply: async () => {},
    cancel: () => {},
    range: { from: 2, to: 5 },
  })
  const field = row.querySelector('textarea')!
  expect(row.contains(kept)).toBe(true)
  expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5])
  expect(row.querySelector('.abele-word-editor')).not.toBeNull()
  dispose()
  expect(row.querySelector('.abele-word-editor')).toBeNull()
  expect(Array.from(row.children)).toEqual([kept])
  dispose()
})
