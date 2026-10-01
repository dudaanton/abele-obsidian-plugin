import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { noteCssImporter } from '@/slides/cssImportAdapter'
import { expandCssImports } from '@/slides/core/cssImports'
import { request } from '@/helpers/http'

vi.mock('@/helpers/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.mocked(request).mockReset())

describe('presentation stylesheet host adapter', () => {
  it('resolves vault imports and assets relative to each importing sheet', async () => {
    const app = buildFakeVault([
      { path: 'Decks/sample-deck.md', content: '' },
      {
        path: 'Decks/Styles/sample-root.css',
        content: '@import "./Parts/sample-part.css"; .sample-root { opacity: 1 }',
      },
      {
        path: 'Decks/Styles/Parts/sample-part.css',
        content: '.sample-part { background: url("../sample-icon.svg") }',
      },
      { path: 'Decks/Styles/sample-icon.svg', content: '<svg/>' },
    ])
    const loader = noteCssImporter(app as unknown as App, () => 'Decks/sample-deck.md')
    const source = await loader('[[Styles/sample-root.css]]')
    expect(source.id).toBe('Decks/Styles/sample-root.css')
    const css = await expandCssImports(source, loader)
    expect(css).not.toContain('@import')
    expect(css).toContain('app://sample/Decks/Styles/sample-icon.svg')
    expect(request).not.toHaveBeenCalled()
  })

  it('loads HTTP imports through the shared transport and keeps their URL base', async () => {
    vi.mocked(request).mockResolvedValue({ text: '.sample { opacity: .5 }' } as never)
    const app = buildFakeVault([])
    const loader = noteCssImporter(app as unknown as App, () => 'sample-deck.md')
    const source = await loader(
      '../sample-theme.css',
      'https://styles.example.test/Parts/sample-parent.css'
    )
    expect(request).toHaveBeenCalledWith({ url: 'https://styles.example.test/sample-theme.css' })
    expect(source.assetUrl!('sample-icon.svg')).toBe('https://styles.example.test/sample-icon.svg')
    expect(source.assetUrl!('#sample-symbol')).toBe('#sample-symbol')
  })

  it('loads data stylesheet imports as text rather than allowing the browser to import them globally', async () => {
    const app = buildFakeVault([])
    const loader = noteCssImporter(app as unknown as App, () => 'sample-deck.md')
    const data = 'data:text/css,' + encodeURIComponent('.sample-workspace { display: none }')
    const source = await loader(data)
    expect(source.css).toBe('.sample-workspace { display: none }')
    expect(request).not.toHaveBeenCalled()
  })
})
