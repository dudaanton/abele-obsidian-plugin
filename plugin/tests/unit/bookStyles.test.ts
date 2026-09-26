/**
 * A book's own stylesheets made safe to show (`src/reader/bookStyles.ts`): nothing outside the book
 * is fetched, nothing that ever ran code survives, the reader's choices win, and the book's
 * layout of its own content stays.
 */
import { describe, it, expect } from 'vitest'
import {
  BOOK_STYLE_MARK,
  inlineBookStyles,
  sanitizeBookCss,
  type CssLoader,
} from '@/reader/bookStyles'

describe("a book's stylesheet, cleaned", () => {
  it('keeps what lays out its content: tables, indents, alignment, drop caps', () => {
    const css = `table { border-collapse: collapse; width: 100% }
td.num { text-align: right; padding: .25em }
p.p1 { text-indent: 1.5em; text-align: justify }
p.first::first-letter { float: left; font-size: 3em; line-height: .8 }
@media (min-width: 600px) { .wide { columns: 2 } }
@font-face { font-family: "Book Serif"; src: url("blob:app://obsidian.md/1234") format("opentype") }
.pic { background: url('blob:app://obsidian.md/5678') no-repeat }`
    const out = sanitizeBookCss(css)
    for (const kept of [
      'border-collapse: collapse',
      'text-align: right',
      'text-indent: 1.5em',
      'float: left',
      '@media (min-width: 600px)',
      'url("blob:app://obsidian.md/1234") format("opentype")',
      "url('blob:app://obsidian.md/5678')",
    ])
      expect(out).toContain(kept)
  })

  it('fetches nothing outside the book: web, file, app and other data URLs become none', () => {
    const out = sanitizeBookCss(`
      .a { background: url(https://tracker.example/pixel.png?reader=1) }
      .b { background-image: url("http://example.com/x.png") }
      .c { background: url('file:///etc/passwd') }
      .d { cursor: url(app://obsidian.md/x.cur), auto }
      .e { background: url(data:text/html;base64,PHNjcmlwdD4=) }
      .f { background: url(//example.com/x.png) }
      .g { background: url(data:image/png;base64,iVBORw0KGgo=) }
      .h { filter: url(#shadow) }
      @font-face { font-family: X; src: url(https://fonts.example/x.woff2) }
    `)
    expect(out).not.toMatch(/example|file:|app:|text\/html/)
    expect(out).toContain('url(data:image/png;base64,iVBORw0KGgo=)')
    expect(out).toContain('url(#shadow)')
    expect(out.match(/\bnone\b/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('drops every @import, and image-set() and src() with their declaration', () => {
    const out = sanitizeBookCss(`@import url("https://evil.example/a.css");
      @import 'other.css' screen;
      .a { color: red; background-image: image-set("https://evil.example/a.png" 1x); margin: 0 }
      .b { background: -webkit-image-set(url(https://evil.example/b.png) 2x) }
      @font-face { font-family: Y; src: src("https://evil.example/y.woff") }`)
    expect(out).not.toMatch(/@import|evil|image-set|src\(/)
    expect(out).toContain('color: red')
    expect(out).toContain('margin: 0')
  })

  it('takes out what ever ran code, and its declaration', () => {
    const out = sanitizeBookCss(`.a { width: expression(alert(1)); color: blue }
      .b { behavior: url(evil.htc) }
      .c { -moz-binding: url("evil.xml#x") }
      .d { background: url(javascript:alert(1)) }
      .e { background: url("vbscript:msgbox") }`)
    expect(out).not.toMatch(/expression|behavior|binding|javascript|vbscript|evil/)
    expect(out).toContain('color: blue')
  })

  it("takes out the book's !important, so the reader's own choices win", () => {
    const out = sanitizeBookCss('p { font-size: 9px !important; color: red ! IMPORTANT }')
    expect(out).not.toMatch(/important/i)
    // A fixed size made relative to the root, whose size the reader sets.
    expect(out).toContain('font-size: 0.5625rem')
    expect(sanitizeBookCss('h1 { font-size: 24pt } p { font-size: 1.1em }')).toBe(
      'h1 { font-size: 2rem } p { font-size: 1.1em }'
    )
  })

  it('lets no escape hide a way out: dropped whole, or the URL made none', () => {
    for (const hostile of [
      '.a { background: u\\72l(https://evil.example/x.png) }',
      '.a { background: \\75 rl("https://evil.example/x.png") }',
      '@\\69mport "https://evil.example/x.css";',
      '.a { width: e\\78pression(alert(1)) }',
      '.a { background: url(\\68ttps://evil.example/x.png) }',
      '.a { color: red !\\69mportant }',
    ])
      expect(sanitizeBookCss(hostile), hostile).not.toMatch(/evil|xpression|important|mport/i)
    // Hidden where only the browser's reading of it would find it: dropped whole.
    expect(sanitizeBookCss('.a { background: u\\72l(https://evil.example/x.png) }')).toBe('')
  })

  it('reads through comments that would split a word', () => {
    expect(sanitizeBookCss('.a { background: u/**/rl(https://evil.example/x) }')).not.toMatch(
      /evil/
    )
    expect(sanitizeBookCss('@im/* */port "https://evil.example/x.css";')).not.toMatch(/evil/)
  })
})

const page = (head: string, body = '<p>words</p>'): Document =>
  new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`,
    'application/xhtml+xml'
  )

describe("a page's stylesheets put into it", () => {
  const sheets: Record<string, string> = {
    'blob:app://obsidian.md/main': '@import "blob:app://obsidian.md/more"; p { text-indent: 2em }',
    'blob:app://obsidian.md/more': 'td { text-align: right; background: url(https://x.example/a) }',
  }
  const load: CssLoader = async (href) => sheets[href] ?? null

  it('takes the place of each link to a stylesheet of the book, cleaned and marked', async () => {
    const doc = page(
      '<title>t</title><link rel="stylesheet" href="blob:app://obsidian.md/main" type="text/css"/>' +
        '<style>h1 { color: green !important; background: url(https://x.example/b) }</style>'
    )
    const before = doc.head.children.length
    await inlineBookStyles(doc, load)
    const styles = Array.from(doc.head.getElementsByTagName('style'))
    expect(doc.head.children.length).toBe(before)
    expect(doc.head.getElementsByTagName('link')).toHaveLength(0)
    expect(styles).toHaveLength(2)
    for (const s of styles) expect(s.hasAttribute(BOOK_STYLE_MARK)).toBe(true)
    const all = styles.map((s) => s.textContent).join('\n')
    expect(all).toContain('text-indent: 2em')
    expect(all).toContain('text-align: right')
    expect(all).not.toMatch(/x\.example|important|@import/)
  })

  it('leaves a link it cannot read from the book as it is', async () => {
    const doc = page('<link rel="stylesheet" href="https://x.example/c.css"/>')
    await inlineBookStyles(doc, load)
    expect(doc.head.getElementsByTagName('link')).toHaveLength(1)
    expect(doc.head.getElementsByTagName('style')).toHaveLength(0)
  })

  it('does not follow an @import of itself for ever', async () => {
    const loop: CssLoader = async () => '@import "blob:app://obsidian.md/loop"; p { margin: 0 }'
    const doc = page('<link rel="stylesheet" href="blob:app://obsidian.md/loop"/>')
    await inlineBookStyles(doc, loop)
    expect(doc.head.getElementsByTagName('style')[0].textContent).toContain('margin: 0')
  })
})
