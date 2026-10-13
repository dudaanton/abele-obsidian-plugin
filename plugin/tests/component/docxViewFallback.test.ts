import { expect, it } from 'vitest'
import { DocxView } from '@/word/DocxView'
import { useVault } from '../helpers/testEnv'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

it('leaves every paragraph readable and an explanation when the page fails', async () => {
  const app = useVault([])
  const bytes = sampleDocx()
  const file = await app.vault.createBinary('sample.docx', bytes.buffer as ArrayBuffer)
  const contentEl = document.createElement('div')
  const view = {
    app,
    contentEl,
    token: 0,
    paragraph: 1,
    editing: false,
    document: null,
    unmountPage: () => {},
    showDocument: async () => {
      contentEl.empty()
      throw new Error('sample renderer failure')
    },
  }
  await DocxView.prototype.onLoadFile.call(view as never, file)
  expect(contentEl.textContent).toContain('sample renderer failure')
  expect(contentEl.textContent).toContain('Sample report')
})
