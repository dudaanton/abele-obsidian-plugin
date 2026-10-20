// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { resolve } from 'node:path'

it('builds the guarded filesystem without a bundled or shimmed Node filesystem', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('src/sync/vaultPathLinks.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: { external: ['obsidian', '@abele/sync-sdk/core', '@noble/hashes/sha2'] },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunks = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .filter((chunk) => chunk.type === 'chunk')
  expect(chunks.length).toBeGreaterThan(0)
  const code = chunks.map((chunk) => chunk.code).join('\n')
  expect(code).not.toMatch(/node:fs|__vite-browser-external|browserExternal/)
  expect(code).toMatch(/window\.require\(["']fs["']\)/)
  expect(
    chunks
      .flatMap((chunk) => Object.keys(chunk.modules))
      .filter((id) => /node:fs|browser-external/.test(id))
  ).toEqual([])
})
