import { afterEach, expect, it, vi } from 'vitest'
import { shallowReactive } from 'vue'
import { DocxView } from '@/word/DocxView'
import { useVault } from '../helpers/testEnv'
import { paragraph, sampleBody, sampleDocx, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'
import { WordPicturePicker } from '@/word/WordPicturePicker'
import type { WordEdit } from '@/word/edit'
import { Modal, Platform } from 'obsidian'

const views: DocxView[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await view.onUnloadFile()
  vi.restoreAllMocks()
})

async function opened(body = paragraph('Sample original')) {
  const app = useVault([])
  const file = await app.vault.createBinary(
    'sample-page.docx',
    sampleDocx(body).buffer as ArrayBuffer
  )
  const state = shallowReactive({ model: { blocks: [], styles: [] }, save: { state: 'idle' } })
  const view = Object.assign(Object.create(DocxView.prototype) as DocxView, {
    app,
    file,
    contentEl: document.createElement('div'),
    token: 0,
    paragraph: 1,
    editing: false,
    saving: false,
    externalChange: false,
    document: null,
    vue: null,
    state,
    pending: Promise.resolve(),
    abort: new AbortController(),
  })
  views.push(view)
  await view.onLoadFile(file)
  const edit = (edit: WordEdit) =>
    (view as unknown as { enqueue(edit: WordEdit): Promise<void> }).enqueue(edit)
  return { app, file, view, state, edit }
}

it('mounts the accepted page and serializes typing then formatting through the real save path', async () => {
  const { app, file, view, edit } = await opened()
  expect(view.contentEl.querySelector('.abele-word-page')).not.toBeNull()
  expect(view.contentEl.querySelector('iframe')).toBeNull()
  const text = edit({
    operation: 'replace',
    paragraph: 1,
    old_text: 'original',
    new_text: 'edited',
  })
  const format = edit({
    operation: 'format',
    paragraph: 1,
    from: 0,
    to: 6,
    format: 'italic',
    enabled: true,
  })
  await Promise.all([text, format])
  expect(view.document?.paragraphs[0].text).toBe('Sample edited')
  expect(view.document?.xml.get('word/document.xml')).toContain('<w:i')
  expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(view.document?.original)
})

it('rejects an external revision instead of overwriting it and leaves an error on the page', async () => {
  const { app, file, view, state, edit } = await opened()
  const changed = sampleDocx(paragraph('Sample competing change'))
  await app.vault.modifyBinary(file, changed.buffer as ArrayBuffer)
  await expect(edit({ operation: 'insert', paragraph: 1, text: ' draft' })).rejects.toThrow(
    /changed/
  )
  expect(state.save.state).toBe('failed')
  expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(changed)
  expect(view.document?.paragraphs[0].text).toBe('Sample original')
})

it('rejects queued work after the document is closed', async () => {
  const { app, file, view, edit } = await opened()
  const write = vi.spyOn(app.vault, 'modifyBinary')
  const pending = edit({ operation: 'insert', paragraph: 1, text: ' draft' })
  await view.onUnloadFile()
  await expect(pending).rejects.toThrow(/no longer open/)
  expect(write).not.toHaveBeenCalled()
  expect(file.path).toBe('sample-page.docx')
})

type Dialogs = {
  advanced(paragraph: number, picture?: boolean): Promise<void>
  askLink(edit: Omit<WordEdit, 'url'>): Promise<void>
  pickImage(paragraph: number): void
}
const dialogs = (view: DocxView) => view as unknown as Dialogs
const modal = () => document.querySelector<HTMLElement>('.modal')
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`.modal [aria-label="${label}"]`)
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

it('asks for a link on the words chosen on the page and links exactly those', async () => {
  const { view } = await opened()
  await dialogs(view).askLink({ operation: 'link', paragraph: 1, from: 0, to: 6 })
  await vi.waitFor(() => expect(modal()?.textContent).toContain('On «Sample»'))
  const field = document.querySelector<HTMLInputElement>('.modal input[aria-label="Link address"]')!
  field.value = 'https://example.com/sample'
  field.dispatchEvent(new Event('input'))
  await flush()
  button('Link the words to this address')!.click()
  await vi.waitFor(() =>
    expect(view.document?.xml.get('word/document.xml')).toContain('<w:hyperlink')
  )
  expect(modal()).toBeNull()
  const xml = view.document!.xml.get('word/document.xml')!
  const linked = xml.slice(xml.indexOf('<w:hyperlink'), xml.indexOf('</w:hyperlink>'))
  expect(linked).toContain('Sample')
  expect(linked).not.toContain('original')
})

