import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('gives the large title glyphs room beyond their tight line boxes', () => {
  const source = readFileSync('src/slides/core/layouts.css', 'utf8')
  const sheet = document.createElement('style')
  sheet.textContent = source
  document.head.append(sheet)
  try {
    const title = Array.from(sheet.sheet!.cssRules).find(
      (rule) => (rule as CSSStyleRule).selectorText === '.abele-slide-title h1'
    ) as CSSStyleRule
    expect(title.style.getPropertyValue('padding-block')).toBe('0.1em')
    expect(title.style.lineHeight).toBe('1.04')
  } finally {
    sheet.remove()
  }
})
