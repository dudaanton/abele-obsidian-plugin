import { describe, expect, it } from 'vitest'
import { openDocx } from '@/word/package'
import { sampleDocx, paragraph } from '../fixtures/docx/sampleDocx'

describe('Word case-folded search source offsets', () => {
  it('reports original UTF-16 positions after a case expansion', async () => {
    const text = 'İ findword 😀 FINDWORD'
    const doc = await openDocx(sampleDocx(paragraph(text)))
    const results = doc.search('findword', 0, 10)
    expect(results.finds.map((find) => find.offset)).toEqual([
      text.indexOf('findword'),
      text.indexOf('FINDWORD'),
    ])
  })
  it('reports the original source length of a match containing an expanding character', async () => {
    const doc = await openDocx(sampleDocx(paragraph('İ sample')))
    const result = doc.search('İ', 0, 10)
    expect(result.finds[0]).toMatchObject({ offset: 0, length: 1 })
  })
  it('maps a partial folded match to its complete original Unicode character', async () => {
    const doc = await openDocx(sampleDocx(paragraph('İ sample')))
    expect(doc.search('i', 0, 10).finds[0]).toMatchObject({ offset: 0, length: 1 })
  })
  it('maps supplementary Unicode characters and keeps literal case-insensitive search behavior', async () => {
    const text = 'İ 😀 [sample]'
    const doc = await openDocx(sampleDocx(paragraph(text)))
    expect(doc.search('😀', 0, 10).finds[0]).toMatchObject({
      offset: text.indexOf('😀'),
      length: 2,
    })
    expect(doc.search('[SAMPLE]', 0, 10).finds[0]).toMatchObject({
      offset: text.indexOf('['),
      length: 8,
    })
  })
})
