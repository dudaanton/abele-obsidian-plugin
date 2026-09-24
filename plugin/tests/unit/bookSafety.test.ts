/**
 * The cleaning a book goes through before any page of it is drawn (`src/reader/bookSafety.ts`).
 *
 * happy-dom's XML parser is not a browser's — it cannot read an XML prolog — so these tests
 * clean pages parsed as HTML and prolog-free XHTML, and check the rules one by one. The same
 * crafted book is opened in the real app by `tests/e2e/bookReader.e2e.test.ts`, which is where
 * "nothing runs" is proven.
 */
import { describe, it, expect } from 'vitest'
import {
  BOOK_CSP,
  CSP_MARK,
  MIME,
  REMOVED_MARK,
  auditDocument,
  cleanDocument,
  frameSandbox,
  guardBook,
  injectPolicy,
  isOpenableExternal,
  isRunnableUrl,
  resourcePolicy,
  sanitizeResource,
  sanitizeStyle,
} from '@/reader/bookSafety'
import { payload } from '../fixtures/books/maliciousBook'

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html')

const cleaned = (html: string) => {
  const doc = parseHtml(html)
  cleanDocument(doc)
  injectPolicy(doc)
  return doc
}

/** Every attribute value and text in the document that could still carry a payload. */
const liveCode = (doc: Document): string[] => {
  const found: string[] = []
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (
      ['script', 'iframe', 'object', 'embed', 'base', 'template', 'noscript'].includes(el.localName)
    )
      found.push(`<${el.localName}>`)
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) found.push(attr.name)
      if (isRunnableUrl(attr.value)) found.push(`${attr.name}=${attr.value}`)
    }
  }
  return found
}

describe('a runnable URL', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'jav\u0000ascript:alert(1)',
    'vbscript:msgbox',
    '0;url=javascript:alert(1)',
  ])('is found in %j', (value) => {
    expect(isRunnableUrl(value)).toBe(true)
  })

  it.each([
    'https://example.com',
    'chapter2.xhtml#note',
    'mailto:a@b.c',
    'data:image/png;base64,AA',
  ])('is not found in %j', (value) => {
    expect(isRunnableUrl(value)).toBe(false)
  })
})

