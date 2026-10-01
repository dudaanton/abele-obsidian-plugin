import { describe, expect, it } from 'vitest'
import { openDocx } from '@/word/package'
import { applyWordEdit } from '@/word/edit'
import { paragraphTextEdit } from '@/word/textEditor'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

const body =
  '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>one</w:t></w:r><w:r><w:t xml:space="preserve"> one</w:t></w:r><w:hyperlink w:anchor="sample"><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> tail</w:t></w:r></w:hyperlink></w:p>'

describe('precise desktop Word text edits', () => {
  it('changes a repeated word without moving untouched text or formatting into another run', async () => {
    const original = await openDocx(sampleDocx(body))
    const edit = paragraphTextEdit(original.paragraphs[0], 'one two tail')
    const after = await openDocx(await applyWordEdit(original, edit))
    expect(after.xml.get('word/document.xml')).toBe(
      original.xml.get('word/document.xml')!.replace('> one</w:t>', '> two</w:t>')
    )
    expect(after.paragraphs[0].runs.map((run) => run.text)).toEqual(['one', ' two', ' tail'])
    expect(after.links[0]).toMatchObject({ from: 7, to: 12, url: '#sample' })
  })
  it('also targets a repeated substring inside a hyperlink without changing the preceding run', async () => {
    const original = await openDocx(
      sampleDocx(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>one </w:t></w:r><w:hyperlink w:anchor="sample"><w:r><w:t>one</w:t></w:r></w:hyperlink></w:p>'
      )
    )
    const after = await openDocx(
      await applyWordEdit(original, paragraphTextEdit(original.paragraphs[0], 'one two'))
    )
    expect(after.paragraphs[0].runs.map((run) => run.text)).toEqual(['one ', 'two'])
    expect(after.links[0]).toMatchObject({ from: 4, to: 7 })
  })
})
