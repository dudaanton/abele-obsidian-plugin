import { UserConfig, defineConfig } from 'vite'
import path from 'path'
import builtins from 'builtin-modules'
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
          ...builtins,
        ],
      },
    },
  } as UserConfig
})
