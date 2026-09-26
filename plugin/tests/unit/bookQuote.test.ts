/**
 * Finding words an agent quotes in a page of a book, exactly enough to highlight them
 * (`src/reader/bookQuote.ts`). Real books and PDFs are the e2e tier's
 * (`tests/e2e/bookAgentWrite.e2e.test.ts`); here the pages are small documents written inline.
 */
import { pageOf } from '../helpers/pageDocument'
import { describe, it, expect } from 'vitest'
import { aroundOf, findQuote, nearest, quoteKey, wordsOf } from '@/reader/bookQuote'
import { fromRange, parse, toRange } from '@/vendor/foliate-js/epubcfi.js'

const page = (body: string): Document =>
  pageOf(body, '<title>t</title><style>p { color: red }</style>')

describe('words quoted from a page', () => {
  it('are found across the elements they run through, and read back as the page has them', () => {
    const doc = page('<p>Fear is the <em>mind</em>-killer. Fear is the little-death.</p>')
    const found = findQuote(doc, 'the mind-killer')
    expect(found).toHaveLength(1)
    expect(found[0].toString()).toBe('the mind-killer')
    expect(wordsOf(found[0])).toBe('the mind-killer')
  })

  it('ignore the spacing, the case, curly quotes, dashes and soft hyphens of either side', () => {
    const doc = page('<p>He said,\n   “It’s   a trap” — and left.</p><p>Hyphen­ated word.</p>')
    expect(findQuote(doc, 'he said, "it\'s a trap" - and')[0]?.toString()).toBe(
      'He said,\n   “It’s   a trap” — and'
    )
    expect(findQuote(doc, 'hyphenated word')[0]?.toString()).toBe('Hyphen­ated word')
  })

  it('come with the words of their paragraph before and after them, not its opening', () => {
    const doc = page(
      '<h1>Title</h1><p>Opening words of the paragraph. Then <em>the mind</em>-killer comes, and more.</p><p>Next.</p>'
    )
    const [range] = findQuote(doc, 'the mind-killer')
    expect(aroundOf(range)).toEqual({
      pre: 'Opening words of the paragraph. Then ',
      match: 'the mind-killer',
      post: ' comes, and more.',
    })
  })

  it('run over paragraphs, and read back with a line between them', () => {
    const doc = page('<p>End of one.</p>\n<p>Start of two.</p>')
    const [range] = findQuote(doc, 'one. Start')
    expect(range).toBeTruthy()
    expect(wordsOf(range)).toBe('one.\nStart')
  })

  it('are every place they occur, in the page’s order', () => {
    const doc = page('<p>Plain text here.</p><p>Plain text again.</p><p>Plain text.</p>')
    expect(
      findQuote(doc, 'plain text').map((r) => r.startContainer.parentElement?.textContent)
    ).toEqual(['Plain text here.', 'Plain text again.', 'Plain text.'])
  })

  it('skip what is not read: styles, scripts, hidden parts', () => {
    const doc = page('<p hidden>secret word</p><script>secret word</script><p>open word</p>')
    expect(findQuote(doc, 'secret word')).toHaveLength(0)
    expect(findQuote(doc, 'open word')).toHaveLength(1)
  })

  it('are nothing when too short to tell apart', () => {
    const doc = page('<p>a b c</p>')
    expect(findQuote(doc, ' a ')).toHaveLength(0)
    expect(quoteKey('  “A”  ')).toBe('"a"')
  })

  it('in a PDF’s text layer, are found though the spans run words together', () => {
    // PDF.js puts each piece of text in a span of its own, a line break as <br>.
    const doc = page(
      '<div id="canvas"></div><div class="textLayer"><span>The quick brown</span><span>fox jumps</span><br><span>over the lazy dog.</span></div>'
    )
    const [range] = findQuote(doc, 'brown fox jumps over the')
    expect(range).toBeTruthy()
    expect(wordsOf(range)).toBe('brownfox jumps\nover the')
  })

  it('make a CFI that leads back to the same words', () => {
    const doc = page('<h1>Title</h1><p>One <b>two</b> three four.</p>')
    const [range] = findQuote(doc, 'two three')
    const cfi = fromRange(range)
    const back = toRange(doc, parse(cfi))
    expect(back.toString()).toBe('two three')
  })
})

describe('the occurrence meant', () => {
  it('is the one at or nearest the place given', () => {
    const doc = page(
      '<p id="a">Plain text here.</p><p id="b">Plain text again.</p><p id="c">Plain text.</p>'
    )
    const found = findQuote(doc, 'plain text')
    const at = doc.createRange()
    at.setStart(doc.getElementById('b')!.firstChild!, 6)
    expect(nearest(found, at)).toBe(found[1])
    const after = doc.createRange()
    after.setStart(doc.getElementById('c')!.firstChild!, 10)
    expect(nearest(found, after)).toBe(found[2])
  })
})
