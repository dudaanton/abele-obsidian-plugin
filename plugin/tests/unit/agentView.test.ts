import { describe, expect, it } from 'vitest'
import { cleanViewHtml, readViewLink, viewDocument } from '@/views/agentView'
import { readTopic } from '@/docs'

describe('cleanViewHtml', () => {
  it('keeps a card as written', () => {
    const card =
      '<div class="card"><img src="https://pictures.example/chair.jpg" alt="Chair"><div class="title">Chair</div><a class="button" href="https://shop.example/chair">Open</a></div>'
    expect(cleanViewHtml(card)).toBe(card)
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
