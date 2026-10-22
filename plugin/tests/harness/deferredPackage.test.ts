// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { build } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { deferredPackagePlugin } from '../../scripts/deferred-package.mjs'

describe('deferred packages in the single-file build', () => {
  it('defers pele module evaluation in the production configuration', () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { loadConfigFromFile } from 'vite'
      const {config} = await loadConfigFromFile({command:'build',mode:'production'}, 'vite.config.mts')
      console.log(JSON.stringify({
        inline:config.build.rollupOptions.output.inlineDynamicImports,
        deferred:config.plugins.some(plugin => plugin.name === 'abele-deferred-package' && plugin.api?.source === 'pele/lazy')
      }))
    `,
      ],
      { encoding: 'utf8' }
    )
    expect(JSON.parse(result)).toEqual({ inline: true, deferred: true })
  })
  it('keeps real pele rendering and flowchart parsing available through the factory', async () => {
    const scratchRoot = resolve('.scratch')
    mkdirSync(scratchRoot, { recursive: true })
    const scratch = mkdtempSync(join(scratchRoot, 'deferred-pele-'))
    try {
      const entry = join(scratch, 'entry.js')
      writeFileSync(
        entry,
        `
        export async function draw(source) { return (await import('pele/lazy')).renderAsync(source) }
        export async function parse(source) { const pele = await import('pele/lazy'); await pele.load('flowchart'); return pele.parse(source).type }
      `
      )
      await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
          deferredPackagePlugin({
            source: 'pele/lazy',
            exports: ['renderAsync', 'load', 'parse'],
            target: 'es2022',
            minify: true,
          }),
        ],
        build: {
          minify: 'esbuild',
          outDir: join(scratch, 'out'),
          lib: { entry, formats: ['cjs'], fileName: () => 'main.cjs' },
          rollupOptions: { output: { inlineDynamicImports: true } },
        },
      })
      const require = createRequire(resolve('package.json'))
      const loaded = require(join(scratch, 'out/main.cjs')) as {
        draw(source: string): Promise<{ type: string; width: number }>
        parse(source: string): Promise<string>
      }
      expect(await loaded.parse('flowchart LR\n A --> B')).toBe('flowchart')
      for (const source of ['sequenceDiagram\n A->>B: Hello', 'xychart-beta\n bar [2, 4]']) {
        expect((await loaded.draw(source)).width).toBeGreaterThan(0)
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
  it.each([false, 'esbuild'] as const)(
    'does not run a module body before first use (minify %s)',
    async (minify) => {
      const scratchRoot = resolve('.scratch')
      mkdirSync(scratchRoot, { recursive: true })
      const scratch = mkdtempSync(join(scratchRoot, 'deferred-package-'))
      const probe = globalThis as typeof globalThis & { sampleModuleStarts?: number }
      try {
        const heavy = join(scratch, 'heavy.js')
        const entry = join(scratch, 'entry.js')
        writeFileSync(
          heavy,
          'globalThis.sampleModuleStarts = (globalThis.sampleModuleStarts ?? 0) + 1; export function read(){return 42}'
        )
        writeFileSync(
          entry,
          'export async function read(){return (await import("sample-heavy")).read()}'
        )
        await build({
          configFile: false,
          logLevel: 'silent',
          plugins: [
            deferredPackagePlugin({
              source: 'sample-heavy',
              entry: heavy,
              exports: ['read'],
              target: 'es2022',
              minify: !!minify,
            }),
          ],
          resolve: { alias: { 'sample-heavy': heavy } },
          build: {
            minify,
            outDir: join(scratch, 'out'),
            lib: { entry, formats: ['cjs'], fileName: () => 'main.cjs' },
            rollupOptions: { output: { inlineDynamicImports: true } },
          },
        })
        const require = createRequire(resolve('package.json'))
        const loaded = require(join(scratch, 'out/main.cjs')) as { read(): Promise<number> }
        expect(probe.sampleModuleStarts).toBeUndefined()
        expect(await loaded.read()).toBe(42)
        expect(probe.sampleModuleStarts).toBe(1)
        expect(await loaded.read()).toBe(42)
        expect(probe.sampleModuleStarts).toBe(1)
      } finally {
        delete probe.sampleModuleStarts
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )
})
