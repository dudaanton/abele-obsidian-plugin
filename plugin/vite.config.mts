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
import { assertNoTestingModules } from './scripts/production-test-guard.mjs'

/**
 * Carry MapLibre's three ESM assets in the single plugin file. The main and worker assets
 * import one embedded shared asset, rewritten to the same Blob URL on first use. Bundling
 * the shared code into both realms instead would store roughly half a megabyte twice.
 */
function maplibreAssetsPlugin(prod: boolean) {
  const virtualId = 'virtual:maplibre-assets'
  const resolvedId = '\0' + virtualId
  return {
    name: 'abele-maplibre-assets',
    resolveId(id: string) {
      return id === virtualId ? resolvedId : null
    },
    async load(id: string) {
      if (id !== resolvedId) return null
      const require = createRequire(import.meta.url)
      const assets: Record<string, string> = {}
      for (const [name, file] of Object.entries({
        shared: 'maplibre-gl-shared.mjs',
        main: 'maplibre-gl.mjs',
        worker: 'maplibre-gl-worker.mjs',
      })) {
        const bundled = await esbuild({
          entryPoints: [require.resolve(`maplibre-gl/dist/${file}`)],
          bundle: true,
          write: false,
          format: 'esm',
          platform: 'browser',
          minify: prod,
          target: 'es2020',
          plugins: [
            {
              name: 'abele-maplibre-shared-external',
              setup(build) {
                build.onResolve({ filter: /maplibre-gl-shared\.mjs$/ }, (args) =>
                  args.kind === 'entry-point'
                    ? undefined
                    : { path: 'abele-maplibre-shared', external: true }
                )
              },
            },
          ],
        })
        assets[name] = bundled.outputFiles[0].text
      }
      return `export default ${JSON.stringify(assets)}`
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
        // JSZip's browser distribution embeds legacy polyfills, bypassing package aliases.
        // Use its modular entry so both schedulers can be replaced without editing dependencies.
        jszip: path.resolve(__dirname, 'node_modules/jszip/lib/index.js'),
        immediate: path.resolve(__dirname, 'src/shims/immediate.ts'),
        setimmediate: path.resolve(__dirname, 'src/shims/setimmediate.ts'),
      },
    },
    plugins: [
      vue(),
      maplibreAssetsPlugin(prod),
      {
        name: 'abele-optional-node-streams',
        load(id: string) {
          if (id !== path.resolve(__dirname, 'node_modules/jszip/lib/readable-stream-browser.js'))
            return null
          // Obsidian's mobile require emits a notice even when JSZip catches its error.
          // Keep desktop Node streams, but never attempt that forbidden import on mobile.
          return `const { Platform } = require('obsidian'); module.exports = Platform.isMobile ? {} : require('stream')`
        },
      },
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
      ...(prod
        ? [
            {
              name: 'abele-no-production-testing',
              generateBundle(_options: unknown, bundle: unknown) {
                assertNoTestingModules(bundle)
              },
            },
          ]
        : []),
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
      // JSZip probes Node streams inside try/catch. Hoisting that optional require makes
      // the modular entry crash on mobile before the probe can handle its absence.
      commonjsOptions: { ignore: ['stream'] },
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
