import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string): string {
  const source = readFileSync(`src/components/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
}

// A phone has neither a pointer to hover with nor a keyboard focus to tab to: a comment's edit
// and delete glyphs revealed only that way were not there at all, and the first tap was a hover.
it('shows a comment entry edit and delete glyphs on a phone without a hover', () => {
  const rules = [...css('TextCommentDialog').matchAll(/([^{}]+)\{([^}]+)\}/g)]
  const shown = rules.find(
    ([, selector, body]) =>
      /\.is-mobile\s+\.abele-text-comments__meta\s+\.clickable-icon/.test(selector) &&
      /opacity:\s*1/.test(body)
  )
  expect(shown).toBeDefined()
})
