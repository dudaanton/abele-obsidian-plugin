import { describe, expect, it, vi } from 'vitest'
import { expandCssImports } from '@/slides/core/cssImports'

const sheets: Record<string, string> = {
  'https://styles.example.test/sample-theme.css':
    '@import "sample-cycle.css"; .sample-theme { opacity: .7; background: url("sample-image.svg"); }',
  'https://styles.example.test/sample-cycle.css':
    '@import "sample-theme.css"; .sample-cycle { opacity: .8; }',
}
const loader = () =>
  vi.fn(async (ref: string, from = 'https://styles.example.test/') => {
    const id = new URL(ref, from).href
    if (!(id in sheets)) throw new Error('sample import is unavailable')
    return { id, css: sheets[id], assetUrl: (asset: string) => new URL(asset, id).href }
  })

describe('deck CSS import expansion', () => {
  it('resolves relative imports, keeps qualifiers and asset bases, and ends cycles', async () => {
    const load = loader()
    const result = await expandCssImports(
      {
        id: 'https://styles.example.test/sample-inline.css',
        css: '@import "sample-theme.css" layer(sample) supports(display: grid) screen and (min-width: 1px); h1 { opacity: 1 }',
      },
      load
    )
    expect(result).not.toMatch(/@import/i)
    expect(result).toContain('@layer sample')
    expect(result).toContain('@supports (display: grid)')
    expect(result).toContain('@media screen and (min-width: 1px)')
    expect(result).toContain('https://styles.example.test/sample-image.svg')
    expect(result).toContain('.sample-cycle')
    expect(load).toHaveBeenCalledTimes(3)
    expect(result.match(/\.sample-theme/g)).toHaveLength(1)
  })

  it('expands escaped import names and a final import without a semicolon', async () => {
    const result = await expandCssImports(
      {
        id: 'https://styles.example.test/sample-inline.css',
        css: String.raw`@\69mport url("sample-theme.css")`,
      },
      loader()
    )
    expect(result).not.toContain('import')
    expect(result).toContain('.sample-theme')
  })

  it('retains escaped qualifier identifiers and recognizes comments between import tokens', async () => {
    const result = await expandCssImports(
      {
        id: 'https://styles.example.test/sample-inline.css',
        css: String.raw`@import/* separator */"sample-theme.css" layer(sample\7b \7d );`,
      },
      loader()
    )
    expect(result).toContain(String.raw`@layer sample\7b \7d`)
    expect(result).toContain('.sample-theme')
    const commented = await expandCssImports(
      {
        id: 'https://styles.example.test/sample-inline.css',
        css: '@import/* separator */url("sample-theme.css");',
      },
      loader()
    )
    expect(commented).toContain('.sample-theme')
    expect(commented).not.toContain('@import')
  })

  it('keeps quoted import examples as values and drops failed imports without losing other rules', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await expandCssImports(
        {
          id: 'https://styles.example.test/sample-inline.css',
          css: '@import "sample-missing.css"; h1 { content: "@import is text"; opacity: 1 }',
        },
        loader()
      )
      expect(result).not.toContain('sample-missing.css')
      expect(result).toContain('content: "@import is text"')
      expect(result).toContain('opacity: 1')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
