import { expect, it } from 'vitest'
import { externalIcon } from '@/components/external/externalFormat'

it.each([
  ['application/pdf', 'file'],
  ['application/epub+zip', 'file'],
  ['audio/mpeg', 'file-audio'],
])('uses the bundled file glyph for %s', (mime, icon) => {
  expect(externalIcon({ name: 'sample', mime })).toBe(icon)
})
