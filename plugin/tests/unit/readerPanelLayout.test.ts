import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

it('gives the phone header and every footer state a solid theme background', () => {
  expect(css('reader/BookReader')).toMatch(
    /\.is-phone \.workspace-leaf-content\[data-type=["']?abele-book["']?\] > \.view-header,\s*\.is-phone \.abele-book-reader__foot\s*\{\s*background-color: var\(--background-primary\);/
  )
})

it('opens the phone panel at full width without a backdrop or page strip', () => {
  const rules = css('reader/BookReader')
  expect(rules).toMatch(
    /\.is-phone \.abele-book-reader__panel\s*\{[^}]*width: 100%;[^}]*box-shadow: none;[^}]*border-inline-end: none;/
  )
  expect(rules).toMatch(/\.is-phone \.abele-book-reader__backdrop\s*\{\s*display: none;/)
})

it('keeps conditional back and forward controls first in the reader row', () => {
  const source = readFileSync('src/components/reader/BookFooter.vue', 'utf8')
  expect(source.indexOf('v-if="model.canGoBack"')).toBeLessThan(
    source.indexOf('v-if="model.canGoForward"')
  )
  expect(source.indexOf('v-if="model.canGoForward"')).toBeLessThan(
    source.indexOf('v-if="model.kind')
  )
  expect(source).toContain('@click="emit(\'forward\')"')
})

function css(component: string): string {
  const source = readFileSync(`src/components/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
}

it('reserves focus paint space at both ends of the reader glyph strip', () => {
  const tabs = css('reader/BookReader').match(/\.abele-book-reader__panel-tabs\s*\{([^}]+)\}/)![1]
  expect(tabs).toContain('padding-inline: var(--size-4-1)')
})

it.each(['reader/BookReader', 'github/GithubLayout'])(
  '%s lets the panel reach its advertised split maximum',
  (component) => {
    const rules = css(component).match(
      /\.abele-(?:book-reader|github-layout)__panel\s*\{([^}]+)\}/
    )![1]
    expect(rules).toContain('max-width: 100%')
  }
)
