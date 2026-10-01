/** Resolve the real Vite config: an unknown top-level minify flag is silently ignored. */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('build compression', () => {
  it.each(['production', 'development'])('sets the effective minifier for %s', (mode) => {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import { loadConfigFromFile } from 'vite'
      const { config } = await loadConfigFromFile({ command: 'build', mode: '${mode}' }, 'vite.config.mts')
      console.log(JSON.stringify({ minify: config.build.minify, misplaced: 'minify' in config }))
    `,
        ],
        { encoding: 'utf8' }
      )
    )
    expect(result).toEqual({ minify: mode === 'production' ? 'esbuild' : false, misplaced: false })
  })
})
