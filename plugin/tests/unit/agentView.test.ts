import { describe, expect, it, vi } from 'vitest'
import { cleanViewHtml, readViewLink, viewDocument, viewLinkTargets } from '@/views/agentView'
import { readTopic } from '@/docs'

describe('cleanViewHtml', () => {
  it('makes every allowed link inert and keyboard accessible, without trusting supplied routing data', () => {
    const doc = new DOMParser().parseFromString(
      cleanViewHtml(
        '<a href="https://example.test" data-abele-href="javascript:bad" tabindex="-1">web</a><a href="abele:ask?text=More">ask</a><a data-abele-href="https://example.test">forged</a>'
      ),
      'text/html'
    )
    expect(doc.querySelector('a[href]')).toBeNull()
    const links = doc.querySelectorAll('a')
    expect(links[0].getAttribute('data-abele-href')).toBe('https://example.test')
    expect(links[1].getAttribute('data-abele-href')).toBe('abele:ask?text=More')
    for (const link of Array.from(links).slice(0, 2)) {
      expect(link.getAttribute('role')).toBe('link')
      expect(link.getAttribute('tabindex')).toBe('-1')
      expect(link.getAttribute('aria-hidden')).toBe('true')
    }
    expect(links[2].hasAttribute('data-abele-href')).toBe(false)
  })
  it('keeps a card as written', () => {
    const card =
      '<div class="card"><img src="https://pictures.example/chair.jpg" alt="Chair"><div class="title">Chair</div><a class="button" href="https://shop.example/chair">Open</a></div>'
    // Destinations survive as routing data, never native frame navigation.
    expect(cleanViewHtml(card)).toBe(
      card.replace(
        'href="https://shop.example/chair"',
        'data-abele-href="https://shop.example/chair" role="link" tabindex="-1" aria-hidden="true"'
      )
    )
  })

  it('takes out what could run or reach out', () => {
    const out = cleanViewHtml(
      '<script>alert(1)</script><iframe srcdoc="x"></iframe><form><input></form>' +
        '<img src="x.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><p onclick="x()">text</p>'
    )
    expect(out).not.toMatch(/script|iframe|form|onerror|onclick|javascript/i)
    expect(out).toContain('<p>text</p>')
  })

  it('keeps links to notes, questions and inline pictures', () => {
    const out = cleanViewHtml(
      '<a href="abele:note?path=Desk.md">n</a><a href="abele:ask?text=hi">a</a><img src="data:image/svg+xml,%3Csvg%3E">'
    )
    expect(out).toContain('abele:note?path=Desk.md')
    expect(out).toContain('abele:ask?text=hi')
    expect(out).toContain('data:image/svg+xml')
  })
})

describe('parent link geometry', () => {
  it('clips wrapped fragments to the viewport and overflow ancestors, and retains offscreen links for keyboard access', () => {
    const holder = document.createElement('div')
    const parsed = new DOMParser().parseFromString(
      cleanViewHtml(
        '<div style="overflow:hidden"><a href="abele:ask?text=More" aria-label="Compare choices">First<br>second</a></div><a href="https://example.test"><img alt="Sample picture"></a><a style="display:none" href="https://example.test/hidden">Hidden</a>'
      ),
      'text/html'
    )
    holder.replaceChildren(...Array.from(parsed.body.childNodes))
    document.body.appendChild(holder)
    const rect = (left: number, top: number, width: number, height: number) => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    })
    try {
      const anchors = holder.querySelectorAll('a')
      vi.spyOn(anchors[0], 'getClientRects').mockReturnValue([
        rect(-5, 10, 30, 10),
        rect(0, 25, 40, 10),
      ] as unknown as DOMRectList)
      vi.spyOn(anchors[0].parentElement!, 'getBoundingClientRect').mockReturnValue(
        rect(2, 3, 15, 27) as DOMRect
      )
      vi.spyOn(anchors[1], 'getClientRects').mockReturnValue([
        rect(10, 200, 30, 20),
      ] as unknown as DOMRectList)
      vi.spyOn(anchors[2], 'getClientRects').mockReturnValue([
        rect(10, 20, 30, 20),
      ] as unknown as DOMRectList)
      const targets = viewLinkTargets(document, 20, 100)
      expect(targets.map(({ href, label, rects }) => ({ href, label, rects }))).toEqual([
        {
          href: 'abele:ask?text=More',
          label: 'Compare choices',
          rects: [rect(2, 10, 15, 10), rect(2, 25, 15, 5)].map(({ left, top, width, height }) => ({
            left,
            top,
            width,
            height,
          })),
        },
        { href: 'https://example.test', label: 'Sample picture', rects: [] },
      ])
    } finally {
      holder.remove()
      vi.restoreAllMocks()
    }
  })
})

