import { describe, expect, it } from 'vitest'
import { applyWordEdit } from '@/word/edit'
import { openDocx } from '@/word/package'
import { descendants, W } from '@/word/xml'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

describe('Word namespaces across container edits', () => {
  it('merges text whose namespace prefix is declared only on the second paragraph', async () => {
    const doc = await openDocx(
      sampleDocx(
        `<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p xmlns:z="${W}"><z:r><z:rPr><z:i/></z:rPr><z:t>B</z:t></z:r></w:p>`
      )
    )
    const after = await openDocx(
      await applyWordEdit(doc, { operation: 'paragraph_merge', paragraph: 1 })
    )
    expect(after.paragraphs[0].text).toBe('AB')
    expect(after.paragraphs[0].runs[1].node.ns).toBe(W)
    expect(after.paragraphs[0].runs[1].run!.namespaces.z).toBe(W)
  })
  it('retains conflicting aliases instead of rebinding moved attributes to the first paragraph', async () => {
    const doc = await openDocx(
      sampleDocx(
        '<w:p xmlns:z="urn:sample:first"><w:r z:marker="sample"><w:t>A</w:t></w:r></w:p><w:p xmlns:z="urn:sample:second"><w:r z:marker="sample"><w:t>B</w:t></w:r></w:p>'
      )
    )
    const after = await openDocx(
      await applyWordEdit(doc, { operation: 'paragraph_merge', paragraph: 1 })
    )
    expect(after.paragraphs[0].runs).toHaveLength(2)
    expect(after.paragraphs[0].runs.map((run) => run.run!.namespaces.z)).toEqual([
      'urn:sample:first',
      'urn:sample:second',
    ])
  })
  it('keeps a default namespace when moving unprefixed text elements', async () => {
    const doc = await openDocx(
      sampleDocx(`<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p xmlns="${W}"><r><t>B</t></r></w:p>`)
    )
    const after = await openDocx(
      await applyWordEdit(doc, { operation: 'paragraph_merge', paragraph: 1 })
    )
    expect(after.paragraphs[0].text).toBe('AB')
    expect(after.paragraphs[0].runs[1].node.ns).toBe(W)
  })
  it.each(['', 'https://example.invalid/changed'])(
    'keeps locally declared namespaces while removing/editing a link: %s',
    async (url) => {
      const doc = await openDocx(
        sampleDocx(
          `<w:p><w:hyperlink xmlns:z="${W}" w:anchor="sample"><z:r><z:t>sample</z:t></z:r></w:hyperlink></w:p>`
        )
      )
      const after = await openDocx(
        await applyWordEdit(doc, { operation: 'link', paragraph: 1, from: 0, to: 6, url })
      )
      expect(after.paragraphs[0].text).toBe('sample')
      expect(after.paragraphs[0].runs[0].node.ns).toBe(W)
    }
  )
  it('preserves an empty default namespace on opaque run properties', async () => {
    const doc = await openDocx(
      sampleDocx(
        `<w:p xmlns="${W}"><w:r><w:t>A</w:t></w:r></w:p><w:p xmlns=""><w:r><w:rPr><sample-opaque/></w:rPr><w:t>B</w:t></w:r></w:p>`
      )
    )
    const after = await openDocx(
      await applyWordEdit(doc, { operation: 'paragraph_merge', paragraph: 1 })
    )
    expect(descendants(after.paragraphs[0].node, '', 'sample-opaque')).toHaveLength(1)
  })
})
