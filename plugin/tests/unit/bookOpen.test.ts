/**
 * Telling a book the reader can open from one it cannot (`src/reader/openBook.ts`).
 */
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { BookFormatError, isProtected, openEpub } from '@/reader/openBook'
import { openZip } from '@/reader/zipLoader'

const zipOf = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

const encryption = (
  algorithm: string
) => `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
  xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
  <enc:EncryptionMethod Algorithm="${algorithm}"/>
  <enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData>
</enc:EncryptedData></encryption>`

describe('a protected book', () => {
  it('is one whose chapters are encrypted', () => {
    const zip = openZip(
      zipOf({
        'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc'),
      })
    )
    expect(isProtected(zip)).toBe(true)
  })

  it('is one carrying Adobe or Apple rights files', () => {
    expect(isProtected(openZip(zipOf({ 'META-INF/rights.xml': '<rights/>' })))).toBe(true)
    expect(isProtected(openZip(zipOf({ 'META-INF/sinf.xml': '<sinf/>' })))).toBe(true)
  })

  it('is not one whose fonts are only obfuscated', () => {
    expect(
      isProtected(
        openZip(
          zipOf({ 'META-INF/encryption.xml': encryption('http://www.idpf.org/2008/embedding') })
        )
      )
    ).toBe(false)
    expect(isProtected(openZip(zipOf({ mimetype: 'application/epub+zip' })))).toBe(false)
  })

  it('is refused with a message that says so', async () => {
    const data = zipOf({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': '<container/>',
      'META-INF/rights.xml': '<rights/>',
    })
    await expect(openEpub(data)).rejects.toThrow(/protected by DRM/)
  })
})

describe('a file that is not a book', () => {
  it('is refused before anything is parsed', async () => {
    await expect(openEpub(strToU8('%PDF-1.7'))).rejects.toThrow(BookFormatError)
    await expect(openEpub(zipOf({ 'readme.txt': 'hi' }))).rejects.toThrow(/no container/)
  })
})
