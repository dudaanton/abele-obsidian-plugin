import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildRichEpub, RICH_BOOK_ID } from '../fixtures/books/richBook'

describe('reader fixture book identity', () => {
  it('keeps the shared default but gives independently owned fixtures distinct identifiers', () => {
    const metadata = (id?: string) => strFromU8(unzipSync(buildRichEpub(id))['OEBPS/content.opf'])
    expect(metadata()).toContain(`<dc:identifier id="id">${RICH_BOOK_ID}</dc:identifier>`)
    expect(metadata('urn:sample:book-alpha')).toContain(
      '<dc:identifier id="id">urn:sample:book-alpha</dc:identifier>'
    )
    expect(metadata('urn:sample:book-beta')).not.toContain('urn:sample:book-alpha')
  })
})
