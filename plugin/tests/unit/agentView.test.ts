import { describe, expect, it } from 'vitest'
import { cleanViewHtml, readViewLink, viewDocument } from '@/views/agentView'

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
  it('forbids scripts by its own rule and carries the theme', () => {
    const doc = viewDocument('<p>hi</p>', '--text-normal: #222;')
    expect(doc).toContain("default-src 'none'")
    expect(doc).not.toContain('script-src')
    expect(doc).toContain('--text-normal: #222;')
    expect(doc).toContain('<body><p>hi</p></body>')
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
