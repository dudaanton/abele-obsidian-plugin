import { afterEach, expect, it, vi } from 'vitest'
import { shallowReactive } from 'vue'
import { DocxView } from '@/word/DocxView'
import { useVault } from '../helpers/testEnv'
import { paragraph, sampleDocx } from '../fixtures/docx/sampleDocx'
import type { WordEdit } from '@/word/edit'

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

it('opens retained controls in the shared modal with the selected link range', async () => {
  const { view } = await opened()
  await (
    view as unknown as {
      advanced(paragraph: number, range: { from: number; to: number }): Promise<void>
    }
  ).advanced(1, { from: 0, to: 6 })
  await vi.waitFor(() =>
    expect(document.querySelector('.abele-word-editor textarea')).not.toBeNull()
  )
  const field = document.querySelector<HTMLTextAreaElement>('.abele-word-editor textarea')!
  expect(field.selectionStart).toBe(0)
  expect(field.selectionEnd).toBe(6)
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.abele-word-editor button')
  )
  expect(buttons.some((button) => button.textContent === 'Apply link')).toBe(true)
  buttons.find((button) => button.textContent === 'Cancel')!.click()
  expect(document.querySelector('.abele-word-editor')).toBeNull()
})
