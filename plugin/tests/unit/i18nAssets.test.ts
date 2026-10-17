import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { buildCatalogAssets } from '../../scripts/i18n-assets.mjs'

it('builds versioned, hashed JSON assets without bundling translated prose', async () => {
  const { assets, hashes } = await buildCatalogAssets(resolve('.'), '1.2.3')
  expect(Object.keys(assets).sort()).toEqual(
    ['de', 'es', 'lv', 'ru'].map((lang) => `abele-i18n-${lang}.json`)
  )
  for (const text of Object.values(assets)) {
    const value = JSON.parse(text as string)
    expect(value.version).toBe('1.2.3')
    expect(hashes[value.language]).toBe(
      createHash('sha256')
        .update(text as string)
        .digest('hex')
    )
    expect(Object.keys(value.catalog).length).toBeGreaterThan(100)
  }
  const result = await build({
    entryPoints: ['src/i18n/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
  })
  const code = result.outputFiles[0].text
  expect(code).toContain('Waveform')
  expect(code).not.toContain('Звуковая волна')
  expect(code).not.toContain('\\u0417\\u0432\\u0443')
  expect(result.outputFiles).toHaveLength(1)
})