describe('cleaning a page', () => {
  it('takes out every element that can run or load a page, leaving hidden stand-ins in their place', () => {
    const doc = cleaned(`<html><head><script>${payload('a')}</script><base href="x/"></head><body>
      <p id="one">one</p><script id="s">${payload('b')}</script><p>two</p>
      <iframe srcdoc="x"></iframe><object data="x"></object><embed src="x"><template><script></script></template>
      <noscript>n</noscript><svg><script>1</script><foreignObject><script>2</script></foreignObject></svg>
    </body></html>`)
    expect(liveCode(doc)).toEqual([])
    // The body keeps its element count, so positions counted in the book's own file still match.
    const kids = Array.from(doc.body.children).map((el) => el.localName)
    expect(kids.slice(0, 3)).toEqual(['p', 'span', 'p'])
    const stand = doc.getElementById('s')!
    expect(stand.getAttribute(REMOVED_MARK)).toBe('script')
    expect(stand.hasAttribute('hidden')).toBe(true)
  })

  it('strips every event handler attribute, in any case', () => {
    const doc = cleaned(
      `<body onload="x()"><img src="a.png" onerror="x()" ONCLICK="x()"><div onMouseOver="x()">d</div></body>`
    )
    expect(liveCode(doc)).toEqual([])
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('a.png')
  })

  it('strips runnable URLs from links, forms, buttons, image maps and MathML', () => {
    const doc = cleaned(`<body>
      <a href="javascript:x()">a</a><a href=" java&#x09;script:x()">b</a>
      <form action="javascript:x()"><button formaction="javascript:x()">b</button></form>
      <map><area href="javascript:x()"></map>
      <math><mtext href="javascript:x()">m</mtext></math>
      <a href="chapter2.xhtml#n" id="keep">keep</a>
    </body>`)
    expect(liveCode(doc)).toEqual([])
    expect(doc.getElementById('keep')!.getAttribute('href')).toBe('chapter2.xhtml#n')
    expect(doc.querySelector('form')!.hasAttribute('action')).toBe(false)
  })

  it('takes out meta refresh and any policy the book brings, however it is marked', () => {
    const doc = cleaned(`<html><head>
      <meta http-equiv="refresh" content="0;url=https://example.com">
      <meta ${CSP_MARK}="" http-equiv="Content-Security-Policy" content="script-src *">
      <meta charset="utf-8"><meta name="viewport" content="width=600">
    </head><body></body></html>`)
    const metas = Array.from(doc.head.querySelectorAll('meta'))
    const policies = metas.filter((m) => m.hasAttribute('http-equiv'))
    expect(policies).toHaveLength(1)
    expect(policies[0].getAttribute('content')).toBe(BOOK_CSP)
    expect(doc.head.firstElementChild).toBe(policies[0])
    // A fixed-layout book needs its viewport.
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull()
  })

  it('keeps stylesheets and drops every other kind of link', () => {
    const doc = cleaned(`<html><head>
      <link rel="stylesheet" href="data:text/css,p{}"><link rel="modulepreload" href="evil.js">
      <link rel="import" href="x.html"><link rel="prefetch" href="x"><link href="no-rel">
    </head><body></body></html>`)
    const links = Array.from(doc.querySelectorAll('link')).map((l) => l.getAttribute('rel'))
    expect(links).toEqual(['stylesheet'])
  })

  it('removes SVG animations that would write a link or an event handler', () => {
    const doc = cleaned(`<body><svg><a><animate attributeName="href" to="javascript:x()"/></a>
      <set attributeName="onload" to="x()"/><animate attributeName="xlink:href" values="a;javascript:x()"/>
      <animate attributeName="opacity" from="0" to="1" id="fade"/></svg></body>`)
    const kept = Array.from(doc.querySelectorAll('animate, set')).map((a) => a.id)
    expect(kept).toEqual(['fade'])
  })

  it('refuses data URLs that could be a page, and keeps pictures and fonts', () => {
    const doc = cleaned(`<body>
      <a href="data:text/html,x" id="a">a</a><img src="data:image/png;base64,AA" id="b">
      <img src="data:text/html;base64,AA" id="c"><a href="data:application/xhtml+xml,x" id="d">d</a>
    </body>`)
    expect(doc.getElementById('a')!.hasAttribute('href')).toBe(false)
    expect(doc.getElementById('b')!.getAttribute('src')).toBe('data:image/png;base64,AA')
    expect(doc.getElementById('c')!.hasAttribute('src')).toBe(false)
    expect(doc.getElementById('d')!.hasAttribute('href')).toBe(false)
  })

  it('does not let the book carry the marks Abele gives its own elements', () => {
    const doc = cleaned(`<body><span ${REMOVED_MARK}="script" onclick="x()">s</span></body>`)
    const span = doc.querySelector('span[hidden]') ?? doc.body.querySelector('span')!
    expect(span.hasAttribute(REMOVED_MARK)).toBe(false)
    expect(liveCode(doc)).toEqual([])
  })

  it('puts the policy first in a head it makes when the page has none', () => {
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>',
      MIME.XHTML
    )
    injectPolicy(doc)
    const head = doc.documentElement.firstElementChild!
    expect(head.localName).toBe('head')
    expect(head.firstElementChild!.getAttribute('content')).toBe(BOOK_CSP)
  })
})

describe('the policy', () => {
  it('allows no script, no network, no frames and no forms', () => {
    for (const directive of [
      "script-src 'none'",
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "object-src 'none'",
      "base-uri 'none'",
    ])
      expect(BOOK_CSP).toContain(directive)
    expect(BOOK_CSP).not.toMatch(/script-src[^;]*(unsafe|\*|blob|data|self)/)
  })
})

describe('the audit of a loaded page', () => {
  it('passes a cleaned page', () => {
    const doc = cleaned(
      `<html><head><script>x</script></head><body onload="x()"><p>t</p></body></html>`
    )
    expect(auditDocument(doc)).toEqual([])
  })

  it('reports a script, a handler, a runnable link and a missing policy', () => {
    const doc = parseHtml(
      `<html><head></head><body><script>x</script><p onclick="x()">t</p><a href="javascript:x()">a</a></body></html>`
    )
    const findings = auditDocument(doc)
    expect(findings).toContain('policy is not first in the head')
    expect(findings).toContain('element <script>')
    expect(findings).toContain('attribute onclick')
    expect(findings.some((f) => f.startsWith('runnable URL'))).toBe(true)
  })

  it('passes a page the engine has put its own styles into, before and after the policy', () => {
    const doc = cleaned('<html><head><title>t</title></head><body><p>t</p></body></html>')
    doc.head.prepend(doc.createElement('style'))
    doc.head.append(doc.createElement('style'))
    expect(auditDocument(doc)).toEqual([])
  })

  it('reports a policy that is not the first thing the page itself put in its head', () => {
    const doc = cleaned('<html><head><title>t</title></head><body><p>t</p></body></html>')
    const style = doc.createElement('style')
    style.setAttribute('media', 'all')
    doc.head.prepend(style)
    expect(auditDocument(doc)).toContain('policy is not first in the head')
  })

  it('reports a script put in after the page was cleaned', () => {
    const doc = cleaned('<html><head></head><body><p>t</p></body></html>')
    doc.body.appendChild(doc.createElement('script'))
    expect(auditDocument(doc)).toContain('element <script>')
  })
})