it('closes the link window on Cancel without writing', async () => {
  const { app, view } = await opened()
  const write = vi.spyOn(app.vault, 'modifyBinary')
  await dialogs(view).askLink({ operation: 'link', paragraph: 1, from: 0, to: 6 })
  await vi.waitFor(() => expect(button('Close without linking')).not.toBeNull())
  button('Close without linking')!.click()
  await flush()
  expect(modal()).toBeNull()
  expect(write).not.toHaveBeenCalled()
})

it('opens what the ribbon has no room for as rows, and joins a paragraph with the next', async () => {
  const { view } = await opened(paragraph('Sample first') + paragraph('Sample second'))
  const title = vi.spyOn(Modal.prototype, 'setTitle')
  await dialogs(view).advanced(1)
  await vi.waitFor(() => expect(modal()?.textContent).toContain('Join with the next paragraph'))
  expect(title).toHaveBeenLastCalledWith('Paragraph 1')
  expect(document.querySelector('.abele-word-editor')).toBeNull()
  button('Join the next paragraph onto this one')!.click()
  const body = () => view.document?.paragraphs.filter((p) => p.part === 'word/document.xml')
  await vi.waitFor(() => expect(body()).toHaveLength(1))
  expect(body()?.[0].text).toBe('Sample firstSample second')
  expect(modal()).toBeNull()
})

it('resizes a chosen picture in proportion and keeps its window open', async () => {
  const { view } = await opened(sampleBody)
  const title = vi.spyOn(Modal.prototype, 'setTitle')
  const number = view.document!.images[0].paragraph
  await dialogs(view).advanced(number, true)
  await vi.waitFor(() => expect(title).toHaveBeenLastCalledWith('Picture'))
  const width = document.querySelector<HTMLInputElement>(
    '.modal input[aria-label="Width in pixels"]'
  )!
  const height = document.querySelector<HTMLInputElement>(
    '.modal input[aria-label="Height in pixels"]'
  )!
  expect([width.value, height.value]).toEqual(['100', '100'])
  width.value = '50'
  width.dispatchEvent(new Event('input'))
  await flush()
  expect(height.value).toBe('50')
  width.dispatchEvent(new Event('change'))
  width.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await vi.waitFor(() =>
    expect(view.document?.xml.get('word/document.xml')).toContain('cx="476250" cy="476250"')
  )
  expect(modal()).not.toBeNull()
})

it('puts a picture from the vault in at its own size, offering only what Word can hold', async () => {
  const { app, view } = await opened()
  await app.vault.createBinary('Attachments/sample-image.png', SAMPLE_IMAGE.buffer as ArrayBuffer)
  await app.vault.create('Attachments/sample-drawing.svg', '<svg/>')
  await app.vault.create('Notes/sample-note.md', 'Sample')
  const open = vi.spyOn(WordPicturePicker.prototype, 'open').mockImplementation(() => {})
  dialogs(view).pickImage(1)
  const picker = open.mock.contexts[0] as WordPicturePicker | undefined
  expect(picker).toBeDefined()
  expect(picker!.getSuggestions('').map((f) => f.path)).toEqual(['Attachments/sample-image.png'])
  picker!.selectSuggestion({ path: 'Attachments/sample-image.png' }, new KeyboardEvent('keydown'))
  await vi.waitFor(() => expect(view.document?.images).toHaveLength(1))
  // The invented picture is 16 pixels square: 16 × 9525 EMU.
  expect(view.document?.xml.get('word/document.xml')).toContain('cx="152400" cy="152400"')
})

it('opens the same rows read only on a phone without enabling document writes', async () => {
  const prior = Platform.isMobile
  Platform.isMobile = true
  try {
    const { app, view } = await opened(paragraph('Sample first') + paragraph('Sample second'))
    const write = vi.spyOn(app.vault, 'modifyBinary')
    await dialogs(view).advanced(1)
    await vi.waitFor(() => expect(modal()?.textContent).toContain('Read only'))
    expect(document.querySelector('.abele-word-editor')).toBeNull()
    expect(
      document.querySelectorAll(
        '.modal input,.modal select,.modal textarea,.modal button:not(.modal-close-button)'
      )
    ).toHaveLength(0)
    await view.onUnloadFile()
    expect(modal()).toBeNull()
    expect(write).not.toHaveBeenCalled()
  } finally {
    Platform.isMobile = prior
  }
})
