import { afterEach, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { openEpub } from '@/reader/openBook'

const sampleBook = () =>
  zipSync(
    Object.fromEntries(
      Object.entries({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml':
          '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'package.opf':
          '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="sample-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="sample-id">sample-book</dc:identifier><dc:title>Sample book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="sample-chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="sample-chapter"/></spine></package>',
        'chapter.xhtml':
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Sample chapter</title></head><body><p>Sample words.</p></body></html>',
      }).map(([path, text]) => [path, strToU8(text)])
    )
  )

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openedSample() {
  const Parser = DOMParser
  vi.stubGlobal(
    'DOMParser',
    class extends Parser {
      parseFromString(text: string, type: DOMParserSupportedType): Document {
        const doc = super.parseFromString(text, type)
        // The XML documents in this DOM emulator lack the native namespace lookup methods.
        const query = doc.querySelectorAll.bind(doc)
        Object.assign(doc, {
          lookupNamespaceURI: () => doc.documentElement.namespaceURI,
          lookupPrefix: () => null,
          // This sample has no links; the emulator cannot parse namespaced selectors.
          querySelectorAll: (selector: string) =>
            query(selector === '[*|href]:not([href])' ? 'a[href]' : selector),
        })
        return doc
      }
    }
  )
  let serial = 0
  const created = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(() => `blob:sample-${++serial}`)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const opened = await openEpub(sampleBook())
  return { opened, created, revoke }
}

it.each([2, 3])(
  'retains one chapter URL until every one of %s consumers unloads across repeated cycles',
  async (count) => {
    const { opened, revoke } = await openedSample()
    const chapter = opened.book.sections[0]
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const urls = await Promise.all(Array.from({ length: count }, () => chapter.load()))
        expect(new Set(urls).size).toBe(1)
        const before = revoke.mock.calls.length
        for (let consumer = 0; consumer < count - 1; consumer++) {
          chapter.unload?.()
          expect(revoke).toHaveBeenCalledTimes(before)
        }
        chapter.unload?.()
        expect(revoke).toHaveBeenCalledTimes(before + 1)
      }
    } finally {
      opened.destroy()
    }
  }
)

it('shares concurrent chapter loads and releases their single URL after both consumers unload', async () => {
  const { opened, created, revoke } = await openedSample()
  const chapter = opened.book.sections[0]
  try {
    const [first, second] = await Promise.all([chapter.load(), chapter.load()])
    expect(first).toBe(second)
    expect(created).toHaveBeenCalledOnce()
    chapter.unload?.()
    expect(revoke).not.toHaveBeenCalled()
    chapter.unload?.()
    expect(revoke).toHaveBeenCalledOnce()
  } finally {
    opened.destroy()
  }
})