describe('resources of a book', () => {
  it.each([
    ['application/xhtml+xml', 'page'],
    ['text/html', 'page'],
    ['image/svg+xml', 'svg'],
    ['text/css', 'style'],
    ['application/javascript', 'script'],
    ['text/javascript', 'script'],
    ['application/ecmascript', 'script'],
    ['image/png', 'passive'],
    ['font/woff2', 'passive'],
    ['application/vnd.ms-opentype', 'passive'],
    ['audio/mpeg', 'passive'],
    ['application/xml', 'inert'],
    ['text/xml', 'inert'],
    ['application/xslt+xml', 'inert'],
    ['', 'inert'],
  ])('%j is treated as %s', (type, policy) => {
    expect(resourcePolicy(type)).toBe(policy)
  })

  it('hands a page over as XHTML with the policy and without its script', async () => {
    const out = await sanitizeResource(
      `<html><head><title>t</title></head><body><p onclick="x()">a</p><script>x()</script></body></html>`,
      'text/html'
    )
    expect(out.type).toBe(MIME.XHTML)
    expect(out.data).toContain(BOOK_CSP.slice(0, 30))
    expect(out.data).not.toMatch(/<script|onclick/)
  })

  it('hands a script or an unknown type over as bytes nothing renders', async () => {
    expect(await sanitizeResource('alert(1)', 'application/javascript')).toEqual({
      data: '',
      type: MIME.INERT,
    })
    const xml = await sanitizeResource('<x/>', 'application/xml')
    expect(xml.type).toBe(MIME.INERT)
  })

  it('passes pictures through untouched', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const out = await sanitizeResource(blob, 'image/png')
    expect(out.data).toBe(blob)
    expect(out.type).toBe('image/png')
  })

  it('neutralises runnable URLs in a stylesheet', () => {
    expect(sanitizeStyle('a{background:url(javascript:x())}')).not.toMatch(/javascript:/i)
  })
})

describe('the guard on a book', () => {
  it('refuses script resources and cleans every other one by its type', async () => {
    const target = new EventTarget()
    guardBook({ transformTarget: target })

    const load = new CustomEvent('load', {
      detail: { type: 'application/javascript', isScript: true, allow: true },
    })
    target.dispatchEvent(load)
    expect(load.detail.allow).toBe(false)

    const detail = { data: Promise.resolve('<p onclick="x()">a</p>'), type: 'text/html' }
    target.dispatchEvent(new CustomEvent('data', { detail }))
    expect(await detail.type).toBe(MIME.XHTML)
    expect(await detail.data).not.toContain('onclick')
  })

  it('refuses to open a book whose resources it cannot see', () => {
    expect(() => guardBook({})).toThrow()
  })
})

describe('the frame sandbox', () => {
  it('drops allow-scripts on the desktop and Android', () => {
    expect(frameSandbox({})).toBe('allow-same-origin')
    expect(frameSandbox({ isIosApp: false, isSafari: false })).toBe('allow-same-origin')
  })

  it('keeps allow-scripts on the iPhone and iPad, where WebKit needs it for events', () => {
    expect(frameSandbox({ isIosApp: true })).toBe('allow-same-origin allow-scripts')
  })
})

describe('links out of a book', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['mailto:a@b.c', true],
    ['javascript:x()', false],
    ['file:///etc/passwd', false],
    ['data:text/html,x', false],
    ['obsidian://open?vault=x', false],
  ])('%s opens outside: %s', (href, ok) => {
    expect(isOpenableExternal(href)).toBe(ok)
  })
})
