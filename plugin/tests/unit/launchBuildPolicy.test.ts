// @vitest-environment node
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'
import { buildArtifactPlugin } from '../../scripts/build-artifact.mjs'

it.each(['production', 'sharing-test'])(
  'bounds %s launch bytes without inline maps',
  async (mode) => {
    const loaded = await loadConfigFromFile({ mode, command: 'build' }, 'vite.config.mts')
    expect(loaded).toBeTruthy()
    // Explicit test activation lets qualification keep the optimized production emission.
    expect(loaded!.config.build?.minify).toBe('esbuild')
    expect(loaded!.config.build?.sourcemap).toBe(false)
    expect(loaded!.config.build?.rollupOptions?.output).toMatchObject({
      inlineDynamicImports: true,
    })
  }
)
it('keeps development source maps and test activation separate from optimized emission', async () => {
  const loaded = await loadConfigFromFile(
    { mode: 'development', command: 'build' },
    'vite.config.mts'
  )
  expect(loaded!.config.build?.sourcemap).toBe('inline')
  expect(loaded!.config.build?.minify).toBe(false)
  const test = await loadConfigFromFile(
    { mode: 'sharing-test', command: 'build' },
    'vite.config.mts'
  )
  expect(test!.config.define?.__ABELE_TEST_SHARING__).toBe('true')
  expect(test!.config.define?.['process.env.NODE_ENV']).toBe('"production"')
})
it.each(['production', 'sharing-test'])(
  'guards %s emitted launch bytes even without writing the build',
  (mode) => {
    const plugin = buildArtifactPlugin(fileURLToPath(new URL('../../..', import.meta.url)), mode)
    expect(plugin.generateBundle).toBeTypeOf('function')
    expect(() =>
      plugin.generateBundle(
        {},
        {
          'main.js': {
            type: 'chunk',
            code: '//# sourceMappingURL=data:application/json;base64,e30=',
          },
        }
      )
    ).toThrow(/source map/i)
    expect(() =>
      plugin.generateBundle(
        {},
        { 'main.js': { type: 'chunk', code: ' '.repeat(27 * 1024 * 1024) } }
      )
    ).toThrow(/budget/i)
  }
)
