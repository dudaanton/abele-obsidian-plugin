import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { prepareContentBody, alignShortContentBody } from '@/slides/core/contentLayout'

const layouts = readFileSync('src/slides/core/layouts.css', 'utf8')

const styles = () => {
  const sheet = document.createElement('style')
  sheet.textContent = layouts
  document.head.append(sheet)
  return sheet
}
afterEach(() => {
  document.body.replaceChildren()
  document.head.querySelectorAll('style').forEach((sheet) => sheet.remove())
  vi.restoreAllMocks()
})

it('uses normal body tracking even when the surrounding theme widens text', () => {
  styles()
  const host = document.createElement('div')
  host.style.letterSpacing = '2px'
  host.innerHTML =
    '<section class="abele-slide abele-slide-split"><div class="abele-slide-content markdown-rendered"><div class="abele-slide-region"><div><p>A simple statement</p><ul><li>A point</li></ul><table><tr><th>Measure</th><td>Value</td></tr></table></div></div></div></section>'
  document.body.append(host)
  for (const element of host.querySelectorAll('p, li, table, th, td'))
    expect(getComputedStyle(element).letterSpacing).toBe('0px')
  // The SVG text-rendering hint is unsupported by Happy DOM, so check its declaration.
  expect(layouts).toMatch(/\.abele-slide\s*\{[^}]*text-rendering:\s*geometricPrecision/)
})

it('keeps sources at body size and only their grouping headings a step smaller', () => {
  const sheet = styles()
  // Happy DOM does not resolve inherited/calc font sizes; the live tier measures their pixels.
  const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[]
  const region = rules.find(
    (rule) => rule.selectorText === ".abele-slide[data-generated='sources'] .abele-slide-region"
  )!
  expect(region.style.fontSize).toBe('inherit')
  expect(layouts).toMatch(
    /\.abele-slide\[data-generated='sources'\] h3\s*\{[^}]*font-size:\s*calc\(var\(--font-text-size,\s*16px\)\s*\*\s*1\.5\)/
  )
  expect(region.style.overflowWrap).toBe('anywhere')
})

const content = () => {
  const slide = document.createElement('section')
  slide.className = 'abele-slide abele-slide-content'
  slide.innerHTML =
    '<div class="abele-slide-content markdown-rendered"><div class="abele-slide-region abele-slide-region-body"><div><h2>A short idea</h2><p>A useful statement.</p></div></div></div>'
  document.body.append(slide)
  return slide
}
it('keeps the heading at the top and centers a short body in the remaining space', () => {
  const slide = content()
  prepareContentBody(slide)
  const body = slide.querySelector<HTMLElement>('.abele-slide-content-body')!
  expect(slide.querySelector('.abele-slide-content-heading h2')?.textContent).toBe('A short idea')
  expect(body.querySelector('h2')).toBeNull()
  expect(body.textContent).toBe('A useful statement.')
  vi.spyOn(body, 'clientHeight', 'get').mockReturnValue(480)
  vi.spyOn(body.firstElementChild as HTMLElement, 'offsetHeight', 'get').mockReturnValue(60)
  alignShortContentBody(slide)
  expect(slide.classList.contains('abele-slide-short-body')).toBe(true)
  prepareContentBody(slide)
  expect(slide.querySelectorAll('.abele-slide-content-heading')).toHaveLength(1)
  vi.spyOn(body.firstElementChild as HTMLElement, 'offsetHeight', 'get').mockReturnValue(180)
  alignShortContentBody(slide)
  expect(slide.classList.contains('abele-slide-short-body')).toBe(false)
})
it('does not center tables, media, code or an empty body', () => {
  for (const tag of ['table', 'img', 'pre']) {
    const slide = content()
    slide.querySelector('.abele-slide-region > div')!.append(document.createElement(tag))
    prepareContentBody(slide)
    expect(slide.querySelector('.abele-slide-content-body')).toBeNull()
  }
  const slide = content()
  slide.querySelector('p')!.remove()
  prepareContentBody(slide)
  alignShortContentBody(slide)
  expect(slide.classList.contains('abele-slide-short-body')).toBe(false)
})
