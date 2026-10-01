import { defineConfig } from 'vite'
import path from 'path'
import { readFileSync } from 'node:fs'
import { generateChangelog } from './scripts/changelog.mjs'
import { builtinModules } from 'node:module'
import vue from '@vitejs/plugin-vue'
import replace from '@rollup/plugin-replace'
import { build as esbuild } from 'esbuild'
import { createRequire } from 'node:module'
import { EVAL_START_INTRO } from './src/helpers/loadMarks'

/**
 * MapLibre's worker, bundled into a string the plugin can carry.
 *
 * MapLibre loads its worker as a second file, resolved relative to its own URL. A plugin is
 * one `main.js` with nothing beside it, so that resolution yields an empty string and every
 * map comes up blank. The worker and the chunk it imports are bundled here at build time and
 * handed to MapLibre as a blob at runtime (`helpers/mapRender.ts`).
 */
function maplibreWorkerPlugin(prod: boolean) {
  const virtualId = 'virtual:maplibre-worker'
  const resolvedId = '\0' + virtualId

  return {
    name: 'abele-maplibre-worker',
    resolveId(id: string) {
      return id === virtualId ? resolvedId : null
    },
    async load(id: string) {
      if (id !== resolvedId) return null

      const require = createRequire(import.meta.url)
      const entry = require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')
      const bundled = await esbuild({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: prod,
        target: 'es2020',
      })

      return `export default ${JSON.stringify(bundled.outputFiles[0].text)}`
    },
  }
}

export default defineConfig(async ({ mode }) => {
  const { resolve } = path
  const prod = mode === 'production'

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins: [
      vue(),
      maplibreWorkerPlugin(prod),
      {
        name: 'abele-changelog',
        resolveId(id: string) {
          return id === 'virtual:abele-changelog' ? '\0virtual:abele-changelog' : null
        },
        load(id: string) {
          if (id !== '\0virtual:abele-changelog') return null
          const releases = generateChangelog(undefined, {
            onUnrecognized: (subjects: { revision: string; subject: string }[]) => {
              if (subjects.length)
                console.warn(
                  `[Abele changelog] ${subjects.length} uncategorized historical subjects omitted; review with node scripts/review-changelog.mjs`
                )
            },
          })
          const version = JSON.parse(
            readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8')
          ).version
          return `export const runningVersion = ${JSON.stringify(version)}; export default ${JSON.stringify(releases)}`
        },
      },
    ],
    build: {
      minify: prod ? 'esbuild' : false,
      lib: {
        entry: resolve(__dirname, 'src/main.ts'),
        name: 'main',
        fileName: () => 'main.js',
        formats: ['cjs'],
      },
      sourcemap: prod ? false : 'inline',
      cssCodeSplit: false,
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        output: {
          /**
           * One file, always. A dynamic `import()` of a bundled dependency otherwise becomes
           * its own chunk that `main.js` requires at runtime — and the release publishes only
           * `main.js`, `manifest.json` and `styles.css`, so that chunk never reaches a vault
           * and the feature behind the import throws. `script.unzip()` shipped broken this
           * way. See docs/Testing.md.
           */
          inlineDynamicImports: true,
          // The first statement of the file: the load-time probe tells Obsidian reading and
          // compiling `main.js` apart from the modules running. See `src/helpers/loadMarks.ts`.
          intro: EVAL_START_INTRO,
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'main.css'
            }
            return '[name].[ext]'
          },
        },
        input: {
          main: resolve(__dirname, 'src/main.ts'),
        },
        plugins: [
          replace({
            'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
          }),
        ],
        external: [
          'obsidian',
          'electron',
          '@codemirror/autocomplete',
          '@codemirror/collab',
          '@codemirror/commands',
          '@codemirror/language',
          '@codemirror/lint',
          '@codemirror/search',
          '@codemirror/state',
          '@codemirror/view',
          '@lezer/common',
          '@lezer/highlight',
          '@lezer/lr',
          ...builtinModules,
        ],
      },
    },
  }
})
