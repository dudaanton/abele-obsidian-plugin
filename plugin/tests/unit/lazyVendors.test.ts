// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { runInNewContext } from 'node:vm'

it('initializes standard CommonJS libraries once and preserves their APIs', async () => {
  const yaml = '/sample/node_modules/js-yaml/index.js'
  const qr = '/sample/node_modules/jsqr/dist/jsQR.js'
  const zip = '/sample/node_modules/fflate/lib/browser.cjs'
  const archive = '/sample/node_modules/jszip/lib/index.js'
  const code = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-vendors',
        resolveId: (id) =>
          id === '/sample/entry.js' || id === yaml || id === qr || id === zip || id === archive
            ? id
            : null,
        load(id) {
          if (id === '/sample/entry.js')
            return `import yaml from '${yaml}'; import qr from '${qr}'; import { Codec } from '${zip}'; import Archive from '${archive}'; export function read(){ return [yaml.load('sample'),qr('pixels'),new Codec().value,new Archive().value] }; export function keys(){return Object.keys(yaml)}; export function derived(){class Derived extends Archive{extra(){return 'derived'}};return new Derived().extra()}`
          if (id === yaml)
            return `globalThis.initialized.push('yaml'); exports.load = x => x; exports.CORE_SCHEMA = { sample: true };`
          if (id === archive)
            return `globalThis.initialized.push('archive'); module.exports = class { value = 'archive' };`
          if (id === zip)
            return `globalThis.initialized.push('zip'); exports.Codec = class { value = 'bytes' };`
          if (id === qr) return `globalThis.initialized.push('qr'); module.exports = x => x;`
        },
      },
    ],
    build: {
      commonjsOptions: { ignore: ['stream'] },
      write: false,
      minify: false,
      lib: { entry: '/sample/entry.js', formats: ['cjs'] },
    },
  })
  const outputs = (Array.isArray(code) ? code : [code]).flatMap((one) => one.output)
  const chunk = outputs.find((one) => one.type === 'chunk')!
  const initialized: string[] = [],
    module = { exports: {} as any }
  runInNewContext(chunk.code, {
    module,
    exports: module.exports,
    initialized,
    require() {
      throw new Error('Unexpected native import')
    },
  })
  // Standard bundling eagerly evaluates imports; the removed proxies deferred them.
  expect(initialized).toHaveLength(4)
  expect(module.exports.read()).toEqual(['sample', 'pixels', 'bytes', 'archive'])
  expect(module.exports.read()).toEqual(['sample', 'pixels', 'bytes', 'archive'])
  expect(initialized).toEqual(['yaml', 'qr', 'zip', 'archive'])
  expect(module.exports.keys()).toEqual(['load', 'CORE_SCHEMA'])
  expect(module.exports.derived()).toBe('derived')
})

it('keeps real YAML, QR and compression APIs intact in the standard bundle', async () => {
  const { resolve } = await import('node:path')
  const zip = resolve('node_modules/fflate/lib/browser.cjs')
  const archive = resolve('node_modules/jszip/lib/index.js')
  const code = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: { fflate: zip, jszip: archive, 'js-yaml': resolve('node_modules/js-yaml/index.js') },
    },
    plugins: [
      {
        name: 'sample-real-entry',
        enforce: 'pre',
        resolveId: (id) => (id === '/sample-real.js' ? id : null),
        load(id) {
          if (id === '/sample-real.js')
            return `import Archive from 'jszip'; export async function archive(){const zip = new Archive();zip.file('sample.txt','sample');return (await Archive.loadAsync(await zip.generateAsync({type:'uint8array'}))).file('sample.txt').async('string')}; import yaml from 'js-yaml'; import qr from 'jsqr'; import * as zip from 'fflate'; export {zip}; export function run(){ return { yaml:yaml.load(yaml.dump({sample:true,n:3})), zip:Array.from(zip.gunzipSync(zip.gzipSync(new Uint8Array([1,2,3])))), qr:qr(new Uint8ClampedArray(64).fill(255),4,4) }};`
        },
        transform(source, id) {
          if (id.startsWith('\0') || id.includes('?')) return null
          if (
            [
              '/js-yaml/index.js',
              '/jsqr/dist/jsQR.js',
              '/fflate/lib/browser.cjs',
              '/jszip/lib/index.js',
            ].some((end) => id.endsWith(end))
          )
            return (
              `globalThis.initialized.push(${JSON.stringify(id.split('/node_modules/').at(-1))});\n` +
              source
            )
        },
      },
    ],
    build: {
      commonjsOptions: { ignore: ['stream'] },
      write: false,
      minify: false,
      lib: { entry: '/sample-real.js', formats: ['cjs'] },
    },
  })
  const outputs = (Array.isArray(code) ? code : [code]).flatMap((one) => one.output)
  const initialized: string[] = [],
    module = { exports: {} as any }
  runInNewContext(outputs.find((one) => one.type === 'chunk')!.code, {
    module,
    exports: module.exports,
    initialized,
    Uint8Array,
    Uint8ClampedArray,
    setTimeout,
    clearTimeout,
    require: () => {
      throw new Error('No optional native streams')
    },
  })
  // Standard bundling eagerly evaluates imports; the removed proxies deferred them.
  expect(initialized).toHaveLength(4)
  expect(module.exports.run()).toEqual({ yaml: { sample: true, n: 3 }, zip: [1, 2, 3], qr: null })
  expect(module.exports.run()).toEqual({ yaml: { sample: true, n: 3 }, zip: [1, 2, 3], qr: null })
  expect(initialized).toHaveLength(4)
  expect(
    Object.keys(module.exports.zip)
      .filter((key) => key !== 'default')
      .sort()
  ).toEqual(Object.keys(module.exports.zip.default).sort())
  expect(await module.exports.archive()).toBe('sample')
  expect(initialized).toHaveLength(4)
})
