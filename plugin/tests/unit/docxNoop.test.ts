import { describe, expect, it } from 'vitest'
import { openDocx } from '@/word/package'
import { applyWordEdit } from '@/word/edit'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

describe('Word no-op run replacements', () => {
  it('retains the exact archive and run formatting when identical text spans runs', async () => {
    const doc = await openDocx(sampleDocx())
    const after = await applyWordEdit(doc, {
      operation: 'replace',
      paragraph: 1,
      old_text: 'Sample report',
      new_text: 'Sample report',
    })
    expect(after === doc.original).toBe(true)
    expect((await openDocx(after)).paragraphs[0].runs.map((run) => run.text)).toEqual([
      'Sample ',
      'report',
    ])
  })
  it('retains hyperlink contents on a no-op spanning a link boundary', async () => {
    const doc = await openDocx(
      sampleDocx(
        '<w:p><w:r><w:t>sample </w:t></w:r><w:hyperlink w:anchor="sample"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>'
      )
    )
    const after = await applyWordEdit(doc, {
      operation: 'replace',
      paragraph: 1,
      old_text: 'sample link',
      new_text: 'sample link',
    })
    expect(after === doc.original).toBe(true)
  })
})