describe('viewDocument', () => {
  it('drops an unsafe theme value without losing the remaining theme', () => {
    const doc = viewDocument(
      '<p>View</p>',
      '--shadow-s: url(https://example.test); --font-interface: sans-serif;'
    )
    expect(doc).toContain('--font-interface: sans-serif;')
    expect(doc).not.toContain('url(https://example.test)')
  })
  it('keeps modern theme colour functions instead of discarding the theme', () => {
    const theme = '--text-normal: color-mix(in srgb, #111, #222); --font-interface: sans-serif;'
    expect(viewDocument('<p>View</p>', theme)).toContain(theme)
  })
  it('forbids scripts by its own rule and carries the theme', () => {
    const doc = viewDocument('<p>hi</p>', '--text-normal: #222;')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("script-src 'none'")
    expect(doc).toContain('--text-normal: #222;')
    expect(doc).toContain('<body><p>hi</p></body>')
  })
})

describe('view security boundaries', () => {
  it('serves the block reference through the existing docs section', () => {
    const topic = readTopic('display', 'agent-views')
    for (const text of [
      '```abele-view',
      'abele:note?path=',
      'abele:ask?text=',
      'https://',
      'cards',
      'unsent',
    ])
      expect(topic).toContain(text)
  })
  it.each([
    '<svg><script>alert(1)</script></svg>',
    '<meta http-equiv="refresh" content="0;url=https://example.test"><base href="https://example.test">',
    '<object data="https://example.test"></object><embed src="https://example.test">',
    '<form action="https://example.test"><input autofocus></form>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<style>@import "https://example.test/style";</style>',
    '<svg onload="alert(1)"><foreignObject><iframe srcdoc="x"></iframe></foreignObject></svg>',
  ])('removes active containers: %s', (html) => {
    expect(cleanViewHtml(html)).toBe('')
  })
  it.each([
    'background:url(https://example.test/pixel)',
    'width:expression(alert(1))',
    'behavior:url(https://example.test/code)',
    'background:image-set(url(https://example.test/pixel) 1x)',
    String.raw`background:u\72l(https://example.test/pixel)`,
  ])('removes unsafe inline CSS: %s', (style) => {
    expect(cleanViewHtml(`<p style="${style}">safe</p>`)).toBe('<p>safe</p>')
  })
  it.each(['javascript:alert(1)', 'data:text/html,test', 'http://example.test', 'abele:run?cmd=x'])(
    'rejects link %s',
    (href) => {
      expect(cleanViewHtml(`<a href="${href}">link</a>`)).toBe('<a>link</a>')
      expect(readViewLink(href)).toBeNull()
    }
  )
  it('removes resource attributes outside image sources', () => {
    expect(
      cleanViewHtml(
        '<a href="data:image/png;base64,AA" ping="https://example.test">x</a><div background="https://example.test" srcdoc="x" onmouseover="x()">y</div>'
      )
    ).toBe('<a>x</a><div>y</div>')
  })
  it('removes event handlers and encoded executable URLs', () => {
    expect(
      cleanViewHtml(
        '<p onclick="alert(1)">safe</p><a href="java&#10;script:alert(1)">bad</a><img src="data:text/html,test" onerror="alert(1)">'
      )
    ).toBe('<p>safe</p><a>bad</a><img>')
  })
  it('keeps inline layout and refuses theme style breakout', () => {
    expect(cleanViewHtml('<div style="display:grid;gap:var(--size-4-2)">safe</div>')).toContain(
      'display:grid'
    )
    expect(viewDocument('<p>safe</p>', '</style><script>alert(1)</script>')).not.toContain(
      '<script>'
    )
  })
  it('explicitly blocks execution, submission, nesting and connections', () => {
    const doc = viewDocument('<p>safe</p>', '')
    for (const directive of [
      "script-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "connect-src 'none'",
    ])
      expect(doc).toContain(directive)
  })
})

describe('readViewLink', () => {
  it('reads a web page, a note and a question', () => {
    expect(readViewLink('https://shop.example/a')).toEqual({
      kind: 'web',
      url: 'https://shop.example/a',
    })
    expect(readViewLink('abele:note?path=Desk%20chair.md')).toEqual({
      kind: 'note',
      path: 'Desk chair.md',
    })
    expect(readViewLink('abele:ask?text=Tell%20me%20more')).toEqual({
      kind: 'ask',
      text: 'Tell me more',
    })
  })

  it('does nothing for anything else', () => {
    expect(readViewLink('javascript:alert(1)')).toBeNull()
    expect(readViewLink('abele:ask?text=')).toBeNull()
    expect(readViewLink('abele:run?cmd=x')).toBeNull()
    expect(readViewLink('#top')).toBeNull()
  })
})
