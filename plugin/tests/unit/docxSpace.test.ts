import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { applyWordEdit } from '@/word/edit'
import { openDocx } from '@/word/package'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

describe('Word whitespace attributes', () => {
  it.each(['xml:space="default"', 'xml:space = "default"', "xml:space\n= 'default'"])(
    'fills a self-closing text node without duplicating %s',
    async (attribute) => {
      const doc = await openDocx(sampleDocx(`<w:p><w:r><w:t ${attribute}/></w:r></w:p>`))
      const bytes = await applyWordEdit(doc, {
        operation: 'insert',
        paragraph: 1,
        offset: 0,
        text: ' X',
      })
      const xml = strFromU8(unzipSync(bytes)['word/document.xml'])
      expect(xml.match(/xml:space\s*=/g)).toHaveLength(1)
      expect((await openDocx(bytes)).paragraphs[0].text).toBe(' X')
      expect((await openDocx(bytes)).paragraphs[0].runs[0].node.attrs['xml:space']).toBe('preserve')
    }
  )
  it('updates a spaced attribute on a nonempty text node', async () => {
    const doc = await openDocx(
      sampleDocx('<w:p><w:r><w:t xml:space = "default">sample</w:t></w:r></w:p>')
    )
    const after = await openDocx(
      await applyWordEdit(doc, { operation: 'insert', paragraph: 1, offset: 0, text: ' ' })
    )
    expect(after.paragraphs[0].text).toBe(' sample')
    expect(after.paragraphs[0].runs[0].node.attrs['xml:space']).toBe('preserve')
  })
  it('updates a spaced attribute while formatting split text runs', async () => {
    const doc = await openDocx(
      sampleDocx('<w:p><w:r><w:t xml:space = "default">a b</w:t></w:r></w:p>')
    )
    const after = await openDocx(
      await applyWordEdit(doc, {
        operation: 'format',
        paragraph: 1,
        from: 0,
        to: 1,
        format: 'italic',
        enabled: true,
      })
    )
    expect(after.paragraphs[0].text).toBe('a b')
    expect(after.paragraphs[0].runs[1].node.attrs['xml:space']).toBe('preserve')
  })
})
