import { UserConfig, defineConfig } from 'vite'
import path from 'path'
import { builtinModules } from 'node:module'
import vue from '@vitejs/plugin-vue'
import replace from '@rollup/plugin-replace'

export default defineConfig(async ({ mode }) => {
  const { resolve } = path
  const prod = mode === 'production'

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins: [vue()],
    minify: prod,
    build: {
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
  } as UserConfig
})
