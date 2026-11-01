// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { runInNewContext } from 'node:vm'
import { singleFileLazyPlugin } from '../../scripts/single-file-lazy.mjs'

it('embeds dynamic modules in one file without evaluating them before their first import', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-module',
        resolveId(id, from) {
          if (id === '/sample/entry.js') return id
          if (id === './optional.js' && from === '/sample/entry.js') return '/sample/optional.js'
        },
        load(id) {
          if (id === '/sample/entry.js')
            return `export async function read(){return (await import('./optional.js')).value}`
          if (id === '/sample/optional.js')
            return `globalThis.initialized++; export const value = {sample:true}`
        },
      },
      singleFileLazyPlugin(),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: '/sample/entry.js', formats: ['cjs'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output)
  const chunks = outputs.filter((one) => one.type === 'chunk')
  expect(chunks).toHaveLength(1)
  const module = { exports: {} as any },
    context = {
      module,
      exports: module.exports,
      initialized: 0,
      require() {
        throw new Error('Unexpected host import')
      },
    }
  runInNewContext(chunks[0].code, context)
  expect(context.initialized).toBe(0)
  const first = await module.exports.read()
  expect(first).toEqual({ sample: true })
  expect(await module.exports.read()).toBe(first)
  expect(context.initialized).toBe(1)
})

it('preserves shared module identity, live exports and failed-import caching', async () => {
  const sources = {
    '/sample/entry.js': `export async function read(){return import('./optional.js')}; export async function fail(){return import('./failed.js')}`,
    '/sample/optional.js': `export { value, increment } from './shared.js'; export { value as other } from './shared.js'`,
    '/sample/shared.js': `globalThis.initialized++; export let value=1; export function increment(){value++}`,
    '/sample/failed.js': `globalThis.failures++; throw new Error('sample failure'); export const unused=1`,
  }
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-shared',
        resolveId(id, from) {
          return id in sources ? id : from && id.startsWith('./') ? '/sample/' + id.slice(2) : null
        },
        load(id) {
          return sources[id]
        },
      },
      singleFileLazyPlugin(),
    ],
    build: { write: false, minify: false, lib: { entry: '/sample/entry.js', formats: ['cjs'] } },
  })
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((one) => one.output)
    .filter((one) => one.type === 'chunk')
  expect(chunks).toHaveLength(1)
  const module = { exports: {} as any },
    context = {
      module,
      exports: module.exports,
      initialized: 0,
      failures: 0,
      require() {
        throw new Error('Unexpected host import')
      },
    }
  runInNewContext(chunks[0].code, context)
  expect(context.initialized).toBe(0)
  const first = await module.exports.read()
  expect(first).toBe(await module.exports.read())
  expect(context.initialized).toBe(1)
  first.increment()
  expect([first.value, first.other]).toEqual([2, 2])
  await expect(module.exports.fail()).rejects.toThrow('sample failure')
  await expect(module.exports.fail()).rejects.toThrow('sample failure')
  expect(context.failures).toBe(1)
})

it('keeps source maps accurate for code inside deferred factories', async () => {
  const { SourceMap } = await import('node:module')
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-map',
        resolveId(id, from) {
          return id === '/sample/entry.js' || (from && id === './optional.js')
            ? id === './optional.js'
              ? '/sample/optional.js'
              : id
            : null
        },
        load(id) {
          if (id === '/sample/entry.js')
            return `export async function read(){return (await import('./optional.js')).value()}`
          if (id === '/sample/optional.js')
            return `export function value(){\n  throw new Error('sample source');\n}`
        },
      },
      singleFileLazyPlugin(),
    ],
    build: {
      write: false,
      minify: false,
      sourcemap: true,
      lib: { entry: '/sample/entry.js', formats: ['cjs'] },
    },
  })
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((one) => one.output)
    .find((one) => one.type === 'chunk')!
  const position = chunk.code.indexOf('sample source')
  expect(position).toBeGreaterThan(0)
  const lines = chunk.code.slice(0, position).split('\n')
  const mapping = new SourceMap(JSON.parse(chunk.map!.toString())).findEntry(
    lines.length - 1,
    lines.at(-1)!.length
  )
  expect(mapping.originalSource).toMatch(/sample\/optional\.js$/)
  expect(mapping.originalLine).toBe(1)
})

it('preserves native URL imports used by embedded browser modules', async () => {
  const { constants } = await import('node:vm')
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-native-import',
        resolveId: (id) => (id === '/sample/entry.js' ? id : null),
        load: (id) =>
          id === '/sample/entry.js'
            ? `export function read(url){return import(/* @vite-ignore */ url)}`
            : null,
      },
      singleFileLazyPlugin(),
    ],
    build: { write: false, minify: false, lib: { entry: '/sample/entry.js', formats: ['cjs'] } },
  })
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((one) => one.output)
    .find((one) => one.type === 'chunk')!
  const module = { exports: {} as any }
  runInNewContext(
    chunk.code,
    {
      module,
      exports: module.exports,
      require() {
        throw new Error('URL import became a native require')
      },
    },
    { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }
  )
  expect((await module.exports.read('data:text/javascript,export default "sample"')).default).toBe(
    'sample'
  )
})
