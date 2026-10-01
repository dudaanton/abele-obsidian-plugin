import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openDocx } from '@/word/package'
import { applyWordEdit } from '@/word/edit'
import { paragraph, sampleDocx, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'

const text = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml'])
const table = () =>
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  [1, 2]
    .map(
      (r) =>
        '<w:tr>' +
        [1, 2]
          .map(
            (c) =>
              `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(`Cell ${r}-${c}`)}</w:tc>`
          )
          .join('') +
        '</w:tr>'
    )
    .join('') +
  '</w:tbl>'
const img = SAMPLE_IMAGE

async function edit(bytes: Uint8Array, operation: Record<string, unknown>) {
  return applyWordEdit(await openDocx(bytes), { paragraph: 1, ...operation } as never)
}
async function unchangedParts(before: Uint8Array, after: Uint8Array, allowed: string[]) {
  const a = unzipSync(before)
  const b = unzipSync(after)
  for (const [name, bytes] of Object.entries(a))
    if (!allowed.includes(name)) expect(b[name], name).toEqual(bytes)
  await openDocx(after)
}

describe('surgical basic Word formatting', () => {
  it.each(['bold', 'italic', 'underline', 'strike'])(
    'formats only a selected text range: %s',
    async (format) => {
      const original = sampleDocx(paragraph('abcde'))
      const after = await edit(original, {
        operation: 'format',
        from: 1,
        to: 4,
        format,
        enabled: true,
      })
      expect((await openDocx(after)).paragraphs[0].text).toBe('abcde')
      const xml = text(after)
      expect(xml).toContain('>a</w:t>')
      expect(xml).toContain('>bcd</w:t>')
      expect(xml).toContain('>e</w:t>')
      expect(xml).toContain(
        `<w:${{ bold: 'b', italic: 'i', underline: 'u', strike: 'strike' }[format]}`
      )
      await unchangedParts(original, after, ['word/document.xml'])
      const off = await edit(after, { operation: 'format', from: 1, to: 4, format, enabled: false })
      expect(text(off)).toContain(format === 'underline' ? 'w:val="none"' : 'w:val="0"')
    }
  )
  it('applies an existing heading without rebuilding styles', async () => {
    const original = sampleDocx(paragraph('Heading sample'))
    const after = await edit(original, { operation: 'style', style_id: 'Heading1' })
    expect((await openDocx(after)).paragraphs[0].style).toBe('Heading1')
    await unchangedParts(original, after, ['word/document.xml'])
    await expect(edit(original, { operation: 'style', style_id: 'UnknownStyle' })).rejects.toThrow(
      /existing/
    )
  })
  it('adds, splits, merges and deletes paragraphs while preserving surrounding XML', async () => {
    const original = sampleDocx(paragraph('one two') + paragraph('tail'))
    let after = await edit(original, { operation: 'paragraph_split', offset: 4 })
    expect((await openDocx(after)).paragraphs.slice(0, 3).map((p) => p.text)).toEqual([
      'one ',
      'two',
      'tail',
    ])
    after = await edit(after, { operation: 'paragraph_merge' })
    expect((await openDocx(after)).paragraphs[0].text).toBe('one two')
    after = await edit(after, { operation: 'paragraph_add', text: 'added' })
    expect((await openDocx(after)).paragraphs.slice(0, 3).map((p) => p.text)).toEqual([
      'one two',
      'added',
      'tail',
    ])
    after = await edit(after, { operation: 'paragraph_delete', paragraph: 2 })
    expect(text(after)).toBe(text(original))
    await unchangedParts(original, after, ['word/document.xml'])
  })
  it('inserts text into an empty paragraph or self-closing text node', async () => {
    for (const body of ['<w:p/>', '<w:p><w:r><w:t/></w:r></w:p>']) {
      const after = await edit(sampleDocx(body), {
        operation: 'insert',
        offset: 0,
        text: 'empty filled',
      })
      expect((await openDocx(after)).paragraphs[0].text).toBe('empty filled')
    }
  })
  it('reuses existing bullet definitions and adds only minimal numbering for new numbered lists', async () => {
    const original = sampleDocx(paragraph('item'))
    const bullet = await edit(original, { operation: 'list', list: 'bullet' })
    expect(text(bullet)).toContain('w:val="7"')
    await unchangedParts(original, bullet, ['word/document.xml'])
    const numbered = await edit(original, { operation: 'list', list: 'decimal' })
    expect(strFromU8(unzipSync(numbered)['word/numbering.xml'])).toContain(
      'w:numFmt w:val="decimal"'
    )
    await unchangedParts(original, numbered, ['word/document.xml', 'word/numbering.xml'])
    const clear = await edit(numbered, { operation: 'list', list: 'none' })
    expect(text(clear)).not.toContain('numPr')
  })
  it('adds, edits and removes links without changing text or other relationships', async () => {
    const original = sampleDocx(paragraph('go sample now'))
    let after = await edit(original, {
      operation: 'link',
      from: 3,
      to: 9,
      url: 'https://example.invalid/sample',
    })
    expect((await openDocx(after)).paragraphs[0].text).toBe('go sample now')
    expect(text(after)).toContain('w:hyperlink')
    expect(strFromU8(unzipSync(after)['word/_rels/document.xml.rels'])).toContain(
      'https://example.invalid/sample'
    )
    after = await edit(after, {
      operation: 'link',
      from: 3,
      to: 9,
      url: 'https://example.invalid/other',
    })
    expect(strFromU8(unzipSync(after)['word/_rels/document.xml.rels'])).toContain(
      'https://example.invalid/other'
    )
    after = await edit(after, { operation: 'link', from: 3, to: 9, url: '' })
    expect(text(after)).not.toContain('w:hyperlink')
    await unchangedParts(original, after, ['word/document.xml', 'word/_rels/document.xml.rels'])
    await expect(
      edit(original, { operation: 'link', from: 3, to: 9, url: 'javascript:throw 1' })
    ).rejects.toThrow(/URL/)
  })
  it('edits existing cells and adds/removes a simple row without changing table properties', async () => {
    const original = sampleDocx(table())
    let after = await edit(original, {
      operation: 'replace',
      paragraph: 1,
      old_text: 'Cell 1-1',
      new_text: 'Updated cell',
    })
    after = await edit(after, { operation: 'row_add', table: 1, row: 1 })
    expect((await openDocx(after)).tables[0].rows).toHaveLength(3)
    after = await edit(after, { operation: 'row_delete', table: 1, row: 2 })
    expect((await openDocx(after)).tables[0].rows).toHaveLength(2)
    expect(text(after)).toContain(
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>'
    )
    await unchangedParts(original, after, ['word/document.xml'])
  })
  it('merges and splits horizontal/vertical cells without losing any text', async () => {
    const original = sampleDocx(table())
    let after = await edit(original, {
      operation: 'cells_merge',
      table: 1,
      row: 1,
      column: 1,
      to_row: 2,
      to_column: 2,
    })
    expect(text(after)).toContain('gridSpan')
    expect(text(after)).toContain('vMerge')
    for (const value of ['Cell 1-1', 'Cell 1-2', 'Cell 2-1', 'Cell 2-2'])
      expect(text(after)).toContain(value)
    after = await edit(after, { operation: 'cells_split', table: 1, row: 1, column: 1 })
    expect(text(after)).not.toContain('gridSpan')
    expect(text(after)).not.toContain('vMerge')
    const doc = await openDocx(after)
    expect(doc.tables[0].rows).toHaveLength(2)
    for (const row of doc.tables[0].rows)
      expect(row.children.filter((c) => c.local === 'tc')).toHaveLength(2)
    await unchangedParts(original, after, ['word/document.xml'])
  })
  it('keeps unsupported structures read-only rather than rebuilding them', async () => {
    const original = sampleDocx()
    for (const operation of ['format', 'paragraph_delete', 'paragraph_split', 'style']) {
      await expect(
        edit(original, {
          operation,
          paragraph: 5,
          from: 0,
          to: 8,
          offset: 3,
          format: 'bold',
          style_id: 'Heading1',
        })
      ).rejects.toThrow(/read-only|unsupported|protected/)
    }
  })
})

describe('inline Word images', () => {
  it('inserts, resizes, replaces and deletes inline images, preserving other media', async () => {
    const original = sampleDocx(paragraph('Picture sample'))
    const resources = {
      loadImage: async () => ({ bytes: img, extension: 'png', mime: 'image/png' }),
    }
    let after = await applyWordEdit(
      await openDocx(original),
      {
        operation: 'image_insert',
        paragraph: 1,
        image_path: 'sample.png',
        width: 120,
        height: 80,
      } as never,
      resources
    )
    expect(text(after)).toContain('wp:inline')
    expect((await openDocx(after)).images).toHaveLength(1)
    await unchangedParts(original, after, [
      'word/document.xml',
      'word/_rels/document.xml.rels',
      '[Content_Types].xml',
    ])
    after = await edit(after, { operation: 'image_resize', image: 1, width: 240, height: 160 })
    expect(text(after)).toContain('cx="2286000"')
    after = await applyWordEdit(
      await openDocx(after),
      {
        operation: 'image_replace',
        paragraph: 1,
        image: 1,
        image_path: 'another-sample.png',
      } as never,
      resources
    )
    const media = Object.keys(unzipSync(after)).filter((n) => n.startsWith('word/media/'))
    expect(media).toHaveLength(3)
    after = await edit(after, { operation: 'image_delete', image: 1 })
    expect(text(after)).not.toContain('wp:inline')
    expect(unzipSync(after)['word/media/sample.png']).toEqual(
      unzipSync(original)['word/media/sample.png']
    )
  })
  it('refuses anchored/floating images without altering their bytes', async () => {
    const original = sampleDocx(paragraph('picture'))
    const inline = await applyWordEdit(
      await openDocx(original),
      {
        operation: 'image_insert',
        paragraph: 1,
        image_path: 'sample.png',
        width: 120,
        height: 80,
      } as never,
      { loadImage: async () => ({ bytes: img, extension: 'png', mime: 'image/png' }) }
    )
    const parts = unzipSync(inline)
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replaceAll('wp:inline', 'wp:anchor')
    )
    const anchored = await openDocx(zipSync(parts))
    await expect(
      applyWordEdit(anchored, {
        operation: 'image_resize',
        paragraph: 1,
        image: 1,
        width: 10,
        height: 10,
      } as never)
    ).rejects.toThrow(/floating|read-only/)
  })
})
