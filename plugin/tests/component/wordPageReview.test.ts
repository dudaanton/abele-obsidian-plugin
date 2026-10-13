import { expect, it } from 'vitest'
import source from '@/word/WordPage.vue?raw'

it('does not paint-contain the table and clip the edited cell focus ring', () => {
  const tableStyle = source.match(/\.abele-word-page__table\s*\{([^}]+)\}/)?.[1]
  expect(tableStyle).toBeDefined()
  expect(tableStyle).not.toMatch(/content-visibility|contain-intrinsic-size|contain\s*:/)
})
