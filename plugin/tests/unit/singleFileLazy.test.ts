// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { runInNewContext } from 'node:vm'

it('ships an accurate inline source map for inlined dynamic modules', async () => {
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
    ],
    build: {
      write: false,
      minify: false,
      sourcemap: 'inline',
      rollupOptions: { output: { inlineDynamicImports: true } },
      lib: { entry: '/sample/entry.js', formats: ['cjs'] },
    },
  })
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((one) => one.output)
    .find((one) => one.type === 'chunk')!
  const position = chunk.code.indexOf('sample source')
  expect(position).toBeGreaterThan(0)
  const lines = chunk.code.slice(0, position).split('\n')
  const encoded = chunk.code.match(
    /sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/
  )?.[1]
  expect(encoded).toBeTruthy()
  const emittedMap = JSON.parse(Buffer.from(encoded!, 'base64').toString())
  const mapping = new SourceMap(emittedMap).findEntry(lines.length - 1, lines.at(-1)!.length)
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
    ],
    build: {
      rollupOptions: { output: { inlineDynamicImports: true } },
      write: false,
      minify: false,
      lib: { entry: '/sample/entry.js', formats: ['cjs'] },
    },
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
