/**
 * Reading a book archive one entry at a time (`src/reader/zipLoader.ts`).
 */
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { ArchiveError, MAX_ENTRY_BYTES, isZip, openZip } from '@/reader/zipLoader'
import { buildMaliciousEpub, maliciousBookFiles } from '../fixtures/books/maliciousBook'

describe('a book archive', () => {
  it('lists its entries with their unpacked sizes, without unpacking them', () => {
    const zip = openZip(buildMaliciousEpub())
    const files = maliciousBookFiles()
    expect(zip.entries.map((e) => e.filename).sort()).toEqual(Object.keys(files).sort())
    expect(zip.getSize('OEBPS/content.opf')).toBe(strToU8(files['OEBPS/content.opf']).length)
    expect(zip.getSize('missing')).toBe(0)
  })

  it('reads one entry as text, bytes or a typed blob', async () => {
    const zip = openZip(buildMaliciousEpub())
    expect(zip.loadText('mimetype')).toBe('application/epub+zip')
    expect(zip.loadBytes('mimetype')!.length).toBe(20)
    const blob = zip.loadBlob('OEBPS/content.opf', 'application/oebps-package+xml')!
    expect(blob.type).toBe('application/oebps-package+xml')
    expect(await blob.text()).toContain('Malicious test book')
  })

  it('answers null for an entry it does not have', () => {
    const zip = openZip(buildMaliciousEpub())
    expect(zip.loadText('nope')).toBeNull()
    expect(zip.loadBlob('nope')).toBeNull()
  })

  it('refuses an entry that claims to unpack larger than any book needs', () => {
    // A stored entry whose central directory claims a huge size: patch the 32-bit field.
    const data = zipSync({ big: [strToU8('x'), { level: 0 }] })
    const view = new DataView(data.buffer)
    for (let i = data.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, MAX_ENTRY_BYTES + 1, true)
        break
      }
    }
    const zip = openZip(data)
    expect(() => zip.loadBytes('big')).toThrow(ArchiveError)
  })

  it('tells a zip from anything else, and refuses to open what is not one', () => {
    expect(isZip(buildMaliciousEpub())).toBe(true)
    expect(isZip(strToU8('%PDF-1.7'))).toBe(false)
    expect(() => openZip(strToU8('not a zip at all'))).toThrow(ArchiveError)
  })
})
