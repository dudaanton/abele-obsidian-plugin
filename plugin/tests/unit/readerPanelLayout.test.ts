import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string): string {
  const source = readFileSync(`src/components/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
}

it('reserves focus paint space at both ends of the reader glyph strip', () => {
  const tabs = css('reader/BookReader').match(/\.abele-book-reader__panel-tabs\s*\{([^}]+)\}/)![1]
  expect(tabs).toContain('padding-inline: var(--size-4-1)')
})
