import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compileString } from 'sass-embedded'

it('leaves horizontal focus paint inside the comments scroll boundary', () => {
  const source = readFileSync('src/components/TextCommentDialog.vue', 'utf8')
  const scss = source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]
  const sheet = document.createElement('style')
  sheet.textContent = compileString(scss).css
  document.head.append(sheet)
  try {
    const list = Array.from(sheet.sheet!.cssRules).find(
      (rule) => (rule as CSSStyleRule).selectorText === '.abele-text-comments__list'
    ) as CSSStyleRule
    expect(list.style.getPropertyValue('padding-inline')).toBe('var(--size-4-1)')
    expect(list.style.getPropertyValue('margin-inline')).toBe('calc(-1 * var(--size-4-1))')
  } finally {
    sheet.remove()
  }
})
