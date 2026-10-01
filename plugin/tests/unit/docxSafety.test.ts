import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { applyWordEdit } from '@/word/edit'
import { openDocx } from '@/word/package'
import { paragraph, sampleDocx, sampleParts, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'
import { parseXml } from '@/word/xml'

const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml'])
describe('Word XML safety boundaries', () => {
  it('keeps the UTF-8 BOM and lexical XML bytes outside edited text', async () => {
    const parts = sampleParts(paragraph('before'))
    const original = parts['word/document.xml']
    parts['word/document.xml'] = new Uint8Array([239, 187, 191, ...original])
    const doc = await openDocx(zipSync(parts))
    const after = unzipSync(
      await applyWordEdit(doc, {
        operation: 'replace',
        paragraph: 1,
        old_text: 'before',
        new_text: 'after',
      })
    )['word/document.xml']
    expect(Array.from(after.slice(0, 3))).toEqual([239, 187, 191])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(after)).toBe(
      new TextDecoder('utf-8', { ignoreBOM: true })
        .decode(parts['word/document.xml'])
        .replace('before', 'after')
    )
  })
  it('carries local namespace declarations when copying paragraph properties', async () => {
    const body =
      '<w:p xmlns:z="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><z:pPr><z:pStyle z:val="Heading1"/></z:pPr><w:r><w:t>sample</w:t></w:r></w:p>'
    const after = await applyWordEdit(await openDocx(sampleDocx(body)), {
      operation: 'paragraph_add',
      paragraph: 1,
      text: 'added',
    })
    expect((await openDocx(after)).paragraphs[1].style).toBe('Heading1')
  })

  it('does not duplicate paragraph identity attributes on a split', async () => {
    const parts = sampleParts(
      '<w:p xmlns:sample="http://schemas.microsoft.com/office/word/2010/wordml" sample:paraId="12345678" sample:textId="87654321"><w:r><w:t>sample text</w:t></w:r></w:p>'
    )
    const after = await applyWordEdit(await openDocx(zipSync(parts)), {
      operation: 'paragraph_split',
      paragraph: 1,
      offset: 7,
    })
    expect(xml(after).match(/sample:paraId="12345678"/g)).toHaveLength(1)
    expect(xml(after).match(/sample:textId="87654321"/g)).toHaveLength(1)
  })
  it('formats documents using namespace aliases without serializing other XML', async () => {
    const parts = sampleParts(paragraph('sample text'))
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replaceAll('w:', 'q:').replace('xmlns:w=', 'xmlns:q=')
    )
    const after = await applyWordEdit(await openDocx(zipSync(parts)), {
      operation: 'format',
      paragraph: 1,
      from: 0,
      to: 6,
      format: 'italic',
      enabled: true,
    })
    expect((await openDocx(after)).paragraphs[0].text).toBe('sample text')
    expect(xml(after)).toContain('<q:sectPr>')
    expect(xml(after)).toContain('w:i')
  })
  it('adds numbering and the required relationships/content types to a package without numbering', async () => {
    const parts = sampleParts(paragraph('sample item'))
    delete parts['word/numbering.xml']
    parts['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(parts['word/_rels/document.xml.rels']).replace(
        /<Relationship[^>]+Type="[^"]+\/numbering"[^>]*\/>/,
        ''
      )
    )
    const after = await applyWordEdit(await openDocx(zipSync(parts)), {
      operation: 'list',
      paragraph: 1,
      list: 'decimal',
    })
    const out = unzipSync(after)
    expect(out['word/numbering.xml']).toBeDefined()
    expect(strFromU8(out['word/_rels/document.xml.rels'])).toContain('abeleRel')
    await parseXml(strFromU8(out['word/numbering.xml']))
  })
  it('can fill a self-closing numbering root and style an empty paragraph', async () => {
    const parts = sampleParts('<w:p/>')
    parts['word/numbering.xml'] = strToU8(
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    )
    const doc = await openDocx(zipSync(parts))
    const list = await applyWordEdit(doc, { operation: 'list', paragraph: 1, list: 'decimal' })
    await parseXml(strFromU8(unzipSync(list)['word/numbering.xml']))
    expect((await openDocx(list)).paragraphs[0].node.children).toHaveLength(1)
    const styled = await applyWordEdit(doc, {
      operation: 'style',
      paragraph: 1,
      style_id: 'Heading1',
    })
    expect((await openDocx(styled)).paragraphs[0].style).toBe('Heading1')
  })
  it('preserves proofing markers exactly once when splitting at a paragraph end', async () => {
    const original = sampleDocx(
      '<w:p><w:r><w:t>sample</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p>'
    )
    const after = await applyWordEdit(await openDocx(original), {
      operation: 'paragraph_split',
      paragraph: 1,
      offset: 6,
    })
    expect(xml(after).match(/proofErr/g)).toHaveLength(1)
  })
  it('reads CDATA and XML comments as text but keeps non-plain run markup read-only', async () => {
    const doc = await openDocx(
      sampleDocx('<w:p><w:r><w:t>Sample <![CDATA[& literal]]><!--opaque--> text</w:t></w:r></w:p>')
    )
    expect(doc.paragraphs[0].text).toBe('Sample & literal text')
    await expect(
      applyWordEdit(doc, {
        operation: 'replace',
        paragraph: 1,
        old_text: 'Sample',
        new_text: 'changed',
      }).then(() => 'saved')
    ).rejects.toThrow(/read-only|protected/i)
  })

  it('does not insert an image through a Unicode character boundary', async () => {
    const doc = await openDocx(sampleDocx(paragraph('sample 😀 text')))
    await expect(
      applyWordEdit(
        doc,
        {
          operation: 'image_insert',
          paragraph: 1,
          offset: 8,
          image_path: 'sample.png',
          width: 10,
          height: 10,
        },
        { loadImage: async () => ({ bytes: SAMPLE_IMAGE, extension: 'png', mime: 'image/png' }) }
      ).then(() => 'saved')
    ).rejects.toThrow(/Unicode|range/i)
  })

  it('refuses invalid XML and invalid ranges without producing a package', async () => {
    await expect(parseXml('<sample>bare & text</sample>')).rejects.toThrow()
    const doc = await openDocx(sampleDocx(paragraph('sample 😀 text')))
    await expect(
      applyWordEdit(doc, {
        operation: 'format',
        paragraph: 1,
        from: 8,
        to: 9,
        format: 'bold',
        enabled: true,
      })
    ).rejects.toThrow(/Unicode|range/i)
  })
})
