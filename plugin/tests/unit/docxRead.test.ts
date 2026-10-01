import { describe, expect, it } from 'vitest'
import { openDocx } from '@/word/package'
import { safeRenderBytes } from '@/word/renderSafety'
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate'
import { paragraph, sampleDocx, sampleParts, W } from '../fixtures/docx/sampleDocx'

describe('Word reading', () => {
  it('indexes split runs, lists, tables and supplementary text without deleted revisions', async () => {
    const doc = await openDocx(sampleDocx())
    expect(doc.paragraphs[0]).toMatchObject({
      text: 'Sample report',
      style: 'Heading1',
      part: 'word/document.xml',
    })
    expect(doc.paragraphs.find((p) => p.text === 'Cell sample')?.table).toBeDefined()
    expect(doc.paragraphs.map((p) => p.text)).toContain('Inserted words')
    expect(doc.paragraphs.map((p) => p.text).join('\n')).not.toContain('Deleted words')
    for (const text of ['Sample header', 'Sample footer', 'Sample comment', 'Sample footnote'])
      expect(doc.paragraphs.map((p) => p.text)).toContain(text)
    expect(doc.search('sample report', 0, 10).finds[0]).toMatchObject({ paragraph: 1, offset: 0 })
    expect(doc.read(1, 2, 1000)).toContain('Sample report')
  })
  it('resolves namespace aliases rather than assuming the w prefix', async () => {
    const parts = sampleParts(paragraph('Alias sample'))
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replaceAll('w:', 'z:').replace('xmlns:w=', 'xmlns:z=')
    )
    expect((await openDocx(zipSync(parts))).paragraphs[0].text).toBe('Alias sample')
  })
  it('rejects XML entities, malformed packages and oversized XML before rendering', async () => {
    await expect(openDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    const parts = sampleParts()
    parts['word/document.xml'] = strToU8(
      `<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///sample">]><w:document xmlns:w="${W}">&bad;</w:document>`
    )
    await expect(openDocx(zipSync(parts))).rejects.toThrow(/DOCTYPE|entities/)
    parts['word/document.xml'] = new Uint8Array(8 * 1024 * 1024 + 1)
    await expect(openDocx(zipSync(parts))).rejects.toThrow(/large/)
  })
  it('removes external resources and active chunks from renderer input without changing original bytes', async () => {
    const parts = sampleParts()
    parts['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" TargetMode="External" Target="https://example.invalid/pixel" Type="image"/></Relationships>'
    )
    parts['word/evil.html'] = strToU8('<script>throw 1</script>')
    const original = zipSync(parts)
    const doc = await openDocx(original)
    const rendered = unzipSync(await safeRenderBytes(doc))
    expect(strFromU8(rendered['word/_rels/document.xml.rels'])).not.toContain('example.invalid')
    expect(rendered['word/evil.html']).toBeUndefined()
    expect(doc.original).toEqual(original)
  })
  it('bounds reads/search and selects paged fallback for large documents', async () => {
    const doc = await openDocx(
      sampleDocx(Array.from({ length: 1500 }, (_, i) => paragraph(`Large paragraph ${i}`)).join(''))
    )
    expect(doc.richPreview).toBe(false)
    expect(doc.read(1, 1500, 200)).toHaveLength(200)
    const result = doc.search('large', 20, 5)
    expect(result.total).toBe(1500)
    expect(result.finds).toHaveLength(5)
    expect(result.finds[0].paragraph).toBe(21)
  })
})
