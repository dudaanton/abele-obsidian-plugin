import { expect, it, vi } from 'vitest'
import { openXlsx } from '@/spreadsheet/package'
import { flushPromises } from '@vue/test-utils'
import { XlsxView } from '@/spreadsheet/XlsxView'
import { useVault } from '../helpers/testEnv'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
it('does not replace the grid for a delayed modify event with identical workbook bytes', async () => {
  const app = useVault([])
  const data = sampleXlsx()
  const file = await app.vault.createBinary('sample.xlsx', data.buffer as ArrayBuffer)
  const reload = vi.fn()
  const view = {
    app,
    file,
    workbook: await openXlsx(data),
    token: 1,
    saving: false,
    editing: false,
    loadedPath: file.path,
    onLoadFile: reload,
  }
  await XlsxView.prototype.onWorkbookModified.call(view as never, file)
  expect(reload).not.toHaveBeenCalled()
})
it('keeps the selected sheet and cell after the workbook is reloaded following an edit', async () => {
  const app = useVault([])
  const data = sampleXlsx()
  const file = await app.vault.createBinary('sample.xlsx', data.buffer as ArrayBuffer)
  const contentEl = document.createElement('div')
  const view = {
    app,
    file,
    contentEl,
    token: 0,
    workbook: null,
    vue: null,
    sheetName: 'Other',
    cell: 'A1',
    saving: false,
    onLoadFile: XlsxView.prototype.onLoadFile,
  }
  await view.onLoadFile(file)
  await flushPromises()
  expect(contentEl.querySelector('select')?.value).toBe('Other')
  expect(contentEl.querySelector('.abele-workbook-formula')?.textContent).toContain('Sample!C1*2')
  await XlsxView.prototype.onUnloadFile.call(view as never)
})
