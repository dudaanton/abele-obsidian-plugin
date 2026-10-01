import { expect, it, vi } from 'vitest'
import { mountWordEditor } from '@/word/desktopEditor'
import { openDocx } from '@/word/package'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

it('desktop fields expose range formatting, structure, tables and images through the same operations', async () => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const row = document.createElement('div')
  document.body.appendChild(row)
  const apply = vi.fn(async () => {})
  mountWordEditor(row, doc, doc.paragraphs[0], { app: app as never, apply, cancel: () => {} })
  const input = row.querySelector('textarea')!
  input.setSelectionRange(0, 6)
  Array.from(row.querySelectorAll('button'))
    .find((b) => b.textContent === 'Italic')!
    .click()
  expect(apply).toHaveBeenCalledWith({
    operation: 'format',
    paragraph: 1,
    from: 0,
    to: 6,
    format: 'italic',
    enabled: true,
  })
  for (const label of [
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
    expect(
      Array.from(row.querySelectorAll('button')).some((b) => b.textContent === label),
      label
    ).toBe(true)
  row.remove()
  const tableRow = document.createElement('div')
  mountWordEditor(tableRow, doc, doc.paragraphs.find((p) => p.table === 1)!, {
    app: app as never,
    apply,
    cancel: () => {},
  })
  for (const label of ['Add row below', 'Delete row', 'Merge cells', 'Split cells'])
    expect(
      Array.from(tableRow.querySelectorAll('button')).some((b) => b.textContent === label),
      label
    ).toBe(true)
})
it('does not silently discard unsaved text when formatting is requested', async () => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const row = document.createElement('div')
  const apply = vi.fn(async () => {})
  mountWordEditor(row, doc, doc.paragraphs[0], { app: app as never, apply, cancel: () => {} })
  row.querySelector('textarea')!.value = 'unsaved text'
  Array.from(row.querySelectorAll('button'))
    .find((b) => b.textContent === 'Bold')!
    .click()
  expect(apply).not.toHaveBeenCalled()
  expect(row.querySelector('[role="status"]')!.textContent).toContain('Save text changes')
})
