/**
 * Telling the formats apart, refusing a protected Kindle book, and the fixtures the e2e tier opens
 * in the running app (`tests/e2e/bookFormats.e2e.test.ts`), where the engine builds their pages.
 */
import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { formatOf, mobiEncryption } from '@/reader/otherFormats'
import { buildCbz, buildFb2, buildMobi, OTHER_TEXT } from '../fixtures/books/otherFormats'

describe('the format of a file', () => {
  it.each([
    ['epub', 'epub'],
    ['pdf', 'pdf'],
    ['mobi', 'mobi'],
    ['azw3', 'mobi'],
    ['AZW', 'mobi'],
    ['fb2', 'fb2'],
    ['fbz', 'fbz'],
    ['cbz', 'cbz'],
    ['md', null],
    ['cbr', null],
  ])('.%s is read as %s', (ext, format) => {
    expect(formatOf(ext)).toBe(format)
  })
})

describe('a Mobipocket or Kindle book', () => {
  it('is protected when its header says it is encrypted, and not otherwise', () => {
    expect(mobiEncryption(buildMobi())).toBe(0)
    expect(mobiEncryption(buildMobi({ encrypted: true }))).toBe(2)
    expect(mobiEncryption(new Uint8Array(10))).toBe(0)
  })

  it('carries its text where the engine reads it', () => {
    const data = buildMobi()
    expect(new TextDecoder().decode(data)).toContain(OTHER_TEXT)
    expect(String.fromCharCode(...data.subarray(60, 68))).toBe('BOOKMOBI')
  })
})

describe('the other fixtures', () => {
  it('are a FictionBook and a comic archive of pictures', () => {
    expect(new TextDecoder().decode(buildFb2())).toContain('<FictionBook')
    const cbz = unzipSync(buildCbz())
    expect(Object.keys(cbz).sort()).toEqual(['notes.txt', 'page1.png', 'page10.png', 'page2.png'])
    expect(cbz['page1.png'].subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]))
  })
})
