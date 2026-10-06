import { describe, expect, it } from 'vitest'
import { checkSlideDensity, checkDeckCss } from '@/slides/core/density'

const canvas = (body: string) => {
  return new DOMParser()
    .parseFromString(`<section><div class="abele-slide-content">${body}</div></section>`, 'text/html')
    .querySelector<HTMLElement>('section')!
}
const kinds = (body: string) => checkSlideDensity(canvas(body)).map((w) => w.kind)

describe('slide authoring warnings', () => {
  it('counts visible body words, excluding headings, and warns only above forty', () => {
    expect(kinds(`<h2>${'Heading '.repeat(50)}</h2><p>${'word '.repeat(40)}</p>`)).toEqual([])
    expect(kinds(`<p>${'слово '.repeat(41)}</p>`)).toEqual(['words'])
  })
  it('counts nested and ordered bullets, with a five-item limit', () => {
    expect(kinds(`<ol>${'<li>Point</li>'.repeat(5)}</ol>`)).toEqual([])
    expect(kinds(`<ul>${'<li>Point</li>'.repeat(5)}<li>Last</li></ul>`)).toEqual(['bullets'])
    expect(kinds(`<ul><li>Outer<ul>${'<li>Nested</li>'.repeat(5)}</ul></li></ul>`)).toEqual([
      'bullets',
    ])
  })
  it('limits each table to five data rows and three columns, including colspan', () => {
    const row = '<tr><td>A</td><td>B</td><td>C</td></tr>'
    const header = '<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>'
    expect(kinds(`<table>${header}<tbody>${row.repeat(5)}</tbody></table>`)).toEqual([])
    expect(kinds(`<table>${header}<tbody>${row.repeat(6)}</tbody></table>`)).toContain('table-rows')
    expect(kinds('<table><tr><td colspan="4">Wide</td></tr></table>')).toEqual(['table-columns'])
  })
  it('warns for more than two links and visible raw URLs but not image sources', () => {
    const link = '<a href="https://example.test/">Report</a>'
    expect(kinds(link.repeat(2))).toEqual([])
    expect(kinds(link.repeat(3))).toEqual(['links'])
    expect(kinds('<a href="https://example.test/">https://example.test/</a>')).toEqual(['raw-url'])
    expect(kinds('<p>https://example.test/</p>')).toEqual(['raw-url'])
    expect(kinds('<img src="https://example.test/sample.png">')).toEqual([])
  })
  it('keeps theme variables and ordinary geometry but flags fonts and literal palettes', () => {
    expect(
      checkDeckCss(
        'h2 { color: var(--text-accent); background: var(--background-primary); padding: 24px }'
      )
    ).toEqual([])
    expect(
      checkDeckCss('/* font-family: fake; color: red */ h2 { color: var(--text-normal) }')
    ).toEqual([])
    expect(
      checkDeckCss(
        'table { border: 1px solid var(--background-modifier-border); background: linear-gradient(var(--background-primary), var(--background-secondary)); background-size: cover; border-radius: 4px }'
      )
    ).toEqual([])
    expect(
      checkDeckCss(
        'body { font-family: var(--font-text); color: #123456; background: rgb(1, 2, 3) }'
      ).map((w) => w.kind)
    ).toEqual(['css-font', 'css-color'])
    expect(
      checkDeckCss('body { background: navy; --sample-accent: #abc }').map((w) => w.kind)
    ).toEqual(['css-color'])
  })
})
