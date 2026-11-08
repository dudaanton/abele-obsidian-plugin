/** Resolve the real Vite config: an unknown top-level minify flag is silently ignored. */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('build compression', () => {
  it.each(['production', 'development', 'sharing-test'])(
    'sets the effective minifier for %s',
    (mode) => {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
      import { loadConfigFromFile } from 'vite'
      const { config } = await loadConfigFromFile({ command: 'build', mode: '${mode}' }, 'vite.config.mts')
      console.log(JSON.stringify({ minify: config.build.minify, misplaced: 'minify' in config,
        environment: JSON.parse(config.define['process.env.NODE_ENV']),
        vueProduction: config.plugins.find(plugin => plugin.name === 'vite:vue').api.options.isProduction,
        componentApiFenced: !!config.resolve.alias['@/testing/componentAccess'],
        testApiFenced: !!config.resolve.alias['@/testing/exposeTestApi'],
        sharing: JSON.parse(config.define.__ABELE_TEST_SHARING__) }))
    `,
          ],
          { encoding: 'utf8' }
        )
      )
      expect(result).toEqual({
        minify: mode !== 'development' ? 'esbuild' : false,
        misplaced: false,
        environment: mode !== 'development' ? 'production' : 'development',
        testApiFenced: mode === 'production',
        componentApiFenced: mode === 'production',
        vueProduction: mode !== 'development',
        sharing: mode === 'sharing-test',
      })
    }
  )
})
